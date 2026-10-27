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
