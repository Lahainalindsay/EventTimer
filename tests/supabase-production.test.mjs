import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const client = readFileSync("lib/supabase.ts", "utf8");
const app = readFileSync("app/event-flow-timer.tsx", "utf8");

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
  assert.match(app, /from\("events"\)\.insert/);
  assert.match(app, /from\("agenda_items"\)\.insert/);
  assert.match(app, /from\("event_runtime"\)\.upsert/);
});
