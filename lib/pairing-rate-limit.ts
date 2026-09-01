export const PAIRING_ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
export const PAIRING_MAX_FAILED_ATTEMPTS = 8;

type Attempt = { at: number; ok: boolean };
type PairingAttemptReader = {
  from: (table: "display_pairing_attempts") => {
    select: (
      columns: string,
      options: { count: "exact"; head: true },
    ) => {
      eq: (
        column: "rate_limit_key",
        value: string,
      ) => {
        eq: (
          column: "succeeded",
          value: boolean,
        ) => {
          gte: (
            column: "attempted_at",
            value: string,
          ) => PromiseLike<{ count: number | null; error: unknown }>;
        };
      };
    };
    insert: (row: {
      rate_limit_key: string;
      event_id: string | null;
      succeeded: boolean;
      attempted_at: string;
    }) => PromiseLike<{ error: unknown }>;
  };
};

const globalForPairing = globalThis as typeof globalThis & {
  __eventTimerPairingAttempts?: Map<string, Attempt[]>;
};

function store() {
  globalForPairing.__eventTimerPairingAttempts ??= new Map<string, Attempt[]>();
  return globalForPairing.__eventTimerPairingAttempts;
}

export function isPairingThrottled(key: string, nowMs = Date.now()): boolean {
  const cutoff = nowMs - PAIRING_ATTEMPT_WINDOW_MS;
  const attempts = (store().get(key) ?? []).filter((attempt) => attempt.at >= cutoff);
  store().set(key, attempts);
  return attempts.filter((attempt) => !attempt.ok).length >= PAIRING_MAX_FAILED_ATTEMPTS;
}

export function recordPairingAttempt(key: string, ok: boolean, nowMs = Date.now()): void {
  const cutoff = nowMs - PAIRING_ATTEMPT_WINDOW_MS;
  const attempts = (store().get(key) ?? []).filter((attempt) => attempt.at >= cutoff);
  attempts.push({ at: nowMs, ok });
  store().set(key, attempts);
}

export function resetPairingAttemptsForTests(): void {
  store().clear();
}

export async function isPairingThrottledByStore(
  rawSupabase: unknown,
  key: string,
  nowMs = Date.now(),
): Promise<boolean> {
  const supabase = rawSupabase as PairingAttemptReader;
  const cutoff = new Date(nowMs - PAIRING_ATTEMPT_WINDOW_MS).toISOString();
  const { count, error } = await supabase
    .from("display_pairing_attempts")
    .select("id", { count: "exact", head: true })
    .eq("rate_limit_key", key)
    .eq("succeeded", false)
    .gte("attempted_at", cutoff);

  if (error) {
    return isPairingThrottled(key, nowMs);
  }

  return (count ?? 0) >= PAIRING_MAX_FAILED_ATTEMPTS;
}

export async function recordPairingAttemptInStore(
  rawSupabase: unknown,
  key: string,
  eventId: string | null,
  ok: boolean,
  nowMs = Date.now(),
): Promise<void> {
  const supabase = rawSupabase as PairingAttemptReader;
  recordPairingAttempt(key, ok, nowMs);
  await supabase.from("display_pairing_attempts").insert({
    rate_limit_key: key,
    event_id: eventId,
    succeeded: ok,
    attempted_at: new Date(nowMs).toISOString(),
  });
}
