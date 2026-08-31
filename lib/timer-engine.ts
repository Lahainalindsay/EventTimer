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
  manualOffsetSeconds: 0;
  status: "paused";
  startedAt: null;
}

export interface RunningTimerState {
  durationSeconds: number;
  manualOffsetSeconds: 0;
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
