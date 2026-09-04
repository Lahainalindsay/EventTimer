-- Read-only diagnostic for the Event creation RPC and legacy events.status.
-- Run in the Supabase SQL Editor for the intended private-beta project.
WITH event_status AS (
  SELECT
    c.data_type,
    c.udt_name,
    c.column_default,
    c.is_nullable
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'events'
    AND c.column_name = 'status'
), status_checks AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'constraint_name', con.conname,
    'definition', pg_get_constraintdef(con.oid)
  ) ORDER BY con.conname), '[]'::jsonb) AS constraints
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'public'
    AND rel.relname = 'events'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%status%'
), creation_function AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'signature', pg_get_function_identity_arguments(p.oid),
    'definition', pg_get_functiondef(p.oid),
    'authenticated_execute', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
    'anon_execute', has_function_privilege('anon', p.oid, 'EXECUTE'),
    'public_execute', has_function_privilege('public', p.oid, 'EXECUTE')
  )), '[]'::jsonb) AS functions
  FROM pg_proc p
  JOIN pg_namespace nsp ON nsp.oid = p.pronamespace
  WHERE nsp.nspname = 'public'
    AND p.proname = 'create_event_atomic'
)
SELECT jsonb_build_object(
  'events_status', (SELECT to_jsonb(event_status) FROM event_status),
  'status_check_constraints', (SELECT constraints FROM status_checks),
  'create_event_atomic', (SELECT functions FROM creation_function)
) AS event_creation_diagnostic;
