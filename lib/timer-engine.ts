/**
 * Event Timer — deterministic timer engine.
 *
 * All public functions are framework-independent pure functions so they can be
 * unit tested without React or Supabase.  Time is always derived from
 * authoritative ISO timestamps rather than accumulated setInterval ticks, so
 * the display stays correct after tab sleep, network loss, or reconnection.
 */

export type TimerStatus = "running" | "paused";

export interface TimerState {
  /** Seconds remaining at the last start / pause / adjust operation. */
  durationSeconds: number;
  /** Any manual offset applied on top of durationSeconds. */
  manualOffsetSeconds: number;
  status: TimerStatus;
  /** ISO timestamp of the most recent "start" operation, or null when paused. */
  startedAt: string | null;
}

/**
 * Derive the current remaining seconds from timestamps.
 * When running, subtracts elapsed time since startedAt.
 * When paused, returns the stored base value unchanged.
 * May return negative values once the segment goes into overtime.
 */
export function computeRemainingSeconds(state: TimerState, nowMs: number): number {
  const base = state.durationSeconds + state.manualOffsetSeconds;
  if (state.status === "running" && state.startedAt) {
    const elapsed = Math.floor((nowMs - new Date(state.startedAt).getTime()) / 1000);
    return base - elapsed;
  }
  return base;
}

/** Returns true when the timer has gone past zero (overtime). */
export function isOvertime(remainingSeconds: number): boolean {
  return remainingSeconds < 0;
}

export interface PausedTimerState {
  durationSeconds: number;
  manualOffsetSeconds: number;
  status: "paused";
  startedAt: null;
}

export interface RunningTimerState {
  durationSeconds: number;
  manualOffsetSeconds: number;
  status: "running";
  startedAt: string;
}

/**
 * Pause a running timer.  Captures the remaining seconds at `nowMs` so the
 * value is stable when the timer is later resumed.
 */
export function pause(state: TimerState, nowMs: number): PausedTimerState {
  const remaining = computeRemainingSeconds(state, nowMs);
  return { durationSeconds: remaining, manualOffsetSeconds: 0, status: "paused", startedAt: null };
}

/**
 * Resume a paused (or running) timer from the current remaining value.
 * Records a fresh startedAt so future calls to computeRemainingSeconds drift
 * from this moment forward.
 */
export function resume(state: TimerState, nowMs: number): RunningTimerState {
  const remaining = computeRemainingSeconds(state, nowMs);
  return { durationSeconds: remaining, manualOffsetSeconds: 0, status: "running", startedAt: new Date(nowMs).toISOString() };
}

/** Reset to a fixed duration without starting the timer. */
export function reset(durationSeconds: number): PausedTimerState {
  return { durationSeconds, manualOffsetSeconds: 0, status: "paused", startedAt: null };
}

/**
 * Add or subtract seconds from the timer.  Preserves running/paused state.
 * Pass a negative deltaSeconds to subtract time.
 */
export function adjustTime(state: TimerState, deltaSeconds: number, nowMs: number): PausedTimerState | RunningTimerState {
  const remaining = computeRemainingSeconds(state, nowMs) + deltaSeconds;
  if (state.status === "running") {
    return { durationSeconds: remaining, manualOffsetSeconds: 0, status: "running", startedAt: new Date(nowMs).toISOString() };
  }
  return { durationSeconds: remaining, manualOffsetSeconds: 0, status: "paused", startedAt: null };
}

/**
 * Format seconds as MM:SS, with a leading "+" when in overtime.
 * Absolute value is used so overtime counts upward positively.
 */
export function formatTime(seconds: number): string {
  const s = Math.abs(Math.floor(seconds));
  const prefix = seconds < 0 ? "+" : "";
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${prefix}${mm}:${ss}`;
}

export type TimerMode = "countdown" | "count_up";

/** Threshold configuration for timer warning states. */
export interface ThresholdConfig {
  warningSecs: number;
  urgentSecs: number;
}

/** Default thresholds used when no per-segment config is set. */
export const DEFAULT_THRESHOLDS: ThresholdConfig = {
  warningSecs: 120,
  urgentSecs: 30,
};

export type TimerStateName = "normal" | "warning" | "urgent" | "overtime";

/**
 * Determine the named state of the timer for display purposes.
 * In count_up mode, there are no warning thresholds — always returns "normal".
 */
export function getTimerStateName(
  remaining: number,
  mode: TimerMode,
  thresholds: ThresholdConfig = DEFAULT_THRESHOLDS,
): TimerStateName {
  if (mode === "count_up") return "normal";
  if (remaining < 0) return "overtime";
  if (remaining <= thresholds.urgentSecs) return "urgent";
  if (remaining <= thresholds.warningSecs) return "warning";
  return "normal";
}

/**
 * Compute elapsed seconds for count_up mode.
 * durationSeconds stores the accumulated elapsed seconds at the last pause.
 */
export function computeElapsedSeconds(state: TimerState, nowMs: number): number {
  if (state.status === "running" && state.startedAt) {
    const elapsed = Math.floor((nowMs - new Date(state.startedAt).getTime()) / 1000);
    return state.durationSeconds + elapsed;
  }
  return state.durationSeconds;
}

/**
 * Get the display value (seconds) for either mode.
 * For countdown: remaining seconds (may be negative in overtime).
 * For count_up: elapsed seconds.
 */
export function computeDisplaySeconds(state: TimerState, mode: TimerMode, nowMs: number): number {
  return mode === "count_up"
    ? computeElapsedSeconds(state, nowMs)
    : computeRemainingSeconds(state, nowMs);
}

/**
 * Active running segments must be paused or reset before their timer mode can
 * be changed. Future segments are always safe to edit.
 */
export function canChangeTimerMode(
  segmentIndex: number,
  activeIndex: number,
  isRunning: boolean,
): boolean {
  return !(isRunning && segmentIndex === activeIndex);
}
