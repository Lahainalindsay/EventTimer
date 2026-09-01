export const PAIRING_ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
export const PAIRING_MAX_FAILED_ATTEMPTS = 8;

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

export async function isPairingThrottledByStore(
  rawSupabase: unknown,
  key: string,
  nowMs = Date.now(),
): Promise<{ throttled: boolean; available: boolean }> {
  const supabase = rawSupabase as PairingAttemptReader;
  const cutoff = new Date(nowMs - PAIRING_ATTEMPT_WINDOW_MS).toISOString();
  const { count, error } = await supabase
    .from("display_pairing_attempts")
    .select("id", { count: "exact", head: true })
    .eq("rate_limit_key", key)
    .eq("succeeded", false)
    .gte("attempted_at", cutoff);

  if (error) {
    return { throttled: false, available: false };
  }

  return { throttled: (count ?? 0) >= PAIRING_MAX_FAILED_ATTEMPTS, available: true };
}

export async function recordPairingAttemptInStore(
  rawSupabase: unknown,
  key: string,
  eventId: string | null,
  ok: boolean,
  nowMs = Date.now(),
): Promise<boolean> {
  const supabase = rawSupabase as PairingAttemptReader;
  const { error } = await supabase.from("display_pairing_attempts").insert({
    rate_limit_key: key,
    event_id: eventId,
    succeeded: ok,
    attempted_at: new Date(nowMs).toISOString(),
  });
  return !error;
}
