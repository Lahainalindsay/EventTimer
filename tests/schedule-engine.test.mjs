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

const mod = await vite.ssrLoadModule("/lib/schedule-engine.ts");
const segmentHistory = await vite.ssrLoadModule("/lib/segment-history.ts");

const {
  plannedTotalSeconds,
  plannedRemainingSeconds,
  projectedFinishMs,
  projectedFinishWithHistory,
  segmentVarianceSeconds,
  formatVarianceLabel,
  formatProjectedFinish,
} = mod;

const { actualElapsedSeconds } = segmentHistory;

describe("schedule-engine", () => {
  const segments = [{ duration: 15 }, { duration: 10 }, { duration: 25 }];

  it("plannedTotalSeconds sums all segments", () => {
    assert.equal(plannedTotalSeconds(segments), (15 + 10 + 25) * 60);
  });

  it("plannedTotalSeconds returns 0 for empty agenda", () => {
    assert.equal(plannedTotalSeconds([]), 0);
  });

  it("plannedRemainingSeconds includes active segment and forward", () => {
    assert.equal(plannedRemainingSeconds(segments, 1), (10 + 25) * 60);
  });

  it("plannedRemainingSeconds from first includes all", () => {
    assert.equal(plannedRemainingSeconds(segments, 0), (15 + 10 + 25) * 60);
  });

  it("plannedRemainingSeconds at last segment returns only that segment", () => {
    assert.equal(plannedRemainingSeconds(segments, 2), 25 * 60);
  });

  it("plannedRemainingSeconds for empty agenda returns 0", () => {
    assert.equal(plannedRemainingSeconds([], 0), 0);
  });

  it("projectedFinishMs: current remaining + future planned added to now", () => {
    const now = 1_000_000;
    const remaining = 600;
    const expected = now + (600 + 1_500) * 1_000;
    assert.equal(projectedFinishMs(segments, 1, remaining, now), expected);
  });

  it("projectedFinishMs at last segment has no future segments", () => {
    const now = 1_000_000;
    const remaining = 300;
    assert.equal(projectedFinishMs(segments, 2, remaining, now), now + 300 * 1_000);
  });

  it("projectedFinishMs for single segment", () => {
    const now = 5_000;
    assert.equal(projectedFinishMs([{ duration: 20 }], 0, 1_200, now), now + 1_200_000);
  });

  it("segmentVarianceSeconds returns 0 when remaining equals planned duration", () => {
    const segment = { duration: 20 };
    assert.equal(segmentVarianceSeconds(segment, 1_200), 0);
  });

  it("segmentVarianceSeconds positive when ahead (more time than planned)", () => {
    const segment = { duration: 20 };
    assert.equal(segmentVarianceSeconds(segment, 1_500), 300);
  });

  it("segmentVarianceSeconds negative when behind (less time than planned)", () => {
    const segment = { duration: 20 };
    assert.equal(segmentVarianceSeconds(segment, 900), -300);
  });

  it("segmentVarianceSeconds handles overtime (negative remaining)", () => {
    const segment = { duration: 20 };
    assert.equal(segmentVarianceSeconds(segment, -60), -1_260);
  });

  it("formatVarianceLabel: on schedule for small variance", () => {
    assert.equal(formatVarianceLabel(59), "On schedule");
    assert.equal(formatVarianceLabel(-59), "On schedule");
    assert.equal(formatVarianceLabel(0), "On schedule");
  });

  it("formatVarianceLabel: ahead when positive", () => {
    assert.equal(formatVarianceLabel(300), "5 min ahead");
  });

  it("formatVarianceLabel: behind when negative", () => {
    assert.equal(formatVarianceLabel(-300), "5 min behind");
  });

  it("formatVarianceLabel rounds to nearest minute", () => {
    assert.equal(formatVarianceLabel(90), "2 min ahead");
  });

  it("formatProjectedFinish returns a time string", () => {
    const result = formatProjectedFinish(new Date("2024-01-01T14:30:00Z").getTime());
    assert.equal(typeof result, "string");
    assert.ok(result.length > 0);
  });
});

describe("segment-history", () => {
  it("projectedFinishWithHistory matches planned projection when runs are unused", () => {
    const now = 10_000;
    const segments = [{ id: "a", duration: 15 }, { id: "b", duration: 10 }, { id: "c", duration: 5 }];
    assert.equal(projectedFinishWithHistory(segments, 1, 120, [], now), now + (120 + 300) * 1000);
  });

  it("uses actual completed run duration for future segment overruns", () => {
    const now = 10_000;
    const segments = [{ id: "a", duration: 15 }, { id: "b", duration: 10 }, { id: "c", duration: 5 }];
    const runs = [
      { agenda_item_id: "c", started_at: "2024-01-01T00:00:00Z", ended_at: "2024-01-01T00:07:00Z", elapsed_seconds: 420 },
    ];
    assert.equal(projectedFinishWithHistory(segments, 1, 120, runs, now), now + (120 + 420) * 1000);
  });

  it("uses actual completed run duration for future segment underruns", () => {
    const now = 10_000;
    const segments = [{ id: "a", duration: 15 }, { id: "b", duration: 10 }, { id: "c", duration: 5 }];
    const runs = [
      { agenda_item_id: "c", started_at: "2024-01-01T00:00:00Z", ended_at: "2024-01-01T00:03:00Z", elapsed_seconds: 180 },
    ];
    assert.equal(projectedFinishWithHistory(segments, 1, 120, runs, now), now + (120 + 180) * 1000);
  });

  it("uses the most recent completed run when multiple actuals exist", () => {
    const now = 10_000;
    const segments = [{ id: "a", duration: 15 }, { id: "b", duration: 10 }, { id: "c", duration: 5 }];
    const runs = [
      { agenda_item_id: "c", started_at: "2024-01-01T00:00:00Z", ended_at: "2024-01-01T00:04:00Z", elapsed_seconds: 240 },
      { agenda_item_id: "c", started_at: "2024-01-01T00:10:00Z", ended_at: "2024-01-01T00:16:30Z", elapsed_seconds: 390 },
    ];
    assert.equal(projectedFinishWithHistory(segments, 1, 120, runs, now), now + (120 + 390) * 1000);
  });

  it("actualElapsedSeconds returns stored elapsed_seconds when present", () => {
    assert.equal(
      actualElapsedSeconds({
        agenda_item_id: "a",
        started_at: "2024-01-01T00:00:00Z",
        ended_at: "2024-01-01T00:00:15Z",
        elapsed_seconds: 12,
      }),
      12,
    );
  });

  it("actualElapsedSeconds derives elapsed time from timestamps", () => {
    assert.equal(
      actualElapsedSeconds({
        agenda_item_id: "a",
        started_at: "2024-01-01T00:00:00Z",
        ended_at: "2024-01-01T00:00:15Z",
        elapsed_seconds: null,
      }),
      15,
    );
  });

  it("actualElapsedSeconds returns null when run has not ended", () => {
    assert.equal(
      actualElapsedSeconds({
        agenda_item_id: "a",
        started_at: "2024-01-01T00:00:00Z",
        ended_at: null,
        elapsed_seconds: null,
      }),
      null,
    );
  });
});
