import { describe, expect, it } from 'vitest';

import { SITE_CONTENT_KEYS, retroRowToGame, slugify, validateUpload, type RetroRow, type UploadDraft } from '../admin';
import { LIBRARY_HEADING, RETRO_HEADING, RETRO_LEDE } from '../copy';
import { mergeLibraries, parseRetroLibrary, validateRetroGame, type RetroGame } from '../retro';

const draft = (overrides: Partial<UploadDraft> = {}): UploadDraft => ({
  title: 'Night Shift',
  tagline: 'Sweep the aisles before dawn.',
  description: 'A small puzzle game about closing up a supermarket.',
  author: 'Someone',
  year: 2024,
  license: 'MIT',
  licenseUrl: 'https://example.com/LICENSE',
  sourceUrl: 'https://example.com/night-shift',
  tags: ['puzzle'],
  bytes: 512 * 1024,
  rightsNote: 'MIT, built from the author’s own repository.',
  ...overrides,
});

describe('admin upload rules', () => {
  it('accepts a complete draft with a redistributable licence', () => {
    expect(validateUpload(draft())).toEqual([]);
  });

  it('refuses a licence this shelf cannot host', () => {
    for (const license of ['CC-BY-NC-4.0', 'NOASSERTION', 'proprietary', '']) {
      expect(validateUpload(draft({ license })).join(' ')).toMatch(/licence/i);
    }
  });

  it('refuses missing links, a silly size and a hostile title', () => {
    expect(validateUpload(draft({ licenseUrl: 'http://example.com/l' }))).toContain('The licence link has to be an https URL.');
    expect(validateUpload(draft({ sourceUrl: 'javascript:alert(1)' }))).toContain('The source link has to be an https URL.');
    expect(validateUpload(draft({ bytes: 40 * 1024 * 1024 }))[0]).toMatch(/32 MB/);
    expect(validateUpload(draft({ bytes: 0 }))[0]).toMatch(/32 MB/);
    expect(validateUpload(draft({ title: '' }))[0]).toMatch(/title/i);
  });

  it('refuses a slug that is already on the shelf', () => {
    expect(validateUpload(draft({ title: 'Night Shift' }), { takenIds: ['night-shift'] })[0]).toMatch(/already exists/i);
  });

  it('makes a safe id from any title', () => {
    expect(slugify('Night Shift')).toBe('night-shift');
    expect(slugify('Pokémon: Mystery Dungeon!')).toBe('pokemon-mystery-dungeon');
    expect(slugify('  ')).toBe('cartridge');
    expect(slugify('x'.repeat(80))).toHaveLength(48);
    expect(slugify('a/b\\c')).toBe('a-b-c');
  });
});

describe('an uploaded row becomes a shelf card', () => {
  const row: RetroRow = {
    id: 'night-shift',
    title: 'Night Shift',
    tagline: 'Sweep the aisles before dawn.',
    description: 'A small puzzle game.',
    author: 'Someone',
    year: 2024,
    license: 'MIT',
    license_url: 'https://example.com/LICENSE',
    source_url: 'https://example.com/night-shift',
    accent: '#ffd24d',
    tags: ['puzzle', 'arcade'],
    bytes: 512 * 1024,
    rom_path: 'night-shift/rom.gba',
    cover_path: 'night-shift/cover.png',
    status: 'published',
    rights_note: '',
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
  };
  const toUrl = (path: string) => `https://project.supabase.co/storage/v1/object/public/retro/${path}`;

  it('produces exactly what the shelf validator accepts', () => {
    const game = retroRowToGame(row, toUrl);
    expect(validateRetroGame(game, { remote: true })).toMatchObject({
      id: 'night-shift',
      rom: 'https://project.supabase.co/storage/v1/object/public/retro/night-shift/rom.gba',
      cover: 'https://project.supabase.co/storage/v1/object/public/retro/night-shift/cover.png',
      save: null,
    });
  });

  it('drops a row whose links are not https, rather than rendering a broken card', () => {
    const game = retroRowToGame({ ...row, source_url: 'http://example.com' }, toUrl);
    expect(validateRetroGame(game, { remote: true })).toBeNull();
  });
});

describe('the shelf merges uploaded cartridges', () => {
  const committed: RetroGame = {
    id: 'pong',
    title: 'Pong',
    tagline: '',
    year: 2023,
    author: 'ZeroDayArcade',
    license: 'MIT',
    licenseUrl: 'https://example.com/L',
    sourceUrl: 'https://example.com/S',
    description: '',
    rom: 'roms/pong.gba',
    cover: 'covers/pong.png',
    marquee: null,
    bytes: 8884,
    accent: '#5b7cff',
    tags: [],
    players: 2,
    save: false,
  };
  const base = parseRetroLibrary({ version: 1, games: [committed] });

  it('adds a remote cartridge alongside the committed ones, sorted by title', () => {
    const remote: RetroGame = {
      ...committed,
      id: 'night-shift',
      title: 'Aardvark',
      rom: 'https://project.supabase.co/storage/v1/object/public/retro/night-shift/rom.gba',
      cover: 'https://project.supabase.co/storage/v1/object/public/retro/night-shift/cover.png',
    };
    const merged = mergeLibraries(base, [remote]);
    expect(merged.games.map((g) => g.id)).toEqual(['night-shift', 'pong']);
  });

  it('never lets a remote row shadow a committed one or a bad row through', () => {
    const shadow = { ...committed, title: 'Impostor' };
    const broken = { ...committed, id: 'broken', rom: 'roms/../etc/passwd' } as unknown as RetroGame;
    const merged = mergeLibraries(base, [shadow, broken]);
    expect(merged.games).toHaveLength(1);
    expect(merged.games[0].title).toBe('Pong');
  });
});

describe('shelf assets', () => {
  it('accepts an uploaded absolute URL and still refuses a bad one', () => {
    const game = {
      id: 'night-shift',
      title: 'Night Shift',
      rom: 'https://project.supabase.co/storage/v1/object/public/retro/night-shift/rom.gba',
      cover: 'https://project.supabase.co/storage/v1/object/public/retro/night-shift/cover.png',
      licenseUrl: 'https://example.com/L',
      sourceUrl: 'https://example.com/S',
      accent: '#ffd24d',
      bytes: 1024,
    };
    expect(validateRetroGame(game, { remote: true })).not.toBeNull();
    expect(validateRetroGame({ ...game, rom: 'javascript:alert(1)' }, { remote: true })).toBeNull();
    expect(validateRetroGame({ ...game, rom: 'http://insecure.example/x.gba' }, { remote: true })).toBeNull();
    expect(validateRetroGame({ ...game, cover: '//cdn.example/x.png' }, { remote: true })).toBeNull();
    /* The committed manifest stays locked to its own folder. */
    expect(validateRetroGame(game)).toBeNull();
  });
});

describe('the copy desk', () => {
  it('offers only keys the site actually reads', () => {
    const keys = SITE_CONTENT_KEYS.map((k) => k.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(['retro.title', 'retro.lede', 'library.title']);
  });

  it('ships a real default for every key, so a blank field means something', () => {
    /* The desk prints the default as the placeholder: if it were empty, a
       maintainer would be editing a field with no idea what it replaces. */
    for (const entry of SITE_CONTENT_KEYS) {
      expect(entry.fallback.trim().length, entry.key).toBeGreaterThan(0);
    }
    expect(SITE_CONTENT_KEYS.find((k) => k.key === 'retro.title')?.fallback).toBe(RETRO_HEADING);
    expect(SITE_CONTENT_KEYS.find((k) => k.key === 'retro.lede')?.fallback).toBe(RETRO_LEDE);
    expect(SITE_CONTENT_KEYS.find((k) => k.key === 'library.title')?.fallback).toBe(LIBRARY_HEADING);
  });
});
