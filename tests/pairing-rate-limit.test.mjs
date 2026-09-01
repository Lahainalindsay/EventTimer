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

const mod = await vite.ssrLoadModule("/lib/pairing-rate-limit.ts");
const {
  PAIRING_MAX_FAILED_ATTEMPTS,
  isPairingThrottledByStore,
  recordPairingAttemptInStore,
} = mod;

describe("pairing rate limit", () => {
  it("uses durable attempt counts when a store is available", async () => {
    const fakeStore = {
      from() {
        return {
          select() {
            return {
              eq() {
                return {
                  eq() {
                    return {
                      async gte() {
                        return { count: PAIRING_MAX_FAILED_ATTEMPTS, error: null };
                      },
                    };
                  },
                };
              },
            };
          },
          async insert() {
            return { error: null };
          },
        };
      },
    };

    assert.deepEqual(await isPairingThrottledByStore(fakeStore, "ip-event", 2000), { throttled: true, available: true });
    assert.equal(await recordPairingAttemptInStore(fakeStore, "ip-event", "event-1", false, 2000), true);
  });

  it("fails closed when durable storage cannot be queried or written", async () => {
    const unavailableStore = {
      from() {
        return {
          select() {
            return { eq() { return { eq() { return { async gte() { return { count: null, error: new Error("db down") }; } }; } }; } };
          },
          async insert() { return { error: new Error("db down") }; },
        };
      },
    };
    assert.deepEqual(await isPairingThrottledByStore(unavailableStore, "ip-event"), { throttled: false, available: false });
    assert.equal(await recordPairingAttemptInStore(unavailableStore, "ip-event", "event-1", false), false);
  });
});

after(async () => {
  await vite.close();
});
