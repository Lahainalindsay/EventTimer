"use client";

import { ArrowRight, Fullscreen, Link2, Radio } from "lucide-react";
import { DEFAULT_THRESHOLDS, getTimerStateName } from "@/lib/timer-engine";
import {
  formatProjectedFinish,
  formatVarianceLabel,
  plannedTotalSeconds,
  segmentVarianceSeconds,
} from "@/lib/schedule-engine";
import { actualElapsedSeconds, projectedFinishWithHistory } from "@/lib/segment-history";
import { TimerDisplay } from "@/components/event-timer/timer-display";
import { TimerControls } from "@/components/event-timer/timer-controls";
import { RundownPanel } from "@/components/event-timer/rundown-panel";
import { CommsPanel } from "@/components/event-timer/comms-panel";
import { CuesPanel } from "@/components/event-timer/cues-panel";
import type { Connection, CueType, EventData, Segment } from "@/lib/types";

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
  onSendMessage: (body: string, target?: string, priority?: string) => Promise<void>;
  onClearMessage: () => Promise<void>;
  onTriggerCue: (cueType: CueType, target?: string) => Promise<void>;
  onClearCue: (cueId: string) => Promise<void>;
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
  onTriggerCue,
  onClearCue,
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
  const nowMs = Date.now();
  const projected = formatProjectedFinish(
    projectedFinishWithHistory(event.segments, event.active, event.remaining, event.segmentRuns, nowMs),
  );
  const variance = segment ? formatVarianceLabel(segmentVarianceSeconds(segment, event.remaining)) : "";
  const plannedTotal = plannedTotalSeconds(event.segments);
  const actualElapsed = event.segmentRuns
    .map((run) => actualElapsedSeconds(run))
    .filter((value): value is number => value !== null)
    .reduce((sum, value) => sum + value, 0);

  const formatHoursMinutes = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.round((seconds % 3600) / 60);
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  };

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
        <div>
          <span>PLANNED TOTAL</span>
          <strong>{formatHoursMinutes(plannedTotal)}</strong>
        </div>
        <div>
          <span>ACTUAL ELAPSED</span>
          <strong>{formatHoursMinutes(actualElapsed)}</strong>
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

        <div className="side-stack">
          <CommsPanel
            venue={event.venue}
            message={event.message}
            messagePriority={event.messagePriority}
            messageTarget={event.messageTarget}
            connection={connection}
            onSend={onSendMessage}
            onClear={onClearMessage}
          />
          <CuesPanel
            activeCues={event.activeCues}
            connection={connection}
            onTriggerCue={onTriggerCue}
            onClearCue={onClearCue}
          />
        </div>
      </div>

      <RundownPanel
        segments={event.segments}
        activeIndex={event.active}
        isRunning={event.running}
        onJump={onJumpTo}
        onMove={onMoveSegment}
        onSave={onSaveSegment}
        onDelete={onDeleteSegment}
        onDuplicate={onDuplicateSegment}
      />
    </>
  );
}
