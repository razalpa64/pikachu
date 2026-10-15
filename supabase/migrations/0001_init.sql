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
