"use client";

import { useState, type FormEvent } from "react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, Copy, GripVertical, Pencil, Plus, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { canChangeTimerMode, type TimerMode } from "@/lib/timer-engine";
import { SEGMENT_TYPES, type Segment, type SegmentType, TIMER_MODES } from "@/lib/types";

interface RundownPanelProps {
  segments: Segment[];
  activeIndex: number;
  isRunning: boolean;
  onJump: (index: number, run?: boolean) => void;
  onMove: (from: number, to: number) => void;
  onSave: (item: Segment, isEdit: boolean) => Promise<boolean>;
  onDelete: (id: string) => Promise<void>;
  onDuplicate: (segment: Segment, index: number) => Promise<void>;
}

const uid = () => crypto.randomUUID();

interface SortableSegmentRowProps {
  segment: Segment;
  index: number;
  segments: Segment[];
  activeIndex: number;
  openEdit: (segment: Segment) => void;
  onJump: (index: number, run?: boolean) => void;
  onMove: (from: number, to: number) => void;
  onDelete: (id: string) => Promise<void>;
  onDuplicate: (segment: Segment, index: number) => Promise<void>;
}

function SortableSegmentRow({
  segment,
  index,
  segments,
  activeIndex,
  openEdit,
  onJump,
  onMove,
  onDelete,
  onDuplicate,
}: SortableSegmentRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: segment.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`run-row ${index === activeIndex ? "active" : ""} ${isDragging ? "dragging" : ""}`}
    >
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
        <button className="drag-handle" aria-label="Drag to reorder segment" type="button" {...attributes} {...listeners}>
          <GripVertical size={14} />
        </button>
        <button disabled={index === 0} onClick={() => onMove(index, index - 1)} aria-label="Move up">
          <ArrowUp size={14} />
        </button>
        <button disabled={index === segments.length - 1} onClick={() => onMove(index, index + 1)} aria-label="Move down">
          <ArrowDown size={14} />
        </button>
        <button onClick={() => openEdit(segment)} aria-label="Edit segment">
          <Pencil size={14} />
        </button>
        <button onClick={() => void onDuplicate(segment, index)} aria-label="Duplicate segment">
          <Copy size={14} />
        </button>
        <button disabled={segments.length === 1} onClick={() => void onDelete(segment.id)} aria-label="Delete segment">
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

export function RundownPanel({
  segments,
  activeIndex,
  isRunning,
  onJump,
  onMove,
  onSave,
  onDelete,
  onDuplicate,
}: RundownPanelProps) {
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<Segment | null>(null);

  const sensors = useSensors(
    useSensor(MouseSensor),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const openAdd = () => {
    setEditing(null);
    setEditOpen(true);
  };
  const openEdit = (segment: Segment) => {
    setEditing(segment);
    setEditOpen(true);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = segments.findIndex((segment) => segment.id === active.id);
    const to = segments.findIndex((segment) => segment.id === over.id);
    if (from >= 0 && to >= 0) onMove(from, to);
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
      timerMode: (String(data.get("timerMode")) || "countdown") as TimerMode,
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
  const editingIndex = editing ? segments.findIndex((segment) => segment.id === editing.id) : -1;
  const canEditMode = editingIndex < 0 || canChangeTimerMode(editingIndex, activeIndex, isRunning);

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
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={segments.map((segment) => segment.id)} strategy={verticalListSortingStrategy}>
          {segments.map((segment, index) => (
            <SortableSegmentRow
              key={segment.id}
              segment={segment}
              index={index}
              segments={segments}
              activeIndex={activeIndex}
              openEdit={openEdit}
              onJump={onJump}
              onMove={onMove}
              onDelete={onDelete}
              onDuplicate={onDuplicate}
            />
          ))}
        </SortableContext>
      </DndContext>

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
                <input name="duration" type="number" min="1" max="480" required defaultValue={editing?.duration ?? 10} />
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
              Timer mode
              <select
                name="timerMode"
                defaultValue={editing?.timerMode ?? "countdown"}
                disabled={!canEditMode}
                title={!canEditMode ? "Pause or reset the timer before changing mode" : undefined}
              >
                {TIMER_MODES.map((mode) => (
                  <option key={mode.value} value={mode.value}>
                    {mode.label}
                  </option>
                ))}
              </select>
              {!canEditMode && <small>Pause or reset the timer before changing mode</small>}
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
                  <input name="warningSecs" type="number" min="0" max="3600" defaultValue={editing?.warningSecs ?? 120} />
                </label>
                <label>
                  Urgent at (seconds)
                  <input name="urgentSecs" type="number" min="0" max="3600" defaultValue={editing?.urgentSecs ?? 30} />
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
