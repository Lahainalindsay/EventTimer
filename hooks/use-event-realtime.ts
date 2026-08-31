"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Connection, MessageRow, RuntimeRow } from "@/lib/types";

interface UseEventRealtimeOptions {
  currentId: string;
  onRuntimeUpdate: (runtime: RuntimeRow) => void;
  onMessageInsert: (eventId: string, body: string) => void;
  onMessageClear: (eventId: string) => void;
}

export function useEventRealtime({
  currentId,
  onRuntimeUpdate,
  onMessageInsert,
  onMessageClear,
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
          if (message?.body) onMessageInsert(currentId, message.body);
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
      .subscribe((status) =>
        setConnection(status === "SUBSCRIBED" ? "live" : navigator.onLine ? "reconnecting" : "offline"),
      );
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [currentId, onRuntimeUpdate, onMessageInsert, onMessageClear]);

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
