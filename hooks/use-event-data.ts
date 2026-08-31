"use client";

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { Session } from "@supabase/supabase-js";
import { adjustTime, computeRemainingSeconds, pause as pauseTimer, resume as resumeTimer } from "@/lib/timer-engine";
import { supabase } from "@/lib/supabase";
import type { DisplayType } from "@/lib/display-access";
import type { EventData, EventDisplay, EventSettings, RuntimeRow, Segment } from "@/lib/types";

const uid = () => crypto.randomUUID();
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
  setEvents: Dispatch<SetStateAction<EventData[]>>;
  currentId: string;
  setCurrentId: Dispatch<SetStateAction<string>>;
  current: EventData | undefined;
  displays: EventDisplay[];
  hydrated: boolean;
  feedback: string;
  setFeedback: Dispatch<SetStateAction<string>>;
  loadCloud: () => Promise<void>;
  createEvent: (name: string, date: string, venue: string) => Promise<void>;
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
  sendMessage: (body: string) => Promise<void>;
  clearMessage: () => Promise<void>;
}

export function useEventData(session: Session): UseEventDataReturn {
  const [events, setEvents] = useState<EventData[]>([]);
  const [currentId, setCurrentId] = useState("");
  const [displays, setDisplays] = useState<EventDisplay[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [feedback, setFeedback] = useState("");

  const current = events.find((event) => event.id === currentId) ?? events[0];

  const updateCurrent = useCallback((nextEvent: EventData) => {
    setEvents((all) => all.map((event) => (event.id === nextEvent.id ? nextEvent : event)));
  }, []);

  const persistRuntime = useCallback(async (event: EventData) => {
    const active = event.segments[event.active];
    const { error } = await supabase.from("event_runtime").upsert(
      {
        event_id: event.id,
        current_agenda_item_id: active?.id ?? null,
        timer_mode: event.timerMode,
        timer_status: event.running ? "running" : "paused",
        duration_seconds: event.timerDuration,
        started_at: event.timerStartedAt,
        paused_at: event.running ? null : new Date().toISOString(),
        accumulated_paused_seconds: 0,
        manual_offset_seconds: 0,
        updated_by: session.user.id,
        updated_at: new Date().toISOString(),
        version: event.runtimeVersion,
      },
      { onConflict: "event_id" },
    );
    if (error) setFeedback(`Timer sync failed: ${error.message}`);
  }, [session.user.id]);

  const commitRuntime = useCallback((fn: (event: EventData) => EventData) => {
    if (!current) return;
    const changed = fn(current);
    const versioned = { ...changed, runtimeVersion: current.runtimeVersion + 1 };
    updateCurrent(versioned);
    void persistRuntime(versioned);
  }, [current, persistRuntime, updateCurrent]);

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

  useEffect(() => {
    if (!current?.id) return;
    const id = window.setTimeout(() => {
      void loadDisplays(current.id);
    }, 0);
    return () => window.clearTimeout(id);
  }, [current?.id, loadDisplays]);

  const loadCloud = useCallback(async () => {
    const { data: eventRows, error: eventError } = await supabase.from("events").select("*").order("created_at", { ascending: true });
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
    const [{ data: agendaRows, error: agendaError }, { data: runtimeRows, error: runtimeError }, { data: messages }] = await Promise.all([
      supabase.from("agenda_items").select("*").in("event_id", ids).order("position"),
      supabase.from("event_runtime").select("*").in("event_id", ids),
      supabase
        .from("event_messages")
        .select("event_id,body,cleared_at,created_at")
        .in("event_id", ids)
        .is("cleared_at", null)
        .order("created_at", { ascending: false }),
    ]);
    if (agendaError || runtimeError) {
      setFeedback(`Cloud load failed: ${(agendaError ?? runtimeError)?.message ?? "Unknown error"}`);
      setHydrated(true);
      return;
    }
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
        : INITIAL_SEGMENTS.map((segment) => ({ ...segment, id: uid(), warningSecs: eventSettings.warningSecs, urgentSecs: eventSettings.urgentSecs }));
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
        message: (messages ?? []).find((message) => message.event_id === row.id)?.body ?? "",
        updatedAt: new Date(row.updated_at).getTime(),
        runtimeVersion: 0,
        settings: eventSettings,
      };
      return mapRuntime(base, (runtimeRows ?? []).find((runtime) => runtime.event_id === row.id));
    });
    setEvents(mapped);
    setCurrentId((id) => (mapped.some((event) => event.id === id) ? id : (mapped[0]?.id ?? "")));
    setHydrated(true);
  }, []);

  const createEvent = async (name: string, date: string, venue: string) => {
    const settings = defaultSettings();
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
      return;
    }
    const segments = INITIAL_SEGMENTS.map((segment) => ({
      ...segment,
      id: uid(),
      warningSecs: settings.warningSecs,
      urgentSecs: settings.urgentSecs,
    }));
    const { error: agendaError } = await supabase.from("agenda_items").insert(
      segments.map((segment, index) => ({
        id: segment.id,
        event_id: created.id,
        position: index,
        title: segment.title,
        speaker: segment.person,
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
      return;
    }
    const fresh: EventData = {
      id: created.id,
      name,
      date,
      venue,
      segments,
      active: 0,
      remaining: segments[0].duration * 60,
      timerDuration: segments[0].duration * 60,
      timerStartedAt: null,
      timerMode: segments[0].timerMode,
      running: false,
      message: "",
      updatedAt: Date.now(),
      runtimeVersion: 1,
      settings,
    };
    setEvents((all) => [...all, fresh]);
    setCurrentId(fresh.id);
    await persistRuntime(fresh);
    setFeedback("Event saved to Event Timer cloud");
  };

  const deleteEvent = async (id: string): Promise<boolean> => {
    const { error } = await supabase.from("events").delete().eq("id", id);
    if (error) {
      setFeedback(`Delete failed: ${error.message}`);
      return false;
    }
    const rest = events.filter((event) => event.id !== id);
    setEvents(rest);
    if (id === currentId) setCurrentId(rest[0]?.id ?? "");
    if (!rest.length) setDisplays([]);
    setFeedback("Event deleted");
    return true;
  };

  const recordSegmentEnd = useCallback(async (itemId: string, startedAt: string, reason: string): Promise<void> => {
    if (!current) return;
    const endedAt = new Date().toISOString();
    const elapsed = Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000);
    try {
      const { error } = await supabase.from("segment_runs").insert({
        event_id: current.id,
        agenda_item_id: itemId,
        started_at: startedAt,
        ended_at: endedAt,
        elapsed_seconds: elapsed,
        completion_reason: reason,
      });
      if (error && !isMissingRelationError(error.message)) {
        setFeedback(`Segment history failed: ${error.message}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!isMissingRelationError(message)) setFeedback(`Segment history failed: ${message}`);
    }
  }, [current]);

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
    if (current.running && current.timerStartedAt && current.segments[current.active] && index !== current.active) {
      const reason = index === current.active + 1 ? "next" : index === current.active - 1 ? "previous" : "jump";
      void recordSegmentEnd(current.segments[current.active].id, current.timerStartedAt, reason);
    }
    const now = Date.now();
    const duration = current.segments[index].duration * 60;
    const timerMode = current.segments[index].timerMode;
    commitRuntime((event) => ({
      ...event,
      active: index,
      remaining: duration,
      timerDuration: duration,
      timerStartedAt: run ? new Date(now).toISOString() : null,
      timerMode,
      running: run,
      updatedAt: now,
    }));
  };

  const toggleTimer = () => {
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
    updateCurrent({
      ...current,
      segments,
      active: current.active === from ? to : current.active,
      timerMode: segments[current.active === from ? to : current.active]?.timerMode ?? current.timerMode,
      updatedAt: Date.now(),
    });
    void savePositions(segments);
  };

  const deleteSegment = async (id: string) => {
    if (!current || current.segments.length === 1) return;
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

  const sendMessage = async (body: string) => {
    if (!current) return;
    const text = body.trim();
    if (!text) return;
    const { error } = await supabase.from("event_messages").insert({
      event_id: current.id,
      body: text,
      priority: "normal",
      created_by: session.user.id,
      message_type: "message",
    });
    if (error) {
      setFeedback(`Message failed: ${error.message}`);
      return;
    }
    updateCurrent({ ...current, message: text });
    setFeedback("Message sent");
  };

  const clearMessage = async () => {
    if (!current) return;
    const { error } = await supabase
      .from("event_messages")
      .update({ cleared_at: new Date().toISOString() })
      .eq("event_id", current.id)
      .is("cleared_at", null);
    if (error) {
      setFeedback(`Clear failed: ${error.message}`);
      return;
    }
    updateCurrent({ ...current, message: "" });
  };

  return {
    events,
    setEvents,
    currentId,
    setCurrentId,
    current,
    displays,
    hydrated,
    feedback,
    setFeedback,
    loadCloud,
    createEvent,
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
  };
}
