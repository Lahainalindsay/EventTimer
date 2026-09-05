import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const client = readFileSync("lib/supabase.ts", "utf8");
const app = readFileSync("app/event-flow-timer.tsx", "utf8");
const eventDataHook = readFileSync("hooks/use-event-data.ts", "utf8");
const operatorConsole = readFileSync("components/event-timer/operator-console.tsx", "utf8");

test("requires the runtime Supabase URL and publishable key", () => {
  assert.match(client, /NEXT_PUBLIC_SUPABASE_PRODUCTION_REF/);
  assert.match(client, /NEXT_PUBLIC_SUPABASE_STAGING_REF/);
  assert.match(client, /NEXT_PUBLIC_SUPABASE_TEST_REF/);
  assert.match(client, /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
  assert.match(client, /if \(expectedRef && actualRef !== expectedRef\)/);
  assert.doesNotMatch(client, /if \(!expectedRef\)/);
  assert.doesNotMatch(client, /service_role/i);
  assert.doesNotMatch(client, /R.NLINE/i);
});

test("uses real Supabase authentication operations", () => {
  assert.match(app, /auth\.signUp/);
  assert.match(app, /auth\.signInWithPassword/);
  assert.match(app, /auth\.resetPasswordForEmail/);
  assert.match(app, /auth\.signOut/);
  assert.match(app, /auth\.getSession/);
  assert.match(app, /confirmation-email service is at its Supabase sending limit/);
});

test("persists events and agendas through Supabase", () => {
  assert.match(eventDataHook, /rpc\("create_event_atomic"/);
  assert.match(eventDataHook, /p_segments:/);
  assert.match(eventDataHook, /rpc\("upsert_runtime_atomic"/);
  assert.match(eventDataHook, /isMissingFunctionError\(error\)/);
  assert.match(eventDataHook, /\.from\("events"\)\s*\.insert/);
  assert.match(eventDataHook, /\.from\("agenda_items"\)\s*\.upsert/);
  assert.match(eventDataHook, /owner_id: session\.user\.id/);
});

test("timer display and runtime updates are mode aware", () => {
  assert.match(app, /computeDisplaySeconds/);
  assert.match(eventDataHook, /computeDisplaySeconds/);
  assert.match(eventDataHook, /computeElapsedSeconds/);
  assert.match(eventDataHook, /pauseRuntimeForMode/);
  assert.match(eventDataHook, /adjustRuntimeForMode/);
  assert.match(operatorConsole, /event\.timerMode === "count_up" \? 0 : segment\.duration \* 60/);
});
