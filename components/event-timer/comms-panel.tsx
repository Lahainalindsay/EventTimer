"use client";

import { useState } from "react";
import { Bell, MessageSquareText, Send } from "lucide-react";
import type { Connection, MessagePriority } from "@/lib/types";

interface CommsPanelProps {
  venue: string;
  message: string;
  messagePriority: MessagePriority;
  messageTarget: string | null;
  connection: Connection;
  onSend: (body: string, target?: string, priority?: string) => Promise<void>;
  onClear: () => Promise<void>;
}

const PRESETS = ["2 MINUTES", "WRAP UP", "SLOW DOWN", "PLEASE WAIT", "Q&A NEXT", "MIC CHECK"];

export function CommsPanel({
  venue,
  message,
  messagePriority,
  messageTarget,
  connection,
  onSend,
  onClear,
}: CommsPanelProps) {
  const [draft, setDraft] = useState("");
  const [target, setTarget] = useState("all");
  const [priority, setPriority] = useState<MessagePriority>("normal");

  const send = async (text: string) => {
    await onSend(text, target, priority);
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
      <div className="form-grid compact">
        <label className="stacked-field">
          Target
          <select value={target} onChange={(event) => setTarget(event.target.value)}>
            <option value="all">All displays</option>
            <option value="speaker">Speaker displays</option>
            <option value="stage">Stage displays</option>
          </select>
        </label>
        <label className="stacked-field">
          Priority
          <select value={priority} onChange={(event) => setPriority(event.target.value === "urgent" ? "urgent" : "normal")}>
            <option value="normal">Normal</option>
            <option value="urgent">Urgent</option>
          </select>
        </label>
      </div>
      <div className="presets">
        {PRESETS.map((preset) => (
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
        <div className={`sent-preview ${messagePriority === "urgent" ? "urgent" : ""}`}>
          <span>DISPLAYING NOW</span>
          <strong>{message}</strong>
          <small>{(messageTarget ?? "all").toUpperCase()} · {messagePriority.toUpperCase()}</small>
          <button onClick={() => void onClear()}>Clear</button>
        </div>
      )}
      <div className="display-health">
        <span>
          <span className={connection === "live" ? "pulse" : "offline"} /> <Bell size={12} /> Realtime channel
        </span>
        <small>{connection}</small>
      </div>
    </aside>
  );
}
