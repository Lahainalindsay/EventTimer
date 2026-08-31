import assert from "node:assert/strict";
import test, { after, describe, it } from "node:test";
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

const mod = await vite.ssrLoadModule("/lib/timer-engine.ts");

const {
  computeRemainingSeconds,
  isOvertime,
  pause,
  resume,
  reset,
  adjustTime,
  formatTime,
} = mod;

// ─── countdown calculation ────────────────────────────────────────────────────

test("countdown decrements based on elapsed time from startedAt", () => {
  const now = 1_700_000_000_000;
  const state = {
    durationSeconds: 120,
    manualOffsetSeconds: 0,
    status: "running",
    startedAt: new Date(now - 30_000).toISOString(), // started 30 s ago
  };
  assert.equal(computeRemainingSeconds(state, now), 90);
});

test("paused timer returns stable value regardless of elapsed time", () => {
  const state = {
    durationSeconds: 120,
    manualOffsetSeconds: 0,
    status: "paused",
    startedAt: null,
  };
  const t1 = computeRemainingSeconds(state, 1_700_000_000_000);
  const t2 = computeRemainingSeconds(state, 1_700_000_005_000);
  assert.equal(t1, 120);
  assert.equal(t2, 120);
});

test("manualOffsetSeconds is included in remaining calculation", () => {
  const now = 1_700_000_000_000;
  const state = {
    durationSeconds: 100,
    manualOffsetSeconds: 20,
    status: "paused",
    startedAt: null,
  };
  assert.equal(computeRemainingSeconds(state, now), 120);
});

// ─── timestamp reconciliation ────────────────────────────────────────────────

test("computeRemainingSeconds reconciles with authoritative server timestamp", () => {
  const serverNow = 1_700_000_000_000;
  const state = {
    durationSeconds: 300,
    manualOffsetSeconds: 0,
    status: "running",
    startedAt: new Date(serverNow - 60_000).toISOString(), // started 1 min ago
  };
  assert.equal(computeRemainingSeconds(state, serverNow), 240);
});

// ─── pause ────────────────────────────────────────────────────────────────────

test("pause captures remaining time and clears startedAt", () => {
  const now = 1_700_000_000_000;
  const state = {
    durationSeconds: 120,
    manualOffsetSeconds: 0,
    status: "running",
    startedAt: new Date(now - 45_000).toISOString(), // 45 s elapsed
  };
  const result = pause(state, now);
  assert.equal(result.status, "paused");
  assert.equal(result.durationSeconds, 75);
  assert.equal(result.startedAt, null);
  assert.equal(result.manualOffsetSeconds, 0);
});

// ─── resume ──────────────────────────────────────────────────────────────────

test("resume sets running status and records fresh startedAt", () => {
  const now = 1_700_000_000_000;
  const state = {
    durationSeconds: 75,
    manualOffsetSeconds: 0,
    status: "paused",
    startedAt: null,
  };
  const result = resume(state, now);
  assert.equal(result.status, "running");
  assert.equal(result.durationSeconds, 75);
  assert.equal(result.startedAt, new Date(now).toISOString());
});

test("resuming then computing remaining at same instant returns durationSeconds", () => {
  const now = 1_700_000_000_000;
  const state = { durationSeconds: 90, manualOffsetSeconds: 0, status: "paused", startedAt: null };
  const running = resume(state, now);
  assert.equal(computeRemainingSeconds(running, now), 90);
});

// ─── add time ─────────────────────────────────────────────────────────────────

test("adjustTime adds seconds to a running timer", () => {
  const now = 1_700_000_000_000;
  const state = {
    durationSeconds: 60,
    manualOffsetSeconds: 0,
    status: "running",
    startedAt: new Date(now).toISOString(), // just started
  };
  const result = adjustTime(state, 60, now);
  assert.equal(result.status, "running");
  assert.equal(result.durationSeconds, 120);
});

test("adjustTime adds seconds to a paused timer", () => {
  const now = 1_700_000_000_000;
  const state = { durationSeconds: 60, manualOffsetSeconds: 0, status: "paused", startedAt: null };
  const result = adjustTime(state, 60, now);
  assert.equal(result.status, "paused");
  assert.equal(result.durationSeconds, 120);
});

// ─── subtract time ───────────────────────────────────────────────────────────

test("adjustTime subtracts seconds from a paused timer", () => {
  const now = 1_700_000_000_000;
  const state = { durationSeconds: 120, manualOffsetSeconds: 0, status: "paused", startedAt: null };
  const result = adjustTime(state, -30, now);
  assert.equal(result.durationSeconds, 90);
  assert.equal(result.status, "paused");
});

test("adjustTime subtracts seconds from a running timer and stays running", () => {
  const now = 1_700_000_000_000;
  const state = {
    durationSeconds: 120,
    manualOffsetSeconds: 0,
    status: "running",
    startedAt: new Date(now).toISOString(),
  };
  const result = adjustTime(state, -30, now);
  assert.equal(result.durationSeconds, 90);
  assert.equal(result.status, "running");
});

// ─── overtime ─────────────────────────────────────────────────────────────────

test("isOvertime returns true when remaining is negative", () => {
  assert.equal(isOvertime(-1), true);
  assert.equal(isOvertime(-100), true);
});

test("isOvertime returns false when remaining is zero or positive", () => {
  assert.equal(isOvertime(0), false);
  assert.equal(isOvertime(1), false);
});

test("overtime timer continues counting below zero", () => {
  const now = 1_700_000_000_000;
  const state = {
    durationSeconds: 10,
    manualOffsetSeconds: 0,
    status: "running",
    startedAt: new Date(now - 30_000).toISOString(), // 30 s past a 10 s segment
  };
  const remaining = computeRemainingSeconds(state, now);
  assert.equal(remaining, -20);
  assert.equal(isOvertime(remaining), true);
});

// ─── formatTime ──────────────────────────────────────────────────────────────

test("formatTime formats minutes and seconds with zero padding", () => {
  assert.equal(formatTime(125), "02:05");
  assert.equal(formatTime(60), "01:00");
  assert.equal(formatTime(0), "00:00");
});

test("formatTime prefixes overtime with plus sign", () => {
  assert.equal(formatTime(-5), "+00:05");
  assert.equal(formatTime(-65), "+01:05");
});

// ─── reset ────────────────────────────────────────────────────────────────────

test("reset returns a paused state with the given duration", () => {
  const result = reset(300);
  assert.equal(result.status, "paused");
  assert.equal(result.durationSeconds, 300);
  assert.equal(result.startedAt, null);
});


// Phase 2: count_up mode tests
describe("computeElapsedSeconds (count_up)", () => {
  it("returns durationSeconds when paused", () => {
    const state = { durationSeconds: 300, manualOffsetSeconds: 0, status: "paused", startedAt: null };
    assert.equal(mod.computeElapsedSeconds(state, Date.now()), 300);
  });

  it("accumulates elapsed when running", () => {
    const start = Date.now();
    const state = { durationSeconds: 0, manualOffsetSeconds: 0, status: "running", startedAt: new Date(start).toISOString() };
    const elapsed = mod.computeElapsedSeconds(state, start + 10000);
    assert.equal(elapsed, 10);
  });

  it("resumes from paused accumulated value", () => {
    const start = Date.now();
    const state = { durationSeconds: 120, manualOffsetSeconds: 0, status: "running", startedAt: new Date(start).toISOString() };
    const elapsed = mod.computeElapsedSeconds(state, start + 60000);
    assert.equal(elapsed, 180);
  });
});

describe("computeDisplaySeconds", () => {
  it("delegates to computeRemainingSeconds for countdown mode", () => {
    const state = { durationSeconds: 600, manualOffsetSeconds: 0, status: "paused", startedAt: null };
    const display = mod.computeDisplaySeconds(state, "countdown", Date.now());
    assert.equal(display, mod.computeRemainingSeconds(state, Date.now()));
  });

  it("delegates to computeElapsedSeconds for count_up mode", () => {
    const state = { durationSeconds: 300, manualOffsetSeconds: 0, status: "paused", startedAt: null };
    const display = mod.computeDisplaySeconds(state, "count_up", Date.now());
    assert.equal(display, 300);
  });
});

describe("getTimerStateName", () => {
  const def = { warningSecs: 120, urgentSecs: 30 };

  it("returns normal when plenty of time remains", () => {
    assert.equal(mod.getTimerStateName(600, "countdown", def), "normal");
  });

  it("returns warning at warning threshold", () => {
    assert.equal(mod.getTimerStateName(120, "countdown", def), "warning");
  });

  it("returns urgent at urgent threshold", () => {
    assert.equal(mod.getTimerStateName(30, "countdown", def), "urgent");
  });

  it("returns urgent at 0 seconds", () => {
    assert.equal(mod.getTimerStateName(0, "countdown", def), "urgent");
  });

  it("returns overtime when negative", () => {
    assert.equal(mod.getTimerStateName(-1, "countdown", def), "overtime");
  });

  it("returns normal for count_up regardless of value", () => {
    assert.equal(mod.getTimerStateName(-999, "count_up", def), "normal");
    assert.equal(mod.getTimerStateName(0, "count_up", def), "normal");
    assert.equal(mod.getTimerStateName(9999, "count_up", def), "normal");
  });

  it("uses DEFAULT_THRESHOLDS when not supplied", () => {
    assert.equal(mod.getTimerStateName(mod.DEFAULT_THRESHOLDS.warningSecs, "countdown"), "warning");
  });
});
