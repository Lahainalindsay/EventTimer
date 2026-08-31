"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { HEARTBEAT_INTERVAL_MS } from "@/lib/display-access";
import type { Connection, MessageRow, ProductionCue, RuntimeRow } from "@/lib/types";

interface UseEventRealtimeOptions {
  currentId: string;
  displayToken?: string;
  onRuntimeUpdate: (runtime: RuntimeRow) => void;
  onMessageInsert: (eventId: string, message: MessageRow) => void;
  onMessageClear: (eventId: string) => void;
  onCueUpsert: (eventId: string, cue: ProductionCue) => void;
  onCueClear: (eventId: string, cueId: string) => void;
}

export function useEventRealtime({
  currentId,
  displayToken,
  onRuntimeUpdate,
  onMessageInsert,
  onMessageClear,
  onCueUpsert,
  onCueClear,
}: UseEventRealtimeOptions): Connection {
  const [connection, setConnection] = useState<Connection>(
    typeof navigator !== "undefined" && navigator.onLine ? "reconnecting" : "offline",
  );

  useEffect(() => {
    if (!currentId) return;
    const channel = supabase
      .channel(`event-timer-${currentId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "event_runtime", filter: `event_id=eq.${currentId}` },
        (payload) => {
          const runtime = payload.new as RuntimeRow;
          if (runtime?.event_id) onRuntimeUpdate(runtime);
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "event_messages", filter: `event_id=eq.${currentId}` },
        (payload) => {
          const message = payload.new as MessageRow;
          if (message?.body) onMessageInsert(currentId, message);
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "event_messages", filter: `event_id=eq.${currentId}` },
        (payload) => {
          const message = payload.new as MessageRow;
          if (message?.cleared_at) onMessageClear(currentId);
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "production_cues", filter: `event_id=eq.${currentId}` },
        (payload) => {
          const cue = payload.new as ProductionCue;
          if (cue?.id) onCueUpsert(currentId, cue);
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "production_cues", filter: `event_id=eq.${currentId}` },
        (payload) => {
          const cue = payload.new as ProductionCue;
          if (!cue?.id) return;
          if (cue.cleared_at) {
            onCueClear(currentId, cue.id);
            return;
          }
          onCueUpsert(currentId, cue);
        },
      )
      .subscribe((status) =>
        setConnection(status === "SUBSCRIBED" ? "live" : navigator.onLine ? "reconnecting" : "offline"),
      );
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [currentId, onCueClear, onCueUpsert, onRuntimeUpdate, onMessageClear, onMessageInsert]);

  useEffect(() => {
    if (!displayToken) return;
    const sendHeartbeat = () => {
      void fetch("/api/display/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: displayToken }),
      });
    };
    sendHeartbeat();
    const id = window.setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [displayToken]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const online = () => setConnection("reconnecting");
    const offline = () => setConnection("offline");
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
  }, []);

  return connection;
}
