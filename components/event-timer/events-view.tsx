"use client";

import { useState, type FormEvent } from "react";
import { CopyPlus, Plus, Trash2, Users } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { EventData, EventLifecycle } from "@/lib/types";

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <section className="empty-cloud">
      <p className="eyebrow">EVENT TIMER CLOUD</p>
      <h1>Create your first live event</h1>
      <p>Build a run of show, control the timer, and reopen the event from any authenticated browser.</p>
      <button className="button primary" onClick={onCreate}>
        <Plus size={16} /> Create event
      </button>
    </section>
  );
}

function lifecycleLabel(lifecycle: EventLifecycle) {
  return lifecycle === "live"
    ? "Live"
    : lifecycle === "ready"
      ? "Ready"
      : lifecycle === "completed"
        ? "Completed"
        : lifecycle === "archived"
          ? "Archived"
          : "Draft";
}

function nextLifecycle(lifecycle: EventLifecycle): { label: string; value: EventLifecycle } {
  switch (lifecycle) {
    case "draft":
      return { label: "Mark ready", value: "ready" };
    case "ready":
      return { label: "Go live", value: "live" };
    case "live":
      return { label: "Complete", value: "completed" };
    case "completed":
      return { label: "Archive", value: "archived" };
    case "archived":
      return { label: "Restore ready", value: "ready" };
  }
}

interface EventsViewProps {
  events: EventData[];
  currentId: string;
  onOpen: (id: string) => void;
  onOpenMembers: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string, newName: string, newDate: string) => Promise<void>;
  onLifecycleChange: (id: string, status: EventLifecycle) => Promise<void>;
}

export function EventsView({
  events,
  currentId,
  onOpen,
  onOpenMembers,
  onCreate,
  onDelete,
  onDuplicate,
  onLifecycleChange,
}: EventsViewProps) {
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [selected, setSelected] = useState<EventData | null>(null);

  const openDuplicate = (event: EventData) => {
    setSelected(event);
    setDuplicateOpen(true);
  };

  const handleDuplicate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected) return;
    const data = new FormData(event.currentTarget);
    await onDuplicate(selected.id, String(data.get("name") || "").trim(), String(data.get("date") || ""));
    setDuplicateOpen(false);
    setSelected(null);
  };

  return (
    <>
      <div className="workspace-heading">
        <div>
          <div className="eyebrow">EVENT TIMER CLOUD</div>
          <h1>Events</h1>
        </div>
        <button className="button primary" onClick={onCreate}>
          <Plus size={16} /> Create event
        </button>
      </div>
      {events.length ? (
        <div className="event-list">
          {events.map((event) => {
            const transition = nextLifecycle(event.lifecycle);
            return (
              <article className="event-card" key={event.id}>
                <div>
                  <div className="event-card-meta">
                    <span>{event.date}</span>
                    <span className={`lifecycle-badge lifecycle-${event.lifecycle}`}>{lifecycleLabel(event.lifecycle)}</span>
                  </div>
                  <h2>{event.name}</h2>
                  <p>
                    {event.venue} · {event.segments.length} segments
                  </p>
                </div>
                <div className="event-card-actions">
                  <button className="button secondary" onClick={() => onOpen(event.id)}>
                    {event.id === currentId ? "Open current" : "Open event"}
                  </button>
                  <button className="button secondary" onClick={() => onOpenMembers(event.id)}>
                    <Users size={16} /> Members
                  </button>
                  <button className="button secondary" onClick={() => void onLifecycleChange(event.id, transition.value)}>
                    {transition.label}
                  </button>
                  <button className="button secondary" onClick={() => openDuplicate(event)}>
                    <CopyPlus size={16} /> Duplicate
                  </button>
                  <button className="icon-button danger" onClick={() => onDelete(event.id)} aria-label="Delete event">
                    <Trash2 size={16} />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <EmptyState onCreate={onCreate} />
      )}

      <Dialog
        open={duplicateOpen}
        onOpenChange={(open) => {
          setDuplicateOpen(open);
          if (!open) setSelected(null);
        }}
      >
        <DialogContent>
          <form onSubmit={(event) => void handleDuplicate(event)} className="dialog-form">
            <DialogHeader>
              <DialogTitle>Duplicate event</DialogTitle>
              <DialogDescription>
                Copies the rundown and settings into a fresh event. Live timer state, messages, history, and display credentials reset.
              </DialogDescription>
            </DialogHeader>
            <label>
              New name
              <input name="name" required defaultValue={selected ? `${selected.name} copy` : ""} />
            </label>
            <label>
              New date
              <input
                name="date"
                type="date"
                required
                defaultValue={selected?.date || new Date().toISOString().slice(0, 10)}
              />
            </label>
            <label className="stacked-field">
              Duplicate mode
              <select defaultValue="reset" disabled>
                <option value="reset">Start fresh runtime/history (required)</option>
              </select>
            </label>
            <DialogFooter>
              <button type="button" className="button secondary" onClick={() => setDuplicateOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="button primary">Duplicate event</button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
