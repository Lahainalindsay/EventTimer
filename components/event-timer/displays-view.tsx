"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import QRCode from "qrcode";
import { Copy, Fullscreen, Plus, RefreshCw, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getDisplayStatus } from "@/lib/display-access";
import { formatTime } from "@/lib/timer-engine";
import type { DisplayType, EventData, EventDisplay } from "@/lib/types";

interface DisplaysViewProps {
  current: EventData;
  displays: EventDisplay[];
  onAdd: (name: string, type: DisplayType) => Promise<EventDisplay | null>;
  onRevoke: (displayId: string) => Promise<void>;
  onRefreshPairing: (displayId: string) => Promise<string>;
  onOpen: () => void;
  onCopy: () => void;
}

const DISPLAY_TYPES: { value: DisplayType; label: string; description: string }[] = [
  {
    value: "speaker",
    label: "Speaker",
    description: "Large timer, current segment, operator messages. No private notes.",
  },
  {
    value: "stage",
    label: "Stage",
    description: "Timer, current/next segment, cues, stage messages.",
  },
  {
    value: "audience",
    label: "Audience",
    description: "Public timer and session title only. No private data.",
  },
];

function StatusBadge({ display, nowMs }: { display: EventDisplay; nowMs: number }) {
  const status = getDisplayStatus(display.last_heartbeat_at, display.revoked_at, nowMs);
  const labels: Record<(typeof status), string> = {
    connected: "Connected",
    delayed: "Delayed",
    offline: "Offline",
    never_connected: "Never connected",
    revoked: "Revoked",
  };
  return <span className={`display-status-badge ${status}`}>{labels[status]}</span>;
}

export function DisplaysView({
  current,
  displays,
  onAdd,
  onRevoke,
  onRefreshPairing,
  onOpen,
  onCopy,
}: DisplaysViewProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [newDisplay, setNewDisplay] = useState<EventDisplay | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [pairingQrSvg, setPairingQrSvg] = useState("");

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(id);
  }, []);

  const pairingUrl = useMemo(
    () => (typeof window === "undefined" ? "" : `${window.location.origin}/pair?event=${current.id}`),
    [current.id],
  );

  useEffect(() => {
    if (!newDisplay?.pairingCode || !pairingUrl) return;
    void QRCode.toString(pairingUrl, { type: "svg", margin: 1, width: 180 })
      .then(setPairingQrSvg)
      .catch(() => setPairingQrSvg(""));
  }, [newDisplay?.pairingCode, pairingUrl]);

  const handleAdd = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    setBusy(true);
    const data = new FormData(ev.currentTarget);
    const created = await onAdd(
      String(data.get("name") || "").trim(),
      (String(data.get("type") || "speaker") as DisplayType),
    );
    setBusy(false);
    if (created) {
      setNewDisplay(created);
      setAddOpen(false);
    }
  };

  return (
    <>
      <div className="workspace-heading">
        <div>
          <div className="eyebrow">SECURE CLOUD DISPLAY</div>
          <h1>Displays</h1>
        </div>
        <button className="button primary" onClick={() => setAddOpen(true)}>
          <Plus size={16} /> Add display
        </button>
      </div>

      {newDisplay?.pairingCode && (
        <div className="pairing-success" role="status">
          <p className="eyebrow">PAIRING CODE FOR {newDisplay.name.toUpperCase()}</p>
          <div className="pairing-code" aria-label={`Pairing code: ${newDisplay.pairingCode}`}>
            {newDisplay.pairingCode}
          </div>
          {pairingQrSvg && (
            <div
              className="pairing-qr"
              aria-label="QR code to pair display — scan to open pairing page"
              dangerouslySetInnerHTML={{ __html: pairingQrSvg }}
            />
          )}
          <p>
            Open <strong>/pair</strong> on the stage monitor and enter this code. Valid for 10 minutes.
          </p>
          <button className="button secondary" onClick={() => setNewDisplay(null)}>
            Dismiss
          </button>
        </div>
      )}

      {displays.length === 0 ? (
        <div className="empty-displays">
          <p>No displays paired yet. Add a display to get a pairing code.</p>
        </div>
      ) : (
        <div className="display-list">
          {displays.map((display) => (
            <article key={display.id} className="display-item">
              <div className="display-item-info">
                <strong>{display.name}</strong>
                <span className="display-type-badge">{display.display_type}</span>
                <StatusBadge display={display} nowMs={now} />
              </div>
              {display.last_heartbeat_at && (
                <small className="heartbeat-age">
                  Last seen {Math.round((now - new Date(display.last_heartbeat_at).getTime()) / 1000)}s ago
                </small>
              )}
              <div className="display-item-actions">
                <button
                  className="button secondary small"
                  onClick={() => void onRefreshPairing(display.id).then((code) => {
                    setNewDisplay({ ...display, pairingCode: code });
                  })}
                  aria-label="Regenerate pairing code"
                  title="Regenerate pairing code"
                >
                  <RefreshCw size={14} /> Pair again
                </button>
                <button
                  className="icon-button danger"
                  onClick={() => void onRevoke(display.id)}
                  aria-label="Revoke display access"
                  title="Revoke display"
                  disabled={!!display.revoked_at}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      <article className="display-card legacy">
        <div className="display-preview">
          <span>{current.segments[current.active]?.title}</span>
          <strong>{formatTime(current.remaining)}</strong>
          <small>{current.running ? "LIVE" : "PAUSED"}</small>
        </div>
        <div>
          <h2>Authenticated operator display</h2>
          <p>Opens on another browser. Requires signing in to your Event Timer account.</p>
          <div className="display-actions">
            <button className="button primary" onClick={onOpen}>
              <Fullscreen size={16} /> Open display
            </button>
            <button className="button secondary" onClick={onCopy}>
              <Copy size={16} /> Copy link
            </button>
          </div>
        </div>
      </article>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <form onSubmit={(event_) => void handleAdd(event_)} className="dialog-form">
            <DialogHeader>
              <DialogTitle>Add display</DialogTitle>
              <DialogDescription>
                Name this display and choose its type. A 6-digit pairing code will be generated.
              </DialogDescription>
            </DialogHeader>
            <label>
              Display name
              <input name="name" required placeholder="Speaker Confidence" autoFocus />
            </label>
            <fieldset className="display-type-group">
              <legend>Display type</legend>
              {DISPLAY_TYPES.map((type) => (
                <label key={type.value} className="display-type-option">
                  <input type="radio" name="type" value={type.value} defaultChecked={type.value === "speaker"} />
                  <div>
                    <strong>{type.label}</strong>
                    <small>{type.description}</small>
                  </div>
                </label>
              ))}
            </fieldset>
            <DialogFooter>
              <button type="button" className="button secondary" onClick={() => setAddOpen(false)}>
                Cancel
              </button>
              <button className="button primary" type="submit" disabled={busy}>
                {busy ? "Creating…" : "Create display"}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
