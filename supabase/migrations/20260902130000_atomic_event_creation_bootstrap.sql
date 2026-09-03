-- Correct the initial Event bootstrap so the Event, rundown, and runtime are
-- committed together. This replaces the earlier Event-only RPC signature.
DROP FUNCTION IF EXISTS public.create_event_atomic(TEXT, DATE, TEXT, TEXT, INT, INT, BOOLEAN);

CREATE OR REPLACE FUNCTION public.create_event_atomic(
  p_name TEXT,
  p_event_date DATE,
  p_venue TEXT,
  p_timezone TEXT,
  p_warning_seconds INT,
  p_urgent_seconds INT,
  p_auto_advance BOOLEAN,
  p_segments JSONB
)
RETURNS SETOF public.events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_event public.events;
  v_segment JSONB;
  v_segment_id UUID;
  v_first_segment_id UUID;
  v_first_duration INT := 0;
  v_first_timer_mode TEXT := 'countdown';
  v_position INT := 0;
  v_segments JSONB := p_segments;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  IF NULLIF(trim(p_name), '') IS NULL THEN
    RAISE EXCEPTION 'event name is required' USING ERRCODE = '22023';
  END IF;

  IF p_event_date IS NULL THEN
    RAISE EXCEPTION 'event date is required' USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(v_segments) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'event segments must be an array' USING ERRCODE = '22023';
  END IF;

  -- A direct RPC caller that does not provide segments still receives the
  -- same initial rundown as the application default.
  IF jsonb_array_length(v_segments) = 0 THEN
    v_segments := jsonb_build_array(
      jsonb_build_object('title', 'Doors open', 'speaker', 'Front of house', 'duration', 900, 'time', '09:00', 'segment_type', 'opening', 'timer_mode', 'countdown', 'notes', '', 'warning_seconds', p_warning_seconds, 'urgent_seconds', p_urgent_seconds),
      jsonb_build_object('title', 'Welcome & opening', 'speaker', 'Host', 'duration', 600, 'time', '09:15', 'segment_type', 'opening', 'timer_mode', 'countdown', 'notes', '', 'warning_seconds', p_warning_seconds, 'urgent_seconds', p_urgent_seconds),
      jsonb_build_object('title', 'Keynote', 'speaker', 'Speaker', 'duration', 1500, 'time', '09:25', 'segment_type', 'keynote', 'timer_mode', 'countdown', 'notes', '', 'warning_seconds', p_warning_seconds, 'urgent_seconds', p_urgent_seconds)
    );
  END IF;

  INSERT INTO public.events (
    owner_id, name, event_date, venue, timezone, warning_seconds,
    urgent_seconds, auto_advance, status, lifecycle_status
  )
  VALUES (
    v_user_id, trim(p_name), p_event_date, p_venue, p_timezone,
    p_warning_seconds, p_urgent_seconds, p_auto_advance, 'draft', 'draft'
  )
  RETURNING * INTO v_event;

  FOR v_segment IN SELECT value FROM jsonb_array_elements(v_segments)
  LOOP
    v_segment_id := COALESCE(NULLIF(v_segment->>'id', '')::UUID, gen_random_uuid());
    IF v_first_segment_id IS NULL THEN
      v_first_segment_id := v_segment_id;
      v_first_duration := GREATEST(COALESCE((v_segment->>'duration')::INT, (v_segment->>'planned_duration_seconds')::INT, 0), 0);
      v_first_timer_mode := CASE WHEN v_segment->>'timer_mode' = 'count_up' THEN 'count_up' ELSE 'countdown' END;
    END IF;

    INSERT INTO public.agenda_items (
      id, event_id, position, title, speaker, notes, planned_duration_seconds,
      scheduled_start, segment_type, timer_mode, warning_seconds, urgent_seconds
    )
    VALUES (
      v_segment_id,
      v_event.id,
      COALESCE((v_segment->>'position')::INT, v_position),
      COALESCE(v_segment->>'title', ''),
      NULLIF(v_segment->>'speaker', ''),
      NULLIF(v_segment->>'notes', ''),
      GREATEST(COALESCE((v_segment->>'planned_duration_seconds')::INT, (v_segment->>'duration')::INT, 0), 0),
      NULLIF(p_event_date::TEXT || 'T' || COALESCE(v_segment->>'time', '09:00') || ':00', '')::TIMESTAMP,
      COALESCE(v_segment->>'segment_type', 'custom'),
      CASE WHEN v_segment->>'timer_mode' = 'count_up' THEN 'count_up' ELSE 'countdown' END,
      COALESCE((v_segment->>'warning_seconds')::INT, p_warning_seconds),
      COALESCE((v_segment->>'urgent_seconds')::INT, p_urgent_seconds)
    );
    v_position := v_position + 1;
  END LOOP;

  INSERT INTO public.event_runtime (
    event_id, timer_status, duration_seconds, manual_offset_seconds,
    timer_mode, started_at, current_agenda_item_id, version, updated_at
  )
  VALUES (
    v_event.id, 'paused', v_first_duration, 0, v_first_timer_mode, NULL,
    v_first_segment_id, 1, now()
  );

  RETURN NEXT v_event;
END;
$$;

REVOKE ALL ON FUNCTION public.create_event_atomic(TEXT, DATE, TEXT, TEXT, INT, INT, BOOLEAN, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_event_atomic(TEXT, DATE, TEXT, TEXT, INT, INT, BOOLEAN, JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_event_atomic(TEXT, DATE, TEXT, TEXT, INT, INT, BOOLEAN, JSONB) TO authenticated;

COMMENT ON FUNCTION public.create_event_atomic(TEXT, DATE, TEXT, TEXT, INT, INT, BOOLEAN, JSONB) IS
  'Authenticated atomic Event bootstrap. Ownership is auth.uid(); rundown and initial runtime are committed in the same transaction.';
