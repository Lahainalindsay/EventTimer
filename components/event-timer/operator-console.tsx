"use client";

import { ArrowRight, Fullscreen, Link2, Radio } from "lucide-react";
import { DEFAULT_THRESHOLDS, getTimerStateName } from "@/lib/timer-engine";
import {
  formatProjectedFinish,
  formatVarianceLabel,
  projectedFinishMs,
  segmentVarianceSeconds,
} from "@/lib/schedule-engine";
import { TimerDisplay } from "@/components/event-timer/timer-display";
import { TimerControls } from "@/components/event-timer/timer-controls";
import { RundownPanel } from "@/components/event-timer/rundown-panel";
import { CommsPanel } from "@/components/event-timer/comms-panel";
import type { Connection, EventData, Segment } from "@/lib/types";

interface OperatorConsoleProps {
  event: EventData;
  connection: Connection;
  onToggleTimer: () => void;
  onAdjustTimer: (delta: number) => void;
  onSetTimer: (seconds: number, running?: boolean) => void;
  onJumpTo: (index: number, run?: boolean) => void;
  onMoveSegment: (from: number, to: number) => void;
  onSaveSegment: (item: Segment, isEdit: boolean) => Promise<boolean>;
  onDeleteSegment: (id: string) => Promise<void>;
  onDuplicateSegment: (segment: Segment, index: number) => Promise<void>;
  onSendMessage: (body: string) => Promise<void>;
  onClearMessage: () => Promise<void>;
  onOpenDisplay: () => void;
  onCopyDisplay: () => void;
}

export function OperatorConsole({
  event,
  connection,
  onToggleTimer,
  onAdjustTimer,
  onSetTimer,
  onJumpTo,
  onMoveSegment,
  onSaveSegment,
  onDeleteSegment,
  onDuplicateSegment,
  onSendMessage,
  onClearMessage,
  onOpenDisplay,
  onCopyDisplay,
}: OperatorConsoleProps) {
  const segment = event.segments[event.active];
  const next = event.segments[event.active + 1];

  const thresholds = {
    warningSecs: segment?.warningSecs ?? DEFAULT_THRESHOLDS.warningSecs,
    urgentSecs: segment?.urgentSecs ?? DEFAULT_THRESHOLDS.urgentSecs,
  };
  const stateName = getTimerStateName(event.remaining, event.timerMode, thresholds);
  const statusClass = stateName;

  // eslint-disable-next-line react-hooks/purity -- projected finish intentionally reads wall-clock time; component re-renders every 500 ms
  const projected = formatProjectedFinish(projectedFinishMs(event.segments, event.active, event.remaining, Date.now()));
  const variance = segment ? formatVarianceLabel(segmentVarianceSeconds(segment, event.remaining)) : "";

  if (!segment) return null;

  return (
    <>
      <div className="workspace-heading">
        <div>
          <div className="eyebrow">
            <span className="live-dot" /> LIVE CONTROL
          </div>
          <h1>{event.name}</h1>
        </div>
        <div className="heading-actions">
          <button className="button secondary" onClick={onOpenDisplay}>
            <Fullscreen size={16} /> Open display
          </button>
          <button className="button secondary" onClick={onCopyDisplay}>
            <Link2 size={16} /> Share
          </button>
        </div>
      </div>

      <div className="status-strip">
        <div>
          <span>STATUS</span>
          <strong className={event.running ? "green" : undefined}>{event.running ? "Running" : "Ready / paused"}</strong>
        </div>
        <div>
          <span>DATE</span>
          <strong>{event.date}</strong>
        </div>
        <div>
          <span>PROJECTED FINISH</span>
          <strong>{projected}</strong>
        </div>
        <div>
          <span>SCHEDULE</span>
          <strong>{variance}</strong>
        </div>
        <div className="connection-label">
          <span className={connection === "live" ? "pulse" : connection === "reconnecting" ? "reconnecting" : "offline"} />
          {connection === "live"
            ? "Realtime connected"
            : connection === "offline"
              ? "Offline — state may be stale"
              : "Reconnecting"}
        </div>
      </div>

      <div className="console-grid">
        <section className={`timer-card ${statusClass}`}>
          <div className="timer-meta">
            <span>
              <Radio size={14} /> {event.running ? "NOW LIVE" : "READY"}
            </span>
            <span className="timer-mode-badge">{event.timerMode === "count_up" ? "COUNT UP" : "COUNTDOWN"}</span>
          </div>
          <div className="segment-title">{segment.title}</div>
          <div className="speaker">{segment.person}</div>

          <TimerDisplay
            remaining={event.remaining}
            stateName={stateName}
            running={event.running}
            warningSecs={thresholds.warningSecs}
            urgentSecs={thresholds.urgentSecs}
          />

          <TimerControls
            running={event.running}
            segment={segment}
            hasNext={!!next}
            hasPrev={event.active > 0}
            onToggle={onToggleTimer}
            onAdjust={onAdjustTimer}
            onReset={() => onSetTimer(segment.duration * 60, false)}
            onRestart={() => onSetTimer(segment.duration * 60, true)}
            onPrev={() => onJumpTo(event.active - 1, false)}
            onNext={() => next && onJumpTo(event.active + 1, true)}
          />

          <button className="next-button" onClick={() => next && onJumpTo(event.active + 1, true)} disabled={!next}>
            <span>NEXT</span>
            <strong>{next?.title ?? "Show complete"}</strong>
            <ArrowRight size={20} />
          </button>
        </section>

        <CommsPanel
          venue={event.venue}
          message={event.message}
          connection={connection}
          onSend={onSendMessage}
          onClear={onClearMessage}
        />
      </div>

      <RundownPanel
        segments={event.segments}
        activeIndex={event.active}
        onJump={onJumpTo}
        onMove={onMoveSegment}
        onSave={onSaveSegment}
        onDelete={onDeleteSegment}
        onDuplicate={onDuplicateSegment}
      />
    </>
  );
}
