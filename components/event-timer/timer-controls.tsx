"use client";

import { ArrowLeft, Pause, Play, RotateCcw, SkipForward } from "lucide-react";
import type { Segment } from "@/lib/types";

interface TimerControlsProps {
  running: boolean;
  segment: Segment;
  hasNext: boolean;
  hasPrev: boolean;
  onToggle: () => void;
  onAdjust: (deltaSeconds: number) => void;
  onReset: () => void;
  onRestart: () => void;
  onPrev: () => void;
  onNext: () => void;
}

export function TimerControls({
  running,
  segment,
  hasNext,
  hasPrev,
  onToggle,
  onAdjust,
  onReset,
  onRestart,
  onPrev,
  onNext,
}: TimerControlsProps) {
  return (
    <>
      <div className="time-adjust-strip">
        <button onClick={() => onAdjust(-300)} aria-label={`Subtract 5 minutes from ${segment.title}`}>
          −5m
        </button>
        <button onClick={() => onAdjust(-60)} aria-label={`Subtract 1 minute from ${segment.title}`}>
          −1m
        </button>
        <button onClick={() => onAdjust(60)} aria-label={`Add 1 minute to ${segment.title}`}>
          +1m
        </button>
        <button onClick={() => onAdjust(300)} aria-label={`Add 5 minutes to ${segment.title}`}>
          +5m
        </button>
      </div>
      <div className="controls">
        <button
          className="primary-control"
          onClick={onToggle}
          aria-label={running ? "Pause timer" : "Start timer"}
        >
          {running ? <Pause size={30} fill="currentColor" /> : <Play size={30} fill="currentColor" />}
          <span>{running ? "PAUSE" : "START / RESUME"}</span>
        </button>
        <button className="reset" onClick={onReset} aria-label="Reset timer to planned duration">
          <RotateCcw size={19} />
          <span>RESET</span>
        </button>
      </div>
      <div className="segment-nav">
        <button disabled={!hasPrev} onClick={onPrev} aria-label="Previous segment">
          <ArrowLeft size={16} /> Previous
        </button>
        <button onClick={onRestart} aria-label="Restart current segment">
          <RotateCcw size={16} /> Restart
        </button>
        <button disabled={!hasNext} onClick={onNext} aria-label="Next segment">
          <SkipForward size={16} /> Skip / next
        </button>
      </div>
    </>
  );
}
