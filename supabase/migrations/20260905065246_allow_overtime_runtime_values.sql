-- Allow countdown runtime values to go negative so overtime can be paused,
-- adjusted, and resumed. Count-up runtime still stores elapsed seconds and
-- must stay non-negative.
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

  IF p_timer_mode = 'count_up' AND p_duration_seconds < 0 THEN
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

  IF p_timer_mode = 'count_up' AND p_duration_seconds < 0 THEN
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

COMMENT ON FUNCTION public.upsert_runtime_atomic(UUID,BIGINT,TEXT,INT,INT,TEXT,TIMESTAMPTZ,UUID) IS
  'Authorized atomic runtime mutation with initial insert and optimistic concurrency. Countdown duration may be negative while paused in overtime; count-up duration stores non-negative elapsed seconds.';
COMMENT ON FUNCTION public.update_runtime_atomic(UUID,BIGINT,TEXT,INT,INT,TEXT,TIMESTAMPTZ,UUID) IS
  'Authorized runtime update wrapper. Countdown duration may be negative while paused in overtime; count-up duration stores non-negative elapsed seconds.';
