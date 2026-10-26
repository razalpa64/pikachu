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
