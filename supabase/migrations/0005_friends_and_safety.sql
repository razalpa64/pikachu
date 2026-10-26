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
