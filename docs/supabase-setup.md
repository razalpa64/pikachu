# Supabase setup, A to Z

Every click and every paste needed to take Pikachu from "no database" to "signed in,
owner account working, uploads landing in storage". Follow it in order — later steps
depend on earlier ones, and the order is the part that goes wrong.

**What you need:** a Supabase account, this repo on your machine, and a terminal.
**Time:** about 15 minutes, most of it waiting.

There are eleven parts. If you only have time for four, do **0, 2, 4, 5** — that is
the difference between "works" and "nothing works".

---

## Part 0 — Rotate the two credentials that were pasted into a chat

Do this first. Both were exposed and are therefore compromised regardless of who
saw them.

### 0.1 The secret key

1. Supabase dashboard → your project → **Project Settings** (gear, bottom left) →
   **API Keys**.
2. Find the key whose name starts `sb_secret_` — it may be labelled *Secret key* or
   *service_role*.
3. Press **Rotate** / **Revoke and create new**.
4. Copy the **new** one somewhere safe for Part 7. It is shown until you refresh the
   page, then only once more.

The **old** secret key stops working the moment you rotate. That is the point: it
bypasses every Row Level Security policy in this project, so every minute it lives
is a minute the whole database is open to anyone who has it.

### 0.2 The database password

1. **Project Settings** → **Database** → **Database password**.
2. **Reset database password** → generate one in a password manager, or let Supabase
   generate it.
3. **Update any connection string** you have saved — `postgresql://postgres:…@db.<ref>.supabase.co:5432/postgres`
   will now need the new password. Your deployed app does not use this string;
   only `psql`/DBeaver/Prisma do, so nothing breaks if you skip it.

> **Never put either of these in `.env.local`.** `VITE_` variables are compiled into
> the JavaScript bundle, so a secret there ships to every visitor. The app actively
> refuses to start with one — that guard is in `src/lib/supabase.ts` and has tests.

---

## Part 1 — Identify which project is yours

You said you have many and are not sure which is which. Answer it before anything else.

1. Open **https://supabase.com/dashboard/projects**.
2. Each card shows a **name** and, under it, a **project ref** — a 20-character
   string like `wtbjsthpxopzwbcnnfmu`.
3. Find the card whose ref is `wtbjsthpxopzwbcnnfmu`.

**Three outcomes:**

| what you see | what it means | what to do |
|---|---|---|
| The card is there | That is your project. Nothing to switch | Continue to Part 2 |
| Not in the list | Wrong Supabase **account or organisation**. Check the avatar, top right → switch org | Look again in the other orgs |
| Not there in any org | The project was deleted, or that URL was never yours | Create a new one: **New project**, region **Mumbai (ap-south-1)**. Then use its ref everywhere below |

Write the ref down. It appears in Part 4 and Part 5, and `--project` in Part 6 checks
that the app agrees with you.

---

## Part 2 — Create the schema (one paste)

The repo ships **`supabase/all.sql`**: all seven migrations, in order, in a single
transaction. It applies completely or not at all — so a failure cannot leave you with
half a database, which is the failure mode that looks like a code bug.

### 2.1 Get the file

**https://raw.githubusercontent.com/razalpa64/pikachu/main/supabase/all.sql**

Open it, `Ctrl+A`, `Ctrl+C`. It is about 1,300 lines; that is normal.

*(If you have the repo locally, `supabase/all.sql` is the same file — open it in your
editor instead. Do not retype any of it.)*

### 2.2 Paste and run

1. Supabase dashboard → **SQL Editor** (left sidebar, the `>_` icon).
2. **+ New query**.
3. Click into the editor, `Ctrl+V`, then **Run** (or `Ctrl+Enter`).
4. Wait. A few seconds. You want **"Success. No rows returned"**.

### 2.3 Verify — this is not optional

New query, paste, Run:

```sql
select table_name
  from information_schema.tables
 where table_schema = 'public'
 order by table_name;
```

You must get exactly these **12** rows:

```
admin_audit
admin_users
blocks
feedback
friendships
match_results
player_stats
profiles
reports
retro_games
room_messages
site_content
```

And this must return a **`t`** (true) for every row:

```sql
select relname, relrowsecurity
  from pg_class
 where relnamespace = 'public'::regnamespace and relkind = 'r'
 order by relname;
```

If `relrowsecurity` is `f` for anything, stop and tell me — it means a migration was
edited.

### 2.4 If it failed

Every statement is idempotent, so fixing and re-running the whole file is always safe.

| error you see | cause | fix |
|---|---|---|
| `relation "storage.buckets" does not exist` | Not a Supabase project (plain Postgres) | Use the Supabase dashboard, not a local Postgres |
| `permission denied for schema storage` | You are not the project owner | Re-run as `postgres` in the SQL editor |
| `extension "pgcrypto" is not available` | Very old project, rare | **Database → Extensions** → enable `pgcrypto` |
| `current transaction is aborted` | A statement failed earlier in the same Run | Read the **first** red line — the rest are noise. Fix that, re-run everything |

> The app also ships migrations individually in `supabase/migrations/` if you prefer to
> apply them one at a time. `all.sql` is generated from them and a test proves both
> produce an identical database, so there is no advantage to the seven-file route.

---

## Part 3 — Authentication settings

### 3.1 Turn off email confirmation (do this now)

1. **Authentication** → **Sign In / Providers**.
2. **Email** in the list → expand it.
3. **Confirm email** → **off** → **Save**.

Why: with it on, nobody can sign in until they click a link in an email. Supabase's
built-in mailer allows roughly **3 emails per hour**, so the second account you test
with silently gets nothing. This one toggle is the difference between "it works" and
an hour of "invalid login credentials".

### 3.2 Set the redirect URLs (the most-missed step)

1. **Authentication** → **URL Configuration**.
2. **Site URL:**

```
https://pikachu.invytra.in
```

3. **Redirect URLs** → **Add URL**, four times:

```
https://pikachu.invytra.in/**
http://localhost:5173/**
http://localhost:5173/account
https://pikachu.invytra.in/account
```

Without these, a password-recovery or sign-up link sends the browser to a URL Supabase
refuses, and the player lands on a blank page or the Supabase homepage — **with no
error shown anywhere**. This is the single most common "the recovery email doesn't
work" cause.

### 3.3 Minimum password length

**Authentication** → **Policies** (or **Settings**, depending on dashboard version) →
**Minimum password length** → **8**.

The sign-up form validates 8 characters too, so the two agree and nobody hits a
server-side rejection after filling the form.

### 3.4 Email delivery, before real users arrive

Testing works on the built-in mailer. Shipping does not — 3/hour is a hard limit and
it is shared per project.

When you are ready: **Authentication** → **SMTP Settings** → plug in Resend, SendGrid
or Postmark. Then **Authentication** → **Emails** → edit the *Confirm signup* and
*Reset password* templates so they say Pikachu rather than the default Supabase text.

You can skip this until after everything else works.

---

## Part 4 — Copy the two values the app needs

**Project Settings** → **API Keys** (on older projects: **Project Settings** → **API**).

### 4.1 Project URL

```
https://<your-project-ref>.supabase.co
```

### 4.2 Publishable key

One of these two, depending on project age:

- **New projects:** a key starting `sb_publishable_…`
- **Older projects:** the key labelled **anon** — a long `eyJ…` JWT (three
dot-separated parts)

Either works; the app accepts both.

> **This key is public by design.** It ships in your JavaScript bundle. That is safe
> because every table is behind Row Level Security — anonymous callers cannot read a
> profile, write a game, or touch the admin roster. Do not confuse it with the
> `sb_secret_` / `service_role` key, which is the opposite: full access, server-only.

---

## Part 5 — `.env.local`

### 5.1 Create the file

In the repo root — the folder containing `package.json` — create a file named exactly:

```
.env.local
```

The leading dot matters, and it must be next to `package.json`, not in `src/`.

### 5.2 Paste this, then fill in your two values

```dotenv
# ---- Required: accounts, cloud saves, the admin desk ----
VITE_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR-PUBLISHABLE-KEY

# ---- Realtime multiplayer ----
VITE_REALTIME_TRANSPORT=relay
VITE_RELAY_URL=
RELAY_PORT=8787

# ---- Ads: off ----
VITE_ADSENSE_CLIENT=
VITE_ADSENSE_SLOT_HOME=
VITE_ADSENSE_SLOT_LIBRARY=
VITE_ADSENSE_SLOT_FEEDBACK=
```

Using the ref and key from this conversation as an example:

```dotenv
VITE_SUPABASE_URL=https://wtbjsthpxopzwbcnnfmu.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_huTZRWuAl-H6RStUqyMi5A_yyzxWVVt
```

No quotes, no trailing slash, no trailing `]` — if you copy from a chat message the
closing bracket comes along; the app strips it, but clean it anyway.

### 5.3 Confirm the file is ignored by git

```bash
git check-ignore -v .env.local
```

You want a line saying `.gitignore:29:.env.local`. If it prints nothing, the file name
is wrong or it is in the wrong directory.

### 5.4 Start the dev server

```bash
npm install        # only if node_modules is missing
npm run dev
```

Open **http://localhost:5173/account**.

| what you see | meaning |
|---|---|
| "Sign in" / "Create account" tabs | **Working.** Continue |
| "This build has no Supabase project" | Env not read — see 5.5 |

### 5.5 If it says there is no project

`VITE_` variables are read **once, at build time**, not at runtime.

1. Was the file named `.env.local` (not `.env.local.txt`, not `env.local`)?
2. Is it in the same folder as `package.json`? Run `ls -la .env*` there; you should see it.
3. Restart `npm run dev` — Vite does not always pick up a new env file while running.
4. Check the variable names character by character: `VITE_SUPABASE_URL`, not
   `SUPABASE_URL`; not `NEXT_PUBLIC_SUPABASE_URL` (that prefix belongs to Next.js and
   is ignored by Vite).
5. Hard-reload the browser (`Ctrl+Shift+R`) to drop the cached bundle.

---

## Part 6 — Prove the app points at the project you think it does

```bash
npm run admin:doctor -- --project YOUR-PROJECT-REF
```

Expected:

```
  ok   VITE_SUPABASE_URL  —  https://your-ref.supabase.co
        project ref: your-ref   <- check this is the project you meant
  ok   publishable key  —  publishable
  ok   expected project  —  yes — your-ref
  ok   reach the project  —  auth health 200
  ok   public.is_admin()  —  installed (anonymous callers are not admins, correctly)
```

That `public.is_admin()` line is the real proof Part 2 landed. If it says *"missing — run
0004_admin.sql"*, the schema did not apply.

| line that fails | meaning |
|---|---|
| `reach the project` | URL wrong, project paused (free tier pauses after 7 days idle — restore in the dashboard), or no network |
| `expected project — you are pointed at X, not Y` | Stale env, or two env files; `.env.local` wins over `.env` |
| `public.is_admin() — missing` | Schema not applied; re-run Part 2 |
| `publishable key — secret` | You pasted the service key. Remove it immediately |

---

## Part 7 — Create the owner account

This is the account that opens `/admin`. **There is no separate admin login** — one
form for everyone, and the capability rides on a database row. The credential never
enters the repo or the bundle.

### 7.1 The command

Put the **new** service key (from Part 0.1) in front of the command, in your shell only:

```bash
SUPABASE_SERVICE_ROLE_KEY='paste-your-new-secret-key-here' \
ADMIN_EMAIL='you@example.com' \
  npm run admin:doctor -- --setup --password
```

It will:

1. Check the project is reachable and the schema is installed.
2. Create the account (or find it if it already exists).
3. Confirm its email — so it can sign in immediately despite Part 3.1.
4. Insert the `admin_users` row that `is_admin()` reads.
5. Prompt you for a password. Type one, or press Enter and it generates one and
   prints it once. **Write it down.**

Fully non-interactive alternative, which prints a generated password:

```bash
SUPABASE_SERVICE_ROLE_KEY='…' ADMIN_EMAIL='you@example.com' \
  npm run admin:doctor -- --setup --generate
```

Expected finish:

```
  ok   account you@example.com — exists · confirmed · id 2f1c…
  ok   on the roster  —  yes — /admin should open
```

### 7.2 Doing it by hand instead

If you would rather not run the script:

1. **Authentication** → **Users** → **Add user** → *Create new user*.
2. Email: your address. Password: something long. **Tick "Auto Confirm User"**.
3. Copy the **User UID** from the row that appears.
4. SQL Editor → paste, replacing the uuid:

```sql
insert into public.admin_users (user_id, note)
values ('paste-the-user-uid-here', 'owner')
on conflict (user_id) do nothing;
```

5. Confirm it took — this must return **1 row**:

```sql
select a.user_id, u.email, a.added_at
  from public.admin_users a
  join auth.users u on u.id = a.user_id;
```

Id, not email. An insert that matches no row reports success in the SQL editor and
changes nothing — which is how "signed in but not on the roster" becomes a mystery.

---

## Part 8 — Sign in and test it

### 8.1 Sign in

1. `npm run dev`
2. **http://localhost:5173/account**
3. **Sign in** tab → email + password → **Sign in**.
4. You should land back on the site, signed in.

### 8.2 Open the desk

Go to **http://localhost:5173/admin**.

| what you see | meaning |
|---|---|
| The dashboard | Working. Upload a cover, add a game, publish |
| "Sign in to continue" | Not signed in — this build's session is not active. Sign in at `/account` |
| "not on the roster" + SQL | Signed in, but the row from Part 7 is missing. The screen shows your id and the exact insert |
| "admin schema is not installed" | Part 2 was not applied to this project |

### 8.3 Prove the gate is real

The decision lives in Postgres, not in the JavaScript. Two checks:

**a)** In a **private window** (signed out), visit `/admin` — you must get "Sign in to
continue", with **no input fields on the page**.

**b)** With a *second, ordinary* account signed in, visit `/admin` — you must get the
refusal screen, not the dashboard.

### 8.4 Check the data is actually flowing

SQL Editor:

```sql
select id, display_name, handle, created_at from public.profiles order by created_at desc;
```

One row per account. If it is empty after signing in, the `handle_new_user` trigger
did not install — re-run Part 2.

---

## Part 9 — Deploying

`VITE_` values are compiled into the bundle. Changing them on the host without
rebuilding changes **nothing**, and that is the most common "I updated it and it still
doesn't work".

### 9.1 On Vercel / Netlify / Cloudflare Pages

1. Project → **Settings** → **Environment Variables**.
2. Add both, for **Production** (and Preview if you use it):

```
VITE_SUPABASE_URL              = https://your-ref.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY  = sb_publishable_…
```

3. **Redeploy** — a fresh build, not a restart.
4. After it deploys, open the site, `F12` → **Network** → filter `supabase.co`. Every
   request should name your project's ref. If it names a different one, the old bundle
   is still being served.

### 9.2 On a VPS with nginx

```bash
git pull
npm ci
npm run build          # this is the step that bakes in the env
sudo systemctl reload nginx   # or copy dist/ wherever your server root points
```

### 9.3 Before you tell anyone

- Part 3.4 (real SMTP) — otherwise password recovery does not work for real users.
- Part 3.2 (redirect URLs) — must include the production domain.
- Rotate the service key again if it ever appeared in a screenshot, chat, or commit.

---

## Part 10 — Troubleshooting, by symptom

| symptom | most likely cause | fix |
|---|---|---|
| "This build has no Supabase project" | Env not read at build time | Part 5.5 |
| Sign-up says "email not confirmed" | Confirm-email is on | Part 3.1 |
| "Invalid login credentials" on a correct password | Account does not exist (a different address was created), or wrong project | Part 6, then `npm run admin:doctor -- --users` |
| Password reset email never arrives | Built-in mailer rate limit, or wildcard redirect missing | Part 3.2, 3.4 |
| `/admin` says "not on the roster" | No `admin_users` row | Part 7.2 |
| `/admin` says "schema is not installed" | `is_admin()` missing | Part 2 |
| Signed in but nothing syncs | RLS is on and correct, but the row is not yours — check the id | `select auth.uid();` |
| Upload fails at 100% | Storage bucket missing, or file over the cap (GBA 32 MB, DOS 48 MB) | Part 2; check `select id, file_size_limit from storage.buckets;` |
| The site works but the desk 401s | Session expired | Sign out, sign in again |
| Everything worked yesterday, nothing today | Free project paused after 7 days idle | Dashboard → **Restore project** |

Handy SQL for any of the above:

```sql
-- who am I, as the database sees me
select auth.uid();

-- am I an admin, as the database sees it
select public.is_admin();

-- every account and whether it can open the desk
select u.email, u.email_confirmed_at, (a.user_id is not null) as is_admin
  from auth.users u
  left join public.admin_users a on a.user_id = u.id
 order by u.created_at desc;

-- what the desk has done, newest first
select at, action, target, actor from public.admin_audit order by at desc limit 20;

-- the shelf
select id, title, platform, status, bytes from public.retro_games order by created_at desc;
```

---

## Part 11 — Rules that keep this safe

1. **Never** put `sb_secret_…` or a `service_role` JWT in `.env.local`. The app refuses
   it, but do not rely on that — a future refactor could drop the guard.
2. **Never** commit `.env.local`. It is gitignored; verify with `git check-ignore .env.local`.
3. **The publishable key is public.** It is in your bundle. Protect the rows, not the key.
4. **Admin authority is a row**, not a password in code:
   `insert into public.admin_users (user_id) values ('…');`
   Removing someone is `delete from public.admin_users where user_id = '…';`
5. **Rotate** any credential that has been pasted into a chat, a screenshot, or a
   support ticket. Rotation is free; assume exposure is permanent.
6. **After changing a migration**, run `npm run supabase:bundle` and commit the
   regenerated `supabase/all.sql` — a test fails the build if you forget, and that test
   exists because a stale bundle silently gives people a partial database.

---

## Appendix — what Part 2 actually installed

| object | what it is |
|---|---|
| `profiles`, `match_results`, `player_stats` | per-player data, each readable only by its owner |
| `room_messages` | append-only chat mirror; not readable from the browser |
| `feedback` | public wall; column grants stop the browser reading contact or device id |
| `admin_users` | **the** admin roster. No API access at all |
| `retro_games` | the uploaded shelf — GBA and DOS, with platform-aware paths and size caps |
| `site_content` | editable copy on public pages |
| `admin_audit` | every admin write, plus a trigger that records writes the app never reported |
| `blocks`, `friendships`, `reports` | friends list, blocking, and reporting |
| `retro` bucket | public reads, admin-only writes, 32 MB per object |
| `is_admin()`, `handle_new_user()`, `my_friends()`, `find_player()`, `list_admins()`, `note_admin_change()`, `feedback_rate_limit()`, `reports_rate_limit()`, `blocked_pair()` | 9 functions, each with a reason to exist in `supabase/README.md` |

All 12 tables have Row Level Security enabled. That is asserted by a test that runs
these exact SQL files against real Postgres, so it cannot be quietly turned off.
