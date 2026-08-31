"use client";

import { useState, type FormEvent } from "react";
import type { EventData, EventSettings } from "@/lib/types";

const TIMEZONES = [
  "UTC",
  "Pacific/Honolulu",
  "America/Anchorage",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "Asia/Tokyo",
  "Asia/Singapore",
  "Australia/Sydney",
];

interface EventSettingsProps {
  event: EventData;
  onSave: (name: string, date: string, venue: string, settings: EventSettings) => Promise<void>;
}

export function EventSettingsPanel({ event, onSave }: EventSettingsProps) {
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSubmit = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    setBusy(true);
    const data = new FormData(ev.currentTarget);
    await onSave(
      String(data.get("name") || "").trim() || event.name,
      String(data.get("date") || event.date),
      String(data.get("venue") || event.venue),
      {
        timezone: String(data.get("timezone") || "UTC"),
        warningSecs: Math.max(0, Number(data.get("warningSecs") || 120)),
        urgentSecs: Math.max(0, Number(data.get("urgentSecs") || 30)),
        autoAdvance: data.get("autoAdvance") === "on",
      },
    );
    setBusy(false);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  };

  return (
    <section className="settings-panel">
      <p className="eyebrow">EVENT</p>
      <h1>Event Settings</h1>
      <form onSubmit={(event_) => void handleSubmit(event_)} className="settings-form">
        <label>
          Event name
          <input name="name" required defaultValue={event.name} />
        </label>
        <div className="form-grid">
          <label>
            Date
            <input name="date" type="date" required defaultValue={event.date} />
          </label>
          <label>
            Venue / room
            <input name="venue" defaultValue={event.venue} />
          </label>
        </div>
        <label>
          Timezone
          <select name="timezone" defaultValue={event.settings.timezone}>
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </label>
        <div className="form-grid">
          <label>
            Default warning (seconds)
            <input name="warningSecs" type="number" min="0" max="3600" defaultValue={event.settings.warningSecs} />
          </label>
          <label>
            Default urgent (seconds)
            <input name="urgentSecs" type="number" min="0" max="3600" defaultValue={event.settings.urgentSecs} />
          </label>
        </div>
        <label className="toggle-label">
          <input name="autoAdvance" type="checkbox" defaultChecked={event.settings.autoAdvance} />
          <span>
            <span>Auto-advance when countdown completes</span>
            <small>
              OFF by default. When on, the timer moves to the next segment automatically. Manual control always overrides.
            </small>
          </span>
        </label>
        <div className="settings-actions">
          <button className="button primary" type="submit" disabled={busy}>
            {busy ? "Saving…" : saved ? "Saved ✓" : "Save settings"}
          </button>
        </div>
      </form>
    </section>
  );
}
