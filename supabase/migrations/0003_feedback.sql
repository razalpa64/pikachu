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
