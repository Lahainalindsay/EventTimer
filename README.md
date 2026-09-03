# Event Timer

Event Timer is professional live-event timing and run-of-show software.

## Production backend

- Supabase project: set `NEXT_PUBLIC_SUPABASE_URL`
- Authentication: Supabase email/password with persistent browser sessions
- Persistence: Supabase Postgres with row-level security
- Live updates: Supabase Realtime

The application requires:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...
```

`NEXT_PUBLIC_EVENT_TIMER_ENV` and the matching
`NEXT_PUBLIC_SUPABASE_{PRODUCTION,STAGING,TEST}_REF` variables are optional
project-safety labels. When a ref is configured, the application verifies that
the URL matches it. A one-project private beta can omit all of them.

Only the active browser-safe publishable key belongs in the frontend. Never add
a service-role key to this repository or a `NEXT_PUBLIC_*` variable.

## Commands

- `npm run dev` — start the local Sites preview
- `npm run build` — build the Vercel/Next.js production bundle
- `npm run build:vinext` — build the Cloudflare Workers bundle
- `npm test` — build and run repository tests
- `npm run lint` — run ESLint

## Deployment

This repository uses Vinext's Cloudflare Workers deployment path. The existing
`vite.config.ts` and `worker/index.ts` provide the Worker integration; run
`npx vinext deploy --preview` after authenticating Wrangler. Set the Cloudflare
account through `CLOUDFLARE_ACCOUNT_ID` or the generated `wrangler.jsonc`.

Configure these values in the Cloudflare Worker settings under Settings >
Variables and Secrets. Use Preview for beta previews and Production only after
staging validation:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY` (encrypted secret, server-only)

Optional safety labels: `NEXT_PUBLIC_EVENT_TIMER_ENV` and the matching
`NEXT_PUBLIC_SUPABASE_PRODUCTION_REF`, `NEXT_PUBLIC_SUPABASE_STAGING_REF`, or
`NEXT_PUBLIC_SUPABASE_TEST_REF`.

The URL must match the explicitly selected environment ref. Never define the
secret with a `NEXT_PUBLIC_` name or commit a populated `.env` file.

## Database deployment

Migration status is not available until the Supabase project is linked. After
selecting the intended non-production project, authenticate the CLI and run:

```bash
supabase link --project-ref <staging-project-ref>
supabase migration list --linked
supabase db push --linked
supabase migration list --linked
```

The repository migration order is:

1. `001_phase2_additive.sql`
2. `002_phase3_runtime_and_displays.sql`
3. `003_phase4_cues_templates_rpc.sql`
4. `004_phase5_members_lifecycle.sql`
5. `20260831192403_critical_security_repair.sql`
6. `20260901041941_atomic_display_pairing.sql`

Run the same sequence against Production only after the staging schema and
private-beta checks pass. This repository does not automatically apply
migrations to any Supabase project.

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
