# Supabase (optional)

PIKACHU runs **completely without Supabase**. Private rooms, AI opponents, XP, achievements
and match history all work offline — rooms are refereed by the bundled relay in `server/`,
progress lives in `localStorage`.

Supabase adds one thing: **cross-device sync** of your profile, finished matches and per-game stats.

## Setup

1. Create a project at <https://supabase.com>.
2. Open **SQL Editor** and run the migrations **in order**:
   [`0001_init.sql`](migrations/0001_init.sql) →
   [`0002_accounts_and_chat.sql`](migrations/0002_accounts_and_chat.sql) →
   [`0003_feedback.sql`](migrations/0003_feedback.sql) →
   [`0004_admin.sql`](migrations/0004_admin.sql). Each one is idempotent (`create … if not
   exists`, `drop policy if exists`), so re-running the whole set is safe.
3. Copy `.env.example` to `.env` in the project root and fill in:

   ```
   VITE_SUPABASE_URL=https://<your-project>.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_…     # or VITE_SUPABASE_ANON_KEY with the legacy JWT
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
| `feedback` | reviews, game ideas, improvements, bug reports | the published columns of published rows — for anyone |
| `room_messages` | optional mirror of in-room chat | nobody: insert-only, read it in the SQL editor |
| `retro_games` | cartridges an admin uploaded: metadata plus the storage paths | published rows, for anyone; drafts only for admins |
| `site_content` | the handful of headings an admin can rewrite | anyone (it is public copy) |
| `admin_users` | who is allowed to open `/admin` | **nobody** — no grants, no policies, SQL editor only |
| `admin_audit` | one row per admin action | admins |

Row Level Security is enabled on every table, and `match_results` deliberately has **no update or
delete policy** — a results log you can edit is not a results log.

## Feedback

`feedback` is the one table the public can write to without an account, so it is locked down in four
separate ways rather than one:

1. **Column grants.** `anon` may insert `kind, rating, message, game_id, display_name, contact,
   device_id, user_id` and select `id, created_at, kind, rating, message, game_id, display_name`.
   `contact`, `device_id`, `user_id` and `status` are not readable by the browser at all. RLS filters
   *rows*; only column privileges stop a *field* leaking.
2. **CHECK constraints.** Message 8–1200 chars, rating 1–5, a review must carry a rating and nothing
   else may, name ≤ 40, contact ≤ 120.
3. **RLS.** Insert only with `status = 'published'` and no forged `user_id`; select only published
   rows. There is no update or delete policy.
4. **A rate-limit trigger** (`feedback_rate_limit`, `security definer`, so it can count rows the
   inserting role cannot read): max **5 notes per device per hour**, and a global ceiling of 120 per
   10 minutes. It also trims the message and fills in a default name.

### Moderating

```sql
-- hide a note from the wall (it is kept, and stays readable in the table editor)
update public.feedback set status = 'hidden' where id = 123;

-- the whole wall, newest first
select created_at, kind, rating, display_name, message, contact
  from public.feedback where status = 'published' order by created_at desc limit 100;

-- prune the optional chat mirror
delete from public.room_messages where created_at < now() - interval '30 days';
```

## The migrations are tested, not just written

`npm test` includes `src/lib/__tests__/supabase-schema.test.ts`, which runs all four migration files
against a real PostgreSQL (PGlite, in memory) with the Supabase roles, `auth.uid()` and the storage
schema stubbed in, and then connects as `anon`, as an ordinary signed-in member and as the
allowlisted admin to attempt everything each of them must and must not be able to do. If a migration
ever widens a grant, drops a policy, loses the rate-limit trigger or lets a non-admin write a
cartridge, that suite fails in CI instead of in production.

## What changed in 0003

`0002` created `room_messages` with `using (true)` for select and `with check (true)` for insert. With
a public anon key that means *read every room's chat* and *write anything into it*. `0003` drops both
policies and the select grant: the browser can append a row with sane lengths and nothing else. The
relay is still the authoritative copy of chat — this table is only a mirror.

## Security notes

- Use the **publishable** key (`sb_publishable_…`) or the legacy anon JWT; both are safe in a browser
  because RLS plus column grants are what protect the data. The client refuses to boot cloud sync at
  all if it finds a `sb_secret_…` key or a `service_role` JWT in a `VITE_*` variable.
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

## The admin desk (`/admin`)

There is a hidden back office at `/admin`. Nothing links to it, it is `noindex`, it is not in the
sitemap, and — this is the part that matters — **the page decides nothing**. Authority is a row in
`public.admin_users`, and every write goes through RLS on the table and on the `retro` storage
bucket. Deleting the page from the bundle would not grant anybody a single extra byte.

### Turning it on, once

1. **Create the auth user** in *Authentication → Users → Add user* with the maintainer's email and a
   password. Confirm the address if your project requires it.
2. **Allowlist it** in the SQL editor:

   ```sql
   insert into public.admin_users (user_id, note)
   select id, 'owner' from auth.users where lower(email) = 'you@example.com'
   on conflict (user_id) do nothing;
   ```

3. **Run `0004_admin.sql`** if you have not already. It creates the roster, `public.is_admin()`,
   `retro_games`, `site_content`, `admin_audit` and the public `retro` bucket (32 MB cap,
   `application/octet-stream` and `image/png`, public read, admin-only write).
4. Sign in at **Settings → Cloud sync** with that account. If `public.is_admin()` says yes, the app
   opens `/admin`; for every other account the site behaves exactly as before and shows no trace.

### The password is not in this repository

This repo is public. No password, token or service key belongs in a migration, a component or an
`.env` file — anything committed is published and stays in the git history afterwards. The
maintainer's password lives only in the Supabase dashboard (and a password manager). If a password
has ever been pasted into a chat, a ticket or a commit, rotate it in *Authentication → Users*.

### What the desk can do

| Tab | Actions |
|---|---|
| **Retro shelf** | upload a `.gba` (header-checked, ≤ 32 MB), with title, author, tagline, description, tags, licence + licence URL, source URL and a rights note; delete a cartridge (row **and** the stored ROM and cover); unpublish/republish; edit a description |
| **Site copy** | rewrite the Retro Arcade heading and intro, and the Library heading |

Uploads are gated by the same licence rule the importer uses: an SPDX id that does not permit
redistribution (NC, ND, unknown) is refused in the form *and* cannot be published afterwards. No
commercial ROMs — Pokémon, Mario, Contra or anything else all-rights-reserved — belong on this
shelf; players can still run their own dumps through “your own cartridge”, where the file never
leaves their browser.

Every action appends to `admin_audit`, with the actor filled in by the database (`default auth.uid()`
— the client cannot choose it).

### Revoking access

```sql
delete from public.admin_users where user_id = (select id from auth.users where lower(email) = 'you@example.com');
```

The next request that calls `public.is_admin()` answers `false`, and `/admin` goes dark for that
session. Revoke the storage policies' effect the same way — there is exactly one place that decides.
