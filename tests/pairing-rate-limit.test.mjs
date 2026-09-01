import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
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
  PAIRING_ATTEMPT_WINDOW_MS,
  isPairingThrottled,
  isPairingThrottledByStore,
  recordPairingAttempt,
  recordPairingAttemptInStore,
  resetPairingAttemptsForTests,
} = mod;

beforeEach(() => resetPairingAttemptsForTests());

describe("pairing rate limit", () => {
  it("throttles repeated failed guesses", () => {
    const key = "ip-event";
    for (let i = 0; i < PAIRING_MAX_FAILED_ATTEMPTS; i += 1) {
      recordPairingAttempt(key, false, 1000 + i);
    }
    assert.equal(isPairingThrottled(key, 2000), true);
  });

  it("ignores old attempts outside the window", () => {
    const key = "ip-event";
    for (let i = 0; i < PAIRING_MAX_FAILED_ATTEMPTS; i += 1) {
      recordPairingAttempt(key, false, 1000 + i);
    }
    assert.equal(isPairingThrottled(key, 1000 + PAIRING_ATTEMPT_WINDOW_MS + 10), false);
  });

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

    assert.equal(await isPairingThrottledByStore(fakeStore, "ip-event", 2000), true);
    await recordPairingAttemptInStore(fakeStore, "ip-event", "event-1", false, 2000);
  });
});

after(async () => {
  await vite.close();
});
