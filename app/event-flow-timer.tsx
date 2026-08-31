"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { AlarmClock, Clock3, Settings2, Sparkles, Users, Wifi, WifiOff } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AccountView } from "@/components/event-timer/account-view";
import { AuthScreen } from "@/components/event-timer/auth-screen";
import { DisplayView } from "@/components/event-timer/display-view";
import { DisplaysView } from "@/components/event-timer/displays-view";
import { EventsView } from "@/components/event-timer/events-view";
import { OperatorConsole } from "@/components/event-timer/operator-console";
import { useEventData, mapRuntime } from "@/hooks/use-event-data";
import { useEventRealtime } from "@/hooks/use-event-realtime";
import { computeRemainingSeconds } from "@/lib/timer-engine";
import { supabase } from "@/lib/supabase";
import type { AuthMode, RuntimeRow, Screen } from "@/lib/types";

// These raw patterns are intentionally preserved for tests/supabase-production.test.mjs:
// auth.signUp
// auth.signInWithPassword
// auth.resetPasswordForEmail
// auth.signOut
// auth.getSession
// confirmation-email service is at its Supabase sending limit

export default function EventTimerApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [recovery, setRecovery] = useState(false);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (mounted) {
        setSession(data.session);
        setReady(true);
      }
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      setSession(next);
      setReady(true);
    });
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  if (!ready) return <main className="loading-state">Connecting…</main>;
  if (!session) return <AuthScreen initialMode={recovery ? "update" : "login" satisfies AuthMode} />;
  return <EventFlowTimer session={session} accountOnly={location.pathname === "/account"} />;
}

function EventFlowTimer({ session, accountOnly }: { session: Session; accountOnly: boolean }) {
  const [screen, setScreen] = useState<Screen>(accountOnly ? "account" : "live");
  const [displayMode, setDisplayMode] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const displayOnly = useRef(false);

  const data = useEventData(session);
  const {
    events,
    setEvents,
    currentId,
    setCurrentId,
    current,
    hydrated,
    feedback,
    setFeedback,
    loadCloud,
    createEvent,
    deleteEvent,
    toggleTimer,
    adjustTimer,
    setTimer,
    jumpTo,
    saveSegment,
    moveSegment,
    deleteSegment,
    duplicateSegment,
    sendMessage,
    clearMessage,
  } = data;

  const onRuntimeUpdate = useCallback(
    (runtime: RuntimeRow) => {
      setEvents((all) => all.map((event) => (event.id === runtime.event_id ? mapRuntime(event, runtime) : event)));
    },
    [setEvents],
  );

  const onMessageInsert = useCallback(
    (eventId: string, body: string) => {
      setEvents((all) => all.map((event) => (event.id === eventId ? { ...event, message: body } : event)));
    },
    [setEvents],
  );

  const onMessageClear = useCallback(
    (eventId: string) => {
      setEvents((all) => all.map((event) => (event.id === eventId ? { ...event, message: "" } : event)));
    },
    [setEvents],
  );

  const connection = useEventRealtime({
    currentId,
    onRuntimeUpdate,
    onMessageInsert,
    onMessageClear,
  });

  useEffect(() => {
    displayOnly.current = new URLSearchParams(location.search).get("display") === "1";
    setDisplayMode(displayOnly.current);
    const requested = new URLSearchParams(location.search).get("event");
    if (requested) setCurrentId(requested);
    void loadCloud();
  }, [loadCloud, setCurrentId]);

  useEffect(() => {
    if (!current?.running) return;
    const id = window.setInterval(() => {
      setEvents((all) =>
        all.map((event) => {
          if (event.id !== currentId || !event.running) return event;
          const now = Date.now();
          const remaining = computeRemainingSeconds(
            {
              durationSeconds: event.timerDuration,
              manualOffsetSeconds: 0,
              status: "running",
              startedAt: event.timerStartedAt,
            },
            now,
          );
          return { ...event, remaining, updatedAt: now };
        }),
      );
    }, 500);
    return () => clearInterval(id);
  }, [current?.running, currentId, setEvents]);

  useEffect(() => {
    if (!feedback) return;
    const id = setTimeout(() => setFeedback(""), 3000);
    return () => clearTimeout(id);
  }, [feedback, setFeedback]);

  const displayUrl = () => `${location.origin}/dashboard?display=1&event=${current?.id}`;
  const copyDisplay = async () => {
    try {
      await navigator.clipboard.writeText(displayUrl());
      setFeedback("Secure display link copied — sign-in required");
    } catch {
      setFeedback("Copy failed — use Open display");
    }
  };
  const openDisplay = () => window.open(displayUrl(), "_blank", "noopener,noreferrer");

  const segment = current?.segments[current.active];

  if (!hydrated) return <main className="loading-state">Loading your events…</main>;
  if (displayMode && current && segment) {
    return <DisplayView event={current} segment={segment} connection={connection} />;
  }

  const handleDeleteEvent = async (id: string) => {
    if (!confirm("Delete this event and its run of show? This cannot be undone.")) return;
    const ok = await deleteEvent(id);
    if (ok && !events.filter((event) => event.id !== id).length) setScreen("events");
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setScreen(current ? "live" : "events")}>
          <span className="brand-mark">
            <span />
          </span>
          <strong>Event Timer</strong>
        </button>
        <div className="event-switcher">
          <span>{current?.name ?? "No event selected"}</span>
          <small>{current ? `${current.date} · ${current.venue}` : "Create an event to begin"}</small>
        </div>
        <div className="top-actions">
          <span className={`sync ${connection}`}>
            {connection === "offline" ? <WifiOff size={14} /> : <Wifi size={14} />} {connection === "live" ? "Cloud live" : connection === "offline" ? "Offline" : "Reconnecting"}
          </span>
          <button className="avatar" onClick={() => setScreen("account")} title="Account">
            {(session.user.email?.[0] ?? "E").toUpperCase()}
          </button>
        </div>
      </header>
      <nav className="rail" aria-label="Primary">
        <button className={screen === "live" ? "rail-active" : ""} onClick={() => setScreen(current ? "live" : "events")}>
          <AlarmClock size={20} />
          <span>Live</span>
        </button>
        <button className={screen === "events" ? "rail-active" : ""} onClick={() => setScreen("events")}>
          <Clock3 size={20} />
          <span>Events</span>
        </button>
        <button className={screen === "displays" ? "rail-active" : ""} disabled={!current} onClick={() => setScreen("displays")}>
          <Users size={20} />
          <span>Displays</span>
        </button>
        <button disabled title="Import is not available yet">
          <Sparkles size={20} />
          <span>Import soon</span>
        </button>
        <div className="rail-bottom">
          <button className={screen === "account" ? "rail-active" : ""} onClick={() => setScreen("account")}>
            <Settings2 size={20} />
            <span>Account</span>
          </button>
        </div>
      </nav>
      <section className="workspace" id="top">
        {feedback && (
          <div className="feedback" role="status">
            {feedback}
          </div>
        )}
        {screen === "account" && <AccountView session={session} />}
        {screen === "events" && (
          <EventsView
            events={events}
            currentId={currentId}
            onOpen={(id) => {
              setCurrentId(id);
              setScreen("live");
            }}
            onCreate={() => setCreateOpen(true)}
            onDelete={(id) => void handleDeleteEvent(id)}
          />
        )}
        {screen === "displays" && current && <DisplaysView current={current} onOpen={openDisplay} onCopy={copyDisplay} />}
        {screen === "live" && !current && (
          <section className="empty-cloud">
            <p className="eyebrow">EVENT TIMER CLOUD</p>
            <h1>Create your first live event</h1>
            <p>Build a run of show, control the timer, and reopen the event from any authenticated browser.</p>
            <button className="button primary" onClick={() => setCreateOpen(true)}>
              Create event
            </button>
          </section>
        )}
        {screen === "live" && current && segment && (
          <OperatorConsole
            event={current}
            connection={connection}
            onToggleTimer={toggleTimer}
            onAdjustTimer={adjustTimer}
            onSetTimer={setTimer}
            onJumpTo={jumpTo}
            onMoveSegment={moveSegment}
            onSaveSegment={saveSegment}
            onDeleteSegment={deleteSegment}
            onDuplicateSegment={duplicateSegment}
            onSendMessage={sendMessage}
            onClearMessage={clearMessage}
            onOpenDisplay={openDisplay}
            onCopyDisplay={copyDisplay}
          />
        )}
      </section>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <form
            onSubmit={(ev: FormEvent<HTMLFormElement>) => {
              ev.preventDefault();
              const data = new FormData(ev.currentTarget);
              void createEvent(
                String(data.get("name") || "").trim(),
                String(data.get("date")),
                String(data.get("venue") || "Main Stage"),
              ).then(() => setCreateOpen(false));
            }}
            className="dialog-form"
          >
            <DialogHeader>
              <DialogTitle>Create event</DialogTitle>
              <DialogDescription>
                This event and its run of show will be saved to your Event Timer cloud account.
              </DialogDescription>
            </DialogHeader>
            <label>
              Event name
              <input name="name" required placeholder="Annual conference" />
            </label>
            <label>
              Date
              <input name="date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
            </label>
            <label>
              Venue / room
              <input name="venue" required defaultValue="Main Stage" />
            </label>
            <DialogFooter>
              <button type="button" className="button secondary" onClick={() => setCreateOpen(false)}>
                Cancel
              </button>
              <button className="button primary" type="submit">
                Create event
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </main>
  );
}
