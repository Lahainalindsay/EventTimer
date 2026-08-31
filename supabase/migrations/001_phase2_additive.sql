-- Phase 2 additive migration: segment_type field on agenda_items
-- This migration is safe to run against existing data.
-- All existing rows will receive the default value 'speaker'.
-- Run this in the Supabase SQL editor on the production project.

ALTER TABLE agenda_items
  ADD COLUMN IF NOT EXISTS segment_type TEXT NOT NULL DEFAULT 'speaker';

-- Optional: add a CHECK constraint to enforce valid values.
-- Comment this out if you want to allow custom segment types beyond the enum.
-- ALTER TABLE agenda_items
--   ADD CONSTRAINT agenda_items_segment_type_check
--   CHECK (segment_type IN ('opening','speaker','keynote','panel','break','transition','video','performance','qa','closing','custom'));

COMMENT ON COLUMN agenda_items.segment_type IS 'Segment classification for display and filtering. Defaults to speaker.';
