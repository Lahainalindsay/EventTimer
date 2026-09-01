-- Phase 3 additive migration
-- Apply in order after 001_phase2_additive.sql

-- ────────────────────────────────────────────────
-- 1. Per-segment timer mode
-- ────────────────────────────────────────────────
ALTER TABLE agenda_items
  ADD COLUMN IF NOT EXISTS timer_mode TEXT NOT NULL DEFAULT 'countdown';

COMMENT ON COLUMN agenda_items.timer_mode IS 'Timer mode for this segment: countdown or count_up. Defaults to countdown.';

-- ────────────────────────────────────────────────
-- 2. Runtime version / stale-update guard
-- ────────────────────────────────────────────────
ALTER TABLE event_runtime
  ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 0;

COMMENT ON COLUMN event_runtime.version IS 'Monotonically increasing version counter. Realtime clients reject updates with version <= their current version.';

-- ────────────────────────────────────────────────
-- 3. Event settings fields
-- ────────────────────────────────────────────────
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'UTC',
  ADD COLUMN IF NOT EXISTS warning_seconds INT NOT NULL DEFAULT 120,
  ADD COLUMN IF NOT EXISTS urgent_seconds INT NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS auto_advance BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN events.timezone IS 'IANA timezone identifier, e.g. America/Los_Angeles';
COMMENT ON COLUMN events.warning_seconds IS 'Default warning threshold in seconds applied to new segments.';
COMMENT ON COLUMN events.urgent_seconds IS 'Default urgent threshold in seconds applied to new segments.';
COMMENT ON COLUMN events.auto_advance IS 'When true, timer engine may advance to the next segment automatically on countdown completion. Default OFF.';

-- ────────────────────────────────────────────────
-- 4. Display model
-- ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS event_displays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  display_type TEXT NOT NULL DEFAULT 'speaker',
  pairing_code_hash TEXT,
  pairing_code_expires_at TIMESTAMPTZ,
  access_token_hash TEXT UNIQUE,
  connected_at TIMESTAMPTZ,
  last_heartbeat_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE event_displays IS 'Remote display screens paired to an event. Each display has its own scoped access token.';

ALTER TABLE event_displays ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_displays_owner_all" ON event_displays;
CREATE POLICY "event_displays_owner_all"
  ON event_displays
  FOR ALL
  TO authenticated
  USING (
    event_id IN (SELECT id FROM events WHERE owner_id = auth.uid())
  );

-- Display token read policy: enforce in application layer with service role.
-- Public-facing display route uses a server-side API route that verifies
-- access_token_hash before returning presentation-safe data.
-- Raw display rows are NOT exposed to anonymous/display clients through RLS.

-- ────────────────────────────────────────────────
-- 5. Segment run history
-- ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS segment_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  agenda_item_id UUID NOT NULL REFERENCES agenda_items(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  elapsed_seconds INT,
  completion_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE segment_runs IS 'Actual timing history for each segment run. Supports multiple restarts.';

ALTER TABLE segment_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "segment_runs_owner_all" ON segment_runs;
CREATE POLICY "segment_runs_owner_all"
  ON segment_runs
  FOR ALL
  TO authenticated
  USING (
    event_id IN (SELECT id FROM events WHERE owner_id = auth.uid())
  );

-- ────────────────────────────────────────────────
-- 6. Messages/cues type differentiation
-- ────────────────────────────────────────────────
ALTER TABLE event_messages
  ADD COLUMN IF NOT EXISTS message_type TEXT NOT NULL DEFAULT 'message',
  ADD COLUMN IF NOT EXISTS display_target TEXT;

COMMENT ON COLUMN event_messages.message_type IS 'message (free text) or cue (deterministic signal: GO, HOLD, etc.)';
COMMENT ON COLUMN event_messages.display_target IS 'NULL targets all displays. A display id scopes to one screen.';
