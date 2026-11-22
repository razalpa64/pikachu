-- PIKACHU — full schema, one paste
--
-- Generated from supabase/migrations by `npm run supabase:bundle`. Do not edit by hand.
--
-- Run the whole thing once in the Supabase SQL editor (project -> SQL Editor ->
-- New query -> paste -> Run). It is wrapped in a single transaction, so it either
-- applies completely or not at all. It is also idempotent: running it again on a
-- project that already has the schema changes nothing.
--
-- Files included, in order:
--   0001_init.sql
--   0002_accounts_and_chat.sql
--   0003_feedback.sql
--   0004_admin.sql
--   0005_friends_and_safety.sql
--   0006_dos.sql
--   0007_admin_activity.sql
--
-- What this does NOT do: create an admin, or create a user. Authority is a row in
-- public.admin_users, provisioned after sign-up with
--   npm run admin:doctor -- --setup --password
-- so no credential ever lives in this file or the git history.

begin;

-- ============================================================ 0001_init.sql
-- PIKACHU — initial schema
--
-- Run this in the Supabase SQL editor (or `supabase db push`) BEFORE enabling cloud sync.
-- Everything here is private per-user data, so every table has Row Level Security on and
-- policies that only ever match `auth.uid()`. The browser only ever holds the anon key;
-- the service-role key must never appear in client code.

-- ---------------------------------------------------------------- profiles
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text        not null default 'Trainer' check (char_length(display_name) between 1 and 40),
  mascot       text        not null default 'classic' check (mascot in ('classic','cheer','cool','vector','side')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.profiles is 'One row per signed-in player. Readable only by its owner.';

alter table public.profiles enable row level security;

drop policy if exists "profiles are self-readable" on public.profiles;
create policy "profiles are self-readable"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "profiles are self-writable" on public.profiles;
create policy "profiles are self-writable"
  on public.profiles for insert
  with check (auth.uid() = id);

drop policy if exists "profiles are self-updatable" on public.profiles;
create policy "profiles are self-updatable"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- ---------------------------------------------------------------- match results
create table if not exists public.match_results (
  id          bigint generated always as identity primary key,
  user_id     uuid        not null references auth.users (id) on delete cascade,
  game_id     text        not null check (char_length(game_id) between 1 and 40),
  mode        text        not null check (mode in ('solo','ai','online','local','coop')),
  result      text        not null check (result in ('win','loss','draw')),
  score       integer,
  metadata    jsonb       not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

comment on table public.match_results is 'Append-only log of finished matches, mirrored from the device.';

create index if not exists match_results_user_created_idx on public.match_results (user_id, created_at desc);
create index if not exists match_results_user_game_idx    on public.match_results (user_id, game_id);

alter table public.match_results enable row level security;

drop policy if exists "match results are self-readable" on public.match_results;
create policy "match results are self-readable"
  on public.match_results for select
  using (auth.uid() = user_id);

drop policy if exists "match results are self-insertable" on public.match_results;
create policy "match results are self-insertable"
  on public.match_results for insert
  with check (auth.uid() = user_id);

-- Deliberately no update/delete policy: results are a history, not a scoreboard you can edit.

-- ---------------------------------------------------------------- per-game stats
create table if not exists public.player_stats (
  user_id        uuid        not null references auth.users (id) on delete cascade,
  game_id        text        not null,
  matches_played integer     not null default 0 check (matches_played >= 0),
  wins           integer     not null default 0 check (wins   >= 0),
  losses         integer     not null default 0 check (losses >= 0),
  draws          integer     not null default 0 check (draws  >= 0),
  best_score     integer     not null default 0,
  updated_at     timestamptz not null default now(),
  primary key (user_id, game_id)
);

comment on table public.player_stats is 'Rolled-up totals per game; upserted on (user_id, game_id).';

alter table public.player_stats enable row level security;

drop policy if exists "stats are self-readable" on public.player_stats;
create policy "stats are self-readable"
  on public.player_stats for select
  using (auth.uid() = user_id);

drop policy if exists "stats are self-writable" on public.player_stats;
create policy "stats are self-writable"
  on public.player_stats for insert
  with check (auth.uid() = user_id);

drop policy if exists "stats are self-updatable" on public.player_stats;
create policy "stats are self-updatable"
  on public.player_stats for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------- housekeeping
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists player_stats_touch on public.player_stats;
create trigger player_stats_touch before update on public.player_stats
  for each row execute function public.touch_updated_at();

-- Create the profile row automatically the first time someone signs in.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', 'Trainer'))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================ 0002_accounts_and_chat.sql
-- 0002_accounts_and_chat.sql
-- Updates profile trigger to support username + password and adds room chat logs.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'display_name',
      new.raw_user_meta_data ->> 'username',
      split_part(coalesce(new.email, 'Trainer'), '@', 1)
    )
  )
  on conflict (id) do update
    set display_name = excluded.display_name
    where public.profiles.display_name = 'Trainer';
  return new;
end;
$$;

-- Optional cloud chat log table
create table if not exists public.room_messages (
  id bigint generated always as identity primary key,
  room_code text not null check (char_length(room_code) between 1 and 10),
  sender_id text not null,
  sender_name text not null,
  message text not null check (char_length(message) between 1 and 300),
  created_at timestamptz not null default now()
);

create index if not exists room_messages_code_idx on public.room_messages (room_code, created_at desc);

alter table public.room_messages enable row level security;

drop policy if exists "room messages are readable" on public.room_messages;
create policy "room messages are readable"
  on public.room_messages for select
  using (true);

drop policy if exists "room messages are insertable" on public.room_messages;
create policy "room messages are insertable"
  on public.room_messages for insert
  with check (true);

-- ============================================================ 0003_feedback.sql
-- 0003_feedback.sql
--
-- A public feedback box: reviews, game ideas, improvements and bug reports.
--
-- Two things make this different from the other tables, and both are on purpose:
--
--   * it is **write-only for the browser and readable only where it says so**. The
--     anon key is public by definition, so the table can never be "insert anything,
--     read anything". Column-level privileges mean a client can add a note and read
--     the published wall, and can never read the contact field or the device id of
--     anyone else — RLS alone would not stop that, because RLS filters rows, not
--     columns.
--   * it is **rate limited in the database**, not in the browser. `feedback_rate_limit`
--     is a SECURITY DEFINER trigger, so it can count rows the inserting role cannot
--     read. Without it, the anon key would be an open invitation to fill the table.
--
-- Moderation is deliberately dashboard-only: there is no update or delete policy, so
-- nothing short of the service role (i.e. the SQL editor) can hide a note or edit one.
--
--   update public.feedback set status = 'hidden' where id = 123;

create table if not exists public.feedback (
  id           bigint generated always as identity primary key,
  created_at   timestamptz not null default now(),
  kind         text        not null check (kind in ('review', 'game', 'improvement', 'bug')),
  rating       smallint    check (rating is null or rating between 1 and 5),
  message      text        not null check (char_length(btrim(message)) between 8 and 1200),
  game_id      text        check (game_id is null or char_length(game_id) between 1 and 40),
  display_name text        not null default 'A player' check (char_length(display_name) between 1 and 40),
  contact      text        check (contact is null or char_length(contact) between 3 and 120),
  device_id    text        not null check (char_length(device_id) between 6 and 64),
  user_id      uuid        references auth.users (id) on delete set null,
  status       text        not null default 'published' check (status in ('published', 'hidden')),

  -- a review without a rating is not a review; a game idea with a rating is nonsense
  constraint feedback_review_needs_rating check (kind <> 'review' or rating is not null),
  constraint feedback_only_reviews_rated  check (kind =  'review' or rating is null)
);

comment on table  public.feedback is 'Public feedback box: reviews, game ideas, improvements, bug reports.';
comment on column public.feedback.status is 'published = visible on the site; hidden = kept, not shown. Change it in the SQL editor.';
comment on column public.feedback.device_id is 'Random per-browser id, used only for the hourly rate limit. Never exposed to readers.';
comment on column public.feedback.contact is 'Optional way to reach the author of the note. Never exposed to readers.';

create index if not exists feedback_wall_idx    on public.feedback (kind, created_at desc) where status = 'published';
create index if not exists feedback_device_idx  on public.feedback (device_id, created_at desc);
create index if not exists feedback_created_idx on public.feedback (created_at desc);

-- ------------------------------------------------------------------ privileges
-- Start from nothing, then hand out exactly two abilities.
revoke all on public.feedback from anon, authenticated;

grant insert (kind, rating, message, game_id, display_name, contact, device_id, user_id)
  on public.feedback to anon, authenticated;

-- Note the missing `status`, `contact`, `device_id` and `user_id`: they are not
-- readable by the browser at all, so the wall can never leak them.
grant select (id, created_at, kind, rating, message, game_id, display_name)
  on public.feedback to anon, authenticated;

-- The identity column needs its sequence to be usable by the inserting role. This is
-- normally inherited from Supabase's default privileges; doing it explicitly means the
-- migration also works on a plain Postgres instance where the table is created by a
-- different role than the one the API connects as.
do $$
begin
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public' and c.relname = 'feedback_id_seq' and c.relkind = 'S') then
    execute 'grant usage on sequence public.feedback_id_seq to anon, authenticated';
  end if;
end $$;

-- ------------------------------------------------------------------ RLS
alter table public.feedback enable row level security;

drop policy if exists "anyone may leave a note" on public.feedback;
create policy "anyone may leave a note"
  on public.feedback for insert
  to anon, authenticated
  with check (
    status = 'published'                     -- nobody can insert a pre-hidden row…
    and (user_id is null or user_id = auth.uid())  -- …or claim somebody else's account
  );

drop policy if exists "published notes are readable" on public.feedback;
create policy "published notes are readable"
  on public.feedback for select
  to anon, authenticated
  using (status = 'published');

-- No update/delete policy anywhere: a note is a letter, not a wiki page.

-- ------------------------------------------------------------------ rate limit
create or replace function public.feedback_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  per_device int;
  everybody  int;
begin
  select count(*) into per_device
    from public.feedback
   where device_id = new.device_id
     and created_at > now() - interval '1 hour';

  if per_device >= 5 then
    raise exception 'Too many notes from this device in the last hour. Please try again later.'
      using errcode = 'check_violation';
  end if;

  -- a flood guard that does not depend on anyone's device id being honest
  select count(*) into everybody
    from public.feedback
   where created_at > now() - interval '10 minutes';

  if everybody >= 120 then
    raise exception 'The feedback box is busy right now. Please try again in a few minutes.'
      using errcode = 'check_violation';
  end if;

  -- normalise what we store, whatever the client sent
  new.message      := btrim(new.message);
  new.display_name := coalesce(nullif(btrim(new.display_name), ''), 'A player');
  new.contact      := nullif(btrim(coalesce(new.contact, '')), '');

  return new;
end;
$$;

drop trigger if exists feedback_rate_limit on public.feedback;
create trigger feedback_rate_limit
  before insert on public.feedback
  for each row execute function public.feedback_rate_limit();

-- ------------------------------------------------------------------ harden chat logs
-- 0002 shipped `using (true)` and `with check (true)` on room_messages, which on a
-- public anon key means: read every room's chat, and write anything you like into it.
-- The relay is authoritative for chat and this table is only a mirror, so the browser
-- needs to be able to append and nothing else.
drop policy if exists "room messages are readable"  on public.room_messages;
drop policy if exists "room messages are insertable" on public.room_messages;

revoke select on public.room_messages from anon, authenticated;

drop policy if exists "chat logs are append-only" on public.room_messages;
create policy "chat logs are append-only"
  on public.room_messages for insert
  to anon, authenticated
  with check (
    char_length(room_code)   between 1 and 10
    and char_length(sender_id) between 1 and 64
    and char_length(sender_name) between 1 and 40
    and char_length(message)  between 1 and 300
  );

-- Note for anyone changing this later: a client with no SELECT grant cannot use
-- `insert … returning`, because returning a row requires SELECT on it. `logRoomMessage()`
-- inserts blind, which is exactly what this policy is written for. If a future client
-- wants the row back, add a select policy scoped to the author — do not re-grant broad
-- select, which is what 0002 did.

comment on table public.room_messages is
  'Optional mirror of room chat. Append-only for the browser; read it in the SQL editor. Prune with: delete from public.room_messages where created_at < now() - interval ''30 days'';';

-- ============================================================ 0004_admin.sql
-- 0004_admin.sql
-- The admin layer: one allowlisted account, an uploaded-cartridge shelf, and
-- editable site copy. Everything here is enforced by Postgres. The browser only
-- *reflects* these rules; it never decides them.
--
-- Why there is no password in this file
-- -------------------------------------
-- This repository is public. A password written into a migration, a component,
-- or an .env example is published to the world the moment it is pushed, and
-- stays in the git history after it is "removed". So the admin account is an
-- ordinary Supabase auth user, created once in the dashboard or with the CLI
-- (see supabase/README.md), and *authority* is a row in `public.admin_users`
-- that only a project owner can write. Signing in with that account and
-- password is what unlocks /admin — the credential never enters the bundle.
--
-- Bootstrap, once, after creating the auth user. Either paste this, or run
-- `npm run admin:doctor -- --fix` with SUPABASE_SERVICE_ROLE_KEY set, which does
-- the same insert and also confirms the email:
--   insert into public.admin_users (user_id)
--   select id from auth.users where lower(email) = 'razalpa64@gmail.com'
--   on conflict do nothing;
--
-- Note the `select`: if the address is spelled differently, or the auth user was
-- never created, this inserts nothing and reports success. The doctor checks the
-- row actually exists, which is why "signed in but not on the roster" and "that
-- migration was never run" are two different screens in `/admin`.

/* ------------------------------------------------------------- admin roster */

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  note text not null default '',
  added_at timestamptz not null default now()
);

-- Nobody reads the roster from the browser, and nobody but the SQL editor (or a
-- service role) writes it. No policies at all == no access through the API.
alter table public.admin_users enable row level security;
revoke all on public.admin_users from anon, authenticated;

/**
 * The single source of truth for "is this caller an admin".
 *
 * `security definer` so it can read the roster regardless of RLS, `stable` so
 * Postgres can cache it inside one statement. Every policy below calls this,
 * which is why there is exactly one place to revoke somebody's authority.
 */
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admin_users a where a.user_id = auth.uid()
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

/* --------------------------------------------------- uploaded cartridges */

create table if not exists public.retro_games (
  id            text primary key check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(id) <= 48),
  title         text not null check (char_length(title) between 1 and 60),
  tagline       text not null default '' check (char_length(tagline) <= 80),
  description   text not null default '' check (char_length(description) <= 600),
  author        text not null default 'Unknown' check (char_length(author) <= 60),
  year          int check (year between 1990 and 2100),
  -- SPDX-ish id. The upload form refuses anything that is not redistributable,
  -- and this constraint stops a hand-written row from describing itself as
  -- "proprietary" while still being published.
  license       text not null check (char_length(license) between 1 and 40),
  license_url   text not null check (license_url ~ '^https://'),
  source_url    text not null check (source_url ~ '^https://'),
  accent        text not null default '#ffd24d' check (accent ~ '^#[0-9a-fA-F]{6}$'),
  tags          text[] not null default '{}',
  bytes         int not null check (bytes > 0 and bytes <= 33554432),
  -- Paths inside the `retro` storage bucket, set by the uploader.
  rom_path      text not null,
  cover_path    text not null,
  status        text not null default 'draft' check (status in ('draft', 'published')),
  -- The uploader's assertion that they may redistribute this build. Recorded
  -- because it is the one thing a licence field cannot prove.
  rights_note   text not null default '' check (char_length(rights_note) <= 400),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users (id) on delete set null,
  -- Pinned to the row's own folder: a row can never point the emulator at
  -- another game's object, or anywhere else in the bucket. Both paths are
  -- derived from the id, so this is an equality, not a pattern.
  constraint retro_games_rom_path check (rom_path = id || '/rom.gba'),
  constraint retro_games_cover_path check (cover_path = id || '/cover.png')
);

create index if not exists retro_games_status_idx on public.retro_games (status, created_at desc);

alter table public.retro_games enable row level security;

drop policy if exists "published cartridges are readable" on public.retro_games;
create policy "published cartridges are readable"
  on public.retro_games for select
  using (status = 'published' or public.is_admin());

drop policy if exists "admins write cartridges" on public.retro_games;
create policy "admins write cartridges"
  on public.retro_games for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists "admins update cartridges" on public.retro_games;
create policy "admins update cartridges"
  on public.retro_games for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "admins delete cartridges" on public.retro_games;
create policy "admins delete cartridges"
  on public.retro_games for delete
  to authenticated
  using (public.is_admin());

/* ------------------------------------------------------ editable site copy */

create table if not exists public.site_content (
  key         text primary key check (char_length(key) between 1 and 60),
  value       text not null check (char_length(value) <= 1200),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users (id) on delete set null
);

alter table public.site_content enable row level security;

drop policy if exists "site copy is readable" on public.site_content;
create policy "site copy is readable"
  on public.site_content for select
  using (true);

drop policy if exists "admins write site copy" on public.site_content;
create policy "admins write site copy"
  on public.site_content for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists "admins update site copy" on public.site_content;
create policy "admins update site copy"
  on public.site_content for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "admins delete site copy" on public.site_content;
create policy "admins delete site copy"
  on public.site_content for delete
  to authenticated
  using (public.is_admin());

/* --------------------------------------------------------------- audit log */

create table if not exists public.admin_audit (
  id        bigint generated always as identity primary key,
  -- Filled in by the database, not the client: whatever the browser sends, the
  -- log records the account that actually performed the write.
  actor     uuid references auth.users (id) on delete set null default auth.uid(),
  action    text not null check (char_length(action) between 1 and 40),
  target    text not null default '' check (char_length(target) <= 120),
  detail    text not null default '' check (char_length(detail) <= 600),
  at        timestamptz not null default now()
);

alter table public.admin_audit enable row level security;

drop policy if exists "admins read the audit log" on public.admin_audit;
create policy "admins read the audit log"
  on public.admin_audit for select
  to authenticated
  using (public.is_admin());

drop policy if exists "admins write the audit log" on public.admin_audit;
create policy "admins write the audit log"
  on public.admin_audit for insert
  to authenticated
  with check (public.is_admin());

/* --------------------------------------------------------------- storage */

/**
 * One public bucket for cartridge binaries and their covers. Public read is the
 * point: the shelf is public. Writes are admin-only, so the bucket cannot become
 * an anonymous file host, and `file_size_limit` keeps a 32 MB cartridge the
 * biggest object in it.
 */
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('retro', 'retro', true, 33554432, array['application/octet-stream', 'image/png'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "retro assets are public" on storage.objects;
create policy "retro assets are public"
  on storage.objects for select
  using (bucket_id = 'retro');

drop policy if exists "admins upload retro assets" on storage.objects;
create policy "admins upload retro assets"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'retro' and public.is_admin());

drop policy if exists "admins replace retro assets" on storage.objects;
create policy "admins replace retro assets"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'retro' and public.is_admin())
  with check (bucket_id = 'retro' and public.is_admin());

drop policy if exists "admins delete retro assets" on storage.objects;
create policy "admins delete retro assets"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'retro' and public.is_admin());

/* ------------------------------------------------------------ housekeeping */

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists retro_games_touch on public.retro_games;
create trigger retro_games_touch
  before update on public.retro_games
  for each row execute function public.touch_updated_at();

drop trigger if exists site_content_touch on public.site_content;
create trigger site_content_touch
  before update on public.site_content
  for each row execute function public.touch_updated_at();

-- ============================================================ 0005_friends_and_safety.sql
-- 0005_friends_and_safety.sql
--
-- The part of "play with people" that needs a durable identity: a friend list,
-- a block list, and a way to report somebody.
--
-- Why this could not be done with the browser-local playerId
-- ---------------------------------------------------------
-- Until now the relay trusted whatever `playerId` a socket claimed, and the app
-- stored one in localStorage. That is fine for a private room whose code you
-- had to be given, and it is useless for a friend list: clearing storage would
-- mint a new identity, "block" would be advice, and a harasser could come back
-- as somebody else. So friendships and blocks are keyed on `auth.users`, and the
-- relay verifies the access token before it believes who is connecting.
--
-- The three tables are deliberately shaped by what the *other* person can learn:
--
--   * friendships — both parties see the row. There is no "declined" state, so a
--     rejection leaves nothing behind for the requester to read. Accepting is
--     the only thing the addressee can do besides deleting the row.
--   * blocks — readable **only by the blocker**. The blocked person has no
--     policy that would match, so "did they block me?" cannot be answered from
--     the browser, which is the whole reason blocking is safe to use.
--   * reports — insert-only for the reporter, readable by admins alone. A report
--     names the other player, so it must not live in `feedback`, whose published
--     columns are readable by everybody.
--
-- Everything here is idempotent: `create … if not exists`, `drop … if exists`,
-- and functions created with `create or replace`.

/* ------------------------------------------------------------- handles */

/*
 * A shareable, human-typable name. The display name is cosmetic and can be
 * anything; the handle is how a friend finds you, so it is unique, lowercase and
 * restricted to characters that survive being read out loud.
 */
alter table public.profiles add column if not exists handle text;

alter table public.profiles drop constraint if exists profiles_handle_format;
alter table public.profiles add constraint profiles_handle_format
  check (handle is null or handle ~ '^[a-z0-9_]{3,20}$');

create unique index if not exists profiles_handle_key
  on public.profiles (lower(handle)) where handle is not null;

comment on column public.profiles.handle is
  'Public, unique, optional. The only thing other players may search for.';

/**
 * Fill in a handle from the username the account was created with, if that
 * handle is free. A collision leaves it null rather than inventing a suffix the
 * player never chose — they can pick one on /together.
 */
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  wanted text;
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'display_name',
      new.raw_user_meta_data ->> 'username',
      split_part(coalesce(new.email, 'Trainer'), '@', 1)
    )
  )
  on conflict (id) do update
    set display_name = excluded.display_name
    where public.profiles.display_name = 'Trainer';

  wanted := lower(regexp_replace(
    coalesce(new.raw_user_meta_data ->> 'username', ''),
    '[^a-zA-Z0-9_]', '', 'g'
  ));

  if char_length(wanted) between 3 and 20 then
    if not exists (select 1 from public.profiles p where lower(p.handle) = wanted) then
      update public.profiles set handle = wanted where id = new.id and handle is null;
    end if;
  end if;

  return new;
end;
$$;

/* --------------------------------------------------------------- blocks */

create table if not exists public.blocks (
  blocker    uuid        not null references auth.users (id) on delete cascade,
  blocked    uuid        not null references auth.users (id) on delete cascade,
  reason     text        not null default '' check (char_length(reason) <= 200),
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  constraint blocks_not_self check (blocker <> blocked)
);

comment on table public.blocks is
  'One row per block. Readable only by the blocker, so being blocked cannot be detected.';

create index if not exists blocks_blocked_idx on public.blocks (blocked);

alter table public.blocks enable row level security;
revoke all on public.blocks from anon, authenticated;
grant select (blocker, blocked, reason, created_at) on public.blocks to authenticated;
grant insert (blocker, blocked, reason) on public.blocks to authenticated;
grant delete on public.blocks to authenticated;

drop policy if exists "you see only your own blocks" on public.blocks;
create policy "you see only your own blocks"
  on public.blocks for select
  to authenticated
  using (blocker = auth.uid());

drop policy if exists "you block for yourself" on public.blocks;
create policy "you block for yourself"
  on public.blocks for insert
  to authenticated
  with check (blocker = auth.uid() and blocked <> auth.uid());

drop policy if exists "you unblock yourself" on public.blocks;
create policy "you unblock yourself"
  on public.blocks for delete
  to authenticated
  using (blocker = auth.uid());

/*
 * Called from both directions wherever "may these two play together" matters.
 * `security definer` because the caller can only see half of the relationship —
 * the row where *they* are the blocker — and a block has to count whichever way
 * round it points.
 */
create or replace function public.blocked_pair(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.blocks
     where (blocker = a and blocked = b)
        or (blocker = b and blocked = a)
  );
$$;

revoke all on function public.blocked_pair(uuid, uuid) from public;
grant execute on function public.blocked_pair(uuid, uuid) to authenticated;

/**
 * Blocking somebody ends any friendship or pending request between you, in
 * either direction. Done in the database so it cannot be forgotten by a client
 * that only removed the friendship.
 */
create or replace function public.blocks_prune_relationships()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.friendships f
   where (f.requester = new.blocker and f.addressee = new.blocked)
      or (f.requester = new.blocked and f.addressee = new.blocker);
  return new;
end;
$$;

/* ---------------------------------------------------------- friendships */

create table if not exists public.friendships (
  id           bigint      generated always as identity primary key,
  requester    uuid        not null references auth.users (id) on delete cascade,
  addressee    uuid        not null references auth.users (id) on delete cascade,
  status       text        not null default 'pending' check (status in ('pending', 'accepted')),
  created_at   timestamptz not null default now(),
  responded_at timestamptz,
  constraint friendships_not_self check (requester <> addressee)
);

comment on table public.friendships is
  'One row per relationship, pending or accepted. Declining deletes the row, so a rejection is not announced.';

/*
 * One row per pair no matter who asked: `least/greatest` makes (a,b) and (b,a)
 * the same key, which is what stops both people asking at once and ending up
 * with two conflicting rows.
 */
create unique index if not exists friendships_pair_key
  on public.friendships (least(requester, addressee), greatest(requester, addressee));

create index if not exists friendships_requester_idx on public.friendships (requester);
create index if not exists friendships_addressee_idx on public.friendships (addressee, status);

alter table public.friendships enable row level security;
revoke all on public.friendships from anon, authenticated;
grant select (id, requester, addressee, status, created_at, responded_at)
  on public.friendships to authenticated;
grant insert (requester, addressee) on public.friendships to authenticated;
grant update (status, responded_at) on public.friendships to authenticated;
grant delete on public.friendships to authenticated;

drop policy if exists "you see your own relationships" on public.friendships;
create policy "you see your own relationships"
  on public.friendships for select
  to authenticated
  using (auth.uid() in (requester, addressee));

drop policy if exists "you ask for yourself" on public.friendships;
create policy "you ask for yourself"
  on public.friendships for insert
  to authenticated
  with check (
    requester = auth.uid()
    and status = 'pending'
    and addressee <> auth.uid()
    -- a block in either direction stops the request from existing at all
    and not public.blocked_pair(auth.uid(), addressee)
  );

drop policy if exists "the person asked decides" on public.friendships;
create policy "the person asked decides"
  on public.friendships for update
  to authenticated
  using (addressee = auth.uid() and status = 'pending')
  with check (addressee = auth.uid() and status = 'accepted');

drop policy if exists "either side can end it" on public.friendships;
create policy "either side can end it"
  on public.friendships for delete
  to authenticated
  using (auth.uid() in (requester, addressee));

drop trigger if exists friendships_after_block on public.blocks;
create trigger friendships_after_block
  after insert on public.blocks
  for each row execute function public.blocks_prune_relationships();

/* -------------------------------------------------------------- reports */

create table if not exists public.reports (
  id              bigint      generated always as identity primary key,
  created_at      timestamptz not null default now(),
  -- Filled in by the database. The browser has no insert grant on this column,
  -- so a report cannot be filed in somebody else's name.
  reporter        uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  reported        uuid        references auth.users (id) on delete set null,
  reported_handle text        check (reported_handle is null or char_length(reported_handle) <= 20),
  reported_name   text        not null default '' check (char_length(reported_name) <= 40),
  room_code       text        check (room_code is null or char_length(room_code) between 1 and 10),
  game_id         text        check (game_id is null or char_length(game_id) between 1 and 40),
  category        text        not null check (category in ('harassment', 'cheating', 'spam', 'other')),
  message         text        not null check (char_length(btrim(message)) between 8 and 600),
  -- Whatever the client thought was relevant: slot numbers, the last few lines
  -- of chat. Capped so it cannot become file storage.
  context         jsonb       not null default '{}'::jsonb
                  check (pg_column_size(context) <= 4096),
  status          text        not null default 'open' check (status in ('open', 'reviewed', 'actioned')),

  -- A report about a signed-in player points at the account; one about a guest
  -- still has to name somebody, because "somebody was mean" is not actionable.
  constraint reports_have_a_subject
    check (reported is not null or char_length(btrim(reported_name)) between 1 and 40)
);

comment on table public.reports is
  'A report about another player. Insert-only for the reporter, readable by admins alone.';
comment on column public.reports.status is 'open = not looked at yet. Change it in the SQL editor or the admin desk.';

create index if not exists reports_status_idx on public.reports (status, created_at desc);
create index if not exists reports_reporter_idx on public.reports (reporter, created_at desc);

alter table public.reports enable row level security;
revoke all on public.reports from anon, authenticated;
grant insert (reported, reported_handle, reported_name, room_code, game_id, category, message, context)
  on public.reports to authenticated;

-- Reading and triage are granted so that the *policies* can decide: only
-- `public.is_admin()` matches, and a normal account sees no rows at all.
grant select (id, created_at, reporter, reported, reported_handle, reported_name,
              room_code, game_id, category, message, context, status)
  on public.reports to authenticated;
grant update (status) on public.reports to authenticated;

drop policy if exists "you may report, as yourself" on public.reports;
create policy "you may report, as yourself"
  on public.reports for insert
  to authenticated
  with check (reporter = auth.uid());

drop policy if exists "admins read reports" on public.reports;
create policy "admins read reports"
  on public.reports for select
  to authenticated
  using (public.is_admin());

drop policy if exists "admins triage reports" on public.reports;
create policy "admins triage reports"
  on public.reports for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

do $$
begin
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public' and c.relname = 'reports_id_seq' and c.relkind = 'S') then
    execute 'grant usage on sequence public.reports_id_seq to authenticated';
  end if;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public' and c.relname = 'friendships_id_seq' and c.relkind = 'S') then
    execute 'grant usage on sequence public.friendships_id_seq to authenticated';
  end if;
end $$;

/**
 * Reporting is rate limited in the database for the same reason the feedback
 * box is: the anon key is public, and the trigger can count rows the reporter
 * cannot read.
 */
create or replace function public.reports_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  mine    int;
  recent  int;
begin
  select count(*) into mine
    from public.reports
   where reporter = new.reporter
     and created_at > now() - interval '1 hour';

  if mine >= 5 then
    raise exception 'You have sent several reports in the last hour. Please wait before sending another.'
      using errcode = 'check_violation';
  end if;

  select count(*) into recent
    from public.reports
   where created_at > now() - interval '10 minutes';

  if recent >= 120 then
    raise exception 'Too many reports right now. Please try again shortly.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists reports_rate_limit on public.reports;
create trigger reports_rate_limit
  before insert on public.reports
  for each row execute function public.reports_rate_limit();

/* -------------------------------------------------------------- lookups */

/**
 * The friend list, resolved to names, for the caller only.
 *
 * Returns one row per relationship the caller is part of, with the *other*
 * person's handle and display name filled in. This is a function rather than a
 * policy on `profiles` because "which strangers may read my profile" must
 * answer "the ones I have accepted", and expressing that as a policy on a
 * self-only table would mean opening the whole table up to anybody with a
 * session.
 */
create or replace function public.my_friends()
returns table (
  friendship_id bigint,
  player_id     uuid,
  handle        text,
  display_name  text,
  mascot        text,
  status        text,
  direction     text,
  since         timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select f.id,
         other_id,
         p.handle,
         p.display_name,
         p.mascot,
         f.status,
         case
           when f.status = 'accepted' then 'mutual'
           when f.requester = auth.uid() then 'outgoing'
           else 'incoming'
         end,
         f.created_at
    from public.friendships f
    cross join lateral (
      select case when f.requester = auth.uid() then f.addressee else f.requester end as other_id
    ) o
    left join public.profiles p on p.id = o.other_id
   where auth.uid() is not null
     and auth.uid() in (f.requester, f.addressee)
     and not public.blocked_pair(auth.uid(), o.other_id)
   order by (f.status = 'pending' and f.addressee = auth.uid()) desc,
            f.status asc,
            coalesce(p.display_name, 'Trainer');
$$;

revoke all on function public.my_friends() from public;
grant execute on function public.my_friends() to authenticated;

/**
 * Find one player by their exact handle.
 *
 * Exact match, not a prefix search: a directory you can paginate is a directory
 * that can be scraped. You can only find somebody who told you their handle.
 * Anyone you have blocked — or who has blocked you — is not returned.
 */
create or replace function public.find_player(wanted text)
returns table (player_id uuid, handle text, display_name text, mascot text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.handle, p.display_name, p.mascot
    from public.profiles p
   where auth.uid() is not null
     and p.handle is not null
     and lower(p.handle) = lower(btrim(wanted))
     and p.id <> auth.uid()
     and not public.blocked_pair(auth.uid(), p.id)
   limit 1;
$$;

revoke all on function public.find_player(text) from public;
grant execute on function public.find_player(text) to authenticated;

-- ============================================================ 0006_dos.sql
-- 0006_dos.sql
-- A second platform on the same shelf.
--
-- 0004 built `public.retro_games` for Game Boy Advance cartridges, and pinned
-- every row's storage paths to `<id>/rom.gba` + `<id>/cover.png`. A DOS game is
-- not a cartridge: it is a `.jsdos` ZIP, and the row has to say so or the player
-- cannot tell which emulator to start.
--
-- Two changes, no new tables:
--
--   1. `platform` — 'gba' (the default, so every existing row is correct) or
--      'dos'. The public shelf filters on it, so a DOS entry can never be handed
--      to the GBA emulator or the other way round.
--   2. The path constraint becomes platform-aware. A DOS row's bundle is
--      `<id>/game.jsdos`; its cover is still the generated `<id>/cover.png`.
--
-- Why the path stays an equality rather than a pattern: a row must not be able to
-- aim the emulator at another game's object, or anywhere else in the bucket, even
-- if somebody writes it by hand in the SQL editor. `<id>/…` derived from the row's
-- own id is the whole guarantee.
--
-- Idempotent, like the rest of the set: run it again and nothing changes.

alter table public.retro_games
  add column if not exists platform text not null default 'gba';

/* Drop and re-add rather than trying to alter: a check constraint has no
   portable ALTER in Postgres, and `if exists` makes the drop safe. */
alter table public.retro_games drop constraint if exists retro_games_platform_check;
alter table public.retro_games
  add constraint retro_games_platform_check check (platform in ('gba', 'dos'));

alter table public.retro_games drop constraint if exists retro_games_rom_path;
alter table public.retro_games
  add constraint retro_games_rom_path check (
    (platform = 'gba' and rom_path = id || '/rom.gba')
    or (platform = 'dos' and rom_path = id || '/game.jsdos')
  );

alter table public.retro_games drop constraint if exists retro_games_cover_path;
alter table public.retro_games
  add constraint retro_games_cover_path check (cover_path = id || '/cover.png');

/* The browser validates a bundle before uploading it, but the size cap belongs in
   the schema too — and it is platform-aware, because a GBA cartridge has no
   business being larger than 32 MB (0004's rule, unchanged) while a DOS game is
   an installation, not a cartridge. */
alter table public.retro_games drop constraint if exists retro_games_bytes_check;
alter table public.retro_games
  add constraint retro_games_bytes_check check (
    (platform = 'gba' and bytes > 0 and bytes <= 33554432)
    or (platform = 'dos' and bytes > 0 and bytes <= 50331648)
  );

create index if not exists retro_games_platform_idx on public.retro_games (platform, status);

-- Nothing here widens a grant: `retro_games` policies from 0004 still gate every
-- write on `public.is_admin()`, and the storage bucket is still admin-only for
-- writes with public reads.
notify pgrst, 'reload schema';

-- ============================================================ 0007_admin_activity.sql
-- 0007_admin_activity.sql
-- The audit log learns what changed, and the roster becomes readable.
--
-- Correction to an earlier draft of this file: it created a *second* audit
-- table, `admin_activity`, alongside `admin_audit` from 0004. Two parallel logs
-- of the same thing is how a log stops being trustworthy — half the history in
-- each, and nobody able to answer "what happened" from one query. This file now
-- extends the table that already existed and that `src/lib/admin.ts` already
-- writes to.
--
-- Two additions:
--
--   1. **What changed.** `admin_audit` recorded `action` and `target` — enough to
--      know that a cartridge was edited, not what about it. Replacing a file and
--      quietly reverting a paragraph of site copy are exactly the changes an
--      owner wants to look up a week later, so `detail` gets a structured
--      companion (`changes`, jsonb, changed keys only).
--
--   2. **Recording happens in the database.** The app's own 7 `audit()` calls
--      cover everything the desk does today. The trigger below covers everything
--      else: a change made with curl, from the SQL editor, or by a future page
--      somebody forgets to instrument. A log that only knows about the paths
--      that remembered to log is not an audit.
--
-- And, separately, a roster read: `admin_users` is revoked from the API
-- entirely (0004), which is right, but it means the desk cannot show who else
-- can open it. `public.list_admins()` is the one sanctioned way to ask, and it
-- refuses anyone who is not already on it.
--
-- Everything here is enforced by Postgres. The dashboard is a reader.

/* ---------------------------------------------------- what changed, in jsonb */

alter table public.admin_audit
  add column if not exists changes jsonb not null default '{}'::jsonb;

comment on column public.admin_audit.changes is
  'Changed keys only, as {"field": {"from": …, "to": …}}. Never a whole description body.';

/* ------------------------------------------------------------- auto-recording

   One function, attached to the tables the desk actually writes. `auth.uid()` is
   null for the SQL editor, which is recorded as an empty actor — honest, and the
   action still says what happened. */

create or replace function public.note_admin_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  verb text;
  target_id text;
  diff jsonb := '{}'::jsonb;
begin
  if tg_op = 'INSERT' then
    verb := tg_table_name || '.create';
    target_id := coalesce(to_jsonb(new)->>'id', '');
    diff := jsonb_build_object('after', to_jsonb(new) - 'description');
  elsif tg_op = 'UPDATE' then
    verb := tg_table_name || '.update';
    target_id := coalesce(to_jsonb(new)->>'id', '');
    /* Only the keys that actually moved, and never a whole description body. */
    select coalesce(jsonb_object_agg(key_col, jsonb_build_object('from', o.v, 'to', n.v)), '{}'::jsonb)
      into diff
      from jsonb_each(to_jsonb(old) - 'description') o(key_col, v)
      join jsonb_each(to_jsonb(new) - 'description') n(key_col, v) using (key_col)
     where o.v is distinct from n.v;
    if diff = '{}'::jsonb then
      return new;   -- nothing moved; a timestamp bump is not an edit
    end if;
  else
    verb := tg_table_name || '.delete';
    target_id := coalesce(to_jsonb(old)->>'id', '');
    diff := jsonb_build_object('before', to_jsonb(old) - 'description');
  end if;

  /* `actor` defaults to auth.uid() in the table; this is the same value, written
     explicitly so the intent is visible here. */
  insert into public.admin_audit (actor, action, target, detail, changes)
  values (auth.uid(), verb, target_id, verb, diff);

  return coalesce(new, old);
end;
$$;

revoke execute on function public.note_admin_change() from anon, authenticated;

drop trigger if exists retro_games_activity on public.retro_games;
create trigger retro_games_activity
  after insert or update or delete on public.retro_games
  for each row execute function public.note_admin_change();

/* Site copy lives in `site_content` (0004); DOS listings are rows of
   `retro_games` with platform = 'dos' (0006), so the trigger above covers them.
   Guarded, so this is safe on a project that has not applied 0004. */
do $$
begin
  if to_regclass('public.site_content') is not null then
    drop trigger if exists site_copy_activity on public.site_content;
    create trigger site_copy_activity
      after insert or update or delete on public.site_content
      for each row execute function public.note_admin_change();
  end if;
end $$;

/* ------------------------------------------------------------- roster read

   `admin_users` has no policies at all in 0004, which is why nobody can read it
   from the browser. This function is the intended exception: security definer,
   and it checks membership before it returns a row. */

create or replace function public.list_admins()
returns table (user_id uuid, email text, display_name text, note text, added_at timestamptz, last_sign_in timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;
  return query
    select a.user_id, u.email::text,
           coalesce(u.raw_user_meta_data->>'display_name', u.raw_user_meta_data->>'username', '')::text,
           a.note, a.added_at, u.last_sign_in_at
      from public.admin_users a
      join auth.users u on u.id = a.user_id
     order by a.added_at;
end;
$$;

grant execute on function public.list_admins() to authenticated;

/* Removing an admin is an owner action too — never from the browser:
     delete from public.admin_users where user_id = '<uuid>';  */

-- ============================================================ done
--
-- Sanity check, after `commit` lands — this must return 12 rows:
--   select table_name from information_schema.tables
--    where table_schema = 'public' order by table_name;
commit;
