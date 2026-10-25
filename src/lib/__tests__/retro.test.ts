import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  LOCAL_CARTRIDGE_MESSAGE,
  RETRO_BUTTON,
  RETRO_TITLES_EXPECTED,
  formatBytes,
  inspectLocalCartridge,
  loadRetroLibrary,
  looksLikeGbaRom,
  parseRetroLibrary,
  validateRetroGame,
  type RetroGame,
} from '../retro';
import { RETRO_TITLES } from '../seo';
import { STATIC_ENTRIES } from '../sitemap';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const manifestPath = join(root, 'public/retro/roms.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown;

const good: RetroGame = {
  id: 'demo-cart',
  title: 'Demo Cart',
  tagline: 'A demo',
  year: 2024,
  author: 'Someone',
  license: 'MIT',
  licenseUrl: 'https://example.com/LICENSE',
  sourceUrl: 'https://example.com/repo',
  description: 'A cartridge.',
  rom: 'roms/demo-cart.gba',
  cover: 'covers/demo-cart.png',
  marquee: null,
  bytes: 1024,
  accent: '#ff0000',
  tags: ['arcade'],
  players: 1,
  save: false,
};

describe('retro manifest', () => {
  it('parses every committed cartridge', () => {
    const library = parseRetroLibrary(manifest);
    expect(library.games.length).toBe(RETRO_TITLES_EXPECTED.length);
    expect(library.system).toContain('Game Boy Advance');
  });

  it('keeps the structured-data titles in step with the manifest', () => {
    const ids = parseRetroLibrary(manifest).games.map((g) => g.id).sort();
    expect(ids).toEqual(RETRO_TITLES.map((g) => g.id).sort());
  });

  it('ships the ROMs and covers it advertises', () => {
    for (const game of parseRetroLibrary(manifest).games) {
      for (const rel of [game.rom, game.cover, game.marquee].filter(Boolean) as string[]) {
        const file = join(root, 'public/retro', rel);
        expect(existsSync(file), `${rel} is missing`).toBe(true);
        expect(readFileSync(file).length, `${rel} is empty`).toBeGreaterThan(0);
      }
      const romBytes = readFileSync(join(root, 'public/retro', game.rom)).length;
      expect(romBytes, `${game.id} size in the manifest is wrong`).toBe(game.bytes);
    }
  });

  it('only ever points inside /retro', () => {
    for (const game of parseRetroLibrary(manifest).games) {
      expect(game.rom.startsWith('roms/')).toBe(true);
      expect(game.cover.startsWith('covers/')).toBe(true);
      expect(game.sourceUrl.startsWith('https://')).toBe(true);
    }
  });

  it('rejects anything that could smuggle in a remote file', () => {
    const bad = [
      { ...good, id: 'Bad Id' },
      { ...good, rom: 'https://evil.example/game.gba' },
      { ...good, rom: '../../etc/passwd' },
      { ...good, rom: 'roms/game.zip' },
      { ...good, cover: 'https://evil.example/cover.png' },
      { ...good, sourceUrl: 'javascript:alert(1)' },
      { ...good, bytes: 0 },
      { ...good, bytes: 999_999_999 },
      { ...good, accent: 'red' },
      null,
      'nope',
    ];
    for (const entry of bad) expect(validateRetroGame(entry), JSON.stringify(entry)).toBeNull();
    expect(validateRetroGame(good)?.id).toBe('demo-cart');
  });

  it('drops duplicates and bad rows without losing the good ones', () => {
    const library = parseRetroLibrary({ games: [good, { ...good, title: 'Clone' }, { id: 'x' }] });
    expect(library.games).toHaveLength(1);
    expect(library.games[0].title).toBe('Demo Cart');
  });

  it('is registered for search', () => {
    expect(STATIC_ENTRIES.some((e) => e.path === '/retro')).toBe(true);
  });
});

describe('cartridge validation', () => {
  it('accepts the Nintendo logo the boot ROM checks for', () => {
    const rom = readFileSync(join(root, 'public/retro/roms/simple-frogger.gba'));
    expect(looksLikeGbaRom(new Uint8Array(rom.subarray(0, 0xc0)))).toBe(true);
  });

  it('rejects a file that is not a GBA cartridge', () => {
    const png = readFileSync(join(root, 'public/retro/covers/simple-frogger.png'));
    expect(looksLikeGbaRom(new Uint8Array(png.subarray(0, 0xc0)))).toBe(false);
    expect(looksLikeGbaRom(new Uint8Array(4))).toBe(false);
  });

  const file = (name: string, size: number, head?: Uint8Array) => {
    const bytes = head ?? new Uint8Array(0xc0);
    return {
      name,
      size,
      slice: () => ({ arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }),
    } as unknown as File;
  };

  it('accepts a real ROM as a local cartridge', async () => {
    const rom = readFileSync(join(root, 'public/retro/roms/simple-frogger.gba'));
    const head = new Uint8Array(rom.subarray(0, 0xc0));
    expect(await inspectLocalCartridge(file('mine.gba', rom.length, head))).toBeNull();
  });

  it('explains every rejection', async () => {
    expect(await inspectLocalCartridge(file('mine.zip', 1000))).toBe('extension');
    expect(await inspectLocalCartridge(file('mine.gba', 0))).toBe('empty');
    expect(await inspectLocalCartridge(file('mine.gba', 33 * 1024 * 1024))).toBe('too-big');
    expect(await inspectLocalCartridge(file('mine.gba', 1000))).toBe('not-gba');
    for (const key of ['too-big', 'empty', 'not-gba', 'extension'] as const) {
      expect(LOCAL_CARTRIDGE_MESSAGE[key].length).toBeGreaterThan(10);
    }
  });
});

describe('retro helpers', () => {
  it('formats sizes the way a cartridge label would', () => {
    expect(formatBytes(47744)).toBe('47 KB');
    expect(formatBytes(9_910_776)).toBe('9.5 MB');
    expect(formatBytes(512)).toBe('512 B');
  });

  it('maps buttons the way the core expects', () => {
    expect(RETRO_BUTTON.A).toBe(8);
    expect(RETRO_BUTTON.B).toBe(0);
    expect(RETRO_BUTTON.START).toBe(3);
    expect(RETRO_BUTTON.UP).toBe(4);
  });

  it('does not cache a failed manifest fetch', async () => {
    const calls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      calls.push(String(url));
      throw new Error('offline');
    }) as unknown as typeof fetch;
    await expect(loadRetroLibrary()).rejects.toThrow();
    await expect(loadRetroLibrary()).rejects.toThrow();
    globalThis.fetch = original;
    expect(calls.length).toBe(2);
  });
});
