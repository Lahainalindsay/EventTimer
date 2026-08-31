# Auto-Advance Architecture Decision

## Status: Deferred to Phase 6

## Why not in Phase 5?

Auto-advance requires a single authoritative trigger to avoid:
- Multiple connected displays or operators each independently firing the transition
- Duplicate segment_run insertions
- Version conflicts on concurrent triggers

## Recommended architecture for Phase 6

A Supabase Edge Function subscribed to:
- event_runtime changes where timer_status transitions to overtime
- Checks: auto_advance=true, no concurrent advance in flight
- Calls upsert_runtime_atomic with next segment data
- Records segment_run completion

## Until then

The auto_advance setting is persisted and visible in Event Settings.
When auto_advance = true, the operator console shows a prominent indicator.
No automatic timer transition fires in Phase 5.
