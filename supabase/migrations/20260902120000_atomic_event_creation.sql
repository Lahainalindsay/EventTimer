-- Create an Event and its initial runtime under the authenticated user's identity.
-- SECURITY DEFINER is required because the browser cannot insert an event before
-- it has an event row to authorize against. Ownership is never supplied by the
-- caller; it is bound to auth.uid() inside this transaction.
CREATE OR REPLACE FUNCTION public.create_event_atomic(
  p_name TEXT,
  p_event_date DATE,
  p_venue TEXT,
  p_timezone TEXT,
  p_warning_seconds INT,
  p_urgent_seconds INT,
  p_auto_advance BOOLEAN
)
RETURNS SETOF public.events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_event public.events;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  IF NULLIF(trim(p_name), '') IS NULL THEN
    RAISE EXCEPTION 'event name is required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.events (
    owner_id,
    name,
    event_date,
    venue,
    timezone,
    warning_seconds,
    urgent_seconds,
    auto_advance,
    status,
    lifecycle_status
  )
  VALUES (
    v_user_id,
    trim(p_name),
    p_event_date,
    p_venue,
    p_timezone,
    p_warning_seconds,
    p_urgent_seconds,
    p_auto_advance,
    'draft',
    'draft'
  )
  RETURNING * INTO v_event;

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
  VALUES (
    v_event.id,
    'paused',
    0,
    0,
    'countdown',
    NULL,
    NULL,
    1,
    now()
  );

  RETURN NEXT v_event;
END;
$$;

REVOKE ALL ON FUNCTION public.create_event_atomic(TEXT,DATE,TEXT,TEXT,INT,INT,BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_event_atomic(TEXT,DATE,TEXT,TEXT,INT,INT,BOOLEAN) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_event_atomic(TEXT,DATE,TEXT,TEXT,INT,INT,BOOLEAN) TO authenticated;

COMMENT ON FUNCTION public.create_event_atomic(TEXT,DATE,TEXT,TEXT,INT,INT,BOOLEAN) IS
  'Authenticated atomic Event bootstrap. The owner is always auth.uid(); the initial runtime is created in the same transaction.';
