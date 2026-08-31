# Runline

Runline is a cloud-connected live event timer and run-of-show controller.

## Production backend

- Supabase project: `Runline Production`
- Project ref: `tqbppknxhldhtwexwgbo`
- Browser URL: `https://tqbppknxhldhtwexwgbo.supabase.co`
- Authentication: Supabase email/password with persistent browser sessions
- Persistence: Supabase Postgres with row-level security
- Live updates: Supabase Realtime

The application requires:

```env
NEXT_PUBLIC_SUPABASE_URL=https://tqbppknxhldhtwexwgbo.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
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
- `/dashboard` — authenticated Runline operator dashboard
- `/account` — authenticated account panel

The database schema and RLS policies are managed in Supabase. Do not recreate
the existing production tables from this repository.
