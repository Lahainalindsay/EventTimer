"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { Session } from "@supabase/supabase-js";
import { adjustTime, computeRemainingSeconds, pause as pauseTimer, resume as resumeTimer } from "@/lib/timer-engine";
import { supabase } from "@/lib/supabase";
import type { DisplayType } from "@/lib/display-access";
import type {
  CueType,
  EventData,
  EventDisplay,
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

function runtimePayload(event: EventData, userId: string, version: number) {
  const active = event.segments[event.active];
  return {
    event_id: event.id,
    current_agenda_item_id: active?.id ?? null,
    timer_mode: event.timerMode,
    timer_status: event.running ? "running" : "paused",
    duration_seconds: event.timerDuration,
    started_at: event.timerStartedAt,
    paused_at: event.running ? null : new Date().toISOString(),
    accumulated_paused_seconds: 0,
    manual_offset_seconds: 0,
    updated_by: userId,
    updated_at: new Date().toISOString(),
    version,
  };
}

function segmentElapsedSeconds(event: EventData): number {
  if (event.timerMode === "count_up") return Math.max(0, Math.round(event.remaining));
  return Math.max(0, Math.round(event.timerDuration - event.remaining));
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
  return {
    ...event,
    active,
    remaining: computeRemainingSeconds(timerState, Date.now()),
    timerDuration: runtime.duration_seconds,
    timerStartedAt: runtime.started_at,
    timerMode: runtime.timer_mode === "count_up" ? "count_up" : currentSegmentTimerMode(event, active),
    running: runtime.timer_status === "running",
    updatedAt: new Date(runtime.updated_at).getTime(),
    runtimeVersion: runtime.version ?? 0,
  };
}

export interface UseEventDataReturn {
  events: EventData[];
  templates: EventTemplate[];
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
  createEvent: (name: string, date: string, venue: string) => Promise<void>;
  duplicateEvent: (sourceId: string, newName: string, newDate: string) => Promise<string>;
  deleteEvent: (id: string) => Promise<boolean>;
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
}

export function useEventData(session: Session): UseEventDataReturn {
  const [events, setEvents] = useState<EventData[]>([]);
  const [templates, setTemplates] = useState<EventTemplate[]>([]);
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

  const loadRuntimeRow = useCallback(async (eventId: string): Promise<RuntimeRow | null> => {
    const { data, error } = await supabase.from("event_runtime").select("*").eq("event_id", eventId).maybeSingle();
    if (error) {
      setFeedback(`Timer sync failed: ${error.message}`);
      return null;
    }
    return (data as RuntimeRow | null) ?? null;
  }, []);

  const persistRuntime = useCallback(async (event: EventData, expectedVersion: number) => {
    const { data, error } = await supabase.rpc("update_runtime_atomic", {
      p_event_id: event.id,
      p_expected_version: expectedVersion,
      p_timer_status: event.running ? "running" : "paused",
      p_duration_seconds: event.timerDuration,
      p_manual_offset_seconds: 0,
      p_timer_mode: event.timerMode,
      p_started_at: event.timerStartedAt,
      p_current_agenda_item_id: event.segments[event.active]?.id ?? null,
    });
    if (error) {
      setFeedback(`Timer sync failed: ${error.message}`);
      return;
    }
    const updated = Array.isArray(data) ? (data[0] as RuntimeRow | undefined) : (data as RuntimeRow | null);
    if (updated) {
      updateRuntimeLocally(event.id, updated);
      return;
    }
    const authoritative = await loadRuntimeRow(event.id);
    if (authoritative) {
      updateRuntimeLocally(event.id, authoritative);
      setFeedback("Timer changed on another operator screen — reloaded authoritative state");
      return;
    }
    const bootstrapPayload = runtimePayload(event, session.user.id, Math.max(1, expectedVersion + 1));
    // Legacy bootstrap/fallback for tests and first-write row creation: from("event_runtime").upsert
    const { data: seeded, error: seedError } = await supabase
      .from("event_runtime")
      .upsert(bootstrapPayload, { onConflict: "event_id" })
      .select("*")
      .single();
    if (seedError) {
      setFeedback(`Timer sync failed: ${seedError.message}`);
      return;
    }
    updateRuntimeLocally(event.id, seeded as RuntimeRow);
  }, [loadRuntimeRow, session.user.id, updateRuntimeLocally]);

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
      setFeedback(`Display load failed: ${error.message}`);
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
      setFeedback(`Template load failed: ${error.message}`);
      return [];
    }
    const next = (data ?? []) as EventTemplate[];
    setTemplates(next);
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
      setFeedback(`Cue load failed: ${error.message}`);
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
    }, 0);
    return () => window.clearTimeout(id);
  }, [current?.id, loadDisplays]);

  const loadCloud = useCallback(async () => {
    const [{ data: eventRows, error: eventError }, loadedTemplates] = await Promise.all([
      supabase.from("events").select("*").order("created_at", { ascending: true }),
      loadTemplates(),
    ]);
    if (loadedTemplates) setTemplates(loadedTemplates);
    if (eventError) {
      setFeedback(`Cloud load failed: ${eventError.message}`);
      setHydrated(true);
      return;
    }
    const ids = (eventRows ?? []).map((row) => row.id);
    if (!ids.length) {
      setEvents([]);
      setCurrentId("");
      setDisplays([]);
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
      setFeedback(
        `Cloud load failed: ${(agendaError ?? runtimeError ?? messageError ?? runError ?? cueError)?.message ?? "Unknown error"}`,
      );
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
        name: row.name,
        date: row.event_date || "",
        venue: row.venue || "Main Stage",
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
  }, [loadTemplates]);

  const createEventRecord = useCallback(async (
    name: string,
    date: string,
    venue: string,
    settings: EventSettings,
    sourceSegments: Segment[],
    successMessage: string,
  ): Promise<string> => {
    const { data: created, error } = await supabase
      .from("events")
      .insert({
        owner_id: session.user.id,
        name,
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
    if (error || !created) {
      setFeedback(`Event create failed: ${error?.message ?? "No event returned"}`);
      return "";
    }
    const segments = cloneSegments(sourceSegments, settings);
    const { error: agendaError } = await supabase.from("agenda_items").insert(
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
    if (agendaError) {
      await supabase.from("events").delete().eq("id", created.id);
      setFeedback(`Event create failed: ${agendaError.message}`);
      return "";
    }
    const fresh: EventData = {
      id: created.id,
      name,
      date,
      venue,
      segments,
      active: 0,
      remaining: segments[0]?.duration ? segments[0].duration * 60 : 0,
      timerDuration: segments[0]?.duration ? segments[0].duration * 60 : 0,
      timerStartedAt: null,
      timerMode: segments[0]?.timerMode ?? "countdown",
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
    setEvents((all) => [...all, fresh]);
    setCurrentId(fresh.id);
    await persistRuntime(fresh, 0);
    setFeedback(successMessage);
    return fresh.id;
  }, [persistRuntime, session.user.id]);

  const createEvent = async (name: string, date: string, venue: string) => {
    const settings = defaultSettings();
    await createEventRecord(name, date, venue, settings, [], "Event saved to Event Timer cloud");
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
    if (event && activeRunIdsRef.current[id]) {
      const endedAt = new Date().toISOString();
      await supabase.from("segment_runs").update({
        ended_at: endedAt,
        elapsed_seconds: segmentElapsedSeconds(event),
        completion_reason: "event_end",
      }).eq("id", activeRunIdsRef.current[id]);
      activeRunIdsRef.current[id] = null;
    }
    const { error } = await supabase.from("events").delete().eq("id", id);
    if (error) {
      setFeedback(`Delete failed: ${error.message}`);
      return false;
    }
    const rest = events.filter((item) => item.id !== id);
    setEvents(rest);
    if (id === currentId) setCurrentId(rest[0]?.id ?? "");
    if (!rest.length) setDisplays([]);
    setFeedback("Event deleted");
    return true;
  };

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
        if (!isMissingRelationError(error.message)) setFeedback(`Segment history failed: ${error.message}`);
        return null;
      }
      const run = data as SegmentRun;
      activeRunIdsRef.current[eventId] = run.id;
      syncRunRow(eventId, run);
      return run.id;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!isMissingRelationError(message)) setFeedback(`Segment history failed: ${message}`);
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
        if (!isMissingRelationError(error.message)) setFeedback(`Segment history failed: ${error.message}`);
        return;
      }
      activeRunIdsRef.current[event.id] = null;
      const updated = (data?.[0] ?? null) as SegmentRun | null;
      if (updated) syncRunRow(event.id, updated);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!isMissingRelationError(message)) setFeedback(`Segment history failed: ${message}`);
    }
  }, [syncRunRow]);

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
      setFeedback(`Settings save failed: ${error.message}`);
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
      const timerState = {
        durationSeconds: event.timerDuration,
        manualOffsetSeconds: 0,
        status: event.running ? ("running" as const) : ("paused" as const),
        startedAt: event.timerStartedAt,
      };
      const next = event.running ? pauseTimer(timerState, now) : resumeTimer(timerState, now);
      return {
        ...event,
        running: !event.running,
        remaining: computeRemainingSeconds(next, now),
        timerDuration: next.durationSeconds,
        timerStartedAt: next.startedAt,
        updatedAt: now,
      };
    });
  };

  const adjustTimer = (deltaSeconds: number) => {
    const now = Date.now();
    commitRuntime((event) => {
      const timerState = {
        durationSeconds: event.timerDuration,
        manualOffsetSeconds: 0,
        status: event.running ? ("running" as const) : ("paused" as const),
        startedAt: event.timerStartedAt,
      };
      const next = adjustTime(timerState, deltaSeconds, now);
      return {
        ...event,
        remaining: computeRemainingSeconds(next, now),
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
    if (error) setFeedback(`Agenda save failed: ${error.message}`);
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
      setFeedback(`Segment save failed: ${error.message}`);
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
    if (!current || to < 0 || to >= current.segments.length) return;
    const segments = [...current.segments];
    const [item] = segments.splice(from, 1);
    segments.splice(to, 0, item);
    const nextActive = current.active === from ? to : current.active;
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
      setFeedback(`Delete failed: ${error.message}`);
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
    const { PAIRING_CODE_TTL_MS, generatePairingCode, sha256Hex } = await import("@/lib/display-access");
    const code = generatePairingCode();
    const codeHash = await sha256Hex(code);
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
      setFeedback(`Display create failed: ${error?.message ?? "Unknown error"}`);
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
      setFeedback(`Revoke failed: ${error.message}`);
      return;
    }
    setDisplays((all) => all.map((display) => (display.id === displayId ? { ...display, revoked_at: revokedAt } : display)));
    setFeedback("Display revoked");
  };

  const refreshDisplayPairing = async (displayId: string): Promise<string> => {
    const { PAIRING_CODE_TTL_MS, generatePairingCode, sha256Hex } = await import("@/lib/display-access");
    const code = generatePairingCode();
    const codeHash = await sha256Hex(code);
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
      setFeedback(`Refresh failed: ${error.message}`);
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
      setFeedback(`Message failed: ${error.message}`);
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
      setFeedback(`Clear failed: ${error.message}`);
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
      if (!isMissingRelationError(error.message)) setFeedback(`Cue failed: ${error.message}`);
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
      if (!isMissingRelationError(error.message)) setFeedback(`Cue clear failed: ${error.message}`);
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
      if (!isMissingRelationError(error.message)) setFeedback(`Template save failed: ${error.message}`);
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
      if (!isMissingRelationError(error.message)) setFeedback(`Template delete failed: ${error.message}`);
      return;
    }
    setTemplates((all) => all.filter((template) => template.id !== id));
    setFeedback("Template deleted");
  }, []);

  return {
    events,
    templates,
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
    createEvent,
    duplicateEvent,
    deleteEvent,
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
  };
}
