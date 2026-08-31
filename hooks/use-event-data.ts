"use client";

import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  adjustTime,
  computeRemainingSeconds,
  pause as pauseTimer,
  resume as resumeTimer,
} from "@/lib/timer-engine";
import { supabase } from "@/lib/supabase";
import type { EventData, RuntimeRow, Segment } from "@/lib/types";

const uid = () => crypto.randomUUID();
const localTime = (v: string | null) =>
  v
    ? new Date(v).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : "09:00";

const INITIAL_SEGMENTS: Omit<Segment, "id">[] = [
  {
    time: "09:00",
    title: "Doors open",
    person: "Front of house",
    duration: 15,
    segmentType: "opening",
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
    notes: "",
    warningSecs: 120,
    urgentSecs: 30,
  },
];

export function mapRuntime(event: EventData, runtime: RuntimeRow | null | undefined): EventData {
  if (!runtime) return event;
  const found = event.segments.findIndex((s) => s.id === runtime.current_agenda_item_id);
  const active = found < 0 ? 0 : found;
  const timerState = {
    durationSeconds: runtime.duration_seconds,
    manualOffsetSeconds: runtime.manual_offset_seconds,
    status: runtime.timer_status as "running" | "paused",
    startedAt: runtime.started_at,
  };
  const remaining = computeRemainingSeconds(timerState, Date.now());
  const timerMode = runtime.timer_mode === "count_up" ? "count_up" : "countdown";
  return {
    ...event,
    active,
    remaining,
    timerDuration: runtime.duration_seconds,
    timerStartedAt: runtime.started_at,
    timerMode,
    running: runtime.timer_status === "running",
    updatedAt: new Date(runtime.updated_at).getTime(),
  };
}

export interface UseEventDataReturn {
  events: EventData[];
  setEvents: Dispatch<SetStateAction<EventData[]>>;
  currentId: string;
  setCurrentId: Dispatch<SetStateAction<string>>;
  current: EventData | undefined;
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
  duplicateSegment: (s: Segment, index: number) => Promise<void>;
  sendMessage: (body: string) => Promise<void>;
  clearMessage: () => Promise<void>;
}

export function useEventData(session: Session): UseEventDataReturn {
  const [events, setEvents] = useState<EventData[]>([]);
  const [currentId, setCurrentId] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [feedback, setFeedback] = useState("");

  const current = events.find((e) => e.id === currentId) ?? events[0];

  const updateCurrent = (nextEvent: EventData) =>
    setEvents((all) => all.map((e) => (e.id === nextEvent.id ? nextEvent : e)));

  const persistRuntime = async (event: EventData) => {
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
      },
      { onConflict: "event_id" },
    );
    if (error) setFeedback(`Timer sync failed: ${error.message}`);
  };

  const commitRuntime = (fn: (event: EventData) => EventData) => {
    if (!current) return;
    const changed = fn(current);
    updateCurrent(changed);
    void persistRuntime(changed);
  };

  const loadCloud = useCallback(async () => {
    const { data: eventRows, error: eventError } = await supabase
      .from("events")
      .select("id,name,event_date,venue,updated_at")
      .order("created_at", { ascending: true });
    if (eventError) {
      setFeedback(`Cloud load failed: ${eventError.message}`);
      setHydrated(true);
      return;
    }
    const ids = (eventRows ?? []).map((row) => row.id);
    if (!ids.length) {
      setEvents([]);
      setCurrentId("");
      setHydrated(true);
      return;
    }
    const [
      { data: agendaRows, error: agendaError },
      { data: runtimeRows, error: runtimeError },
      { data: messages },
    ] = await Promise.all([
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
      setFeedback(`Cloud load failed: ${(agendaError ?? runtimeError)!.message}`);
      setHydrated(true);
      return;
    }
    const mapped = (eventRows ?? []).map((row) => {
      const segments = (agendaRows ?? [])
        .filter((item) => item.event_id === row.id)
        .map(
          (item): Segment => ({
            id: item.id,
            time: localTime(item.scheduled_start),
            title: item.title,
            person: item.speaker || "Unassigned",
            duration: Math.max(1, Math.round(item.planned_duration_seconds / 60)),
            segmentType: (item.segment_type as Segment["segmentType"]) || "speaker",
            notes: item.notes || "",
            warningSecs: item.warning_seconds ?? 120,
            urgentSecs: item.urgent_seconds ?? 30,
          }),
        );
      const base: EventData = {
        id: row.id,
        name: row.name,
        date: row.event_date || "",
        venue: row.venue || "Main Stage",
        segments,
        active: 0,
        remaining: (segments[0]?.duration ?? 10) * 60,
        timerDuration: (segments[0]?.duration ?? 10) * 60,
        timerStartedAt: null,
        timerMode: "countdown",
        running: false,
        message: (messages ?? []).find((m) => m.event_id === row.id)?.body ?? "",
        updatedAt: new Date(row.updated_at).getTime(),
      };
      return mapRuntime(base, (runtimeRows ?? []).find((runtime) => runtime.event_id === row.id));
    });
    setEvents(mapped);
    setCurrentId((id) => (mapped.some((event) => event.id === id) ? id : (mapped[0]?.id ?? "")));
    setHydrated(true);
  }, []);

  const createEvent = async (name: string, date: string, venue: string) => {
    const { data: created, error } = await supabase
      .from("events")
      .insert({
        owner_id: session.user.id,
        name,
        event_date: date,
        venue,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        status: "draft",
      })
      .select("id,name,event_date,venue,updated_at")
      .single();
    if (error || !created) {
      setFeedback(`Event create failed: ${error?.message ?? "No event returned"}`);
      return;
    }
    const segments = INITIAL_SEGMENTS.map((segment) => ({ ...segment, id: uid() }));
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
      timerMode: "countdown",
      running: false,
      message: "",
      updatedAt: Date.now(),
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
    setFeedback("Event deleted");
    return true;
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
    const now = Date.now();
    const dur = current.segments[index].duration * 60;
    commitRuntime((event) => ({
      ...event,
      active: index,
      remaining: dur,
      timerDuration: dur,
      timerStartedAt: run ? new Date(now).toISOString() : null,
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
      const remaining = computeRemainingSeconds(next, now);
      return {
        ...event,
        running: !event.running,
        remaining,
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
      const remaining = computeRemainingSeconds(next, now);
      return {
        ...event,
        remaining,
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
      warning_seconds: item.warningSecs,
      urgent_seconds: item.urgentSecs,
    });
    if (error) {
      setFeedback(`Segment save failed: ${error.message}`);
      return false;
    }
    updateCurrent({ ...current, segments, updatedAt: Date.now() });
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
    updateCurrent({
      ...current,
      segments,
      active: Math.min(current.active, segments.length - 1),
      updatedAt: Date.now(),
    });
    setFeedback("Segment deleted");
  };

  const duplicateSegment = async (segment: Segment, index: number) => {
    if (!current) return;
    const copy: Segment = { ...segment, id: uid(), title: `${segment.title} copy` };
    const segments = [
      ...current.segments.slice(0, index + 1),
      copy,
      ...current.segments.slice(index + 1),
    ];
    updateCurrent({ ...current, segments, updatedAt: Date.now() });
    await savePositions(segments);
    setFeedback("Segment duplicated");
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
    sendMessage,
    clearMessage,
  };
}
