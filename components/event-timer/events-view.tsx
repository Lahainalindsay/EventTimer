"use client";

import { Plus, Trash2 } from "lucide-react";
import type { EventData } from "@/lib/types";

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

interface EventsViewProps {
  events: EventData[];
  currentId: string;
  onOpen: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
}

export function EventsView({ events, currentId, onOpen, onCreate, onDelete }: EventsViewProps) {
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
          {events.map((event) => (
            <article className="event-card" key={event.id}>
              <div>
                <span>{event.date}</span>
                <h2>{event.name}</h2>
                <p>
                  {event.venue} · {event.segments.length} segments
                </p>
              </div>
              <div>
                <button className="button secondary" onClick={() => onOpen(event.id)}>
                  {event.id === currentId ? "Open current" : "Open event"}
                </button>
                <button className="icon-button danger" onClick={() => onDelete(event.id)} aria-label="Delete event">
                  <Trash2 size={16} />
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState onCreate={onCreate} />
      )}
    </>
  );
}
