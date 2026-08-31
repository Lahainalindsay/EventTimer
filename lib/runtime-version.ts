/**
 * Event Timer — runtime version guard.
 *
 * Prevents stale or out-of-order realtime payloads from overwriting newer
 * timer state. All logic is pure so it can be unit tested.
 */

export interface VersionedRuntime {
  version: number;
  updated_at: string;
}

/**
 * Returns true when the incoming runtime should be accepted.
 *
 * Rules:
 * - Accept if incoming version is strictly greater than current.
 * - Accept if versions are equal but incoming updated_at is newer.
 * - Reject otherwise (stale, duplicate, or out-of-order packet).
 */
export function shouldAcceptRuntimeUpdate(
  current: VersionedRuntime,
  incoming: VersionedRuntime,
): boolean {
  if (incoming.version > current.version) return true;
  if (incoming.version === current.version) {
    return new Date(incoming.updated_at).getTime() > new Date(current.updated_at).getTime();
  }
  return false;
}

export interface RuntimeCasResult {
  ok: boolean;
  version: number;
}

/** Simulate compare-and-swap version advancement for deterministic tests. */
export function applyRuntimeVersionCas(
  storedVersion: number,
  expectedVersion: number,
): RuntimeCasResult {
  if (storedVersion !== expectedVersion) {
    return { ok: false, version: storedVersion };
  }
  return { ok: true, version: storedVersion + 1 };
}
