import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/20260901041941_atomic_display_pairing.sql", "utf8");
const route = readFileSync("app/api/display/pair/route.ts", "utf8");

test("pairing uses one atomic RPC and never performs a client-side display update", () => {
  assert.match(route, /\.rpc\("pair_display_atomic"/);
  assert.doesNotMatch(route, /\.from\("event_displays"\)/);
  assert.doesNotMatch(route, /recordPairingAttemptInStore/);
});

test("atomic pairing records success after the one-time display update", () => {
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\(p_rate_limit_key, 0\)\)/);
  assert.match(migration, /pairing_code_hash = NULL/);
  assert.match(migration, /access_token_hash = p_access_token_hash/);
  assert.match(migration, /UPDATE public\.event_displays[\s\S]+INSERT INTO public\.display_pairing_attempts \(rate_limit_key, event_id, succeeded, attempted_at\)[\s\S]+VALUES \(p_rate_limit_key, p_event_id, true, p_now\)/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.pair_display_atomic/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.pair_display_atomic[\s\S]+ TO service_role/);
});

test("atomic pairing rolls back display state if durable recording fails", () => {
  assert.match(migration, /INSERT INTO public\.display_pairing_attempts[\s\S]+VALUES \(p_rate_limit_key, p_event_id, true, p_now\)/);
  assert.match(migration, /LANGUAGE plpgsql[\s\S]+SECURITY DEFINER/);
  assert.match(route, /if \(error\)[\s\S]+status: 503/);
});

test("pairing keeps throttled and successful responses distinct", () => {
  assert.match(migration, /RETURN QUERY SELECT NULL::UUID, NULL::UUID, NULL::TEXT, true/);
  assert.match(route, /result\?\.throttled/);
  assert.match(route, /status: 429/);
  assert.match(route, /token: accessToken/);
});
