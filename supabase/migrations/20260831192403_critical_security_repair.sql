-- Critical security repair for Event Timer.
-- Source-controlled only: do not apply to production without explicit approval.

-- Role lookup helper for RLS policies. This is SECURITY DEFINER intentionally:
-- policies need a non-recursive way to inspect events and event_members while
-- those tables are themselves protected by RLS. It does not mutate data, uses a
-- fixed search_path, accepts only UUID values, and execute is limited below.
CREATE OR REPLACE FUNCTION public.event_timer_role_for(
  p_event_id UUID,
  p_user_id UUID
)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_user_id IS NULL THEN NULL
    WHEN EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id = p_event_id
        AND e.owner_id = p_user_id
    ) THEN 'owner'
    ELSE (
      SELECT em.role
      FROM public.event_members em
      WHERE em.event_id = p_event_id
        AND em.user_id = p_user_id
        AND em.accepted_at IS NOT NULL
        AND em.role IN ('producer', 'operator', 'viewer')
      ORDER BY CASE em.role
        WHEN 'producer' THEN 1
        WHEN 'operator' THEN 2
        WHEN 'viewer' THEN 3
        ELSE 4
      END
      LIMIT 1
    )
  END;
$$;

CREATE OR REPLACE FUNCTION public.event_timer_can(
  p_event_id UUID,
  p_roles TEXT[]
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.event_timer_role_for(p_event_id, (SELECT auth.uid())) = ANY(p_roles), false);
$$;

REVOKE ALL ON FUNCTION public.event_timer_role_for(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.event_timer_can(UUID, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_timer_can(UUID, TEXT[]) TO authenticated;

-- Private server-side audit table for pairing throttles. No anon/authenticated
-- policy is created; server code writes through a secret key only.
CREATE TABLE IF NOT EXISTS public.display_pairing_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rate_limit_key TEXT NOT NULL,
  event_id UUID,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  succeeded BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS display_pairing_attempts_recent_idx
  ON public.display_pairing_attempts(rate_limit_key, attempted_at DESC);

ALTER TABLE public.display_pairing_attempts ENABLE ROW LEVEL SECURITY;

-- Runtime mutation RPCs. These are SECURITY DEFINER because they are a narrow
-- database API boundary for atomic CAS/initial creation, but they explicitly
-- authorize the caller by auth.uid() against event ownership or accepted
-- owner/producer/operator membership before any mutation. Displays receive no
-- Supabase authenticated identity and cannot execute these functions.
CREATE OR REPLACE FUNCTION public.upsert_runtime_atomic(
  p_event_id UUID,
  p_expected_version BIGINT,
  p_timer_status TEXT,
  p_duration_seconds INT,
  p_manual_offset_seconds INT,
  p_timer_mode TEXT,
  p_started_at TIMESTAMPTZ,
  p_current_agenda_item_id UUID
)
RETURNS SETOF public.event_runtime
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.event_timer_can(p_event_id, ARRAY['owner','producer','operator']) THEN
    RAISE EXCEPTION 'not authorized to mutate event runtime' USING ERRCODE = '42501';
  END IF;

  IF p_expected_version < 0 THEN
    RAISE EXCEPTION 'invalid expected runtime version' USING ERRCODE = '22023';
  END IF;

  IF p_timer_status NOT IN ('running', 'paused') THEN
    RAISE EXCEPTION 'invalid timer status' USING ERRCODE = '22023';
  END IF;

  IF p_timer_mode NOT IN ('countdown', 'count_up') THEN
    RAISE EXCEPTION 'invalid timer mode' USING ERRCODE = '22023';
  END IF;

  IF p_duration_seconds < 0 THEN
    RAISE EXCEPTION 'invalid timer duration' USING ERRCODE = '22023';
  END IF;

  IF p_current_agenda_item_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.agenda_items ai
    WHERE ai.id = p_current_agenda_item_id
      AND ai.event_id = p_event_id
  ) THEN
    RAISE EXCEPTION 'agenda item does not belong to event' USING ERRCODE = '23503';
  END IF;

  RETURN QUERY
  INSERT INTO public.event_runtime (
    event_id,
    timer_status,
    duration_seconds,
    manual_offset_seconds,
    timer_mode,
    started_at,
    current_agenda_item_id,
    version,
    updated_at
  )
  SELECT
    p_event_id,
    p_timer_status,
    p_duration_seconds,
    p_manual_offset_seconds,
    p_timer_mode,
    p_started_at,
    p_current_agenda_item_id,
    1,
    now()
  WHERE p_expected_version = 0
  ON CONFLICT (event_id) DO UPDATE
    SET timer_status = EXCLUDED.timer_status,
        duration_seconds = EXCLUDED.duration_seconds,
        manual_offset_seconds = EXCLUDED.manual_offset_seconds,
        timer_mode = EXCLUDED.timer_mode,
        started_at = EXCLUDED.started_at,
        current_agenda_item_id = EXCLUDED.current_agenda_item_id,
        version = public.event_runtime.version + 1,
        updated_at = now()
    WHERE public.event_runtime.version = p_expected_version
  RETURNING *;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_runtime_atomic(
  p_event_id UUID,
  p_expected_version BIGINT,
  p_timer_status TEXT,
  p_duration_seconds INT,
  p_manual_offset_seconds INT,
  p_timer_mode TEXT,
  p_started_at TIMESTAMPTZ,
  p_current_agenda_item_id UUID
)
RETURNS SETOF public.event_runtime
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_expected_version <= 0 THEN
    RETURN;
  END IF;

  IF NOT public.event_timer_can(p_event_id, ARRAY['owner','producer','operator']) THEN
    RAISE EXCEPTION 'not authorized to mutate event runtime' USING ERRCODE = '42501';
  END IF;

  IF p_timer_status NOT IN ('running', 'paused') THEN
    RAISE EXCEPTION 'invalid timer status' USING ERRCODE = '22023';
  END IF;

  IF p_timer_mode NOT IN ('countdown', 'count_up') THEN
    RAISE EXCEPTION 'invalid timer mode' USING ERRCODE = '22023';
  END IF;

  IF p_duration_seconds < 0 THEN
    RAISE EXCEPTION 'invalid timer duration' USING ERRCODE = '22023';
  END IF;

  IF p_current_agenda_item_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.agenda_items ai
    WHERE ai.id = p_current_agenda_item_id
      AND ai.event_id = p_event_id
  ) THEN
    RAISE EXCEPTION 'agenda item does not belong to event' USING ERRCODE = '23503';
  END IF;

  RETURN QUERY
  UPDATE public.event_runtime
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

COMMENT ON FUNCTION public.event_timer_role_for(UUID, UUID) IS
  'Non-recursive RLS helper. Returns owner, producer, operator, viewer, or NULL for an event/user pair.';
COMMENT ON FUNCTION public.event_timer_can(UUID, TEXT[]) IS
  'RLS/RPC helper. Checks auth.uid() against owner or accepted event membership roles.';
COMMENT ON FUNCTION public.upsert_runtime_atomic(UUID,BIGINT,TEXT,INT,INT,TEXT,TIMESTAMPTZ,UUID) IS
  'Authorized atomic runtime mutation with initial insert and optimistic concurrency. Returns no rows on stale version.';
COMMENT ON FUNCTION public.update_runtime_atomic(UUID,BIGINT,TEXT,INT,INT,TEXT,TIMESTAMPTZ,UUID) IS
  'Authorized runtime update wrapper. Returns no rows on missing row or stale version.';

REVOKE ALL ON FUNCTION public.upsert_runtime_atomic(UUID,BIGINT,TEXT,INT,INT,TEXT,TIMESTAMPTZ,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_runtime_atomic(UUID,BIGINT,TEXT,INT,INT,TEXT,TIMESTAMPTZ,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_runtime_atomic(UUID,BIGINT,TEXT,INT,INT,TEXT,TIMESTAMPTZ,UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_runtime_atomic(UUID,BIGINT,TEXT,INT,INT,TEXT,TIMESTAMPTZ,UUID) TO authenticated;

-- Complete collaborator-aware RLS.
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agenda_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_runtime ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_displays ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.segment_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_cues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "events_owner_all" ON public.events;
DROP POLICY IF EXISTS "events_collaborator_read" ON public.events;
DROP POLICY IF EXISTS "events_owner_insert" ON public.events;
DROP POLICY IF EXISTS "events_owner_update" ON public.events;
DROP POLICY IF EXISTS "events_owner_delete" ON public.events;
CREATE POLICY "events_collaborator_read" ON public.events
  FOR SELECT TO authenticated
  USING (public.event_timer_can(id, ARRAY['owner','producer','operator','viewer']));
CREATE POLICY "events_owner_insert" ON public.events
  FOR INSERT TO authenticated
  WITH CHECK (owner_id = (SELECT auth.uid()));
CREATE POLICY "events_owner_update" ON public.events
  FOR UPDATE TO authenticated
  USING (public.event_timer_can(id, ARRAY['owner']))
  WITH CHECK (owner_id = (SELECT auth.uid()));
CREATE POLICY "events_owner_delete" ON public.events
  FOR DELETE TO authenticated
  USING (public.event_timer_can(id, ARRAY['owner']));

DROP POLICY IF EXISTS "agenda_items_owner_all" ON public.agenda_items;
DROP POLICY IF EXISTS "agenda_items_collaborator_read" ON public.agenda_items;
DROP POLICY IF EXISTS "agenda_items_editor_insert" ON public.agenda_items;
DROP POLICY IF EXISTS "agenda_items_editor_update" ON public.agenda_items;
DROP POLICY IF EXISTS "agenda_items_editor_delete" ON public.agenda_items;
CREATE POLICY "agenda_items_collaborator_read" ON public.agenda_items
  FOR SELECT TO authenticated
  USING (public.event_timer_can(event_id, ARRAY['owner','producer','operator','viewer']));
CREATE POLICY "agenda_items_editor_insert" ON public.agenda_items
  FOR INSERT TO authenticated
  WITH CHECK (public.event_timer_can(event_id, ARRAY['owner','producer']));
CREATE POLICY "agenda_items_editor_update" ON public.agenda_items
  FOR UPDATE TO authenticated
  USING (public.event_timer_can(event_id, ARRAY['owner','producer']))
  WITH CHECK (public.event_timer_can(event_id, ARRAY['owner','producer']));
CREATE POLICY "agenda_items_editor_delete" ON public.agenda_items
  FOR DELETE TO authenticated
  USING (public.event_timer_can(event_id, ARRAY['owner','producer']));

DROP POLICY IF EXISTS "event_runtime_owner_all" ON public.event_runtime;
DROP POLICY IF EXISTS "event_runtime_collaborator_read" ON public.event_runtime;
DROP POLICY IF EXISTS "event_runtime_operator_insert" ON public.event_runtime;
DROP POLICY IF EXISTS "event_runtime_operator_update" ON public.event_runtime;
CREATE POLICY "event_runtime_collaborator_read" ON public.event_runtime
  FOR SELECT TO authenticated
  USING (public.event_timer_can(event_id, ARRAY['owner','producer','operator','viewer']));
CREATE POLICY "event_runtime_operator_insert" ON public.event_runtime
  FOR INSERT TO authenticated
  WITH CHECK (public.event_timer_can(event_id, ARRAY['owner','producer','operator']));
CREATE POLICY "event_runtime_operator_update" ON public.event_runtime
  FOR UPDATE TO authenticated
  USING (public.event_timer_can(event_id, ARRAY['owner','producer','operator']))
  WITH CHECK (public.event_timer_can(event_id, ARRAY['owner','producer','operator']));

DROP POLICY IF EXISTS "event_messages_owner_all" ON public.event_messages;
DROP POLICY IF EXISTS "event_messages_collaborator_read" ON public.event_messages;
DROP POLICY IF EXISTS "event_messages_operator_insert" ON public.event_messages;
DROP POLICY IF EXISTS "event_messages_operator_update" ON public.event_messages;
DROP POLICY IF EXISTS "event_messages_owner_delete" ON public.event_messages;
CREATE POLICY "event_messages_collaborator_read" ON public.event_messages
  FOR SELECT TO authenticated
  USING (public.event_timer_can(event_id, ARRAY['owner','producer','operator','viewer']));
CREATE POLICY "event_messages_operator_insert" ON public.event_messages
  FOR INSERT TO authenticated
  WITH CHECK (public.event_timer_can(event_id, ARRAY['owner','producer','operator']));
CREATE POLICY "event_messages_operator_update" ON public.event_messages
  FOR UPDATE TO authenticated
  USING (public.event_timer_can(event_id, ARRAY['owner','producer','operator']))
  WITH CHECK (public.event_timer_can(event_id, ARRAY['owner','producer','operator']));
CREATE POLICY "event_messages_owner_delete" ON public.event_messages
  FOR DELETE TO authenticated
  USING (public.event_timer_can(event_id, ARRAY['owner']));

DROP POLICY IF EXISTS "event_displays_owner_all" ON public.event_displays;
DROP POLICY IF EXISTS "event_displays_operator_read" ON public.event_displays;
DROP POLICY IF EXISTS "event_displays_manager_insert" ON public.event_displays;
DROP POLICY IF EXISTS "event_displays_manager_update" ON public.event_displays;
DROP POLICY IF EXISTS "event_displays_manager_delete" ON public.event_displays;
CREATE POLICY "event_displays_operator_read" ON public.event_displays
  FOR SELECT TO authenticated
  USING (public.event_timer_can(event_id, ARRAY['owner','producer','operator']));
CREATE POLICY "event_displays_manager_insert" ON public.event_displays
  FOR INSERT TO authenticated
  WITH CHECK (public.event_timer_can(event_id, ARRAY['owner','producer']));
CREATE POLICY "event_displays_manager_update" ON public.event_displays
  FOR UPDATE TO authenticated
  USING (public.event_timer_can(event_id, ARRAY['owner','producer']))
  WITH CHECK (public.event_timer_can(event_id, ARRAY['owner','producer']));
CREATE POLICY "event_displays_manager_delete" ON public.event_displays
  FOR DELETE TO authenticated
  USING (public.event_timer_can(event_id, ARRAY['owner','producer']));

DROP POLICY IF EXISTS "segment_runs_owner_all" ON public.segment_runs;
DROP POLICY IF EXISTS "segment_runs_collaborator_read" ON public.segment_runs;
DROP POLICY IF EXISTS "segment_runs_operator_insert" ON public.segment_runs;
DROP POLICY IF EXISTS "segment_runs_operator_update" ON public.segment_runs;
DROP POLICY IF EXISTS "segment_runs_owner_delete" ON public.segment_runs;
CREATE POLICY "segment_runs_collaborator_read" ON public.segment_runs
  FOR SELECT TO authenticated
  USING (public.event_timer_can(event_id, ARRAY['owner','producer','operator','viewer']));
CREATE POLICY "segment_runs_operator_insert" ON public.segment_runs
  FOR INSERT TO authenticated
  WITH CHECK (public.event_timer_can(event_id, ARRAY['owner','producer','operator']));
CREATE POLICY "segment_runs_operator_update" ON public.segment_runs
  FOR UPDATE TO authenticated
  USING (public.event_timer_can(event_id, ARRAY['owner','producer','operator']))
  WITH CHECK (public.event_timer_can(event_id, ARRAY['owner','producer','operator']));
CREATE POLICY "segment_runs_owner_delete" ON public.segment_runs
  FOR DELETE TO authenticated
  USING (public.event_timer_can(event_id, ARRAY['owner']));

DROP POLICY IF EXISTS "production_cues_owner_all" ON public.production_cues;
DROP POLICY IF EXISTS "production_cues_collaborator_read" ON public.production_cues;
DROP POLICY IF EXISTS "production_cues_operator_insert" ON public.production_cues;
DROP POLICY IF EXISTS "production_cues_operator_update" ON public.production_cues;
DROP POLICY IF EXISTS "production_cues_owner_delete" ON public.production_cues;
CREATE POLICY "production_cues_collaborator_read" ON public.production_cues
  FOR SELECT TO authenticated
  USING (public.event_timer_can(event_id, ARRAY['owner','producer','operator','viewer']));
CREATE POLICY "production_cues_operator_insert" ON public.production_cues
  FOR INSERT TO authenticated
  WITH CHECK (public.event_timer_can(event_id, ARRAY['owner','producer','operator']));
CREATE POLICY "production_cues_operator_update" ON public.production_cues
  FOR UPDATE TO authenticated
  USING (public.event_timer_can(event_id, ARRAY['owner','producer','operator']))
  WITH CHECK (public.event_timer_can(event_id, ARRAY['owner','producer','operator']));
CREATE POLICY "production_cues_owner_delete" ON public.production_cues
  FOR DELETE TO authenticated
  USING (public.event_timer_can(event_id, ARRAY['owner']));

DROP POLICY IF EXISTS "event_members_owner_manage" ON public.event_members;
DROP POLICY IF EXISTS "event_members_self_read" ON public.event_members;
DROP POLICY IF EXISTS "event_members_owner_read" ON public.event_members;
DROP POLICY IF EXISTS "event_members_owner_insert" ON public.event_members;
DROP POLICY IF EXISTS "event_members_owner_update" ON public.event_members;
DROP POLICY IF EXISTS "event_members_owner_delete" ON public.event_members;
CREATE POLICY "event_members_owner_read" ON public.event_members
  FOR SELECT TO authenticated
  USING (public.event_timer_can(event_id, ARRAY['owner']));
CREATE POLICY "event_members_self_read" ON public.event_members
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL);
CREATE POLICY "event_members_owner_insert" ON public.event_members
  FOR INSERT TO authenticated
  WITH CHECK (public.event_timer_can(event_id, ARRAY['owner']));
CREATE POLICY "event_members_owner_update" ON public.event_members
  FOR UPDATE TO authenticated
  USING (public.event_timer_can(event_id, ARRAY['owner']))
  WITH CHECK (public.event_timer_can(event_id, ARRAY['owner']));
CREATE POLICY "event_members_owner_delete" ON public.event_members
  FOR DELETE TO authenticated
  USING (public.event_timer_can(event_id, ARRAY['owner']));

DROP POLICY IF EXISTS "event_templates_owner_all" ON public.event_templates;
CREATE POLICY "event_templates_owner_all" ON public.event_templates
  FOR ALL TO authenticated
  USING (owner_id = (SELECT auth.uid()))
  WITH CHECK (owner_id = (SELECT auth.uid()));
