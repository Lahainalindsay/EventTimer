import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/20260902120000_atomic_event_creation.sql", "utf8");
const hook = readFileSync("hooks/use-event-data.ts", "utf8");

test("event creation binds ownership to auth.uid and creates runtime atomically", () => {
  assert.match(migration, /v_user_id UUID := auth\.uid\(\)/);
  assert.match(migration, /IF v_user_id IS NULL/);
  assert.match(migration, /owner_id,\s*\n\s*name,/);
  assert.match(migration, /VALUES \(\s*\n\s*v_user_id,/);
  assert.match(migration, /INSERT INTO public\.event_runtime/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.create_event_atomic[\s\S]+FROM anon/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.create_event_atomic[\s\S]+TO authenticated/);
});

test("browser creation uses the atomic RPC and never supplies an owner id", () => {
  assert.match(hook, /supabase\.rpc\("create_event_atomic"/);
  assert.doesNotMatch(hook, /\.from\("events"\)\s*\.insert\(/);
  assert.doesNotMatch(hook.slice(hook.indexOf("const createEventRecord"), hook.indexOf("const createEvent =")), /owner_id/);
  assert.match(hook, /runtimeVersion: 1/);
});

test("migration rollback is provided by the database transaction", () => {
  assert.match(migration, /LANGUAGE plpgsql[\s\S]+SECURITY DEFINER/);
  assert.match(migration, /INSERT INTO public\.events[\s\S]+INSERT INTO public\.event_runtime/);
  assert.match(migration, /SET search_path = public/);
});
