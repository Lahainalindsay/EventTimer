"use client";

import { useState } from "react";
import { Bell, MessageSquareText, Send } from "lucide-react";
import type { Connection } from "@/lib/types";

interface CommsPanelProps {
  venue: string;
  message: string;
  connection: Connection;
  onSend: (body: string) => Promise<void>;
  onClear: () => Promise<void>;
}

export function CommsPanel({ venue, message, connection, onSend, onClear }: CommsPanelProps) {
  const [draft, setDraft] = useState("");

  const send = async (text: string) => {
    await onSend(text);
    setDraft("");
  };

  return (
    <aside className="comms-card">
      <div className="panel-title">
        <div>
          <MessageSquareText size={18} />
          <span>Message to stage</span>
        </div>
        <small>{venue.toUpperCase()}</small>
      </div>
      <div className="presets">
        {["2 MINUTES", "WRAP UP", "SLOW DOWN", "PLEASE WAIT"].map((preset) => (
          <button key={preset} onClick={() => setDraft(preset)}>
            {preset}
          </button>
        ))}
      </div>
      <div className="message-compose">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Type a private message…"
          maxLength={80}
        />
        <button disabled={!draft.trim()} onClick={() => void send(draft)} aria-label="Send message">
          <Send size={18} />
        </button>
      </div>
      {message && (
        <div className="sent-preview">
          <span>DISPLAYING NOW</span>
          <strong>{message}</strong>
          <button onClick={() => void onClear()}>Clear</button>
        </div>
      )}
      <div className="cue-section">
        <div className="panel-title">
          <div>
            <Bell size={18} />
            <span>Quick cues</span>
          </div>
        </div>
        <div className="cue-grid">
          {["GO", "HOLD", "STANDBY", "MIC LIVE"].map((cue) => (
            <button key={cue} onClick={() => void send(cue)}>
              {cue}
            </button>
          ))}
        </div>
      </div>
      <div className="display-health">
        <span>
          <span className={connection === "live" ? "pulse" : "offline"} /> Realtime channel
        </span>
        <small>{connection}</small>
      </div>
    </aside>
  );
}
