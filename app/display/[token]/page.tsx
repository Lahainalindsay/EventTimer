import { createClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import { DisplayClient } from "@/components/event-timer/display-client";
import { getDisplayPermissions, type DisplayType } from "@/lib/display-access";
import { computeDisplaySeconds } from "@/lib/timer-engine";

export const dynamic = "force-dynamic";

async function getDisplayData(token: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) return null;

  const { sha256Hex } = await import("@/lib/display-access");
  const tokenHash = await sha256Hex(token);
  const supabase = createClient(supabaseUrl, supabaseKey);

  const { data: display, error: displayError } = await supabase
    .from("event_displays")
    .select("id,event_id,name,display_type,revoked_at,last_heartbeat_at")
    .eq("access_token_hash", tokenHash)
    .is("revoked_at", null)
    .single();

  if (displayError || !display) return null;

  const permissions = getDisplayPermissions(display.display_type as DisplayType);

  const [{ data: runtime }, { data: eventRow }, { data: agendaRows }, { data: messageRows }] = await Promise.all([
    supabase.from("event_runtime").select("*").eq("event_id", display.event_id).single(),
    supabase.from("events").select("*").eq("id", display.event_id).single(),
    supabase
      .from("agenda_items")
      .select("*")
      .eq("event_id", display.event_id)
      .order("position"),
    supabase
      .from("event_messages")
      .select("*")
      .eq("event_id", display.event_id)
      .is("cleared_at", null)
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  const segments = agendaRows ?? [];
  const currentItemId = runtime?.current_agenda_item_id ?? null;
  const activeIndex = segments.findIndex((segment) => segment.id === currentItemId);
  const active = activeIndex >= 0 ? activeIndex : 0;
  const currentSegment = segments[active];
  const nextSegment = segments[active + 1];
  const timerMode = runtime?.timer_mode === "count_up" ? "count_up" : "countdown";
  const timerState = {
    durationSeconds: runtime?.duration_seconds ?? Math.max(60, currentSegment?.planned_duration_seconds ?? 600),
    manualOffsetSeconds: runtime?.manual_offset_seconds ?? 0,
    status: (runtime?.timer_status ?? "paused") as "running" | "paused",
    startedAt: runtime?.started_at ?? null,
  };
  const latestMessage = messageRows?.find((row) => !row.display_target || row.display_target === display.id);

  return {
    displayId: display.id,
    displayType: display.display_type,
    token,
    eventId: display.event_id,
    eventName: eventRow?.name ?? "",
    venue: eventRow?.venue ?? "",
    timerStatus: timerState.status,
    timerMode,
    remaining: computeDisplaySeconds(timerState, timerMode, Date.now()),
    startedAt: timerState.startedAt,
    durationSeconds: timerState.durationSeconds,
    currentTitle: permissions.segmentTitle ? (currentSegment?.title ?? "") : "",
    currentSpeaker: permissions.speaker ? (currentSegment?.speaker ?? "") : "",
    nextTitle: permissions.nextSegment ? (nextSegment?.title ?? "") : "",
    message: permissions.operatorMessage ? (latestMessage?.body ?? "") : "",
    warningSecs: currentSegment?.warning_seconds ?? eventRow?.warning_seconds ?? 120,
    urgentSecs: currentSegment?.urgent_seconds ?? eventRow?.urgent_seconds ?? 30,
    runtimeVersion: runtime?.version ?? 0,
    runtimeUpdatedAt: runtime?.updated_at ?? new Date().toISOString(),
    currentAgendaItemId: currentItemId,
    segments: segments.map((segment) => ({
      id: segment.id,
      title: segment.title ?? "",
      speaker: segment.speaker ?? "",
    })),
    permissions,
  };
}

export default async function DisplayPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const data = await getDisplayData(token);
  if (!data) notFound();
  return <DisplayClient initialData={data} />;
}
