import type { EventData, SegmentRun } from "@/lib/types";
import { actualElapsedSeconds } from "@/lib/segment-history";

export function escapeCSV(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (!/[",\n\r]/u.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

function formatDurationLabel(totalSeconds: number | null): string {
  if (totalSeconds === null) return "";
  const minutes = Math.floor(Math.abs(totalSeconds) / 60);
  const seconds = Math.abs(totalSeconds) % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function segmentActualSeconds(segmentId: string, runs: SegmentRun[]): number | null {
  const latest = runs
    .filter((run) => run.agenda_item_id === segmentId && run.ended_at !== null)
    .sort((left, right) => new Date(left.ended_at ?? 0).getTime() - new Date(right.ended_at ?? 0).getTime())
    .at(-1);
  return latest ? actualElapsedSeconds(latest) : null;
}

export function exportRundownCSV(event: EventData): string {
  const rows = [
    ["Time", "Title", "Person", "Duration Minutes", "Segment Type", "Timer Mode", "Notes", "Warning Seconds", "Urgent Seconds"],
    ...event.segments.map((segment) => [
      segment.time,
      segment.title,
      segment.person,
      segment.duration,
      segment.segmentType,
      segment.timerMode,
      segment.notes,
      segment.warningSecs,
      segment.urgentSecs,
    ]),
  ];
  return rows.map((row) => row.map((value) => escapeCSV(value)).join(",")).join("\n");
}

export function exportTimingReportCSV(event: EventData, runs: SegmentRun[]): string {
  const rows = [
    ["Title", "Person", "Planned Minutes", "Actual Duration", "Variance"],
    ...event.segments.map((segment) => {
      const actual = segmentActualSeconds(segment.id, runs);
      const plannedSeconds = segment.duration * 60;
      const variance = actual === null ? "" : actual - plannedSeconds;
      const varianceLabel = variance === "" ? "" : variance === 0 ? "On time" : `${variance > 0 ? "+" : "-"}${formatDurationLabel(Number(variance))}`;
      return [
        segment.title,
        segment.person,
        segment.duration,
        actual === null ? "" : formatDurationLabel(actual),
        varianceLabel,
      ];
    }),
  ];
  return rows.map((row) => row.map((value) => escapeCSV(value)).join(",")).join("\n");
}
