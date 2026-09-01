"use client";

import { useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase";
import type { AuthMode } from "@/lib/types";

export const authErrorMessage = (reason: unknown) => {
  const message = reason instanceof Error ? reason.message : "Authentication failed.";
  if (message.toLowerCase().includes("email rate limit")) {
    return "Event Timer's confirmation-email service is at its Supabase sending limit. Retrying immediately will not work. Custom production email delivery must be configured before signup can continue.";
  }
  return message;
};

function inviteNotice() {
  if (typeof window === "undefined") return "";
  const invite = new URLSearchParams(window.location.search).get("invite");
  if (invite === "pending") return "Sign in or create an account to accept this invite.";
  return invite === "accepted" ? "Invite accepted. Sign in to continue to Event Timer." : "";
}

function pendingInviteToken() {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.search);
  return params.get("invite") === "pending" ? (params.get("token") ?? "") : "";
}

export function AuthScreen({ initialMode }: { initialMode: AuthMode }) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(inviteNotice);
  const [error, setError] = useState("");

  const submit = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    const data = new FormData(ev.currentTarget);
    const email = String(data.get("email") || "").trim();
    const password = String(data.get("password") || "");
    try {
      if (mode === "signup") {
        const fullName = String(data.get("name") || "").trim();
        const inviteToken = pendingInviteToken();
        const { data: result, error: authError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: fullName },
            emailRedirectTo: inviteToken
              ? `${location.origin}/invite?token=${encodeURIComponent(inviteToken)}`
              : `${location.origin}/dashboard`,
          },
        });
        if (authError) throw authError;
        setNotice(
          result.session
            ? "Account created. You are signed in."
            : "Account created. Check your email and confirm your address before signing in.",
        );
      } else if (mode === "login") {
        const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
        if (authError) throw authError;
      } else if (mode === "reset") {
        const { error: authError } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${location.origin}/?recovery=1`,
        });
        if (authError) throw authError;
        setNotice("Password reset email sent. Use the link in that email to choose a new password.");
      } else {
        const { error: authError } = await supabase.auth.updateUser({ password });
        if (authError) throw authError;
        setNotice("Password updated. You can continue to Event Timer.");
      }
    } catch (reason) {
      setError(authErrorMessage(reason));
    } finally {
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
        <p className="eyebrow">LIVE EVENT CONTROL</p>
        <h1>
          {mode === "signup"
            ? "Create your account"
            : mode === "reset"
              ? "Reset your password"
              : mode === "update"
                ? "Choose a new password"
                : "Sign in to Event Timer"}
        </h1>
        <p className="auth-copy">
          Secure cloud events, run-of-show timing, and synchronized production displays.
        </p>
        <form onSubmit={(e) => void submit(e)} className="auth-form">
          {mode === "signup" && (
            <label>
              Full name
              <input name="name" type="text" required autoComplete="name" />
            </label>
          )}
          {mode !== "update" && (
            <label>
              Email
              <input name="email" type="email" required autoComplete="email" />
            </label>
          )}
          {mode !== "reset" && (
            <label>
              {mode === "update" ? "New password" : "Password"}
              <input
                name="password"
                type="password"
                minLength={8}
                required
                autoComplete={mode === "login" ? "current-password" : "new-password"}
              />
            </label>
          )}
          {error && (
            <div className="auth-error" role="alert">
              {error}
            </div>
          )}
          {notice && (
            <div className="auth-notice" role="status">
              {notice}
            </div>
          )}
          <button className="button primary auth-submit" type="submit" disabled={busy}>
            {busy
              ? "Please wait…"
              : mode === "signup"
                ? "Create account"
                : mode === "reset"
                  ? "Send reset email"
                  : mode === "update"
                    ? "Update password"
                    : "Sign in"}
          </button>
        </form>
        {mode === "login" && (
          <div className="auth-links">
            <button onClick={() => setMode("signup")}>Create account</button>
            <button onClick={() => setMode("reset")}>Forgot password?</button>
          </div>
        )}
        {mode !== "login" && mode !== "update" && (
          <button
            className="auth-back"
            onClick={() => {
              setMode("login");
              setError("");
              setNotice("");
            }}
          >
            Back to sign in
          </button>
        )}
        <small>Event Timer cloud</small>
      </section>
    </main>
  );
}
