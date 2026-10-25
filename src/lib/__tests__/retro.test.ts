import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  LOCAL_CARTRIDGE_MESSAGE,
  RETRO_BUTTON,
  RETRO_TITLES_EXPECTED,
  formatBytes,
  cartridgeKind,
  detectCartridge,
  inspectLocalCartridge,
  looksLikeGbRom,
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

/** The logo bytes a Game Boy header carries at 0x0104 — a header field the boot
 *  ROM checks, which is why the fixture above carries it too. */
const GB_TEST_LOGO = Uint8Array.from(
  'ceed6666cc0d000b03730083000c000d0008111f8889000edccc6ee6ddddddd999bbbb67636e0ecccdddc999fbbb9333e'
    .match(/.{2}/g)!
    .map((byte) => parseInt(byte, 16)),
);

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
    expect(await inspectLocalCartridge(file('mine.gba', 1000))).toBe('not-cartridge');
    for (const key of ['too-big', 'empty', 'not-cartridge', 'extension'] as const) {
      expect(LOCAL_CARTRIDGE_MESSAGE[key].length).toBeGreaterThan(10);
    }
  });

  /* A hand-made 32 KB Game Boy cartridge: header, logo, checksum, and enough
     code to fill the tile data and the tilemap. It is generated here rather than
     committed, so no third-party ROM enters the repository. */
  const gbRom = () => {
    const rom = new Uint8Array(0x8000);
    const code = [
      0xf3, // di
      0xaf, // xor a
      0xe0, 0x40, // ldh (LCDC), a  — screen off while we touch VRAM
    ];
    rom.set(code, 0x150);
    let at = 0x150 + code.length;
    rom.set([0x21, 0x00, 0x80, 0x01, 0x00, 0x10], at); // ld hl,$8000 ; ld bc,$1000
    at += 6;
    const fill = at;
    rom.set([0x7d, 0xe6, 0xe0, 0x22, 0x0b, 0x78, 0xb1, 0x20, 0xf7], at); // ld a,l; and $e0; ld (hl+),a; dec bc; ld a,b; or c; jr nz,fill
    at += 9;
    rom.set([0x21, 0x00, 0x98, 0x01, 0x00, 0x04], at); // ld hl,$9800 ; ld bc,$400
    at += 6;
    const map = at;
    rom.set([0x7d, 0xe6, 0x0f, 0x22, 0x0b, 0x78, 0xb1, 0x20, 0xf8], at);
    at += 9;
    rom.set([0x3e, 0xe4, 0xe0, 0x47, 0x3e, 0x91, 0xe0, 0x40], at); // palette, then LCDC on
    at += 8;
    const hang = at;
    rom.set([0x76, 0x18, 0xfd], at); // halt ; jr hang
    void fill;
    void map;
    void hang;

    rom[0x100] = 0x00; // nop
    rom[0x101] = 0xc3; // jp $0150
    rom[0x102] = 0x50;
    rom[0x103] = 0x01;
    rom.set(GB_TEST_LOGO, 0x104);
    rom.set([0x54, 0x45, 0x53, 0x54], 0x134); // "TEST"
    rom[0x143] = 0x00; // not CGB
    rom[0x147] = 0x00; // ROM only
    rom[0x148] = 0x00; // 32 KB
    rom[0x149] = 0x00; // no RAM
    rom[0x14b] = 0x33;
    let checksum = 0;
    for (let i = 0x134; i <= 0x14c; i += 1) checksum = (checksum - rom[i] - 1) & 0xff;
    rom[0x14d] = checksum;
    return rom;
  };

  it('accepts a homebrew GBA build that blanks the Nintendo logo', () => {
    /* `grimlight` ships `2e 00 00 ea` at 0x00 with a zeroed logo area. The shelf
       hosts it, so the drop zone has to take it back. */
    const rom = new Uint8Array(0x1000);
    rom.set([0x2e, 0x00, 0x00, 0xea]);
    expect(looksLikeGbaRom(rom)).toBe(true);
    expect(detectCartridge(rom)).toBe('gba');
    rom[3] = 0x00;
    expect(looksLikeGbaRom(rom)).toBe(false);
    expect(detectCartridge(rom)).toBeNull();
  });

  it('tells a Game Boy dump from a Game Boy Advance one', () => {
    const gb = gbRom();
    expect(looksLikeGbRom(gb)).toBe(true);
    expect(looksLikeGbaRom(gb)).toBe(false);
    expect(detectCartridge(gb)).toBe('gb');

    const gba = readFileSync(join(root, 'public/retro/roms/simple-frogger.gba'));
    const gbaHead = new Uint8Array(gba.subarray(0, 0x150));
    expect(detectCartridge(gbaHead)).toBe('gba');
    expect(looksLikeGbRom(gbaHead)).toBe(false);
    expect(detectCartridge(new Uint8Array(0x8000))).toBeNull();
  });

  it('accepts a Game Boy cartridge from the drop zone', async () => {
    const gb = gbRom();
    const head = new Uint8Array(gb.subarray(0, 0x150));
    const dropped = file('pokemon-red.gb', gb.length, head);
    expect(await inspectLocalCartridge(dropped)).toBeNull();
    expect(await cartridgeKind(dropped)).toBe('gb');
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
