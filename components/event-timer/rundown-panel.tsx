"use client";

import { useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, Copy, Pencil, Plus, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SEGMENT_TYPES, type Segment, type SegmentType } from "@/lib/types";

interface RundownPanelProps {
  segments: Segment[];
  activeIndex: number;
  onJump: (index: number, run?: boolean) => void;
  onMove: (from: number, to: number) => void;
  onSave: (item: Segment, isEdit: boolean) => Promise<boolean>;
  onDelete: (id: string) => Promise<void>;
  onDuplicate: (segment: Segment, index: number) => Promise<void>;
}

const uid = () => crypto.randomUUID();

export function RundownPanel({
  segments,
  activeIndex,
  onJump,
  onMove,
  onSave,
  onDelete,
  onDuplicate,
}: RundownPanelProps) {
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<Segment | null>(null);

  const openAdd = () => {
    setEditing(null);
    setEditOpen(true);
  };
  const openEdit = (segment: Segment) => {
    setEditing(segment);
    setEditOpen(true);
  };

  const handleSave = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const data = new FormData(ev.currentTarget);
    const item: Segment = {
      id: editing?.id ?? uid(),
      time: String(data.get("time")),
      title: String(data.get("title")).trim(),
      person: String(data.get("person")).trim(),
      duration: Math.max(1, Number(data.get("duration"))),
      segmentType: (String(data.get("segmentType")) || "speaker") as SegmentType,
      notes: String(data.get("notes") || "").trim(),
      warningSecs: Number(data.get("warningSecs") || 120),
      urgentSecs: Number(data.get("urgentSecs") || 30),
    };
    if (!item.title) return;
    const ok = await onSave(item, !!editing);
    if (ok) {
      setEditOpen(false);
      setEditing(null);
    }
  };

  const totalPlanned = segments.reduce((sum, segment) => sum + segment.duration, 0);

  return (
    <section className="rundown">
      <div className="rundown-head">
        <div>
          <span>RUN OF SHOW</span>
          <strong>
            {segments.length} segments · {totalPlanned} min planned
          </strong>
        </div>
        <div className="variance">
          <small>PERSISTENCE</small>
          <strong>CLOUD SAVED</strong>
        </div>
        <button className="button secondary" onClick={openAdd}>
          <Plus size={15} /> Add segment
        </button>
      </div>
      <div className="table-head">
        <span>TIME</span>
        <span>SEGMENT</span>
        <span>TYPE</span>
        <span>PERSON / LOCATION</span>
        <span>DURATION</span>
        <span>ACTIONS</span>
      </div>
      {segments.map((segment, index) => (
        <div className={`run-row ${index === activeIndex ? "active" : ""}`} key={segment.id}>
          <button className="row-jump" onClick={() => onJump(index, false)}>
            <span>{segment.time}</span>
            <span>
              <b>{segment.title}</b>
            </span>
            <span className="seg-type-badge">
              {SEGMENT_TYPES.find((type) => type.value === segment.segmentType)?.label ?? segment.segmentType}
            </span>
            <span>{segment.person}</span>
            <span>{segment.duration} min</span>
          </button>
          <div className="row-actions">
            <button disabled={index === 0} onClick={() => onMove(index, index - 1)} aria-label="Move up">
              <ArrowUp size={14} />
            </button>
            <button
              disabled={index === segments.length - 1}
              onClick={() => onMove(index, index + 1)}
              aria-label="Move down"
            >
              <ArrowDown size={14} />
            </button>
            <button onClick={() => openEdit(segment)} aria-label="Edit segment">
              <Pencil size={14} />
            </button>
            <button onClick={() => void onDuplicate(segment, index)} aria-label="Duplicate segment">
              <Copy size={14} />
            </button>
            <button
              disabled={segments.length === 1}
              onClick={() => void onDelete(segment.id)}
              aria-label="Delete segment"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      ))}

      <Dialog
        open={editOpen}
        onOpenChange={(open) => {
          setEditOpen(open);
          if (!open) setEditing(null);
        }}
      >
        <DialogContent>
          <form onSubmit={(event) => void handleSave(event)} className="dialog-form">
            <DialogHeader>
              <DialogTitle>{editing ? "Edit segment" : "Add segment"}</DialogTitle>
              <DialogDescription>Changes save immediately to Event Timer cloud.</DialogDescription>
            </DialogHeader>
            <label>
              Title
              <input name="title" required defaultValue={editing?.title} />
            </label>
            <div className="form-grid">
              <label>
                Start time
                <input name="time" type="time" required defaultValue={editing?.time ?? "11:10"} />
              </label>
              <label>
                Duration (minutes)
                <input
                  name="duration"
                  type="number"
                  min="1"
                  max="480"
                  required
                  defaultValue={editing?.duration ?? 10}
                />
              </label>
            </div>
            <label>
              Segment type
              <select name="segmentType" defaultValue={editing?.segmentType ?? "speaker"}>
                {SEGMENT_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Person / location
              <input name="person" required defaultValue={editing?.person ?? "Unassigned"} />
            </label>
            <label>
              Notes
              <input name="notes" defaultValue={editing?.notes ?? ""} />
            </label>
            <details className="threshold-details">
              <summary>Warning thresholds</summary>
              <div className="form-grid">
                <label>
                  Warning at (seconds)
                  <input
                    name="warningSecs"
                    type="number"
                    min="0"
                    max="3600"
                    defaultValue={editing?.warningSecs ?? 120}
                  />
                </label>
                <label>
                  Urgent at (seconds)
                  <input
                    name="urgentSecs"
                    type="number"
                    min="0"
                    max="3600"
                    defaultValue={editing?.urgentSecs ?? 30}
                  />
                </label>
              </div>
            </details>
            <DialogFooter>
              <button type="button" className="button secondary" onClick={() => setEditOpen(false)}>
                Cancel
              </button>
              <button className="button primary" type="submit">
                Save segment
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
