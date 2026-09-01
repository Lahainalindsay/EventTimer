# Event Timer

Event Timer is professional live-event timing and run-of-show software.

## Production backend

- Production Supabase project ref: set `NEXT_PUBLIC_SUPABASE_PRODUCTION_REF`
- Staging Supabase project ref: set `NEXT_PUBLIC_SUPABASE_STAGING_REF`
- Test Supabase project ref: set `NEXT_PUBLIC_SUPABASE_TEST_REF`
- Browser URL: set `NEXT_PUBLIC_SUPABASE_URL`
- Authentication: Supabase email/password with persistent browser sessions
- Persistence: Supabase Postgres with row-level security
- Live updates: Supabase Realtime

The application requires:

```env
NEXT_PUBLIC_EVENT_TIMER_ENV=staging
NEXT_PUBLIC_SUPABASE_URL=https://your-staging-ref.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
NEXT_PUBLIC_SUPABASE_PRODUCTION_REF=your-production-ref
NEXT_PUBLIC_SUPABASE_STAGING_REF=your-staging-ref
NEXT_PUBLIC_SUPABASE_TEST_REF=your-test-ref
SUPABASE_SECRET_KEY=sb_secret_...
```

Only the active browser-safe publishable key belongs in the frontend. Never add
a service-role key to this repository or a `NEXT_PUBLIC_*` variable.

## Commands

- `npm run dev` — start the local Sites preview
- `npm run build` — build the production bundle
- `npm test` — build and run repository tests
- `npm run lint` — run ESLint

## Routes

- `/` — branded authentication and application entry
- `/dashboard` — authenticated Event Timer operator dashboard
- `/account` — authenticated account panel

The database schema and RLS policies are managed in Supabase. Do not recreate
the existing production tables from this repository.

## Architecture

```
lib/timer-engine.ts     — deterministic, framework-independent timer logic
app/event-flow-timer.tsx — main application shell (auth + event UI)
lib/supabase.ts         — Supabase client (keep backend identifiers)
db/schema.ts            — Drizzle schema (intentionally empty; DB managed in Supabase)
```

### Timer engine

The timer derives remaining seconds from authoritative ISO timestamps rather
than accumulating `setInterval` ticks.  This makes it correct after tab sleep,
network loss, reconnection, and multi-display synchronization.  All timer logic
lives in `lib/timer-engine.ts` and can be unit-tested without React.
