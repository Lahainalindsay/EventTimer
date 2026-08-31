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

const mod = await vite.ssrLoadModule("/lib/runtime-version.ts");
const { applyRuntimeVersionCas, reconcileRuntimeConflict, shouldAcceptRuntimeUpdate } = mod;

describe("runtime CAS", () => {
  it("shouldAcceptRuntimeUpdate rejects version conflicts", () => {
    assert.equal(
      shouldAcceptRuntimeUpdate(
        { version: 5, updated_at: "2026-01-01T10:00:00.000Z" },
        { version: 4, updated_at: "2026-01-01T10:00:01.000Z" },
      ),
      false,
    );
  });

  it("version monotonic increment simulation only advances on exact match", () => {
    assert.deepEqual(applyRuntimeVersionCas(3, 3), { ok: true, version: 4 });
    assert.deepEqual(applyRuntimeVersionCas(4, 3), { ok: false, version: 4 });
  });

  it("reconciliation after conflict prefers authoritative runtime", () => {
    const attempted = { version: 7, updated_at: "2026-01-01T10:00:00.000Z" };
    const authoritative = { version: 8, updated_at: "2026-01-01T10:00:02.000Z", timer_status: "paused" };
    assert.deepEqual(reconcileRuntimeConflict(attempted, authoritative), authoritative);
  });
});
