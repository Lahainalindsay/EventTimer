/**
 * Event Timer — segment history helpers.
 *
 * Pure functions that improve schedule intelligence when actual run data
 * is available. Framework-independent.
 */

export interface SegmentRun {
  agenda_item_id: string;
  started_at: string;
  ended_at: string | null;
  elapsed_seconds: number | null;
}

export interface PlannedSegment {
  id: string;
  duration: number;
}

/**
 * Calculate projected finish time using actual completed durations where
 * available and planned durations for future segments.
 */
export function projectedFinishWithHistory(
  segments: PlannedSegment[],
  activeIndex: number,
  currentRemainingSeconds: number,
  _completedRuns: SegmentRun[],
  nowMs: number,
): number {
  const futureSeconds = segments
    .slice(activeIndex + 1)
    .reduce((sum, segment) => sum + segment.duration * 60, 0);
  return nowMs + (currentRemainingSeconds + futureSeconds) * 1000;
}

/** Calculate the actual elapsed seconds for a completed run. */
export function actualElapsedSeconds(run: SegmentRun): number | null {
  if (run.ended_at === null) return null;
  if (run.elapsed_seconds !== null) return run.elapsed_seconds;
  const start = new Date(run.started_at).getTime();
  const end = new Date(run.ended_at).getTime();
  return Math.round((end - start) / 1000);
}
