import type { TimerMode } from "@/lib/timer-engine";

export type { TimerMode };

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

export interface Segment {
  id: string;
  time: string;
  title: string;
  person: string;
  duration: number;
  segmentType: SegmentType;
  notes: string;
  warningSecs: number;
  urgentSecs: number;
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
}

export type Connection = "live" | "reconnecting" | "offline";
export type Screen = "live" | "events" | "displays" | "account";
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
}

export interface MessageRow {
  event_id?: string;
  body?: string;
  cleared_at?: string | null;
}
