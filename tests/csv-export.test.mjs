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

const csv = await vite.ssrLoadModule("/lib/csv-export.ts");

function countColumns(row) {
  let count = 1;
  let inQuotes = false;
  for (let index = 0; index < row.length; index += 1) {
    const char = row[index];
    if (char === "\"") {
      if (inQuotes && row[index + 1] === "\"") {
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      count += 1;
    }
  }
  return count;
}

const sampleEvent = {
  id: "event-1",
  name: "Launch",
  date: "2026-08-31",
  venue: "Main Hall",
  segments: [
    {
      id: "seg-1",
      time: "09:00",
      title: "Intro, welcome",
      person: "Host \"A\"",
      duration: 10,
      segmentType: "opening",
      timerMode: "countdown",
      notes: "Line 1 / Line 2",
      warningSecs: 120,
      urgentSecs: 30,
    },
    {
      id: "seg-2",
      time: "09:10",
      title: "国际嘉宾",
      person: "Renée",
      duration: 15,
      segmentType: "speaker",
      timerMode: "countdown",
      notes: "",
      warningSecs: 120,
      urgentSecs: 30,
    },
  ],
  active: 0,
  remaining: 600,
  timerDuration: 600,
  timerStartedAt: null,
  timerMode: "countdown",
  running: false,
  message: "",
  messagePriority: "normal",
  messageTarget: null,
  messageExpiresAt: null,
  updatedAt: 0,
  runtimeVersion: 0,
  settings: { timezone: "UTC", warningSecs: 120, urgentSecs: 30, autoAdvance: false },
  segmentRuns: [
    {
      id: "run-1",
      event_id: "event-1",
      agenda_item_id: "seg-1",
      started_at: "2026-08-31T09:00:00Z",
      ended_at: "2026-08-31T09:11:30Z",
      elapsed_seconds: 690,
      completion_reason: "next",
      created_at: "2026-08-31T09:00:00Z",
    },
  ],
  activeCues: [],
};

describe("escapeCSV", () => {
  it("escapes commas, quotes, empty values, and unicode safely", () => {
    assert.equal(csv.escapeCSV("a,b"), "\"a,b\"");
    assert.equal(csv.escapeCSV("say \"hi\""), "\"say \"\"hi\"\"\"");
    assert.equal(csv.escapeCSV("Line 1\nLine 2"), "\"Line 1\nLine 2\"");
    assert.equal(csv.escapeCSV(""), "");
    assert.equal(csv.escapeCSV(null), "");
    assert.equal(csv.escapeCSV("国际嘉宾"), "国际嘉宾");
  });
});

describe("exportRundownCSV", () => {
  it("emits the expected header row", () => {
    const [header] = csv.exportRundownCSV(sampleEvent).split("\n");
    assert.equal(header, "Time,Title,Person,Duration Minutes,Segment Type,Timer Mode,Notes,Warning Seconds,Urgent Seconds");
  });

  it("keeps the same column count for every row", () => {
    const rows = csv.exportRundownCSV(sampleEvent).split("\n");
    const count = countColumns(rows[0]);
    rows.forEach((row) => assert.equal(countColumns(row), count));
  });
});

describe("exportTimingReportCSV", () => {
  it("emits a valid timing report header row", () => {
    const [header] = csv.exportTimingReportCSV(sampleEvent, sampleEvent.segmentRuns).split("\n");
    assert.equal(header, "Title,Person,Planned Minutes,Actual Duration,Variance");
  });

  it("keeps the same column count for every row", () => {
    const rows = csv.exportTimingReportCSV(sampleEvent, sampleEvent.segmentRuns).split("\n");
    const count = countColumns(rows[0]);
    rows.forEach((row) => assert.equal(countColumns(row), count));
  });
});
