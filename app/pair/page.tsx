"use client";

import { useState, type FormEvent } from "react";

export default function PairPage() {
  const [code, setCode] = useState("");
  const [eventId, setEventId] = useState(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("event") ?? "";
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit code.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/display/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, event_id: eventId }),
      });
      const data = (await res.json()) as { display_url?: string; error?: string };
      if (!res.ok || !data.display_url) {
        setError(data.error ?? "Pairing failed. Check the code and try again.");
        setBusy(false);
        return;
      }
      window.location.href = data.display_url;
    } catch {
      setError("Network error. Check your connection and try again.");
      setBusy(false);
    }
  };

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="auth-brand">
          <span className="brand-mark">
            <span />
          </span>
          <strong>Event Timer</strong>
        </div>
        <p className="eyebrow">DISPLAY PAIRING</p>
        <h1>Enter pairing code</h1>
        <p className="auth-copy">Ask your operator for the 6-digit pairing code shown in Event Timer Displays.</p>
        <form onSubmit={(event) => void handleSubmit(event)} className="auth-form">
          {!eventId && (
            <label>
              Event ID
              <input
                value={eventId}
                onChange={(event) => setEventId(event.target.value)}
                placeholder="Paste the event ID from your operator"
                required
              />
            </label>
          )}
          <label>
            Pairing code
            <input
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              required
              className="pairing-code-input"
            />
          </label>
          {error && <div className="auth-error" role="alert">{error}</div>}
          <button className="button primary auth-submit" type="submit" disabled={busy || code.length < 6}>
            {busy ? "Pairing…" : "Pair display"}
          </button>
        </form>
        <small>Event Timer cloud</small>
      </section>
    </main>
  );
}
