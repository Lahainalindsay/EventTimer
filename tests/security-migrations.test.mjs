import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const migrationDir = "supabase/migrations";
const migrations = readdirSync(migrationDir)
  .filter((name) => name.endsWith(".sql"))
  .map((name) => [name, readFileSync(join(migrationDir, name), "utf8")]);
const allSql = migrations.map(([, sql]) => sql).join("\n");
const repair = readFileSync("supabase/migrations/20260831192403_critical_security_repair.sql", "utf8");

test("migrations do not use invalid CREATE POLICY IF NOT EXISTS syntax", () => {
  assert.doesNotMatch(allSql, /CREATE\s+POLICY\s+IF\s+NOT\s+EXISTS/i);
});

test("runtime RPC explicitly authorizes owner, producer, and operator but not viewer", () => {
  assert.match(repair, /event_timer_can\(p_event_id,\s*ARRAY\['owner','producer','operator'\]\)/);
  assert.doesNotMatch(repair, /event_timer_can\(p_event_id,\s*ARRAY\['owner','producer','operator','viewer'\]\)/);
  assert.match(repair, /RAISE EXCEPTION 'not authorized to mutate event runtime'/);
  assert.match(repair, /GRANT EXECUTE ON FUNCTION public\.upsert_runtime_atomic\(UUID,BIGINT,TEXT,INT,INT,TEXT,TIMESTAMPTZ,UUID\) TO authenticated/);
  assert.doesNotMatch(repair, /GRANT EXECUTE ON FUNCTION public\.upsert_runtime_atomic[\s\S]+ TO anon/i);
});

test("runtime bootstrap and mutation keep database-side CAS semantics", () => {
  assert.match(repair, /ON CONFLICT \(event_id\) DO UPDATE/);
  assert.match(repair, /WHERE public\.event_runtime\.version = p_expected_version/);
  assert.match(repair, /version = public\.event_runtime\.version \+ 1/);
  assert.match(repair, /WHERE p_expected_version = 0/);
});

test("collaborator RLS covers private event tables", () => {
  for (const table of [
    "events",
    "agenda_items",
    "event_runtime",
    "event_messages",
    "event_displays",
    "segment_runs",
    "production_cues",
    "event_members",
  ]) {
    assert.match(repair, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`));
  }
});

test("display clients do not subscribe directly to protected tables", () => {
  const displayClient = readFileSync("components/event-timer/display-client.tsx", "utf8");
  assert.doesNotMatch(displayClient, /postgres_changes/);
  assert.doesNotMatch(displayClient, /from\("event_runtime"\)/);
  assert.match(displayClient, /\/api\/display\/stream/);
  const streamRoute = readFileSync("app/api/display/stream/route.ts", "utf8");
  assert.match(streamRoute, /loadDisplaySnapshot/);
  assert.match(streamRoute, /createSupabaseServiceClient/);
});

test("pairing exchange is one-time and server-throttled", () => {
  const route = readFileSync("app/api/display/pair/route.ts", "utf8");
  assert.match(route, /isPairingThrottledByStore/);
  assert.match(route, /recordPairingAttemptInStore/);
  assert.match(route, /\.update\(\{/);
  assert.match(route, /\.eq\("pairing_code_hash", codeHash\)/);
  assert.match(route, /pairing_code_hash: null/);
});

test("invite acceptance keeps unauthenticated invitations pending", () => {
  const route = readFileSync("app/api/invite/accept/route.ts", "utf8");
  assert.match(route, /if \(!authUser\) \{/);
  assert.match(route, /requires_login: true/);
  assert.doesNotMatch(route, /: \{ accepted_at: member\.accepted_at \?\? now \}/);
});
