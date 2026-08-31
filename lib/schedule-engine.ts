/**
 * Event Timer — deterministic schedule-intelligence engine.
 *
 * All functions are pure and framework-independent so they can be unit tested
 * without React or Supabase.
 */

export interface ScheduleSegment {
  /** Planned duration in minutes. */
  duration: number;
}

/**
 * Total planned event duration for all segments, in seconds.
 */
export function plannedTotalSeconds(segments: ScheduleSegment[]): number {
  return segments.reduce((sum, s) => sum + s.duration * 60, 0);
}

/**
 * Planned duration of segments from activeIndex onward (inclusive), in seconds.
 */
export function plannedRemainingSeconds(
  segments: ScheduleSegment[],
  activeIndex: number,
): number {
  return segments.slice(activeIndex).reduce((sum, s) => sum + s.duration * 60, 0);
}

/**
 * Projected finish time in milliseconds.
 *
 * Correctly accounts for actual remaining time on the current segment plus
 * planned durations of all future segments.
 */
export function projectedFinishMs(
  segments: ScheduleSegment[],
  activeIndex: number,
  currentRemainingSeconds: number,
  nowMs: number,
): number {
  const futureSeconds = segments
    .slice(activeIndex + 1)
    .reduce((sum, s) => sum + s.duration * 60, 0);
  return nowMs + (currentRemainingSeconds + futureSeconds) * 1000;
}

/**
 * Schedule variance for the current segment, in seconds.
 *
 * Positive = ahead of schedule (more time remaining than the segment's
 * planned duration implies we are running fast).
 * Negative = behind schedule (less time remaining than planned — overtime or
 * the operator has shortened this slot).
 *
 * This is only meaningful relative to the planned duration set when the
 * segment was loaded.  It does not require tracking actual wall-clock start
 * times.
 */
export function segmentVarianceSeconds(
  segment: ScheduleSegment,
  currentRemainingSeconds: number,
): number {
  return currentRemainingSeconds - segment.duration * 60;
}

/**
 * Format a variance value as a human-readable label.
 *
 * @param varianceSeconds – positive = ahead, negative = behind
 */
export function formatVarianceLabel(varianceSeconds: number): string {
  const abs = Math.abs(varianceSeconds);
  if (abs < 60) return "On schedule";
  const mins = Math.round(abs / 60);
  return varianceSeconds > 0 ? `${mins} min ahead` : `${mins} min behind`;
}

/**
 * Format a projected finish timestamp as a locale time string.
 */
export function formatProjectedFinish(
  finishMs: number,
  locale: string | undefined = undefined,
): string {
  return new Date(finishMs).toLocaleTimeString(locale, {
    hour: "numeric",
    minute: "2-digit",
  });
}
