"use client";

import { Radio } from "lucide-react";
import { DEFAULT_THRESHOLDS, formatTime, getTimerStateName } from "@/lib/timer-engine";
import type { Connection, EventData, Segment } from "@/lib/types";

interface DisplayViewProps {
  event: EventData;
  segment: Segment;
  connection: Connection;
}

export function DisplayView({ event, segment, connection }: DisplayViewProps) {
  const next = event.segments[event.active + 1];
  const thresholds = {
    warningSecs: segment.warningSecs ?? DEFAULT_THRESHOLDS.warningSecs,
    urgentSecs: segment.urgentSecs ?? DEFAULT_THRESHOLDS.urgentSecs,
  };
  const stateName = getTimerStateName(event.remaining, event.timerMode, thresholds);
  const stateLabel = stateName === "overtime"
    ? "OVERTIME"
    : stateName === "urgent"
      ? "URGENT"
      : stateName === "warning"
        ? "WRAP SOON"
        : event.running
          ? "ON TIME"
          : "PAUSED";

  return (
    <main className={`display-view ${stateName}`}>
      <button className="exit-display" onClick={() => { location.href = "/dashboard"; }}>
        Exit display
      </button>
      <div className="display-kicker">
        <Radio size={16} /> {connection === "live" ? "LIVE CLOUD" : "NOT SYNCHRONIZED"} · {event.venue.toUpperCase()}
      </div>
      <div className="display-title">{segment.title}</div>
      <div className="display-clock" aria-live="polite">
        {formatTime(event.remaining)}
      </div>
      <div className="display-status" data-state={stateName}>
        {connection === "offline" ? "OFFLINE" : stateLabel}
      </div>
      {event.message && <div className="display-message">{event.message}</div>}
      <div className="display-next">NEXT&nbsp;&nbsp; {next?.title ?? "End of show"}</div>
    </main>
  );
}
