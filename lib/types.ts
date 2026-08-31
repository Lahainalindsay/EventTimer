import type { DisplayStatus, DisplayType } from "@/lib/display-access";
import type { TimerMode } from "@/lib/timer-engine";

export type { TimerMode };
export type { DisplayType, DisplayStatus };

export type SegmentType =
  | "opening"
  | "speaker"
  | "keynote"
  | "panel"
  | "break"
  | "transition"
  | "video"
  | "performance"
  | "qa"
  | "closing"
  | "custom";

export const SEGMENT_TYPES: { value: SegmentType; label: string }[] = [
  { value: "opening", label: "Opening" },
  { value: "speaker", label: "Speaker" },
  { value: "keynote", label: "Keynote" },
  { value: "panel", label: "Panel" },
  { value: "break", label: "Break" },
  { value: "transition", label: "Transition" },
  { value: "video", label: "Video" },
  { value: "performance", label: "Performance" },
  { value: "qa", label: "Q&A" },
  { value: "closing", label: "Closing" },
  { value: "custom", label: "Custom" },
];

export const TIMER_MODES: { value: TimerMode; label: string }[] = [
  { value: "countdown", label: "Countdown" },
  { value: "count_up", label: "Count Up" },
];

export interface Segment {
  id: string;
  time: string;
  title: string;
  person: string;
  duration: number;
  segmentType: SegmentType;
  timerMode: TimerMode;
  notes: string;
  warningSecs: number;
  urgentSecs: number;
}

export interface EventSettings {
  timezone: string;
  warningSecs: number;
  urgentSecs: number;
  autoAdvance: boolean;
}

export interface EventData {
  id: string;
  name: string;
  date: string;
  venue: string;
  segments: Segment[];
  active: number;
  remaining: number;
  timerDuration: number;
  timerStartedAt: string | null;
  timerMode: TimerMode;
  running: boolean;
  message: string;
  updatedAt: number;
  runtimeVersion: number;
  settings: EventSettings;
}

export type Connection = "live" | "reconnecting" | "offline";
export type Screen = "live" | "events" | "displays" | "account" | "settings";
export type AuthMode = "login" | "signup" | "reset" | "update";

export interface RuntimeRow {
  event_id: string;
  current_agenda_item_id: string | null;
  duration_seconds: number;
  manual_offset_seconds: number;
  timer_status: string;
  timer_mode: string;
  started_at: string | null;
  updated_at: string;
  version: number;
}

export interface MessageRow {
  event_id?: string;
  body?: string;
  cleared_at?: string | null;
  message_type?: string;
}

export interface EventDisplay {
  id: string;
  event_id: string;
  name: string;
  display_type: DisplayType;
  pairing_code_expires_at: string | null;
  connected_at: string | null;
  last_heartbeat_at: string | null;
  revoked_at: string | null;
  created_at: string;
  pairingCode?: string;
}

export interface SegmentRun {
  id: string;
  event_id: string;
  agenda_item_id: string;
  started_at: string;
  ended_at: string | null;
  elapsed_seconds: number | null;
  completion_reason: string | null;
  created_at: string;
}
