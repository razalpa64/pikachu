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
