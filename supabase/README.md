# Supabase (optional)

PIKACHU runs **completely without Supabase**. Private rooms, AI opponents, XP, achievements
and match history all work offline — rooms are refereed by the bundled relay in `server/`,
progress lives in `localStorage`.

Supabase adds one thing: **cross-device sync** of your profile, finished matches and per-game stats.

## Setup

1. Create a project at <https://supabase.com>.
2. Open **SQL Editor** and run [`migrations/0001_init.sql`](migrations/0001_init.sql).
3. Copy `.env.example` to `.env` in the project root and fill in:

   ```
   VITE_SUPABASE_URL=https://<your-project>.supabase.co
   VITE_SUPABASE_ANON_KEY=<your anon public key>
   ```

4. Restart the dev server. **Settings → Cloud sync** will switch from
   *“Not configured”* to *“Configured — sign in to start syncing”*.
5. Sign in with a magic link. Supabase emails it; no password is stored and no
   credential is ever hardcoded in this repository.

## What is stored

| Table | Contents | Who can read it |
|---|---|---|
| `profiles` | display name, chosen mascot | only `auth.uid() = id` |
| `match_results` | one append-only row per finished match | only the owner |
| `player_stats` | rolled-up per-game totals, upserted on `(user_id, game_id)` | only the owner |

Row Level Security is enabled on all three tables, and `match_results` deliberately has
**no update or delete policy** — a results log you can edit is not a results log.

## Security notes

- The browser only ever uses the **anon public** key. Never put a service-role key in
  `VITE_*` variables: everything prefixed `VITE_` is compiled into the client bundle.
- The relay server never talks to Supabase. Game outcomes are decided by the shared rules
  modules in `src/games/*/rules.ts`, not by anything the browser or the database asserts.
- If the keys are absent or wrong, every sync call fails silently once (with a single console
  warning) and the app keeps working offline.

## Realtime

This build does **not** subscribe to Supabase Realtime by default: room traffic goes over the
local relay WebSocket (`/rt`), which is cheaper and authoritative. `VITE_REALTIME_TRANSPORT`
is reserved for swapping that transport later; leave it as `relay`.
