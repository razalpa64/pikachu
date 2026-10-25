/**
 * The words the site ships with.
 *
 * These exist in one place because two things need them: the pages themselves
 * (as the fallback when nobody has overridden them) and the admin copy desk (as
 * the placeholder that tells a maintainer what they are about to replace). If
 * they lived twice, an edit would silently drift from what a blank field means.
 *
 * No imports here on purpose — `content.ts` and `admin.ts` both read this file,
 * and a cycle between those two would be worse than a few constants.
 */
export const RETRO_HEADING = 'Retro';
export const RETRO_LEDE =
  'A shelf of real Game Boy Advance cartridges, running on the original hardware timings inside your browser. Every title here is freely redistributable homebrew — nothing commercial, nothing borrowed from a ROM site — and the emulator is only downloaded the moment you insert a cartridge.';
export const LIBRARY_HEADING = 'Game Library';
