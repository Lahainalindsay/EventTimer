"use client";

import { Copy, Fullscreen } from "lucide-react";
import { formatTime } from "@/lib/timer-engine";
import type { EventData } from "@/lib/types";

interface DisplaysViewProps {
  current: EventData;
  onOpen: () => void;
  onCopy: () => void;
}

export function DisplaysView({ current, onOpen, onCopy }: DisplaysViewProps) {
  return (
    <>
      <div className="workspace-heading">
        <div>
          <div className="eyebrow">SECURE CLOUD DISPLAY</div>
          <h1>Displays</h1>
        </div>
      </div>
      <article className="display-card">
        <div className="display-preview">
          <span>{current.segments[current.active]?.title}</span>
          <strong>{formatTime(current.remaining)}</strong>
          <small>{current.running ? "LIVE" : "PAUSED"}</small>
        </div>
        <div>
          <h2>Speaker display</h2>
          <p>
            Opens on another browser and synchronizes through Event Timer cloud. The display must sign in to an authorized account.
          </p>
          <div className="display-actions">
            <button className="button primary" onClick={onOpen}>
              <Fullscreen size={16} /> Open display
            </button>
            <button className="button secondary" onClick={onCopy}>
              <Copy size={16} /> Copy secure link
            </button>
          </div>
        </div>
      </article>
      <article className="unavailable-card">
        <div>
          <h3>Public token pairing</h3>
          <p>Unavailable until a display-token policy is deployed. Secure authenticated displays are available now.</p>
        </div>
        <button disabled className="button secondary">
          Setup required
        </button>
      </article>
    </>
  );
}
