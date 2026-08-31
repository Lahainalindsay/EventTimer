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

const displayAccess = await vite.ssrLoadModule("/lib/display-access.ts");
const runtimeVersion = await vite.ssrLoadModule("/lib/runtime-version.ts");

const {
  generatePairingCode,
  generateAccessToken,
  sha256Hex,
  verifyHash,
  getDisplayStatus,
  getDisplayPermissions,
  HEARTBEAT_ONLINE_THRESHOLD_MS,
  HEARTBEAT_DELAYED_THRESHOLD_MS,
  PAIRING_CODE_TTL_MS,
} = displayAccess;

const { applyRuntimeVersionCas, shouldAcceptRuntimeUpdate } = runtimeVersion;

describe("generatePairingCode", () => {
  it("returns exactly 6 digits", () => {
    const code = generatePairingCode();
    assert.match(code, /^\d{6}$/);
  });

  it("returns different codes on successive calls", () => {
    const codes = new Set(Array.from({ length: 20 }, () => generatePairingCode()));
    assert.ok(codes.size > 1, "Should generate diverse codes");
  });
});

describe("generateAccessToken", () => {
  it("returns a non-empty string", () => {
    const token = generateAccessToken();
    assert.equal(typeof token, "string");
    assert.ok(token.length > 10);
  });

  it("returns different tokens on successive calls", () => {
    const tokens = new Set(Array.from({ length: 10 }, () => generateAccessToken()));
    assert.equal(tokens.size, 10);
  });
});

describe("sha256Hex", () => {
  it("returns a 64-char hex string", async () => {
    const hash = await sha256Hex("hello");
    assert.equal(hash.length, 64);
    assert.match(hash, /^[0-9a-f]+$/);
  });

  it("same input produces same hash", async () => {
    assert.equal(await sha256Hex("abc"), await sha256Hex("abc"));
  });

  it("different inputs produce different hashes", async () => {
    assert.notEqual(await sha256Hex("abc"), await sha256Hex("xyz"));
  });
});

describe("verifyHash", () => {
  it("matches correct raw value against stored hash", async () => {
    const raw = "123456";
    const hash = await sha256Hex(raw);
    assert.equal(await verifyHash(raw, hash), true);
  });

  it("rejects wrong raw value", async () => {
    const hash = await sha256Hex("correct");
    assert.equal(await verifyHash("wrong", hash), false);
  });

  it("rejects empty input against real hash", async () => {
    const hash = await sha256Hex("nonempty");
    assert.equal(await verifyHash("", hash), false);
  });
});

describe("getDisplayStatus", () => {
  const now = 1_700_000_000_000;

  it("revoked overrides everything", () => {
    assert.equal(getDisplayStatus("2024-01-01T00:00:00Z", "2024-01-02T00:00:00Z", now), "revoked");
  });

  it("never_connected when no heartbeat", () => {
    assert.equal(getDisplayStatus(null, null, now), "never_connected");
  });

  it("connected when heartbeat is recent", () => {
    const recent = new Date(now - 20_000).toISOString();
    assert.equal(getDisplayStatus(recent, null, now), "connected");
  });

  it("delayed when heartbeat is slightly stale", () => {
    const slightlyStale = new Date(now - (HEARTBEAT_DELAYED_THRESHOLD_MS + 5000)).toISOString();
    assert.equal(getDisplayStatus(slightlyStale, null, now), "delayed");
  });

  it("offline when heartbeat is outside online threshold", () => {
    const old = new Date(now - (HEARTBEAT_ONLINE_THRESHOLD_MS + 5000)).toISOString();
    assert.equal(getDisplayStatus(old, null, now), "offline");
  });
});

describe("getDisplayPermissions — speaker", () => {
  const perms = getDisplayPermissions("speaker");

  it("speaker can see timer", () => assert.equal(perms.timer, true));
  it("speaker can see segment title", () => assert.equal(perms.segmentTitle, true));
  it("speaker can see speaker name", () => assert.equal(perms.speaker, true));
  it("speaker cannot see next segment", () => assert.equal(perms.nextSegment, false));
  it("speaker receives operator message", () => assert.equal(perms.operatorMessage, true));
  it("speaker cannot see private notes", () => assert.equal(perms.privateNotes, false));
  it("speaker receives cues", () => assert.equal(perms.cues, true));
});

describe("getDisplayPermissions — stage", () => {
  const perms = getDisplayPermissions("stage");

  it("stage can see timer", () => assert.equal(perms.timer, true));
  it("stage can see next segment", () => assert.equal(perms.nextSegment, true));
  it("stage receives cues", () => assert.equal(perms.cues, true));
  it("stage cannot see private notes", () => assert.equal(perms.privateNotes, false));
});

describe("getDisplayPermissions — audience", () => {
  const perms = getDisplayPermissions("audience");

  it("audience can see timer", () => assert.equal(perms.timer, true));
  it("audience cannot see speaker", () => assert.equal(perms.speaker, false));
  it("audience does not receive operator messages", () => assert.equal(perms.operatorMessage, false));
  it("audience cannot see next segment", () => assert.equal(perms.nextSegment, false));
  it("audience cannot see private notes", () => assert.equal(perms.privateNotes, false));
  it("audience does not receive cues", () => assert.equal(perms.cues, false));
});

describe("shouldAcceptRuntimeUpdate", () => {
  it("accepts higher version", () => {
    assert.equal(
      shouldAcceptRuntimeUpdate(
        { version: 1, updated_at: "2024-01-01T00:00:00Z" },
        { version: 2, updated_at: "2024-01-01T00:00:01Z" },
      ),
      true,
    );
  });

  it("rejects lower version", () => {
    assert.equal(
      shouldAcceptRuntimeUpdate(
        { version: 5, updated_at: "2024-01-01T00:00:05Z" },
        { version: 3, updated_at: "2024-01-01T00:00:03Z" },
      ),
      false,
    );
  });

  it("accepts equal version with newer updated_at", () => {
    assert.equal(
      shouldAcceptRuntimeUpdate(
        { version: 2, updated_at: "2024-01-01T00:00:00Z" },
        { version: 2, updated_at: "2024-01-01T00:00:01Z" },
      ),
      true,
    );
  });

  it("rejects equal version with older updated_at", () => {
    assert.equal(
      shouldAcceptRuntimeUpdate(
        { version: 2, updated_at: "2024-01-01T00:00:05Z" },
        { version: 2, updated_at: "2024-01-01T00:00:01Z" },
      ),
      false,
    );
  });

  it("rejects equal version with same updated_at (duplicate)", () => {
    assert.equal(
      shouldAcceptRuntimeUpdate(
        { version: 2, updated_at: "2024-01-01T00:00:00Z" },
        { version: 2, updated_at: "2024-01-01T00:00:00Z" },
      ),
      false,
    );
  });

  it("accepts version 0 when current is also 0 but incoming is newer", () => {
    assert.equal(
      shouldAcceptRuntimeUpdate(
        { version: 0, updated_at: "2024-01-01T00:00:00Z" },
        { version: 0, updated_at: "2024-01-01T00:00:01Z" },
      ),
      true,
    );
  });
});

describe("applyRuntimeVersionCas", () => {
  it("reports success when the expected version matches", () => {
    assert.deepEqual(applyRuntimeVersionCas(4, 4), { ok: true, version: 5 });
  });

  it("reports conflict when the expected version is stale", () => {
    assert.deepEqual(applyRuntimeVersionCas(4, 3), { ok: false, version: 4 });
  });

  it("supports multi-operator reconcile and retry", () => {
    const operatorA = applyRuntimeVersionCas(8, 8);
    assert.deepEqual(operatorA, { ok: true, version: 9 });

    const staleOperatorB = applyRuntimeVersionCas(9, 8);
    assert.deepEqual(staleOperatorB, { ok: false, version: 9 });

    const retriedOperatorB = applyRuntimeVersionCas(staleOperatorB.version, staleOperatorB.version);
    assert.deepEqual(retriedOperatorB, { ok: true, version: 10 });
  });
});

describe("constants", () => {
  it("exports pairing TTL", () => {
    assert.equal(PAIRING_CODE_TTL_MS, 10 * 60 * 1000);
  });
});
