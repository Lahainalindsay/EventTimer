import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  appType: "custom",
  configFile: false,
  root,
  resolve: { alias: { "@": root } },
  server: { middlewareMode: true },
});

after(async () => {
  await vite.close();
});

const { serializeDisplaySnapshot } = await vite.ssrLoadModule("/lib/display-snapshot.ts");

const baseRows = {
  eventRow: { id: "event-1", name: "Town Hall", venue: "Main Room", warning_seconds: 120, urgent_seconds: 30 },
  runtime: {
    event_id: "event-1",
    current_agenda_item_id: "segment-1",
    duration_seconds: 600,
    manual_offset_seconds: 0,
    timer_status: "paused",
    timer_mode: "countdown",
    started_at: null,
    updated_at: "2026-01-01T00:00:00.000Z",
    version: 3,
  },
  agendaRows: [
    {
      id: "segment-1",
      title: "Private Leadership Update",
      speaker: "Confidential Speaker",
      planned_duration_seconds: 600,
      warning_seconds: 60,
      urgent_seconds: 15,
    },
    {
      id: "segment-2",
      title: "Backstage Reset",
      speaker: "Stage Manager",
      planned_duration_seconds: 300,
      warning_seconds: 60,
      urgent_seconds: 15,
    },
  ],
  messageRows: [
    {
      body: "Speaker-only note",
      priority: "urgent",
      display_target: "speaker",
      expires_at: "2026-01-01T00:05:00.000Z",
      message_type: "message",
      cleared_at: null,
      created_at: "2026-01-01T00:00:10.000Z",
    },
  ],
  cueRows: [
    {
      id: "cue-1",
      event_id: "event-1",
      cue_type: "GO",
      target: "stage",
      triggered_at: "2026-01-01T00:00:15.000Z",
      cleared_at: null,
      triggered_by: "operator-1",
      created_at: "2026-01-01T00:00:15.000Z",
    },
  ],
  nowMs: Date.parse("2026-01-01T00:01:00.000Z"),
};

describe("serializeDisplaySnapshot", () => {
  it("minimizes audience display payloads", () => {
    const snapshot = serializeDisplaySnapshot({
      ...baseRows,
      display: { id: "display-1", event_id: "event-1", display_type: "audience" },
    });

    assert.equal(snapshot.currentTitle, "Private Leadership Update");
    assert.equal(snapshot.currentSpeaker, "");
    assert.equal(snapshot.nextTitle, "");
    assert.equal(snapshot.message, "");
    assert.deepEqual(snapshot.activeCues, []);
    assert.equal("segments" in snapshot, false);
  });

  it("allows stage displays to receive targeted cues without speaker messages", () => {
    const snapshot = serializeDisplaySnapshot({
      ...baseRows,
      display: { id: "display-2", event_id: "event-1", display_type: "stage" },
    });

    assert.equal(snapshot.currentSpeaker, "Confidential Speaker");
    assert.equal(snapshot.nextTitle, "Backstage Reset");
    assert.equal(snapshot.message, "");
    assert.equal(snapshot.activeCues.length, 1);
  });
});
