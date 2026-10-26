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
   [`0004_admin.sql`](migrations/0004_admin.sql) →
   [`0005_friends_and_safety.sql`](migrations/0005_friends_and_safety.sql). Each one is idempotent
   (`create … if not exists`, `drop policy if exists`), so re-running the whole set is safe.
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
| `friendships` | one row per relationship, pending or accepted | the two people in it |
| `blocks` | one row per block, with an optional private reason | **only the blocker** |
| `reports` | a private note about another player | insert-only for the reporter; readable by admins |

Row Level Security is enabled on every table, and `match_results` deliberately has **no update or
delete policy** — a results log you can edit is not a results log.

## Friends, blocks and reports (`0005`)

Random opponents need no account. A friend list does, because a friend is a person on another
device — so `0005` adds the three tables that make "play with them again" mean something, plus the
two functions that keep other people's profiles closed.

### Handles

`profiles.handle` is the only thing another player may look for: lowercase, 3–20 characters,
case-insensitively unique, and **optional**. The sign-up trigger fills it from the username if that
handle is free and leaves it empty if it is not — it never invents `ash2`, because a handle nobody
chose is a handle nobody will remember. A player who ends up without one picks it on Play Together.

`public.find_player(handle)` is an **exact** match. There is no prefix search anywhere in the schema
on purpose: a directory you can page through is a directory that can be scraped, and the whole
point of a handle is that you only find somebody who told you theirs. It also excludes yourself and
anyone on either side of a block.

### Friendships

One row per pair, pending or accepted, with `least/greatest` in a unique index so the same two
people cannot each send a request and end up with two rows. The rules are policies, not client
code:

* **insert** — only as yourself (`requester = auth.uid()`), only `pending`, only if
  `blocked_pair()` is false. `status` is not even an insertable column, so a request cannot be born
  accepted.
* **update** — only by the addressee, only from `pending`, only to `accepted`. That is the single
  transition that exists.
* **delete** — either side. Declining *is* deleting, which is why a rejection is never announced:
  the asker's list simply stops showing the request.

`public.my_friends()` resolves the list to names for the caller only. It is a function rather than a
policy on `profiles` because the honest question is "which strangers may read my profile?" and the
answer is "the ones I accepted" — expressing that as a policy on a self-only table would mean
opening the whole table to anybody with a session.

### Blocks

`blocks` is readable **only by the blocker**. That asymmetry is the feature: "did they block me?" is
not a question the browser can answer, which is what makes blocking safe to use. Inserting one
triggers `blocks_prune_relationships`, which deletes any friendship or pending request between the
two in either direction — in the database, so a client that only removed the friendship cannot leave
the block half-applied.

`public.blocked_pair(a, b)` is `security definer` because each side can only see their own half of
the relationship, and a block has to count whichever way round it points. The relay asks the same
question, but it cannot read the database (it has no service key), so each signed-in client sends
its **own** block list on `hello` and the relay applies it in both directions. A modified client can
only weaken its own protections.

### Reports

`reports` is separate from `feedback` on purpose: a report names another player, and the feedback
wall's published columns are readable by anybody. The reporter column is `default auth.uid()` and is
**not** insertable, so a report cannot be filed in somebody else's name; `reporter` is also not
readable by the reporter, because there is nothing useful to do with your own report history and
every column you can read is a column that can leak. Admins read and triage them at `/admin` (or in
the SQL editor), and `reports_rate_limit` caps five per account per hour and 120 per ten minutes
across the site.

A report about a guest — no account to point at — still has to name somebody
(`reports_have_a_subject`), because "somebody was mean" is not actionable.

### What the relay needs

The relay verifies a Supabase access token on `hello`, using the **same two environment variables
the web build already needs**:

```
SUPABASE_URL=https://<project>.supabase.co        # or VITE_SUPABASE_URL
SUPABASE_ANON_KEY=sb_publishable_…                # or VITE_SUPABASE_PUBLISHABLE_KEY
```

It calls `GET /auth/v1/user` with that token and caches the answer for five minutes (or until the
token expires). No service key, no database access, and nothing at all about the games lives there.
If the variables are absent — or the auth service is unreachable — the relay treats the connection as
a guest rather than guessing: an *unreachable* auth server makes it refuse the handshake with
`auth_unavailable` instead of silently downgrading a signed-in player, because a guest is outside
every block list.

### Moderation

```sql
-- everything open, newest first
select created_at, category, reported_name, reported_handle, room_code, message, context
  from public.reports where status = 'open' order by created_at desc;

update public.reports set status = 'reviewed' where id = 42;

-- who is blocked by whom, and how often (blocks are private to the blocker in the
-- browser, but a maintainer can see rows in the table editor)
select blocker, count(*) from public.blocks group by blocker order by 2 desc limit 20;
```

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

`npm test` includes `src/lib/__tests__/supabase-schema.test.ts`, which runs all five migration files
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
