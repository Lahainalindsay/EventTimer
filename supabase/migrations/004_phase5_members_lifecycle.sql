-- 1. Atomic upsert-or-update RPC (replaces the bootstrap race)
-- Handles both: first-time row creation AND CAS update in ONE atomic statement
CREATE OR REPLACE FUNCTION upsert_runtime_atomic(
  p_event_id UUID,
  p_expected_version BIGINT,     -- 0 means "create if not exists"
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
  -- Try CAS update first
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
    AND (version = p_expected_version OR (p_expected_version = 0 AND NOT EXISTS (
      SELECT 1 FROM event_runtime WHERE event_id = p_event_id
    )))
  RETURNING *;

  -- If no row updated AND expected_version=0, insert the first row
  IF NOT FOUND AND p_expected_version = 0 THEN
    RETURN QUERY
    INSERT INTO event_runtime (
      event_id, timer_status, duration_seconds, manual_offset_seconds,
      timer_mode, started_at, current_agenda_item_id, version, updated_at
    ) VALUES (
      p_event_id, p_timer_status, p_duration_seconds, p_manual_offset_seconds,
      p_timer_mode, p_started_at, p_current_agenda_item_id, 1, now()
    )
    ON CONFLICT (event_id) DO UPDATE
      SET timer_status = EXCLUDED.timer_status,
          duration_seconds = EXCLUDED.duration_seconds,
          manual_offset_seconds = EXCLUDED.manual_offset_seconds,
          timer_mode = EXCLUDED.timer_mode,
          started_at = EXCLUDED.started_at,
          current_agenda_item_id = EXCLUDED.current_agenda_item_id,
          version = event_runtime.version + 1,
          updated_at = now()
    RETURNING *;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION upsert_runtime_atomic(UUID,BIGINT,TEXT,INT,INT,TEXT,TIMESTAMPTZ,UUID) TO authenticated;

-- 2. Event lifecycle status (additive — existing 'draft' value already in use)
ALTER TABLE events ADD COLUMN IF NOT EXISTS lifecycle_status TEXT NOT NULL DEFAULT 'draft';
-- legal values: draft, ready, live, completed, archived
-- (events.status column from original schema is unrelated timer-only status — preserve it)
COMMENT ON COLUMN events.lifecycle_status IS 'Event lifecycle: draft | ready | live | completed | archived';

-- 3. Collaborator model
CREATE TABLE IF NOT EXISTS event_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  role TEXT NOT NULL DEFAULT 'operator',  -- owner, producer, operator, viewer
  invited_email TEXT,
  invite_token_hash TEXT UNIQUE,
  invite_expires_at TIMESTAMPTZ,
  invited_by UUID REFERENCES auth.users(id),
  invited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE event_members ENABLE ROW LEVEL SECURITY;

-- Event owner can manage members; collaborators can see their own membership
CREATE POLICY IF NOT EXISTS "event_members_owner_manage" ON event_members
  FOR ALL TO authenticated
  USING (event_id IN (SELECT id FROM events WHERE owner_id = auth.uid()));

CREATE POLICY IF NOT EXISTS "event_members_self_read" ON event_members
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

COMMENT ON TABLE event_members IS 'Collaborators invited to an event. Roles: owner, producer, operator, viewer.';
