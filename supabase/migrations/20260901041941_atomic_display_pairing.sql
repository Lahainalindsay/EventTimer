-- Pairing exchange and durable rate-limit accounting must commit together.
-- This is a narrow service-role API; the browser never receives database credentials.
CREATE OR REPLACE FUNCTION public.pair_display_atomic(
  p_event_id UUID,
  p_pairing_code_hash TEXT,
  p_access_token_hash TEXT,
  p_rate_limit_key TEXT,
  p_now TIMESTAMPTZ,
  p_window_start TIMESTAMPTZ,
  p_max_failed_attempts INT
)
RETURNS TABLE (
  id UUID,
  event_id UUID,
  display_type TEXT,
  throttled BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  failed_attempts BIGINT;
  paired_display RECORD;
BEGIN
  -- Serialize attempts for one client/event key so the durable limit is atomic.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_rate_limit_key, 0));

  SELECT count(*)
    INTO failed_attempts
    FROM public.display_pairing_attempts
   WHERE rate_limit_key = p_rate_limit_key
     AND succeeded = false
     AND attempted_at >= p_window_start;

  IF failed_attempts >= p_max_failed_attempts THEN
    RETURN QUERY SELECT NULL::UUID, NULL::UUID, NULL::TEXT, true;
    RETURN;
  END IF;

  UPDATE public.event_displays
     SET access_token_hash = p_access_token_hash,
         pairing_code_hash = NULL,
         pairing_code_expires_at = NULL,
         connected_at = p_now,
         last_heartbeat_at = p_now,
         updated_at = p_now
   WHERE event_displays.event_id = p_event_id
     AND event_displays.pairing_code_hash = p_pairing_code_hash
     AND event_displays.revoked_at IS NULL
     AND event_displays.pairing_code_expires_at > p_now
   RETURNING event_displays.id, event_displays.event_id, event_displays.display_type
     INTO paired_display;

  IF NOT FOUND THEN
    INSERT INTO public.display_pairing_attempts (rate_limit_key, event_id, succeeded, attempted_at)
    VALUES (p_rate_limit_key, p_event_id, false, p_now);
    RETURN;
  END IF;

  INSERT INTO public.display_pairing_attempts (rate_limit_key, event_id, succeeded, attempted_at)
  VALUES (p_rate_limit_key, p_event_id, true, p_now);

  RETURN QUERY SELECT paired_display.id, paired_display.event_id, paired_display.display_type, false;
END;
$$;

REVOKE ALL ON FUNCTION public.pair_display_atomic(UUID,TEXT,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pair_display_atomic(UUID,TEXT,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,INT) TO service_role;
