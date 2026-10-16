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
