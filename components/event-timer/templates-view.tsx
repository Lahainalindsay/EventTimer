"use client";

import { useState, type FormEvent } from "react";
import { CopyPlus, Save, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { EventData, EventTemplate } from "@/lib/types";

interface TemplatesViewProps {
  current?: EventData;
  templates: EventTemplate[];
  onSaveCurrent: (name: string, description: string) => Promise<void>;
  onCreateFromTemplate: (templateId: string, newName: string, newDate: string) => Promise<void>;
  onDeleteTemplate: (id: string) => Promise<void>;
}

export function TemplatesView({
  current,
  templates,
  onSaveCurrent,
  onCreateFromTemplate,
  onDeleteTemplate,
}: TemplatesViewProps) {
  const [saveOpen, setSaveOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<EventTemplate | null>(null);

  const openCreate = (template: EventTemplate) => {
    setSelected(template);
    setCreateOpen(true);
  };

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await onSaveCurrent(String(data.get("name") || "").trim(), String(data.get("description") || "").trim());
    setSaveOpen(false);
  };

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected) return;
    const data = new FormData(event.currentTarget);
    await onCreateFromTemplate(selected.id, String(data.get("name") || "").trim(), String(data.get("date") || ""));
    setCreateOpen(false);
    setSelected(null);
  };

  return (
    <>
      <div className="workspace-heading">
        <div>
          <div className="eyebrow">REUSABLE RUNDOWNS</div>
          <h1>Templates</h1>
        </div>
        <button className="button primary" disabled={!current} onClick={() => setSaveOpen(true)}>
          <Save size={16} /> Save current event as template
        </button>
      </div>

      {templates.length ? (
        <div className="event-list">
          {templates.map((template) => (
            <article className="event-card" key={template.id}>
              <div>
                <span>{template.template_data.segments.length} segments</span>
                <h2>{template.name}</h2>
                <p>{template.description || "No description"} · {template.template_data.venue}</p>
              </div>
              <div>
                <button className="button secondary" onClick={() => openCreate(template)}>
                  <CopyPlus size={16} /> Create event
                </button>
                <button className="icon-button danger" onClick={() => void onDeleteTemplate(template.id)} aria-label="Delete template">
                  <Trash2 size={16} />
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <section className="empty-cloud">
          <p className="eyebrow">TEMPLATES</p>
          <h1>No templates yet</h1>
          <p>Save your current event to reuse the same run of show later.</p>
        </section>
      )}

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent>
          <form onSubmit={(event) => void handleSave(event)} className="dialog-form">
            <DialogHeader>
              <DialogTitle>Save template</DialogTitle>
              <DialogDescription>Store the current event&rsquo;s segments, venue, and settings.</DialogDescription>
            </DialogHeader>
            <label>
              Template name
              <input name="name" required defaultValue={current ? `${current.name} template` : ""} />
            </label>
            <label>
              Description
              <input name="description" defaultValue={current?.venue ?? ""} />
            </label>
            <DialogFooter>
              <button type="button" className="button secondary" onClick={() => setSaveOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="button primary">Save template</button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) setSelected(null);
        }}
      >
        <DialogContent>
          <form onSubmit={(event) => void handleCreate(event)} className="dialog-form">
            <DialogHeader>
              <DialogTitle>Create event from template</DialogTitle>
              <DialogDescription>Creates a new event with copied segments and settings.</DialogDescription>
            </DialogHeader>
            <label>
              Event name
              <input name="name" required defaultValue={selected?.name ?? ""} />
            </label>
            <label>
              Event date
              <input name="date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
            </label>
            <DialogFooter>
              <button type="button" className="button secondary" onClick={() => setCreateOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="button primary">Create event</button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
