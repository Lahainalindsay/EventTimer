"use client";

import { formatTime, type TimerStateName } from "@/lib/timer-engine";

interface TimerDisplayProps {
  remaining: number;
  stateName: TimerStateName;
  running: boolean;
  warningSecs: number;
  urgentSecs: number;
}

export function TimerDisplay({
  remaining,
  stateName,
  running,
  warningSecs,
  urgentSecs,
}: TimerDisplayProps) {
  const stateLabel = stateName === "overtime"
    ? "OVERTIME"
    : stateName === "urgent"
      ? "URGENT"
      : stateName === "warning"
        ? "WRAP SOON"
        : running
          ? "ON TIME"
          : "PAUSED";
  const timerAriaLabel = `${stateLabel}. ${formatTime(remaining)} remaining.`;

  return (
    <>
      <div className="timer" role="timer" aria-live="off" aria-label={timerAriaLabel} data-state={stateName}>
        {formatTime(remaining)}
      </div>
      <div className="timer-state" data-state={stateName}>
        <span>{stateLabel}</span>
        <small>
          Warning at {String(Math.floor(warningSecs / 60)).padStart(2, "0")}:
          {String(warningSecs % 60).padStart(2, "0")} · Urgent at {String(Math.floor(urgentSecs / 60)).padStart(2, "0")}:
          {String(urgentSecs % 60).padStart(2, "0")}
        </small>
      </div>
    </>
  );
}
