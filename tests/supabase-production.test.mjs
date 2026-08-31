import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const client = readFileSync("lib/supabase.ts", "utf8");
const app = readFileSync("app/event-flow-timer.tsx", "utf8");
const eventDataHook = readFileSync("hooks/use-event-data.ts", "utf8");

test("pins the Runline Production Supabase project", () => {
  assert.match(client, /tqbppknxhldhtwexwgbo\.supabase\.co/);
  assert.match(client, /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
  assert.doesNotMatch(client, /service_role/i);
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
  assert.match(eventDataHook, /from\("events"\)\s*\.insert/);
  assert.match(eventDataHook, /from\("agenda_items"\)\s*\.insert/);
  assert.match(eventDataHook, /from\("event_runtime"\)\.upsert/);
});
