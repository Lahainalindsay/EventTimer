"use client";

import { useEffect, useState } from "react";
import { formatUserError } from "@/lib/error-messages";
import { supabase } from "@/lib/supabase";

export default function InvitePage() {
  const [message, setMessage] = useState("Checking invite…");
  const [error, setError] = useState("");

  useEffect(() => {
    const run = async () => {
      const token = new URLSearchParams(window.location.search).get("token");
      if (!token) {
        setMessage("");
        setError(formatUserError("event_not_found"));
        return;
      }

      const { data } = await supabase.auth.getSession();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (data.session?.access_token) {
        headers.Authorization = "Bearer " + data.session.access_token;
      }

      const res = await fetch("/api/invite/accept", {
        method: "POST",
        headers,
        body: JSON.stringify({ token }),
      });

      if (!res.ok) {
        setMessage("");
        setError(formatUserError("permission_denied"));
        return;
      }

      const result = await res.json() as { requires_login?: boolean };
      if (result.requires_login) {
        setMessage("Sign in to accept this invite.");
        window.location.replace(`/?invite=pending&token=${encodeURIComponent(token)}`);
        return;
      }

      setMessage("Invite accepted. Redirecting…");
      window.location.replace("/dashboard?invite=accepted");
    };

    void run();
  }, []);

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="auth-brand">
          <span className="brand-mark">
            <span />
          </span>
          <strong>Event Timer</strong>
        </div>
        <p className="eyebrow">EVENT INVITE</p>
        <h1>Joining event</h1>
        <p className="auth-copy">Verifying your collaborator invite.</p>
        {message && <div className="auth-notice" role="status">{message}</div>}
        {error && <div className="auth-error" role="alert">{error}</div>}
      </section>
    </main>
  );
}
