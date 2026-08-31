-- Phase 4 additive migration
-- Apply in order after 002_phase3_runtime_and_displays.sql

-- ────────────────────────────────────────────────
-- 1. Atomic runtime update RPC
-- ────────────────────────────────────────────────
-- Centralizes the read-modify-write of event_runtime behind a single
-- statement so concurrent operators cannot silently clobber each other's
-- changes. Callers pass the version they last observed; the UPDATE only
-- succeeds if that version still matches the row in the database. When it
-- does not match (a conflict), zero rows are updated and the function
-- returns no rows — callers must then reload the authoritative row and
-- reconcile local state.
CREATE OR REPLACE FUNCTION update_runtime_atomic(
  p_event_id UUID,
  p_expected_version BIGINT,
  p_timer_status TEXT,
  p_duration_seconds INT,
  p_manual_offset_seconds INT,
  p_timer_mode TEXT,
  p_started_at TIMESTAMPTZ,
  p_current_agenda_item_id UUID
)
RETURNS SETOF event_runtime
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE event_runtime
  SET timer_status = p_timer_status,
      duration_seconds = p_duration_seconds,
      manual_offset_seconds = p_manual_offset_seconds,
      timer_mode = p_timer_mode,
      started_at = p_started_at,
      current_agenda_item_id = p_current_agenda_item_id,
      version = version + 1,
      updated_at = now()
  WHERE event_id = p_event_id
    AND version = p_expected_version
  RETURNING *;
END;
$$;

COMMENT ON FUNCTION update_runtime_atomic IS
  'Atomically applies a runtime change only if p_expected_version still matches the stored version. Returns the updated row, or no rows on a version conflict (caller must reconcile).';

-- Callers authenticate as the event owner; RLS on event_runtime still
-- applies to direct table access, and SECURITY DEFINER lets the function
-- perform the guarded update on the caller's behalf.
GRANT EXECUTE ON FUNCTION update_runtime_atomic(UUID, BIGINT, TEXT, INT, INT, TEXT, TIMESTAMPTZ, UUID) TO authenticated;

-- ────────────────────────────────────────────────
-- 2. Production cues — first class table
-- ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS production_cues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  cue_type TEXT NOT NULL, -- GO, HOLD, STANDBY, MIC_LIVE, VIDEO_READY, LIGHTS, NEXT_SPEAKER, BREAK
  target TEXT,            -- NULL = all stage/speaker displays; or display type; or display id
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  cleared_at TIMESTAMPTZ,
  triggered_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE production_cues IS 'Deterministic stage-management signals (GO, HOLD, STANDBY, etc.), separate from free-text operator messages.';

ALTER TABLE production_cues ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "production_cues_owner_all" ON production_cues
  FOR ALL TO authenticated
  USING (event_id IN (SELECT id FROM events WHERE owner_id = auth.uid()));

-- ────────────────────────────────────────────────
-- 3. Event templates
-- ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS event_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  template_data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE event_templates IS 'Reusable run-of-show templates. template_data stores { segments, settings, venue } only — no runtime, history, messages, or credentials.';

ALTER TABLE event_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "event_templates_owner_all" ON event_templates
  FOR ALL TO authenticated USING (owner_id = auth.uid());

-- ────────────────────────────────────────────────
-- 4. Messages: expiry for auto-clear
-- ────────────────────────────────────────────────
ALTER TABLE event_messages
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

COMMENT ON COLUMN event_messages.expires_at IS 'When set, operator clients auto-clear the message from displays after this time (default 5 minutes from send).';
