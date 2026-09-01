import { sha256Hex, getDisplayPermissions, type DisplayType } from "@/lib/display-access";
import { computeDisplaySeconds } from "@/lib/timer-engine";
import type { CueType, MessagePriority, ProductionCue } from "@/lib/types";

type JsonValue = string | number | boolean | null | undefined;
type Row = Record<string, JsonValue>;
type QueryResult<T> = PromiseLike<{ data: T | null; error?: unknown }>;
type QueryChain<T> = PromiseLike<{ data: T | null; error?: unknown }> & {
  eq: (column: string, value: string) => QueryChain<T>;
  is: (column: string, value: null) => QueryChain<T>;
  order: (column: string, options?: { ascending?: boolean }) => QueryChain<T>;
  single: () => QueryResult<T>;
  maybeSingle: () => QueryResult<T>;
};
type SupabaseReader = {
  from: <T extends Row | Row[]>(table: string) => {
    select: (columns: string) => QueryChain<T>;
  };
};

export interface DisplaySnapshot {
  displayId: string;
  displayType: DisplayType;
  token?: string;
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
  messagePriority: MessagePriority;
  warningSecs: number;
  urgentSecs: number;
  runtimeVersion: number;
  runtimeUpdatedAt: string;
  currentAgendaItemId: string | null;
  activeCues: ProductionCue[];
  permissions: ReturnType<typeof getDisplayPermissions>;
}

function matchesDisplayTarget(target: string | null | undefined, displayId: string, displayType: DisplayType) {
  return !target || target === "all" || target === displayId || target === displayType;
}

function asString(value: JsonValue, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNullableString(value: JsonValue): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: JsonValue, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

function asCue(row: Row): ProductionCue {
  return {
    id: asString(row.id),
    event_id: asString(row.event_id),
    cue_type: asString(row.cue_type) as CueType,
    target: asNullableString(row.target),
    triggered_at: asString(row.triggered_at),
    cleared_at: asNullableString(row.cleared_at),
    triggered_by: asNullableString(row.triggered_by),
    created_at: asString(row.created_at),
  };
}

export function serializeDisplaySnapshot(args: {
  display: Row;
  eventRow: Row | null;
  runtime: Row | null;
  agendaRows: Row[];
  messageRows: Row[];
  cueRows: Row[];
  token?: string;
  nowMs?: number;
}): DisplaySnapshot {
  const displayType = args.display.display_type as DisplayType;
  const permissions = getDisplayPermissions(displayType);
  const segments = args.agendaRows;
  const currentItemId = args.runtime?.current_agenda_item_id ?? null;
  const activeIndex = segments.findIndex((segment) => segment.id === currentItemId);
  const active = activeIndex >= 0 ? activeIndex : 0;
  const currentSegment = segments[active];
  const nextSegment = segments[active + 1];
  const timerMode = args.runtime?.timer_mode === "count_up" ? "count_up" : "countdown";
  const timerState = {
    durationSeconds: asNumber(
      args.runtime?.duration_seconds,
      Math.max(60, asNumber(currentSegment?.planned_duration_seconds, 600)),
    ),
    manualOffsetSeconds: asNumber(args.runtime?.manual_offset_seconds, 0),
    status: (args.runtime?.timer_status ?? "paused") as "running" | "paused",
    startedAt: asNullableString(args.runtime?.started_at),
  };
  const nowIso = new Date(args.nowMs ?? Date.now()).toISOString();
  const latestMessage = permissions.operatorMessage
    ? args.messageRows.find((row) =>
        row.message_type === "message"
        && !row.cleared_at
        && matchesDisplayTarget(asNullableString(row.display_target), asString(args.display.id), displayType)
        && (!row.expires_at || asString(row.expires_at) > nowIso))
    : null;
  const activeCues = permissions.cues
    ? args.cueRows.filter((cue) =>
        !cue.cleared_at && matchesDisplayTarget(asNullableString(cue.target), asString(args.display.id), displayType))
    : [];

  return {
    displayId: asString(args.display.id),
    displayType,
    token: args.token,
    eventId: asString(args.display.event_id),
    eventName: asString(args.eventRow?.name),
    venue: asString(args.eventRow?.venue),
    timerStatus: timerState.status,
    timerMode,
    remaining: computeDisplaySeconds(timerState, timerMode, args.nowMs ?? Date.now()),
    startedAt: timerState.startedAt,
    durationSeconds: timerState.durationSeconds,
    currentTitle: permissions.segmentTitle ? asString(currentSegment?.title) : "",
    currentSpeaker: permissions.speaker ? asString(currentSegment?.speaker) : "",
    nextTitle: permissions.nextSegment ? asString(nextSegment?.title) : "",
    message: asString(latestMessage?.body),
    messagePriority: asString(latestMessage?.priority, "normal") as MessagePriority,
    warningSecs: asNumber(currentSegment?.warning_seconds, asNumber(args.eventRow?.warning_seconds, 120)),
    urgentSecs: asNumber(currentSegment?.urgent_seconds, asNumber(args.eventRow?.urgent_seconds, 30)),
    runtimeVersion: asNumber(args.runtime?.version, 0),
    runtimeUpdatedAt: asString(args.runtime?.updated_at, new Date(args.nowMs ?? Date.now()).toISOString()),
    currentAgendaItemId: asNullableString(currentItemId),
    activeCues: activeCues.map(asCue),
    permissions,
  };
}

export async function loadDisplaySnapshot(rawSupabase: unknown, token: string, includeToken = false): Promise<DisplaySnapshot | null> {
  const supabase = rawSupabase as SupabaseReader;
  const tokenHash = await sha256Hex(token);
  const { data: display, error: displayError } = await supabase
    .from<Row>("event_displays")
    .select("id,event_id,name,display_type,revoked_at,last_heartbeat_at")
    .eq("access_token_hash", tokenHash)
    .is("revoked_at", null)
    .single();

  if (displayError || !display) return null;

  const eventId = asString(display.event_id);
  const [
    { data: runtime },
    { data: eventRow },
    { data: agendaRows },
    { data: messageRows },
    { data: cueRows },
  ] = await Promise.all([
    supabase.from<Row>("event_runtime").select("*").eq("event_id", eventId).maybeSingle(),
    supabase.from<Row>("events").select("id,name,venue,warning_seconds,urgent_seconds").eq("id", eventId).single(),
    supabase
      .from<Row[]>("agenda_items")
      .select("id,title,speaker,planned_duration_seconds,warning_seconds,urgent_seconds")
      .eq("event_id", eventId)
      .order("position"),
    supabase
      .from<Row[]>("event_messages")
      .select("body,priority,display_target,expires_at,message_type,cleared_at,created_at")
      .eq("event_id", eventId)
      .is("cleared_at", null)
      .order("created_at", { ascending: false }),
    supabase
      .from<Row[]>("production_cues")
      .select("id,event_id,cue_type,target,triggered_at,cleared_at,triggered_by,created_at")
      .eq("event_id", eventId)
      .is("cleared_at", null)
      .order("triggered_at"),
  ]);

  return serializeDisplaySnapshot({
    display,
    eventRow,
    runtime,
    agendaRows: agendaRows ?? [],
    messageRows: messageRows ?? [],
    cueRows: cueRows ?? [],
    token: includeToken ? token : undefined,
  });
}
