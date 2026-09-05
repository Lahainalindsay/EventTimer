import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/20260902130000_atomic_event_creation_bootstrap.sql", "utf8");
const hook = readFileSync("hooks/use-event-data.ts", "utf8");
const errors = readFileSync("lib/error-messages.ts", "utf8");
const observability = readFileSync("lib/observability.ts", "utf8");
const diagnostic = readFileSync("supabase/diagnostics/event-creation-schema.sql", "utf8");

test("event creation binds ownership to auth.uid and creates runtime atomically", () => {
  assert.match(migration, /v_user_id UUID := auth\.uid\(\)/);
  assert.match(migration, /IF v_user_id IS NULL/);
  assert.match(migration, /owner_id,\s*name,/);
  assert.match(migration, /VALUES \(\s*\n\s*v_user_id,/);
  assert.match(migration, /INSERT INTO public\.agenda_items/);
  assert.match(migration, /INSERT INTO public\.event_runtime/);
  assert.match(migration, /p_segments JSONB/);
  assert.match(migration, /urgent_seconds, auto_advance, lifecycle_status/);
  assert.doesNotMatch(migration, /auto_advance, status, lifecycle_status/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.create_event_atomic[\s\S]+FROM anon/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.create_event_atomic[\s\S]+TO authenticated/);
});

test("browser creation uses the atomic RPC and never supplies an owner id", () => {
  assert.match(hook, /supabase\.rpc\("create_event_atomic"/);
  assert.match(hook, /p_segments:/);
  assert.match(hook, /isMissingFunctionError\(error\)/);
  assert.match(hook, /\.from\("events"\)\s*\.insert\(/);
  assert.match(hook, /\.from\("agenda_items"\)\s*\.upsert\(/);
  assert.match(hook, /owner_id: session\.user\.id/);
  assert.match(hook, /runtimeVersion: 1/);
});

test("migration rollback is provided by the database transaction", () => {
  assert.match(migration, /LANGUAGE plpgsql[\s\S]+SECURITY DEFINER/);
  assert.match(migration, /INSERT INTO public\.events[\s\S]+INSERT INTO public\.agenda_items[\s\S]+INSERT INTO public\.event_runtime/);
  assert.match(migration, /SET search_path = public/);
});

test("event creation diagnostics distinguish database failure classes safely", () => {
  assert.match(errors, /PGRST202/);
  assert.match(errors, /42501/);
  assert.match(errors, /22007/);
  assert.match(errors, /startsWith\("23"\)/);
  assert.match(hook, /error_code: error\?\.code/);
  assert.match(hook, /error_details: error\?\.details/);
  assert.match(hook, /error_hint: error\?\.hint/);
  assert.doesNotMatch(hook, /console\.(log|error).*error/);
});

test("production diagnostics are limited to safe Event creation fields", () => {
  assert.match(observability, /\[EventTimer:create-event\]/);
  for (const forbidden of ["SUPABASE_SECRET_KEY", "access_token", "refresh_token", "cookies", "authorization"]) {
    assert.doesNotMatch(observability, new RegExp(forbidden, "i"));
  }
  assert.match(diagnostic, /events_status/);
  assert.match(diagnostic, /pg_get_functiondef/);
  assert.match(diagnostic, /has_function_privilege/);
});
