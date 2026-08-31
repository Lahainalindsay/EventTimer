"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { HEARTBEAT_INTERVAL_MS, type DisplayPayloadPermissions } from "@/lib/display-access";
import { shouldAcceptRuntimeUpdate } from "@/lib/runtime-version";
import { computeDisplaySeconds, formatTime, getTimerStateName } from "@/lib/timer-engine";
import type { MessageRow, RuntimeRow } from "@/lib/types";

interface DisplaySegment {
  id: string;
  title: string;
  speaker: string;
}

interface DisplayClientProps {
  initialData: {
    displayId: string;
    displayType: string;
    token: string;
    eventId: string;
    eventName: string;
    venue: string;
    timerStatus: string;
    timerMode: string;
    remaining: number;
    startedAt: string | null;
    durationSeconds: number;
    currentTitle: string;
    currentSpeaker: string;
    nextTitle: string;
    message: string;
    warningSecs: number;
    urgentSecs: number;
    runtimeVersion: number;
    runtimeUpdatedAt: string;
    currentAgendaItemId: string | null;
    segments: DisplaySegment[];
    permissions: DisplayPayloadPermissions;
  };
}

function getSegmentView(segments: DisplaySegment[], agendaItemId: string | null) {
  const activeIndex = segments.findIndex((segment) => segment.id === agendaItemId);
  const safeIndex = activeIndex >= 0 ? activeIndex : 0;
  return {
    currentTitle: segments[safeIndex]?.title ?? "",
    currentSpeaker: segments[safeIndex]?.speaker ?? "",
    nextTitle: segments[safeIndex + 1]?.title ?? "",
  };
}

export function DisplayClient({ initialData }: DisplayClientProps) {
  const [state, setState] = useState(() => ({
    displaySeconds: initialData.remaining,
    running: initialData.timerStatus === "running",
    startedAt: initialData.startedAt,
    durationSeconds: initialData.durationSeconds,
    timerMode: initialData.timerMode,
    currentAgendaItemId: initialData.currentAgendaItemId,
    currentTitle: initialData.currentTitle,
    currentSpeaker: initialData.currentSpeaker,
    nextTitle: initialData.nextTitle,
    message: initialData.message,
    connected: false,
    runtimeVersion: initialData.runtimeVersion,
    runtimeUpdatedAt: initialData.runtimeUpdatedAt,
  }));

  const warning = initialData.warningSecs;
  const urgent = initialData.urgentSecs;

  useEffect(() => {
    const channel = supabase
      .channel(`display-${initialData.eventId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "event_runtime", filter: `event_id=eq.${initialData.eventId}` },
        (payload) => {
          const runtime = payload.new as RuntimeRow;
          if (!runtime?.event_id) return;
          setState((prev) => {
            const currentRuntime = { version: prev.runtimeVersion, updated_at: prev.runtimeUpdatedAt };
            const incomingRuntime = { version: runtime.version ?? 0, updated_at: runtime.updated_at };
            if (!shouldAcceptRuntimeUpdate(currentRuntime, incomingRuntime)) return prev;
            const nextSegments = getSegmentView(initialData.segments, runtime.current_agenda_item_id);
            const timerState = {
              durationSeconds: runtime.duration_seconds,
              manualOffsetSeconds: runtime.manual_offset_seconds,
              status: runtime.timer_status as "running" | "paused",
              startedAt: runtime.started_at,
            };
            return {
              ...prev,
              displaySeconds: computeDisplaySeconds(
                timerState,
                runtime.timer_mode === "count_up" ? "count_up" : "countdown",
                Date.now(),
              ),
              running: runtime.timer_status === "running",
              startedAt: runtime.started_at,
              durationSeconds: runtime.duration_seconds,
              timerMode: runtime.timer_mode,
              currentAgendaItemId: runtime.current_agenda_item_id,
              currentTitle: nextSegments.currentTitle,
              currentSpeaker: nextSegments.currentSpeaker,
              nextTitle: nextSegments.nextTitle,
              runtimeVersion: runtime.version ?? 0,
              runtimeUpdatedAt: runtime.updated_at,
            };
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "event_messages", filter: `event_id=eq.${initialData.eventId}` },
        (payload) => {
          const message = payload.new as MessageRow & { display_target?: string | null };
          if (!message?.body) return;
          if (message.display_target && message.display_target !== initialData.displayId) return;
          setState((prev) => ({ ...prev, message: message.body ?? "" }));
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "event_messages", filter: `event_id=eq.${initialData.eventId}` },
        (payload) => {
          const message = payload.new as MessageRow;
          if (message?.cleared_at) setState((prev) => ({ ...prev, message: "" }));
        },
      )
      .subscribe((status) => setState((prev) => ({ ...prev, connected: status === "SUBSCRIBED" })));

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [initialData.displayId, initialData.eventId, initialData.segments]);

  useEffect(() => {
    if (!state.running) return;
    const id = window.setInterval(() => {
      const timerState = {
        durationSeconds: state.durationSeconds,
        manualOffsetSeconds: 0,
        status: "running" as const,
        startedAt: state.startedAt,
      };
      setState((prev) => ({
        ...prev,
        displaySeconds: computeDisplaySeconds(
          timerState,
          state.timerMode === "count_up" ? "count_up" : "countdown",
          Date.now(),
        ),
      }));
    }, 500);
    return () => window.clearInterval(id);
  }, [state.running, state.durationSeconds, state.startedAt, state.timerMode]);

  useEffect(() => {
    const sendHeartbeat = () => {
      void fetch("/api/display/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: initialData.token }),
      });
    };
    sendHeartbeat();
    const id = window.setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [initialData.token]);

  const viewState = useMemo(() => {
    const timerStateName = getTimerStateName(state.displaySeconds, state.timerMode === "count_up" ? "count_up" : "countdown", {
      warningSecs: warning,
      urgentSecs: urgent,
    });
    return {
      bodyClass: timerStateName === "normal" ? "" : timerStateName,
      status: state.running ? (timerStateName === "overtime" ? "OVERTIME" : "RUNNING") : "PAUSED",
    };
  }, [state.displaySeconds, state.running, state.timerMode, urgent, warning]);

  return (
    <main className={`display-view ${viewState.bodyClass}`}>
      <div className="display-kicker">
        {state.connected ? "LIVE" : "CONNECTING"} · {initialData.venue.toUpperCase()}
      </div>
      {initialData.permissions.segmentTitle && state.currentTitle && <div className="display-title">{state.currentTitle}</div>}
      {initialData.permissions.timer && (
        <div className="display-clock" aria-live="polite">
          {formatTime(state.displaySeconds)}
        </div>
      )}
      {initialData.permissions.speaker && state.currentSpeaker && <div className="display-speaker">{state.currentSpeaker}</div>}
      {initialData.permissions.nextSegment && state.nextTitle && <div className="display-next">NEXT · {state.nextTitle}</div>}
      {initialData.permissions.operatorMessage && state.message && <div className="display-message">{state.message}</div>}
      <div className="display-status">{viewState.status}</div>
    </main>
  );
}
