"use client";

import { useEffect, useMemo, useState } from "react";
import { HEARTBEAT_INTERVAL_MS, type DisplayPayloadPermissions } from "@/lib/display-access";
import { shouldAcceptRuntimeUpdate } from "@/lib/runtime-version";
import { computeDisplaySeconds, formatTime, getTimerStateName } from "@/lib/timer-engine";
import type { ProductionCue } from "@/lib/types";

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
    messagePriority: string;
    runtimeVersion: number;
    runtimeUpdatedAt: string;
    currentAgendaItemId: string | null;
    activeCues: ProductionCue[];
    permissions: DisplayPayloadPermissions;
  };
}

function matchesDisplayTarget(target: string | null | undefined, displayId: string, displayType: string) {
  return !target || target === "all" || target === displayId || target === displayType;
}

function activeCueList(cues: ProductionCue[], displayId: string, displayType: string) {
  return cues.filter((cue) => matchesDisplayTarget(cue.target, displayId, displayType) && cue.cleared_at === null);
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
    messagePriority: initialData.messagePriority,
    activeCues: activeCueList(initialData.activeCues, initialData.displayId, initialData.displayType),
    connectionState: "connecting" as "connecting" | "live" | "offline",
    runtimeVersion: initialData.runtimeVersion,
    runtimeUpdatedAt: initialData.runtimeUpdatedAt,
  }));

  const warning = initialData.warningSecs;
  const urgent = initialData.urgentSecs;

  useEffect(() => {
    let cancelled = false;
    const applySnapshot = (snapshot: typeof initialData) => {
      setState((prev) => {
        const currentRuntime = { version: prev.runtimeVersion, updated_at: prev.runtimeUpdatedAt };
        const incomingRuntime = { version: snapshot.runtimeVersion ?? 0, updated_at: snapshot.runtimeUpdatedAt };
        if (!shouldAcceptRuntimeUpdate(currentRuntime, incomingRuntime)) {
          return {
            ...prev,
            connectionState: "live",
            message: snapshot.message,
            messagePriority: snapshot.messagePriority,
            activeCues: activeCueList(snapshot.activeCues, initialData.displayId, initialData.displayType),
          };
        }
        return {
          ...prev,
          displaySeconds: snapshot.remaining,
          running: snapshot.timerStatus === "running",
          startedAt: snapshot.startedAt,
          durationSeconds: snapshot.durationSeconds,
          timerMode: snapshot.timerMode,
          currentAgendaItemId: snapshot.currentAgendaItemId,
          currentTitle: snapshot.currentTitle,
          currentSpeaker: snapshot.currentSpeaker,
          nextTitle: snapshot.nextTitle,
          message: snapshot.message,
          messagePriority: snapshot.messagePriority,
          activeCues: activeCueList(snapshot.activeCues, initialData.displayId, initialData.displayType),
          connectionState: "live",
          runtimeVersion: snapshot.runtimeVersion,
          runtimeUpdatedAt: snapshot.runtimeUpdatedAt,
        };
      });
    };

    const refreshOnce = async () => {
      const response = await fetch("/api/display/snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: initialData.token }),
      });
      if (!response.ok) {
        return false;
      }
      const snapshot = await response.json() as typeof initialData;
      if (cancelled) return false;
      applySnapshot(snapshot);
      return true;
    };

    const controller = new AbortController();
    let reconnectTimer: number | undefined;
    let reconnectAttempt = 0;
    let revoked = false;

    const scheduleReconnect = () => {
      if (cancelled || revoked || reconnectTimer !== undefined) return;
      setState((prev) => ({ ...prev, connectionState: "offline" }));
      const delay = Math.min(1000 * (2 ** reconnectAttempt), 10000);
      reconnectAttempt += 1;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = undefined;
        if (!cancelled) void connectStream();
      }, delay);
    };

    const connectStream = async () => {
      if (cancelled || revoked) return;
      setState((prev) => ({ ...prev, connectionState: "connecting" }));
      try {
        const response = await fetch("/api/display/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: initialData.token }),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          scheduleReconnect();
          return;
        }

        // Reconcile from the authoritative endpoint before trusting this stream.
        if (!(await refreshOnce())) {
          scheduleReconnect();
          return;
        }
        reconnectAttempt = 0;

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (!cancelled) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            const event = JSON.parse(line) as { type: "snapshot"; snapshot: typeof initialData } | { type: "revoked" };
            if (event.type === "revoked") {
              revoked = true;
              setState((prev) => ({ ...prev, connectionState: "offline" }));
              return;
            }
            applySnapshot(event.snapshot);
          }
        }
        if (!cancelled && !revoked) scheduleReconnect();
      } catch {
        if (!cancelled && !controller.signal.aborted) scheduleReconnect();
      }
    };

    void connectStream();
    return () => {
      cancelled = true;
      controller.abort();
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
    };
  }, [initialData.displayId, initialData.displayType, initialData.token]);

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
        {state.connectionState.toUpperCase()} · {initialData.venue.toUpperCase()}
      </div>
      {initialData.permissions.cues && !!state.activeCues.length && (
        <div className="display-cues" aria-live="assertive" aria-label="Active production cues">
          {state.activeCues.map((cue) => (
            <span key={cue.id} className="display-cue-pill">
              {cue.cue_type.replaceAll("_", " ")}
            </span>
          ))}
        </div>
      )}
      {initialData.permissions.segmentTitle && state.currentTitle && <div className="display-title">{state.currentTitle}</div>}
      {initialData.permissions.timer && (
        <div className="display-clock" aria-live="polite">
          {formatTime(state.displaySeconds)}
        </div>
      )}
      {initialData.permissions.speaker && state.currentSpeaker && <div className="display-speaker">{state.currentSpeaker}</div>}
      {initialData.permissions.nextSegment && state.nextTitle && <div className="display-next">NEXT · {state.nextTitle}</div>}
      {initialData.permissions.operatorMessage && state.message && (
        <div className={`display-message ${state.messagePriority === "urgent" ? "urgent" : ""}`}>{state.message}</div>
      )}
      <div className="display-status">{viewState.status}</div>
    </main>
  );
}
