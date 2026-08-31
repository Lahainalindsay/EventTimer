"use client";

import { useState } from "react";
import { BellRing } from "lucide-react";
import type { Connection, CueType, ProductionCue } from "@/lib/types";
import { CUE_TYPES } from "@/lib/types";

interface CuesPanelProps {
  activeCues: ProductionCue[];
  connection: Connection;
  onTriggerCue: (cueType: CueType, target?: string) => Promise<void>;
  onClearCue: (cueId: string) => Promise<void>;
}

export function CuesPanel({ activeCues, connection, onTriggerCue, onClearCue }: CuesPanelProps) {
  const [target, setTarget] = useState("all");

  return (
    <aside className="comms-card cue-panel">
      <div className="panel-title">
        <div>
          <BellRing size={18} />
          <span>Production cues</span>
        </div>
        <small>{connection === "live" ? "LIVE" : "SYNCING"}</small>
      </div>

      <label className="stacked-field">
        Cue target
        <select value={target} onChange={(event) => setTarget(event.target.value)}>
          <option value="all">All stage/speaker displays</option>
          <option value="speaker">Speaker displays</option>
          <option value="stage">Stage displays</option>
        </select>
      </label>

      <div className="cue-grid expanded">
        {CUE_TYPES.map((cue) => (
          <button key={cue.value} onClick={() => void onTriggerCue(cue.value, target)}>
            {cue.label.toUpperCase()}
          </button>
        ))}
      </div>

      <div className="active-cues">
        <span className="eyebrow">ACTIVE CUES</span>
        {activeCues.length ? (
          activeCues.map((cue) => (
            <div key={cue.id} className="active-cue-row">
              <div>
                <strong>{cue.cue_type.replaceAll("_", " ")}</strong>
                <small>{cue.target ?? "All stage/speaker displays"}</small>
              </div>
              <button onClick={() => void onClearCue(cue.id)}>Clear</button>
            </div>
          ))
        ) : (
          <p className="empty-note">No active cues.</p>
        )}
      </div>
    </aside>
  );
}
