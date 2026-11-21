-- 0007_admin_activity.sql
-- An audit trail for the desk, and a roster the owner can read.
--
-- Two things were missing from the admin layer that 0004_admin.sql built:
--
--   1. **A record of what was changed, and by whom.** `retro_games` has an
--      `updated_at`, which tells you a row moved, not who moved it or what it
--      used to say. Replacing a cartridge file and quietly reverting a site copy
--      paragraph are exactly the changes an owner wants to be able to look up a
--      week later.
--   2. **A way to see who is on the roster** without opening the SQL editor. The
--      roster itself must stay unwritable from the browser (0004 revoked all), so
--      this file exposes a *read* through a security-definer function that asks
--      `is_admin()` first.
--
-- Everything here is enforced by Postgres. The dashboard is a reader.

/* ------------------------------------------------------------- activity log */

create table if not exists public.admin_activity (
  id bigserial primary key,
  /* Who. `on delete set null` keeps the log readable after an account is removed:
     the note still says what happened, it just stops naming a person. */
  actor uuid references auth.users (id) on delete set null,
  actor_name text not null default '',
  /* What. Short verbs: 'listing.create', 'listing.publish', 'listing.delete',
     'file.replace', 'copy.update', 'user.role', 'site.publish'. Kept as text
     rather than an enum so adding one needs no migration. */
  action text not null,
  /* Which row, in which table. Both nullable: some actions are site-wide. */
  subject_table text,
  subject_id text,
  /* A short human summary, and the diff it summarises. The diff is JSON rather
     than a copy of the row, because the point is "what changed", not "restore". */
  summary text not null default '',
  detail jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);

create index if not exists admin_activity_at_idx on public.admin_activity (at desc);
create index if not exists admin_activity_actor_idx on public.admin_activity (actor, at desc);

alter table public.admin_activity enable row level security;
revoke all on public.admin_activity from anon, authenticated;

-- Reads: an admin may read the whole log. Nobody may write it through the API —
-- the trigger below is the only author, which is what makes it trustworthy.
drop policy if exists "admins read the activity log" on public.admin_activity;
create policy "admins read the activity log"
  on public.admin_activity for select
  to authenticated
  using (public.is_admin());

grant select on public.admin_activity to authenticated;

/* ------------------------------------------------------------- auto-recording

   A trigger on the tables the desk actually writes. Doing it here rather than in
   the browser means a change made with curl, the SQL editor, or a future admin
   page somebody forgets to instrument still lands in the log. `auth.uid()` is
   null for the SQL editor, which is recorded as an empty actor — honest, and the
   summary still says what happened. */

create or replace function public.note_admin_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  who uuid := auth.uid();
  who_name text := '';
  verb text;
  row_id text;
  changes jsonb := '{}'::jsonb;
begin
  begin
    select coalesce(raw_user_meta_data->>'display_name', raw_user_meta_data->>'username', email, '')
      into who_name from auth.users where id = who;
  exception when others then
    who_name := '';
  end;

  if tg_op = 'INSERT' then
    verb := tg_table_name || '.create';
    row_id := coalesce((to_jsonb(new)->>'id'), '');
    changes := jsonb_build_object('after', to_jsonb(new) - 'description');
  elsif tg_op = 'UPDATE' then
    verb := tg_table_name || '.update';
    row_id := coalesce((to_jsonb(new)->>'id'), '');
    /* Only the keys that actually moved, and never a whole description body. */
    select coalesce(jsonb_object_agg(k, jsonb_build_object('from', o.v, 'to', n.v)), '{}'::jsonb)
      into changes
      from jsonb_each(to_jsonb(old) - 'description') o(k, v)
      join jsonb_each(to_jsonb(new) - 'description') n(k, v) using (k)
     where o.v is distinct from n.v;
    if changes = '{}'::jsonb then
      return new;
    end if;
  else
    verb := tg_table_name || '.delete';
    row_id := coalesce((to_jsonb(old)->>'id'), '');
    changes := jsonb_build_object('before', to_jsonb(old) - 'description');
  end if;

  insert into public.admin_activity (actor, actor_name, action, subject_table, subject_id, summary, detail)
  values (who, who_name, verb, tg_table_name, row_id, verb, changes);
  return coalesce(new, old);
end;
$$;

revoke execute on function public.note_admin_change() from anon, authenticated;

drop trigger if exists retro_games_activity on public.retro_games;
create trigger retro_games_activity
  after insert or update or delete on public.retro_games
  for each row execute function public.note_admin_change();

/* Site copy lives in `site_content` (0004), DOS listings in whichever table 0006
   created — guarded, so this migration is safe to run on a project that has not
   applied one of them. */
do $$
begin
  if to_regclass('public.site_content') is not null then
    drop trigger if exists site_copy_activity on public.site_content;
    create trigger site_copy_activity
      after insert or update or delete on public.site_content
      for each row execute function public.note_admin_change();
  end if;
  /* DOS listings are rows of `retro_games` with platform = 'dos' (0006), so the
     trigger above already covers them. */
end $$;

/* ------------------------------------------------------------- roster read

   `admin_users` is revoked from the API entirely. This function is the one
   sanctioned way to list it, and it refuses anyone who is not already on it. */

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

/* Removing an admin is an owner action too — never from the browser. Documented
   here so the roster has one obvious way to shrink:
     delete from public.admin_users where user_id = '<uuid>';  */
