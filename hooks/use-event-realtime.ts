"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { HEARTBEAT_INTERVAL_MS } from "@/lib/display-access";
import { reportError } from "@/lib/observability";
import type { Connection, MessageRow, ProductionCue, RuntimeRow } from "@/lib/types";

interface UseEventRealtimeOptions {
  currentId: string;
  displayToken?: string;
  operatorEmail?: string;
  onRuntimeUpdate: (runtime: RuntimeRow) => void;
  onMessageInsert: (eventId: string, message: MessageRow) => void;
  onMessageClear: (eventId: string) => void;
  onCueUpsert: (eventId: string, cue: ProductionCue) => void;
  onCueClear: (eventId: string, cueId: string) => void;
}

export function useEventRealtime({
  currentId,
  displayToken,
  operatorEmail,
  onRuntimeUpdate,
  onMessageInsert,
  onMessageClear,
  onCueUpsert,
  onCueClear,
}: UseEventRealtimeOptions): { connection: Connection; operatorCount: number } {
  const [connection, setConnection] = useState<Connection>(
    typeof navigator !== "undefined" && navigator.onLine ? "reconnecting" : "offline",
  );
  const [operatorCount, setOperatorCount] = useState(0);

  useEffect(() => {
    if (!currentId) return;

    const channel = supabase
      .channel(`event-timer-${currentId}`, {
        config: operatorEmail ? { presence: { key: operatorEmail } } : undefined,
      })
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
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<{ operator?: string; event_id?: string }>();
        const count = Object.values(state)
          .flat()
          .filter((presence) => presence?.event_id === currentId).length;
        setOperatorCount(count);
      })
      .subscribe(async (status) => {
        setConnection(status === "SUBSCRIBED" ? "live" : navigator.onLine ? "reconnecting" : "offline");
        if (status === "SUBSCRIBED" && operatorEmail) {
          const result = await channel.track({ operator: operatorEmail, event_id: currentId });
          if (result !== "ok") {
            reportError({
              context: "operator_presence",
              message: "Presence tracking failed",
              event_id: currentId,
              timestamp: new Date().toISOString(),
            });
          }
        }
      });

    return () => {
      setOperatorCount(0);
      void supabase.removeChannel(channel);
    };
  }, [currentId, onCueClear, onCueUpsert, onRuntimeUpdate, onMessageClear, onMessageInsert, operatorEmail]);

  useEffect(() => {
    if (!displayToken) return;
    const sendHeartbeat = async () => {
      const res = await fetch("/api/display/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: displayToken }),
      });
      if (!res.ok) {
        reportError({
          context: "display_heartbeat",
          message: "Display heartbeat request failed",
          timestamp: new Date().toISOString(),
        });
      }
    };
    void sendHeartbeat();
    const id = window.setInterval(() => {
      void sendHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);
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

  return { connection, operatorCount };
}
