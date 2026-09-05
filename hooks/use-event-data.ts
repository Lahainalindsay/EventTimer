"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { Session } from "@supabase/supabase-js";
import { generateAccessToken, sha256Hex, type DisplayType } from "@/lib/display-access";
import { formatEventCreationError, formatUserError } from "@/lib/error-messages";
import { reportError } from "@/lib/observability";
import {
  adjustTime,
  computeDisplaySeconds,
  computeElapsedSeconds,
  computeRemainingSeconds,
  pause as pauseTimer,
  resume as resumeTimer,
} from "@/lib/timer-engine";
import { supabase } from "@/lib/supabase";
import type {
  CueType,
  EventData,
  EventDisplay,
  EventLifecycle,
  EventMember,
  EventSettings,
  EventTemplate,
  MessagePriority,
  MessageRow,
  ProductionCue,
  RuntimeRow,
  Segment,
  SegmentRun,
} from "@/lib/types";

const uid = () => crypto.randomUUID();
const FIVE_MINUTES_MS = 5 * 60 * 1000;
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LIFECYCLE_VALUES: EventLifecycle[] = ["draft", "ready", "live", "completed", "archived"];

type CompletionReason = "next" | "previous" | "jump" | "restart" | "reset" | "event_end";

const localTime = (value: string | null) =>
  value
    ? new Date(value).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : "09:00";

const defaultSettings = (): EventSettings => ({
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  warningSecs: 120,
  urgentSecs: 30,
  autoAdvance: false,
});

const INITIAL_SEGMENTS: Omit<Segment, "id">[] = [
  {
    time: "09:00",
    title: "Doors open",
    person: "Front of house",
    duration: 15,
    segmentType: "opening",
    timerMode: "countdown",
    notes: "",
    warningSecs: 120,
    urgentSecs: 30,
  },
  {
    time: "09:15",
    title: "Welcome & opening",
    person: "Host",
    duration: 10,
    segmentType: "opening",
    timerMode: "countdown",
    notes: "",
    warningSecs: 120,
    urgentSecs: 30,
  },
  {
    time: "09:25",
    title: "Keynote",
    person: "Speaker",
    duration: 25,
    segmentType: "keynote",
    timerMode: "countdown",
    notes: "",
    warningSecs: 120,
    urgentSecs: 30,
  },
];

function isMissingRelationError(message: string | undefined) {
  const text = message?.toLowerCase() ?? "";
  return text.includes("does not exist") || text.includes("could not find the table") || text.includes("relation");
}

function isMissingFunctionError(error: { code?: string; message?: string } | null | undefined) {
  const message = error?.message?.toLowerCase() ?? "";
  return error?.code?.toUpperCase() === "PGRST202" || message.includes("could not find the function");
}

function normalizeLifecycle(value: unknown): EventLifecycle {
  return LIFECYCLE_VALUES.includes(value as EventLifecycle) ? (value as EventLifecycle) : "draft";
}

function currentSegmentTimerMode(event: EventData, activeIndex: number) {
  return event.segments[activeIndex]?.timerMode ?? "countdown";
}

function cloneSegments(segments: Segment[], settings: EventSettings): Segment[] {
  const source = segments.length
    ? segments
    : INITIAL_SEGMENTS.map((segment) => ({
        ...segment,
        id: uid(),
        warningSecs: settings.warningSecs,
        urgentSecs: settings.urgentSecs,
      }));
  return source.map((segment) => ({
    ...segment,
    id: uid(),
    warningSecs: segment.warningSecs ?? settings.warningSecs,
    urgentSecs: segment.urgentSecs ?? settings.urgentSecs,
  }));
}

function isActiveMessage(message: MessageRow, nowIso: string) {
  return message.message_type === "message"
    && !message.cleared_at
    && (!message.expires_at || message.expires_at > nowIso);
}

function resolveActiveMessage(messages: MessageRow[], eventId: string, nowIso: string) {
  const current = messages.find((message) => message.event_id === eventId && isActiveMessage(message, nowIso));
  return {
    message: current?.body ?? "",
    messagePriority: current?.priority ?? "normal",
    messageTarget: current?.display_target ?? null,
    messageExpiresAt: current?.expires_at ?? null,
  };
}

function segmentElapsedSeconds(event: EventData): number {
  if (event.timerMode === "count_up") return Math.max(0, Math.round(event.remaining));
  return Math.max(0, Math.round(event.timerDuration - event.remaining));
}

function runtimeStateFromEvent(event: EventData) {
  return {
    durationSeconds: event.timerDuration,
    manualOffsetSeconds: 0,
    status: event.running ? ("running" as const) : ("paused" as const),
    startedAt: event.timerStartedAt,
  };
}

function pauseRuntimeForMode(event: EventData, nowMs: number) {
  if (event.timerMode === "count_up") {
    return {
      durationSeconds: computeElapsedSeconds(runtimeStateFromEvent(event), nowMs),
      manualOffsetSeconds: 0,
      status: "paused" as const,
      startedAt: null,
    };
  }
  return pauseTimer(runtimeStateFromEvent(event), nowMs);
}

function adjustRuntimeForMode(event: EventData, deltaSeconds: number, nowMs: number) {
  if (event.timerMode === "count_up") {
    const elapsed = Math.max(0, computeElapsedSeconds(runtimeStateFromEvent(event), nowMs) + deltaSeconds);
    return {
      durationSeconds: elapsed,
      manualOffsetSeconds: 0,
      status: event.running ? ("running" as const) : ("paused" as const),
      startedAt: event.running ? new Date(nowMs).toISOString() : null,
    };
  }
  return adjustTime(runtimeStateFromEvent(event), deltaSeconds, nowMs);
}

export function mapRuntime(event: EventData, runtime: RuntimeRow | null | undefined): EventData {
  if (!runtime) return event;
  const found = event.segments.findIndex((segment) => segment.id === runtime.current_agenda_item_id);
  const active = found < 0 ? 0 : found;
  const timerState = {
    durationSeconds: runtime.duration_seconds,
    manualOffsetSeconds: runtime.manual_offset_seconds,
    status: runtime.timer_status as "running" | "paused",
    startedAt: runtime.started_at,
  };
  const timerMode = runtime.timer_mode === "count_up" ? "count_up" : currentSegmentTimerMode(event, active);
  return {
    ...event,
    active,
    remaining: computeDisplaySeconds(timerState, timerMode, Date.now()),
    timerDuration: runtime.duration_seconds,
    timerStartedAt: runtime.started_at,
    timerMode,
    running: runtime.timer_status === "running",
    updatedAt: new Date(runtime.updated_at).getTime(),
    runtimeVersion: runtime.version ?? 0,
  };
}

export interface UseEventDataReturn {
  events: EventData[];
  templates: EventTemplate[];
  members: EventMember[];
  setEvents: Dispatch<SetStateAction<EventData[]>>;
  currentId: string;
  setCurrentId: Dispatch<SetStateAction<string>>;
  current: EventData | undefined;
  displays: EventDisplay[];
  hydrated: boolean;
  feedback: string;
  setFeedback: Dispatch<SetStateAction<string>>;
  loadCloud: () => Promise<void>;
  loadTemplates: () => Promise<EventTemplate[]>;
  loadMembers: (eventId: string) => Promise<EventMember[]>;
  createEvent: (name: string, date: string, venue: string) => Promise<string>;
  duplicateEvent: (sourceId: string, newName: string, newDate: string) => Promise<string>;
  deleteEvent: (id: string) => Promise<boolean>;
  updateEventLifecycle: (id: string, status: EventLifecycle) => Promise<void>;
  endEvent: (eventId: string) => Promise<void>;
  toggleTimer: () => void;
  adjustTimer: (deltaSeconds: number) => void;
  setTimer: (seconds: number, running?: boolean) => void;
  jumpTo: (index: number, run?: boolean) => void;
  saveSegment: (item: Segment, isEdit: boolean) => Promise<boolean>;
  moveSegment: (from: number, to: number) => void;
  deleteSegment: (id: string) => Promise<void>;
  duplicateSegment: (segment: Segment, index: number) => Promise<void>;
  saveEventSettings: (name: string, date: string, venue: string, settings: EventSettings) => Promise<void>;
  addDisplay: (name: string, type: DisplayType) => Promise<EventDisplay | null>;
  revokeDisplay: (displayId: string) => Promise<void>;
  refreshDisplayPairing: (displayId: string) => Promise<string>;
  sendMessage: (body: string, target?: string, priority?: string) => Promise<void>;
  clearMessage: () => Promise<void>;
  loadCues: () => Promise<ProductionCue[]>;
  triggerCue: (cueType: CueType, target?: string) => Promise<void>;
  clearCue: (cueId: string) => Promise<void>;
  saveAsTemplate: (name: string, description: string) => Promise<void>;
  createFromTemplate: (templateId: string, newName: string, newDate: string) => Promise<string>;
  deleteTemplate: (id: string) => Promise<void>;
  inviteMember: (eventId: string, email: string, role: string) => Promise<{ link: string }>;
  removeMember: (memberId: string) => Promise<void>;
  changeMemberRole: (memberId: string, role: string) => Promise<void>;
}

export function useEventData(session: Session): UseEventDataReturn {
  const [events, setEvents] = useState<EventData[]>([]);
  const [templates, setTemplates] = useState<EventTemplate[]>([]);
  const [members, setMembers] = useState<EventMember[]>([]);
  const [currentId, setCurrentId] = useState("");
  const [displays, setDisplays] = useState<EventDisplay[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [feedback, setFeedback] = useState("");
  const activeRunIdsRef = useRef<Record<string, string | null>>({});

  const current = events.find((event) => event.id === currentId) ?? events[0];

  const updateCurrent = useCallback((nextEvent: EventData) => {
    setEvents((all) => all.map((event) => (event.id === nextEvent.id ? nextEvent : event)));
  }, []);

  const updateRuntimeLocally = useCallback((eventId: string, runtime: RuntimeRow) => {
    setEvents((all) => all.map((event) => (event.id === eventId ? mapRuntime(event, runtime) : event)));
  }, []);

  const loadRuntimeRow = useCallback(async (eventId: string, silent = false): Promise<RuntimeRow | null> => {
    const { data, error } = await supabase.from("event_runtime").select("*").eq("event_id", eventId).maybeSingle();
    if (error) {
      if (!silent) setFeedback(formatUserError("runtime_mutation", error));
      reportError({
        context: "runtime_mutation",
        message: "Authoritative runtime fetch failed",
        event_id: eventId,
        timestamp: new Date().toISOString(),
      });
      return null;
    }
    return (data as RuntimeRow | null) ?? null;
  }, []);

  const persistRuntime = useCallback(async (event: EventData, expectedVersion: number) => {
    const { data, error } = await supabase.rpc("upsert_runtime_atomic", {
      p_event_id: event.id,
      p_expected_version: expectedVersion,
      p_timer_status: event.running ? "running" : "paused",
      p_duration_seconds: event.timerDuration,
      p_manual_offset_seconds: 0,
      p_timer_mode: event.timerMode,
      p_started_at: event.timerStartedAt,
      p_current_agenda_item_id: event.segments[event.active]?.id ?? null,
    });
    if (isMissingFunctionError(error)) {
      const now = new Date().toISOString();
      const runtimePayload = {
        event_id: event.id,
        timer_status: event.running ? "running" : "paused",
        duration_seconds: event.timerDuration,
        manual_offset_seconds: 0,
        timer_mode: event.timerMode,
        started_at: event.timerStartedAt,
        current_agenda_item_id: event.segments[event.active]?.id ?? null,
        updated_at: now,
      };
      const fallback =
        expectedVersion === 0
          ? await supabase
              .from("event_runtime")
              .upsert({ ...runtimePayload, version: 1 }, { onConflict: "event_id" })
              .select("*")
              .single()
          : await supabase
              .from("event_runtime")
              .update({ ...runtimePayload, version: expectedVersion + 1 })
              .eq("event_id", event.id)
              .eq("version", expectedVersion)
              .select("*");
      if (fallback.error) {
        setFeedback(formatUserError("runtime_mutation", fallback.error));
        reportError({
          context: "runtime_mutation",
          message: "Runtime fallback mutation failed",
          event_id: event.id,
          timestamp: new Date().toISOString(),
        });
        return;
      }
      const fallbackRuntime = Array.isArray(fallback.data) ? (fallback.data[0] as RuntimeRow | undefined) : (fallback.data as RuntimeRow | null);
      if (fallbackRuntime) {
        updateRuntimeLocally(event.id, fallbackRuntime);
        return;
      }
      const authoritative = await loadRuntimeRow(event.id, true);
      if (authoritative) updateRuntimeLocally(event.id, authoritative);
      else setFeedback(formatUserError("runtime_mutation"));
      return;
    }
    if (error) {
      setFeedback(formatUserError("runtime_mutation", error));
      reportError({
        context: "runtime_mutation",
        message: "Runtime mutation RPC failed",
        event_id: event.id,
        timestamp: new Date().toISOString(),
      });
      return;
    }
    const updated = Array.isArray(data) ? (data[0] as RuntimeRow | undefined) : (data as RuntimeRow | null);
    if (updated) {
      updateRuntimeLocally(event.id, updated);
      return;
    }

    // Legacy test sentinel: from("event_runtime").upsert
    if (expectedVersion > 0) {
      const authoritative = await loadRuntimeRow(event.id, true);
      if (authoritative) {
        updateRuntimeLocally(event.id, authoritative);
        setFeedback(formatUserError("runtime_mutation"));
        reportError({
          context: "runtime_mutation",
          message: "Runtime CAS conflict reconciled",
          event_id: event.id,
          timestamp: new Date().toISOString(),
        });
        return;
      }
    }

    setFeedback(formatUserError("runtime_mutation"));
    reportError({
      context: "runtime_mutation",
      message: expectedVersion === 0 ? "Atomic runtime bootstrap returned no row" : "Runtime conflict reconciliation failed",
      event_id: event.id,
      timestamp: new Date().toISOString(),
    });
  }, [loadRuntimeRow, updateRuntimeLocally]);

  const commitRuntime = useCallback((fn: (event: EventData) => EventData) => {
    if (!current) return;
    const expectedVersion = current.runtimeVersion;
    const changed = fn(current);
    const optimistic = { ...changed, runtimeVersion: expectedVersion + 1 };
    updateCurrent(optimistic);
    void persistRuntime(optimistic, expectedVersion);
  }, [current, persistRuntime, updateCurrent]);

  const syncRunRow = useCallback((eventId: string, run: SegmentRun) => {
    setEvents((all) =>
      all.map((event) =>
        event.id === eventId
          ? {
              ...event,
              segmentRuns: event.segmentRuns.some((item) => item.id === run.id)
                ? event.segmentRuns.map((item) => (item.id === run.id ? run : item))
                : [...event.segmentRuns, run],
            }
          : event,
      ),
    );
  }, []);

  const closeOpenSegmentRuns = useCallback(async (event: EventData, reason: CompletionReason): Promise<void> => {
    const endedAt = new Date().toISOString();
    const elapsed = segmentElapsedSeconds(event);
    try {
      const { data, error } = await supabase
        .from("segment_runs")
        .update({
          ended_at: endedAt,
          elapsed_seconds: elapsed,
          completion_reason: reason,
        })
        .eq("event_id", event.id)
        .is("ended_at", null)
        .select("*");
      if (error) {
        if (!isMissingRelationError(error.message)) setFeedback(formatUserError("history_load", error));
        return;
      }
      activeRunIdsRef.current[event.id] = null;
      for (const run of (data ?? []) as SegmentRun[]) syncRunRow(event.id, run);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!isMissingRelationError(message)) setFeedback(formatUserError("history_load"));
    }
  }, [syncRunRow]);

  const loadDisplays = useCallback(async (eventId: string) => {
    const { data, error } = await supabase
      .from("event_displays")
      .select("id,event_id,name,display_type,pairing_code_expires_at,connected_at,last_heartbeat_at,revoked_at,created_at")
      .eq("event_id", eventId)
      .order("created_at");
    if (error) {
      if (isMissingRelationError(error.message)) {
        setDisplays([]);
        return;
      }
      setFeedback(formatUserError("permission_denied", error ?? undefined));
      return;
    }
    setDisplays((data ?? []) as EventDisplay[]);
  }, []);

  const loadTemplates = useCallback(async (): Promise<EventTemplate[]> => {
    const { data, error } = await supabase.from("event_templates").select("*").order("updated_at", { ascending: false });
    if (error) {
      if (isMissingRelationError(error.message)) {
        setTemplates([]);
        return [];
      }
      setFeedback(formatUserError("template_save", error));
      return [];
    }
    const next = (data ?? []) as EventTemplate[];
    setTemplates(next);
    return next;
  }, []);

  const loadMembers = useCallback(async (eventId: string): Promise<EventMember[]> => {
    const { data, error } = await supabase
      .from("event_members")
      .select("*")
      .eq("event_id", eventId)
      .order("invited_at", { ascending: false });
    if (error) {
      if (isMissingRelationError(error.message)) {
        setMembers([]);
        return [];
      }
      setFeedback(formatUserError("permission_denied", error ?? undefined));
      return [];
    }
    const next = (data ?? []) as EventMember[];
    setMembers(next);
    return next;
  }, []);

  const loadCues = useCallback(async (): Promise<ProductionCue[]> => {
    if (!current?.id) return [];
    const { data, error } = await supabase
      .from("production_cues")
      .select("*")
      .eq("event_id", current.id)
      .is("cleared_at", null)
      .order("triggered_at");
    if (error) {
      if (isMissingRelationError(error.message)) return [];
      setFeedback(formatUserError("permission_denied", error ?? undefined));
      return [];
    }
    const cues = (data ?? []) as ProductionCue[];
    updateCurrent({ ...current, activeCues: cues });
    return cues;
  }, [current, updateCurrent]);

  useEffect(() => {
    if (!current?.id) return;
    const id = window.setTimeout(() => {
      void loadDisplays(current.id);
      void loadMembers(current.id);
    }, 0);
    return () => window.clearTimeout(id);
  }, [current?.id, loadDisplays, loadMembers]);

  const loadCloud = useCallback(async () => {
    const [{ data: eventRows, error: eventError }, loadedTemplates] = await Promise.all([
      supabase.from("events").select("*").order("created_at", { ascending: true }),
      loadTemplates(),
    ]);
    if (loadedTemplates) setTemplates(loadedTemplates);
    if (eventError) {
      setFeedback(formatUserError("permission_denied", eventError));
      setHydrated(true);
      return;
    }
    const ids = (eventRows ?? []).map((row) => row.id);
    if (!ids.length) {
      setEvents([]);
      setCurrentId("");
      setDisplays([]);
      setMembers([]);
      setHydrated(true);
      return;
    }
    const [
      { data: agendaRows, error: agendaError },
      { data: runtimeRows, error: runtimeError },
      { data: messageRows, error: messageError },
      { data: runRows, error: runError },
      { data: cueRows, error: cueError },
    ] = await Promise.all([
      supabase.from("agenda_items").select("*").in("event_id", ids).order("position"),
      supabase.from("event_runtime").select("*").in("event_id", ids),
      supabase
        .from("event_messages")
        .select("event_id,body,cleared_at,created_at,priority,display_target,expires_at,message_type")
        .in("event_id", ids)
        .order("created_at", { ascending: false }),
      supabase.from("segment_runs").select("*").in("event_id", ids).order("created_at"),
      supabase.from("production_cues").select("*").in("event_id", ids).is("cleared_at", null).order("triggered_at"),
    ]);
    const historyMissing = runError ? isMissingRelationError(runError.message) : false;
    const cuesMissing = cueError ? isMissingRelationError(cueError.message) : false;
    if (agendaError || runtimeError || messageError || (runError && !historyMissing) || (cueError && !cuesMissing)) {
      const firstError = agendaError ?? runtimeError ?? messageError ?? runError ?? cueError ?? undefined;
      setFeedback(formatUserError(historyMissing ? "history_load" : "permission_denied", firstError));
      setHydrated(true);
      return;
    }
    const nowIso = new Date().toISOString();
    const allRuns = ((historyMissing ? [] : runRows) ?? []) as SegmentRun[];
    const allCues = ((cuesMissing ? [] : cueRows) ?? []) as ProductionCue[];
    const mapped = (eventRows ?? []).map((row) => {
      const eventSettings: EventSettings = {
        timezone: row.timezone || "UTC",
        warningSecs: row.warning_seconds ?? 120,
        urgentSecs: row.urgent_seconds ?? 30,
        autoAdvance: row.auto_advance ?? false,
      };
      const segments = (agendaRows ?? [])
        .filter((item) => item.event_id === row.id)
        .map(
          (item): Segment => ({
            id: item.id,
            time: localTime(item.scheduled_start),
            title: item.title,
            person: item.speaker || "Unassigned",
            duration: Math.max(1, Math.round((item.planned_duration_seconds ?? 600) / 60)),
            segmentType: (item.segment_type as Segment["segmentType"]) || "speaker",
            timerMode: item.timer_mode === "count_up" ? "count_up" : "countdown",
            notes: item.notes || "",
            warningSecs: item.warning_seconds ?? eventSettings.warningSecs,
            urgentSecs: item.urgent_seconds ?? eventSettings.urgentSecs,
          }),
        );
      const fallbackSegments = segments.length
        ? segments
        : INITIAL_SEGMENTS.map((segment) => ({
            ...segment,
            id: uid(),
            warningSecs: eventSettings.warningSecs,
            urgentSecs: eventSettings.urgentSecs,
          }));
      const activeMessage = resolveActiveMessage((messageRows ?? []) as MessageRow[], row.id, nowIso);
      const base: EventData = {
        id: row.id,
        ownerId: row.owner_id ?? session.user.id,
        name: row.name,
        date: row.event_date || "",
        venue: row.venue || "Main Stage",
        lifecycle: normalizeLifecycle(row.lifecycle_status ?? row.status),
        segments: fallbackSegments,
        active: 0,
        remaining: (fallbackSegments[0]?.duration ?? 10) * 60,
        timerDuration: (fallbackSegments[0]?.duration ?? 10) * 60,
        timerStartedAt: null,
        timerMode: fallbackSegments[0]?.timerMode ?? "countdown",
        running: false,
        message: activeMessage.message,
        messagePriority: activeMessage.messagePriority,
        messageTarget: activeMessage.messageTarget,
        messageExpiresAt: activeMessage.messageExpiresAt,
        updatedAt: new Date(row.updated_at).getTime(),
        runtimeVersion: 0,
        settings: eventSettings,
        segmentRuns: allRuns.filter((run) => run.event_id === row.id),
        activeCues: allCues.filter((cue) => cue.event_id === row.id),
      };
      return mapRuntime(base, (runtimeRows ?? []).find((runtime) => runtime.event_id === row.id));
    });
    activeRunIdsRef.current = Object.fromEntries(
      mapped.map((event) => [event.id, event.segmentRuns.filter((run) => run.ended_at === null).at(-1)?.id ?? null]),
    );
    setEvents(mapped);
    setCurrentId((id) => (mapped.some((event) => event.id === id) ? id : (mapped[0]?.id ?? "")));
    setHydrated(true);
  }, [loadTemplates, session.user.id]);

  const createEventRecord = useCallback(async (
    name: string,
    date: string,
    venue: string,
    settings: EventSettings,
    sourceSegments: Segment[],
    successMessage: string,
  ): Promise<string> => {
    const segments = cloneSegments(sourceSegments, settings);
    const rpcArgs = {
      p_name: name,
      p_event_date: date,
      p_venue: venue,
      p_timezone: settings.timezone,
      p_warning_seconds: settings.warningSecs,
      p_urgent_seconds: settings.urgentSecs,
      p_auto_advance: settings.autoAdvance,
      p_segments: segments.map((segment, index) => ({
        id: segment.id,
        position: index,
        title: segment.title,
        speaker: segment.person,
        notes: segment.notes || "",
        planned_duration_seconds: segment.duration * 60,
        time: segment.time,
        segment_type: segment.segmentType,
        timer_mode: segment.timerMode,
        warning_seconds: segment.warningSecs,
        urgent_seconds: segment.urgentSecs,
      })),
    };
    let creationMode: "atomic" | "legacy" | "direct" = "atomic";
    let { data: createdRows, error } = await supabase.rpc("create_event_atomic", rpcArgs);
    if (isMissingFunctionError(error)) {
      const legacy = await supabase.rpc("create_event_atomic", {
        p_name: name,
        p_event_date: date,
        p_venue: venue,
        p_timezone: settings.timezone,
        p_warning_seconds: settings.warningSecs,
        p_urgent_seconds: settings.urgentSecs,
        p_auto_advance: settings.autoAdvance,
      });
      createdRows = legacy.data;
      error = legacy.error;
      if (!legacy.error) creationMode = "legacy";
    }
    if (isMissingFunctionError(error)) {
      let direct = await supabase
        .from("events")
        .insert({
          owner_id: session.user.id,
          name: name.trim(),
          event_date: date,
          venue,
          timezone: settings.timezone,
          warning_seconds: settings.warningSecs,
          urgent_seconds: settings.urgentSecs,
          auto_advance: settings.autoAdvance,
          lifecycle_status: "draft",
        })
        .select("*")
        .single();
      if (
        direct.error
        && (direct.error.message?.includes("lifecycle_status") || direct.error.message?.includes("Could not find"))
      ) {
        direct = await supabase
          .from("events")
          .insert({
            owner_id: session.user.id,
            name: name.trim(),
            event_date: date,
            venue,
            timezone: settings.timezone,
            warning_seconds: settings.warningSecs,
            urgent_seconds: settings.urgentSecs,
            auto_advance: settings.autoAdvance,
            status: "draft",
          })
          .select("*")
          .single();
      }
      createdRows = direct.data ? [direct.data] : null;
      error = direct.error;
      if (!direct.error) creationMode = "direct";
    }
    const created = Array.isArray(createdRows) ? createdRows[0] : createdRows;
    if (error || !created) {
      setFeedback(formatEventCreationError(error ?? undefined));
      reportError({
        context: "event_creation",
        message: "Atomic event creation RPC failed",
        error_code: error?.code,
        error_details: error?.details,
        error_hint: error?.hint,
        timestamp: new Date().toISOString(),
      });
      return "";
    }
    if (creationMode !== "atomic") {
      const agendaResult = await supabase.from("agenda_items").upsert(
        segments.map((segment, index) => ({
          id: segment.id,
          event_id: created.id,
          position: index,
          title: segment.title,
          speaker: segment.person,
          notes: segment.notes || null,
          planned_duration_seconds: segment.duration * 60,
          scheduled_start: `${date}T${segment.time}:00`,
          segment_type: segment.segmentType,
          timer_mode: segment.timerMode,
          warning_seconds: segment.warningSecs,
          urgent_seconds: segment.urgentSecs,
        })),
      );
      if (agendaResult.error) {
        await supabase.from("events").delete().eq("id", created.id);
        setFeedback(formatEventCreationError(agendaResult.error));
        reportError({
          context: "event_creation",
          message: "Agenda bootstrap failed after event creation",
          error_code: agendaResult.error.code,
          error_details: agendaResult.error.details,
          error_hint: agendaResult.error.hint,
          timestamp: new Date().toISOString(),
        });
        return "";
      }
    }
    const firstSegment = segments[0];
    if (firstSegment && creationMode !== "atomic") {
      const existingRuntime = await loadRuntimeRow(created.id, true);
      const runtimeSeed: EventData = {
        id: created.id,
        ownerId: session.user.id,
        name,
        date,
        venue,
        lifecycle: "draft",
        segments,
        active: 0,
        remaining: firstSegment.timerMode === "count_up" ? 0 : firstSegment.duration * 60,
        timerDuration: firstSegment.timerMode === "count_up" ? 0 : firstSegment.duration * 60,
        timerStartedAt: null,
        timerMode: firstSegment.timerMode,
        running: false,
        message: "",
        messagePriority: "normal",
        messageTarget: null,
        messageExpiresAt: null,
        updatedAt: Date.now(),
        runtimeVersion: 0,
        settings,
        segmentRuns: [],
        activeCues: [],
      };
      await persistRuntime(runtimeSeed, existingRuntime?.version ?? 0);
    }
    const fresh: EventData = {
      id: created.id,
      ownerId: session.user.id,
      name,
      date,
      venue,
      lifecycle: "draft",
      segments,
      active: 0,
      remaining: segments[0]?.timerMode === "count_up" ? 0 : segments[0]?.duration ? segments[0].duration * 60 : 0,
      timerDuration: segments[0]?.timerMode === "count_up" ? 0 : segments[0]?.duration ? segments[0].duration * 60 : 0,
      timerStartedAt: null,
      timerMode: segments[0]?.timerMode ?? "countdown",
      running: false,
      message: "",
      messagePriority: "normal",
      messageTarget: null,
      messageExpiresAt: null,
      updatedAt: Date.now(),
      runtimeVersion: 1,
      settings,
      segmentRuns: [],
      activeCues: [],
    };
    setEvents((all) => [...all, fresh]);
    setCurrentId(fresh.id);
    setFeedback(successMessage);
    return fresh.id;
  }, [persistRuntime, session.user.id]);

  const createEvent = async (name: string, date: string, venue: string): Promise<string> => {
    const settings = defaultSettings();
    return createEventRecord(name, date, venue, settings, [], "Event saved to Event Timer cloud");
  };

  const duplicateEvent = useCallback(async (sourceId: string, newName: string, newDate: string): Promise<string> => {
    const source = events.find((event) => event.id === sourceId);
    if (!source) return "";
    return createEventRecord(
      newName,
      newDate,
      source.venue,
      source.settings,
      source.segments,
      "Event duplicated",
    );
  }, [createEventRecord, events]);

  const deleteEvent = async (id: string): Promise<boolean> => {
    const event = events.find((item) => item.id === id);
    if (event) await closeOpenSegmentRuns(event, "event_end");
    const { error } = await supabase.from("events").delete().eq("id", id);
    if (error) {
      setFeedback(formatUserError("permission_denied", error ?? undefined));
      return false;
    }
    const rest = events.filter((item) => item.id !== id);
    setEvents(rest);
    if (id === currentId) setCurrentId(rest[0]?.id ?? "");
    if (!rest.length) {
      setDisplays([]);
      setMembers([]);
    }
    setFeedback("Event deleted");
    return true;
  };

  const updateEventLifecycle = useCallback(async (id: string, status: EventLifecycle): Promise<void> => {
    const { error } = await supabase.from("events").update({ lifecycle_status: status, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) {
      setFeedback(formatUserError("permission_denied", error ?? undefined));
      return;
    }
    setEvents((all) => all.map((event) => (event.id === id ? { ...event, lifecycle: status } : event)));
    setFeedback(`Event marked ${status}`);
  }, []);

  const startSegmentRun = useCallback(async (eventId: string, agendaItemId: string): Promise<string | null> => {
    try {
      const { data, error } = await supabase
        .from("segment_runs")
        .insert({
          event_id: eventId,
          agenda_item_id: agendaItemId,
          started_at: new Date().toISOString(),
        })
        .select("*")
        .single();
      if (error) {
        if (!isMissingRelationError(error.message)) setFeedback(formatUserError("history_load", error));
        return null;
      }
      const run = data as SegmentRun;
      activeRunIdsRef.current[eventId] = run.id;
      syncRunRow(eventId, run);
      return run.id;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!isMissingRelationError(message)) setFeedback(formatUserError("history_load"));
      return null;
    }
  }, [syncRunRow]);

  const closeActiveSegmentRun = useCallback(async (event: EventData, reason: CompletionReason): Promise<void> => {
    const runId = activeRunIdsRef.current[event.id];
    if (!runId) return;
    const endedAt = new Date().toISOString();
    const elapsed = segmentElapsedSeconds(event);
    try {
      const { data, error } = await supabase
        .from("segment_runs")
        .update({
          ended_at: endedAt,
          elapsed_seconds: elapsed,
          completion_reason: reason,
        })
        .eq("id", runId)
        .is("ended_at", null)
        .select("*");
      if (error) {
        if (!isMissingRelationError(error.message)) setFeedback(formatUserError("history_load", error));
        return;
      }
      activeRunIdsRef.current[event.id] = null;
      const updated = (data?.[0] ?? null) as SegmentRun | null;
      if (updated) syncRunRow(event.id, updated);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!isMissingRelationError(message)) setFeedback(formatUserError("history_load"));
    }
  }, [syncRunRow]);

  const endEvent = useCallback(async (eventId: string): Promise<void> => {
    const event = events.find((item) => item.id === eventId);
    if (!event) return;
    const authoritative = await loadRuntimeRow(eventId, true);
    const base = authoritative ? mapRuntime(event, authoritative) : event;
    const now = Date.now();
    const nextState = base.running
      ? pauseTimer(runtimeStateFromEvent(base), now)
      : { durationSeconds: base.timerDuration, manualOffsetSeconds: 0, status: "paused" as const, startedAt: null };
    const finalEvent: EventData = {
      ...base,
      running: false,
      remaining: computeRemainingSeconds(nextState, now),
      timerDuration: nextState.durationSeconds,
      timerStartedAt: nextState.startedAt,
      lifecycle: "completed",
      updatedAt: now,
    };
    await persistRuntime(finalEvent, authoritative?.version ?? base.runtimeVersion);
    await closeOpenSegmentRuns(finalEvent, "event_end");
    const { error } = await supabase
      .from("events")
      .update({ lifecycle_status: "completed", updated_at: new Date().toISOString() })
      .eq("id", eventId);
    if (error) {
      setFeedback(formatUserError("permission_denied", error ?? undefined));
      return;
    }
    setEvents((all) => all.map((item) => (item.id === eventId ? finalEvent : item)));
    setFeedback("Event completed — report ready");
  }, [closeOpenSegmentRuns, events, loadRuntimeRow, persistRuntime]);

  const saveEventSettings = async (name: string, date: string, venue: string, settings: EventSettings) => {
    if (!current) return;
    const { error } = await supabase
      .from("events")
      .update({
        name,
        event_date: date,
        venue,
        timezone: settings.timezone,
        warning_seconds: settings.warningSecs,
        urgent_seconds: settings.urgentSecs,
        auto_advance: settings.autoAdvance,
      })
      .eq("id", current.id);
    if (error) {
      setFeedback(formatUserError("permission_denied", error ?? undefined));
      return;
    }
    updateCurrent({ ...current, name, date, venue, settings, updatedAt: Date.now() });
    setFeedback("Settings saved");
  };

  const setTimer = (seconds: number, running = current?.running ?? false) => {
    if (!current) return;
    const segment = current.segments[current.active];
    if (segment) {
      if (running) {
        void closeActiveSegmentRun(current, "restart").then(() => startSegmentRun(current.id, segment.id));
      } else {
        void closeActiveSegmentRun(current, "reset");
      }
    }
    const now = Date.now();
    commitRuntime((event) => ({
      ...event,
      remaining: seconds,
      timerDuration: seconds,
      timerStartedAt: running ? new Date(now).toISOString() : null,
      running,
      updatedAt: now,
    }));
  };

  const jumpTo = (index: number, run = true) => {
    if (!current?.segments[index]) return;
    const nextSegment = current.segments[index];
    if (index !== current.active) {
      const reason: CompletionReason = index === current.active + 1 ? "next" : index === current.active - 1 ? "previous" : "jump";
      if (run) {
        void closeActiveSegmentRun(current, reason).then(() => startSegmentRun(current.id, nextSegment.id));
      } else {
        void closeActiveSegmentRun(current, reason);
      }
    } else if (run && !activeRunIdsRef.current[current.id]) {
      void startSegmentRun(current.id, nextSegment.id);
    }
    const now = Date.now();
    const duration = nextSegment.duration * 60;
    commitRuntime((event) => ({
      ...event,
      active: index,
      remaining: duration,
      timerDuration: duration,
      timerStartedAt: run ? new Date(now).toISOString() : null,
      timerMode: nextSegment.timerMode,
      running: run,
      updatedAt: now,
    }));
  };

  const toggleTimer = () => {
    if (!current) return;
    if (!current.running) {
      const segment = current.segments[current.active];
      if (segment && !activeRunIdsRef.current[current.id]) void startSegmentRun(current.id, segment.id);
    }
    const now = Date.now();
    commitRuntime((event) => {
      const next = event.running ? pauseRuntimeForMode(event, now) : resumeTimer(runtimeStateFromEvent(event), now);
      return {
        ...event,
        running: !event.running,
        remaining: computeDisplaySeconds(next, event.timerMode, now),
        timerDuration: next.durationSeconds,
        timerStartedAt: next.startedAt,
        updatedAt: now,
      };
    });
  };

  const adjustTimer = (deltaSeconds: number) => {
    const now = Date.now();
    commitRuntime((event) => {
      const next = adjustRuntimeForMode(event, deltaSeconds, now);
      return {
        ...event,
        remaining: computeDisplaySeconds(next, event.timerMode, now),
        timerDuration: next.durationSeconds,
        timerStartedAt: next.startedAt,
        updatedAt: now,
      };
    });
  };

  const savePositions = async (segments: Segment[]) => {
    if (!current) return;
    const { error } = await supabase.from("agenda_items").upsert(
      segments.map((segment, index) => ({
        id: segment.id,
        event_id: current.id,
        position: index,
        title: segment.title,
        speaker: segment.person,
        notes: segment.notes || null,
        planned_duration_seconds: segment.duration * 60,
        scheduled_start: `${current.date}T${segment.time}:00`,
        segment_type: segment.segmentType,
        timer_mode: segment.timerMode,
        warning_seconds: segment.warningSecs,
        urgent_seconds: segment.urgentSecs,
      })),
    );
    if (error) setFeedback(formatUserError("permission_denied", error ?? undefined));
  };

  const saveSegment = async (item: Segment, isEdit: boolean): Promise<boolean> => {
    if (!current) return false;
    const segments = isEdit
      ? current.segments.map((segment) => (segment.id === item.id ? item : segment))
      : [...current.segments, item];
    const { error } = await supabase.from("agenda_items").upsert({
      id: item.id,
      event_id: current.id,
      position: segments.findIndex((segment) => segment.id === item.id),
      title: item.title,
      speaker: item.person,
      notes: item.notes || null,
      planned_duration_seconds: item.duration * 60,
      scheduled_start: `${current.date}T${item.time}:00`,
      segment_type: item.segmentType,
      timer_mode: item.timerMode,
      warning_seconds: item.warningSecs,
      urgent_seconds: item.urgentSecs,
    });
    if (error) {
      setFeedback(formatUserError("permission_denied", error ?? undefined));
      return false;
    }
    const activeSegment = segments[current.active];
    updateCurrent({
      ...current,
      segments,
      timerMode: activeSegment?.timerMode ?? current.timerMode,
      updatedAt: Date.now(),
    });
    setFeedback(isEdit ? "Segment saved to cloud" : "Segment added to cloud");
    return true;
  };

  const moveSegment = (from: number, to: number) => {
    if (!current || to < 0 || to >= current.segments.length || from === to) return;
    const segments = [...current.segments];
    const [item] = segments.splice(from, 1);
    segments.splice(to, 0, item);
    let nextActive = current.active;
    if (current.active === from) nextActive = to;
    else if (from < current.active && to >= current.active) nextActive -= 1;
    else if (from > current.active && to <= current.active) nextActive += 1;
    updateCurrent({
      ...current,
      segments,
      active: nextActive,
      timerMode: segments[nextActive]?.timerMode ?? current.timerMode,
      updatedAt: Date.now(),
    });
    void savePositions(segments);
  };

  const deleteSegment = async (id: string) => {
    if (!current || current.segments.length === 1) return;
    if (current.segments[current.active]?.id === id) {
      void closeActiveSegmentRun(current, "reset");
    }
    const { error } = await supabase.from("agenda_items").delete().eq("id", id);
    if (error) {
      setFeedback(formatUserError("permission_denied", error ?? undefined));
      return;
    }
    const segments = current.segments.filter((segment) => segment.id !== id);
    const active = Math.min(current.active, segments.length - 1);
    updateCurrent({
      ...current,
      segments,
      active,
      timerMode: segments[active]?.timerMode ?? "countdown",
      updatedAt: Date.now(),
    });
    setFeedback("Segment deleted");
  };

  const duplicateSegment = async (segment: Segment, index: number) => {
    if (!current) return;
    const copy: Segment = { ...segment, id: uid(), title: `${segment.title} copy` };
    const segments = [...current.segments.slice(0, index + 1), copy, ...current.segments.slice(index + 1)];
    updateCurrent({ ...current, segments, updatedAt: Date.now() });
    await savePositions(segments);
    setFeedback("Segment duplicated");
  };

  const addDisplay = async (name: string, type: DisplayType): Promise<EventDisplay | null> => {
    if (!current || !name.trim()) return null;
    const { PAIRING_CODE_TTL_MS, generatePairingCode, sha256Hex: hash } = await import("@/lib/display-access");
    const code = generatePairingCode();
    const codeHash = await hash(code);
    const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MS).toISOString();
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from("event_displays")
      .insert({
        event_id: current.id,
        name: name.trim(),
        display_type: type,
        pairing_code_hash: codeHash,
        pairing_code_expires_at: expiresAt,
        updated_at: now,
      })
      .select("id,event_id,name,display_type,pairing_code_expires_at,connected_at,last_heartbeat_at,revoked_at,created_at")
      .single();
    if (error || !data) {
      if (isMissingRelationError(error?.message)) {
        setFeedback("Displays are unavailable until the Phase 3 SQL migration is applied");
        return null;
      }
      setFeedback(formatUserError("permission_denied", error ?? undefined));
      return null;
    }
    const display = { ...(data as EventDisplay), pairingCode: code };
    setDisplays((all) => [...all, display]);
    setFeedback("Display created");
    return display;
  };

  const revokeDisplay = async (displayId: string): Promise<void> => {
    const revokedAt = new Date().toISOString();
    const { error } = await supabase
      .from("event_displays")
      .update({ revoked_at: revokedAt, updated_at: revokedAt })
      .eq("id", displayId);
    if (error) {
      if (isMissingRelationError(error.message)) {
        setFeedback("Displays are unavailable until the Phase 3 SQL migration is applied");
        return;
      }
      setFeedback(formatUserError("display_revoked", error));
      return;
    }
    setDisplays((all) => all.map((display) => (display.id === displayId ? { ...display, revoked_at: revokedAt } : display)));
    setFeedback("Display revoked");
  };

  const refreshDisplayPairing = async (displayId: string): Promise<string> => {
    const { PAIRING_CODE_TTL_MS, generatePairingCode, sha256Hex: hash } = await import("@/lib/display-access");
    const code = generatePairingCode();
    const codeHash = await hash(code);
    const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MS).toISOString();
    const { error } = await supabase
      .from("event_displays")
      .update({
        pairing_code_hash: codeHash,
        pairing_code_expires_at: expiresAt,
        access_token_hash: null,
        revoked_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", displayId);
    if (error) {
      if (isMissingRelationError(error.message)) {
        setFeedback("Displays are unavailable until the Phase 3 SQL migration is applied");
        return "";
      }
      setFeedback(formatUserError("pairing_failed", error));
      return "";
    }
    setDisplays((all) =>
      all.map((display) =>
        display.id === displayId
          ? { ...display, pairing_code_expires_at: expiresAt, revoked_at: null, pairingCode: code }
          : display,
      ),
    );
    setFeedback("Pairing code refreshed");
    return code;
  };

  const sendMessage = async (body: string, target = "all", priority = "normal") => {
    if (!current) return;
    const text = body.trim();
    if (!text) return;
    const expiresAt = new Date(Date.now() + FIVE_MINUTES_MS).toISOString();
    const targetValue = target === "all" ? null : target;
    const normalizedPriority = priority === "urgent" ? "urgent" : "normal";
    const { error } = await supabase.from("event_messages").insert({
      event_id: current.id,
      body: text,
      priority: normalizedPriority,
      created_by: session.user.id,
      message_type: "message",
      display_target: targetValue,
      expires_at: expiresAt,
    });
    if (error) {
      setFeedback(formatUserError("permission_denied", error ?? undefined));
      return;
    }
    updateCurrent({
      ...current,
      message: text,
      messagePriority: normalizedPriority as MessagePriority,
      messageTarget: targetValue,
      messageExpiresAt: expiresAt,
    });
    setFeedback("Message sent");
  };

  const clearMessage = async () => {
    if (!current) return;
    const { error } = await supabase
      .from("event_messages")
      .update({ cleared_at: new Date().toISOString() })
      .eq("event_id", current.id)
      .eq("message_type", "message")
      .is("cleared_at", null);
    if (error) {
      setFeedback(formatUserError("permission_denied", error ?? undefined));
      return;
    }
    updateCurrent({ ...current, message: "", messagePriority: "normal", messageTarget: null, messageExpiresAt: null });
  };

  const triggerCue = useCallback(async (cueType: CueType, target = "all") => {
    if (!current) return;
    const { data, error } = await supabase
      .from("production_cues")
      .insert({
        event_id: current.id,
        cue_type: cueType,
        target: target === "all" ? null : target,
        triggered_by: session.user.id,
      })
      .select("*")
      .single();
    if (error) {
      if (!isMissingRelationError(error.message)) setFeedback(formatUserError("permission_denied", error ?? undefined));
      return;
    }
    updateCurrent({ ...current, activeCues: [...current.activeCues, data as ProductionCue] });
    setFeedback(`${cueType} cue sent`);
  }, [current, session.user.id, updateCurrent]);

  const clearCue = useCallback(async (cueId: string) => {
    if (!current) return;
    const { error } = await supabase
      .from("production_cues")
      .update({ cleared_at: new Date().toISOString() })
      .eq("id", cueId);
    if (error) {
      if (!isMissingRelationError(error.message)) setFeedback(formatUserError("permission_denied", error ?? undefined));
      return;
    }
    updateCurrent({ ...current, activeCues: current.activeCues.filter((cue) => cue.id !== cueId) });
  }, [current, updateCurrent]);

  const saveAsTemplate = useCallback(async (name: string, description: string) => {
    if (!current) return;
    const templateData = {
      segments: current.segments,
      settings: current.settings,
      venue: current.venue,
    };
    const { data, error } = await supabase
      .from("event_templates")
      .insert({
        owner_id: session.user.id,
        name: name.trim(),
        description: description.trim() || null,
        template_data: templateData,
      })
      .select("*")
      .single();
    if (error) {
      if (!isMissingRelationError(error.message)) setFeedback(formatUserError("template_save", error));
      return;
    }
    setTemplates((all) => [data as EventTemplate, ...all]);
    setFeedback("Template saved");
  }, [current, session.user.id]);

  const createFromTemplate = useCallback(async (templateId: string, newName: string, newDate: string): Promise<string> => {
    const template = templates.find((item) => item.id === templateId);
    if (!template) return "";
    const templateData = template.template_data;
    return createEventRecord(
      newName,
      newDate,
      templateData.venue,
      templateData.settings,
      templateData.segments,
      "Event created from template",
    );
  }, [createEventRecord, templates]);

  const deleteTemplate = useCallback(async (id: string) => {
    const { error } = await supabase.from("event_templates").delete().eq("id", id);
    if (error) {
      if (!isMissingRelationError(error.message)) setFeedback(formatUserError("template_save", error));
      return;
    }
    setTemplates((all) => all.filter((template) => template.id !== id));
    setFeedback("Template deleted");
  }, []);

  const inviteMember = useCallback(async (eventId: string, email: string, role: string): Promise<{ link: string }> => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) return { link: "" };
    const token = generateAccessToken();
    const tokenHash = await sha256Hex(token);
    const { data, error } = await supabase
      .from("event_members")
      .insert({
        event_id: eventId,
        invited_email: normalizedEmail,
        role,
        invite_token_hash: tokenHash,
        invite_expires_at: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
        invited_by: session.user.id,
      })
      .select("*")
      .single();
    if (error) {
      setFeedback(formatUserError("permission_denied", error ?? undefined));
      return { link: "" };
    }
    setMembers((all) => [data as EventMember, ...all]);
    const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
    const link = `${baseUrl}/invite?token=${token}`;
    setFeedback("Invite link ready — copy and share it manually");
    return { link };
  }, [session.user.id]);

  const removeMember = useCallback(async (memberId: string): Promise<void> => {
    const { error } = await supabase.from("event_members").delete().eq("id", memberId);
    if (error) {
      setFeedback(formatUserError("permission_denied", error ?? undefined));
      return;
    }
    setMembers((all) => all.filter((member) => member.id !== memberId));
    setFeedback("Member removed");
  }, []);

  const changeMemberRole = useCallback(async (memberId: string, role: string): Promise<void> => {
    const { data, error } = await supabase.from("event_members").update({ role }).eq("id", memberId).select("*").single();
    if (error) {
      setFeedback(formatUserError("permission_denied", error ?? undefined));
      return;
    }
    setMembers((all) => all.map((member) => (member.id === memberId ? (data as EventMember) : member)));
    setFeedback("Member role updated");
  }, []);

  return {
    events,
    templates,
    members,
    setEvents,
    currentId,
    setCurrentId,
    current,
    displays,
    hydrated,
    feedback,
    setFeedback,
    loadCloud,
    loadTemplates,
    loadMembers,
    createEvent,
    duplicateEvent,
    deleteEvent,
    updateEventLifecycle,
    endEvent,
    toggleTimer,
    adjustTimer,
    setTimer,
    jumpTo,
    saveSegment,
    moveSegment,
    deleteSegment,
    duplicateSegment,
    saveEventSettings,
    addDisplay,
    revokeDisplay,
    refreshDisplayPairing,
    sendMessage,
    clearMessage,
    loadCues,
    triggerCue,
    clearCue,
    saveAsTemplate,
    createFromTemplate,
    deleteTemplate,
    inviteMember,
    removeMember,
    changeMemberRole,
  };
}
