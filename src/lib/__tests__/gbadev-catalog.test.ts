import { describe, expect, it } from 'vitest';

import {
  accentFor,
  classifyLicenseText,
  decideEntry,
  hasGbaHeader,
  hasOfficialLogo,
  isEntryLicenseFile,
  normalizeSlug,
  normalizeSpdx,
  parseEntry,
  REVIEWED_REFUSALS,
  ruleOnSpdx,
  shelfTags,
  toShelfGame,
  type CatalogEntry,
  type TreeFile,
} from '../gbadevCatalog';
import {
  applyOutcomes,
  buildPlan,
  emptyCache,
  emptyState,
  indexEntries,
  judgeIntegrity,
  mergeShelf,
  recordResult,
  renderManifest,
  renderShelfModule,
  retryList,
  titleKey,
  type CatalogFile,
  type GitTreeFile,
  type MetadataCache,
} from '../retroImport';
import { parseRetroLibrary, validateRetroGame, type RetroGame } from '../retro';

/* ---------------------------------------------------------------- fixtures */

const MIT_TEXT = `MIT License

Copyright (c) 2024 Somebody

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction.`;

const GPL3_TEXT = `                    GNU GENERAL PUBLIC LICENSE
                       Version 3, 29 June 2007

 Copyright (C) 2007 Free Software Foundation, Inc.
 Everyone is permitted to copy and distribute verbatim copies.`;

const NEWLIB_TEXT = `Redistributions of source code must retain the above copyright notice,
this list of conditions and the following disclaimer.`;

const files: TreeFile[] = [
  { path: 'game.json', bytes: 400 },
  { path: 'files/cart.gba', bytes: 1024 },
  { path: 'files/manual.pdf', bytes: 90000 },
  { path: 'shot1.png', bytes: 5000 },
  { path: 'LICENSE', bytes: 1066 },
];

const rawEntry = {
  slug: 'demo_cart',
  title: 'Demo Cart',
  description: 'A small cartridge used by the importer tests. It does one thing.',
  typetag: 'game',
  platform: 'GBA',
  tags: ['Puzzle', 'Open Source'],
  developer: ['Ada Lovelace', 'Grace Hopper'],
  date: '2023-04-01',
  screenshots: ['shot1.png', '../escape.png'],
  repository: 'https://github.com/example/demo-cart',
  website: 'http://example.com/demo',
  gameLicense: 'MIT',
  files: [
    { filename: 'files/manual.pdf', type: 'manual' },
    { filename: 'files/cart.gba', playable: true, default: true, hash: { sha256: 'a'.repeat(64) } },
  ],
};

const entryOf = (overrides: Record<string, unknown> = {}) =>
  parseEntry('demo_cart', { ...rawEntry, ...overrides }, files);

const shelfRow = (overrides: Partial<RetroGame> = {}): RetroGame => ({
  id: 'existing-cart',
  title: 'Existing Cart',
  tagline: 'Already here',
  year: 2020,
  author: 'Somebody',
  license: 'MIT',
  licenseUrl: 'https://example.com/LICENSE',
  sourceUrl: 'https://example.com/repo',
  description: 'A cartridge that is already on the shelf.',
  rom: 'roms/existing-cart.gba',
  cover: 'covers/existing-cart.png',
  marquee: null,
  bytes: 4096,
  accent: '#ffd24d',
  tags: ['arcade'],
  players: 1,
  save: false,
  ...overrides,
});

/* --------------------------------------------------------------- licences */

describe('SPDX handling', () => {
  it('normalises the legacy spellings the archive actually uses', () => {
    expect(normalizeSpdx('GPL-3.0')).toBe('GPL-3.0-only');
    expect(normalizeSpdx('gpl-3.0+')).toBe('GPL-3.0-or-later');
    expect(normalizeSpdx('mit')).toBe('MIT');
    expect(normalizeSpdx('MPL2.0')).toBe('MPL-2.0');
    expect(normalizeSpdx('Apache 2.0')).toBe('Apache-2.0');
    expect(normalizeSpdx('CC0')).toBe('CC0-1.0');
    expect(normalizeSpdx('not-a-licence')).toBeNull();
    expect(normalizeSpdx(null)).toBeNull();
  });

  it('rules open licences in and NC/ND licences out', () => {
    expect(ruleOnSpdx('MIT')).toMatchObject({ family: 'permissive', refused: null });
    expect(ruleOnSpdx('GPL-3.0')).toMatchObject({ spdx: 'GPL-3.0-only', family: 'copyleft' });
    expect(ruleOnSpdx('MPL-2.0')).toMatchObject({ family: 'copyleft', refused: null });
    expect(ruleOnSpdx('CC-BY-4.0')).toMatchObject({ family: 'content', refused: null });
    expect(ruleOnSpdx('CC-BY-NC-4.0')).toMatchObject({ family: null, refused: 'noncommercial' });
    expect(ruleOnSpdx('CC-BY-ND-4.0')).toMatchObject({ family: null, refused: 'noderivs' });
    expect(ruleOnSpdx('NOASSERTION')).toMatchObject({ family: null, refused: 'unknown' });
  });

  it('reads licence text it recognises', () => {
    expect(classifyLicenseText(MIT_TEXT)).toMatchObject({ spdx: 'MIT', family: 'permissive', refused: null });
    expect(classifyLicenseText(GPL3_TEXT)).toMatchObject({ spdx: 'GPL-3.0-only', family: 'copyleft' });
    expect(classifyLicenseText(NEWLIB_TEXT).spdx).toBe('BSD-2-Clause');
  });

  it('refuses a licence that comes with a restriction', () => {
    const fanLicence = `${MIT_TEXT}\n\nThis is a fan game. All rights reserved by the original creators.`;
    expect(classifyLicenseText(fanLicence).refused).toBe('proprietary');
    const nonCommercial = `${MIT_TEXT}\n\nThis may not be sold or used for commercial purposes.`;
    expect(classifyLicenseText(nonCommercial).refused).toBe('noncommercial');
    expect(classifyLicenseText('Ask me before you redistribute this.').family).toBeNull();
  });

  it('tells an entry licence file from an SDK licence', () => {
    expect(isEntryLicenseFile('LICENSE')).toBe(true);
    expect(isEntryLicenseFile('files/LICENSE.txt')).toBe(true);
    expect(isEntryLicenseFile('files/SPELUNKY USER LICENSE.txt')).toBe(true);
    expect(isEntryLicenseFile('COPYING.NEWLIB')).toBe(false);
    expect(isEntryLicenseFile('licenses/butano/libgcc/COPYING3')).toBe(false);
    expect(isEntryLicenseFile('libgba_license.txt')).toBe(false);
    expect(isEntryLicenseFile('shot1.png')).toBe(false);
  });
});

/* ---------------------------------------------------------------- entries */

describe('archive entry parsing', () => {
  it('picks the playable cartridge and ignores manuals, patches and other platforms', () => {
    const entry = entryOf({
      files: [
        { filename: 'files/manual.pdf', type: 'manual' },
        { filename: 'files/old.gb', playable: true },
        { filename: 'files/patch.bps', type: 'patch' },
        { filename: 'files/cart.gba', playable: true },
      ],
    });
    expect(entry.rom).toMatchObject({ filename: 'files/cart.gba', bytes: 1024, inArchive: true });
  });

  it('normalises the fields the shelf needs', () => {
    const entry = entryOf();
    expect(entry.id).toBe('demo-cart');
    expect(entry.year).toBe(2023);
    expect(entry.developer).toBe('Ada Lovelace & Grace Hopper');
    expect(entry.screenshots).toEqual(['shot1.png']);
    expect(entry.links.website).toBe('https://example.com/demo');
    expect(entry.license).toMatchObject({ spdx: 'MIT', source: 'gameLicense', family: 'permissive' });
  });

  it('keeps a cartridge with no date, but does not invent a year', () => {
    expect(entryOf({ date: undefined }).year).toBeNull();
  });

  it('reads a legacy `license` field too', () => {
    const entry = entryOf({ gameLicense: undefined, license: 'GPL-3.0' });
    expect(entry.license).toMatchObject({ spdx: 'GPL-3.0-only', source: 'license' });
  });

  it('slugs an archive folder into a shelf id', () => {
    expect(normalizeSlug('afska_beat-beast')).toBe('afska-beat-beast');
    expect(normalizeSlug('MeteoRain (GBA Jam 2021)')).toBe('meteorain');
  });
});

/* ----------------------------------------------------------------- policy */

describe('import policy', () => {
  it('refuses anything that is not a GBA game', () => {
    expect(decideEntry(entryOf({ typetag: 'demo' })).reason).toBe('typetag');
    expect(decideEntry(entryOf({ platform: 'GB' })).reason).toBe('platform');
  });

  it('refuses an entry that declares no licence at all', () => {
    expect(decideEntry(entryOf({ gameLicense: undefined }))).toMatchObject({
      status: 'skipped',
      reason: 'license-missing',
    });
  });

  it('refuses a licence that is not redistributable', () => {
    expect(decideEntry(entryOf({ gameLicense: 'CC-BY-NC-4.0' }))).toMatchObject({
      status: 'skipped',
      reason: 'license-noncommercial',
    });
    expect(decideEntry(entryOf({ gameLicense: 'CC-BY-ND-4.0' })).reason).toBe('license-noderivs');
  });

  it('accepts a licence learned from the entry’s own licence file', () => {
    const entry = entryOf({ gameLicense: undefined });
    const verdict = decideEntry(entry, { licenseTexts: { LICENSE: classifyLicenseText(MIT_TEXT) } });
    expect(verdict).toMatchObject({ status: 'importable', reason: null });
    expect(entry.license).toMatchObject({ spdx: 'MIT', source: 'license-file', file: 'LICENSE' });
  });

  it('accepts a licence file that names two open licences, and records both', () => {
    const entry = entryOf({ gameLicense: undefined });
    const text = `${MIT_TEXT}\n\nCharts are licensed under CC-BY 4.0.\nCreative Commons Attribution 4.0`;
    const verdict = decideEntry(entry, { licenseTexts: { LICENSE: classifyLicenseText(text) } });
    expect(verdict.status).toBe('importable');
    expect(entry.license.mixed).toContain('CC-BY-4.0');
  });

  it('refuses a fan game of somebody else’s character, unless told otherwise', () => {
    const entry = entryOf({ tags: ['Fangame', 'Arcade'] });
    expect(decideEntry(entry).reason).toBe('third-party-ip');
    expect(decideEntry(entry, { allowFanGame: true }).status).toBe('importable');
  });

  it('refuses entries a maintainer reviewed and turned down, with the reason on record', () => {
    const piugba = parseEntry('piugba', { ...rawEntry, slug: 'piugba', title: 'piuGBA' }, files);
    expect(decideEntry(piugba)).toMatchObject({ status: 'skipped', reason: 'asset-license' });
    const minicraft = parseEntry('minicraft-gba', { ...rawEntry, slug: 'minicraft-gba' }, files);
    expect(decideEntry(minicraft)).toMatchObject({ status: 'skipped', reason: 'third-party-ip' });
    // Every reviewed refusal must be documented, or it is just a stub.
    for (const ruling of Object.values(REVIEWED_REFUSALS)) expect(ruling.detail.length).toBeGreaterThan(20);
  });

  it('skips a cartridge that is too big for the player', () => {
    const big = parseEntry('big_cart', rawEntry, [{ path: 'files/cart.gba', bytes: 40 * 1024 * 1024 }]);
    expect(decideEntry(big)).toMatchObject({ status: 'skipped', reason: 'rom-too-big' });
  });

  it('fails a cartridge whose file is missing from the archive, so it can be retried', () => {
    const missing = parseEntry('gone_cart', rawEntry, [{ path: 'game.json', bytes: 10 }]);
    expect(decideEntry(missing)).toMatchObject({ status: 'failed', reason: 'rom-not-in-archive' });
  });

  it('never imports a cartridge that is already on the shelf', () => {
    const entry = entryOf();
    expect(decideEntry(entry, { takenIds: ['demo-cart'] })).toMatchObject({
      status: 'skipped',
      reason: 'duplicate',
    });
  });
});

/* ------------------------------------------------------------------ shelf */

describe('shelf rows', () => {
  const installed = {
    cover: 'covers/demo-cart.png',
    bytes: 1024,
    accent: '#ff9d57',
    playtest: { status: 'passed' as const, colours: 24, at: '2024-01-01T00:00:00.000Z' },
  };

  it('produces a row the player’s own validator accepts', () => {
    const row = toShelfGame(entryOf(), installed);
    const validated = validateRetroGame(row);
    expect(validated).not.toBeNull();
    expect(validated).toMatchObject({ id: 'demo-cart', rom: 'roms/demo-cart.gba', license: 'MIT', bytes: 1024 });
  });

  it('is still valid when the archive publishes no description and no date', () => {
    const entry = entryOf({ description: undefined, date: undefined, repository: undefined, website: undefined });
    const row = toShelfGame(entry, installed);
    expect(validateRetroGame(row)).not.toBeNull();
    expect((row as { year: unknown }).year).toBeNull();
    expect((row as { description: string }).description).toContain('Demo Cart');
  });

  it('maps archive tags onto the shelf’s own filter vocabulary', () => {
    expect(shelfTags(['Puzzle', 'Horror'])).toEqual(['puzzle', 'horror', 'single player']);
    expect(shelfTags([])).toEqual(['action', 'arcade', 'single player']);
  });

  it('gives every cartridge a stable accent', () => {
    expect(accentFor('demo-cart')).toBe(accentFor('demo-cart'));
    expect(accentFor('demo-cart')).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('keeps the hand-written rows exactly as they are and adds the new ones', () => {
    const existing = shelfRow();
    const merged = mergeShelf([existing], [
      {
        entry: entryOf(),
        installed,
      },
    ]);
    expect(merged.map((game) => game.id)).toEqual(['demo-cart', 'existing-cart']);
    expect(merged.find((game) => game.id === 'existing-cart')).toBe(existing);
    expect(mergeShelf([existing], [{ entry: entryOf(), installed }])).toHaveLength(2);
  });

  it('writes a manifest that parses back to the same shelf', () => {
    const games = mergeShelf([shelfRow()], [{ entry: entryOf(), installed }]);
    const parsed = parseRetroLibrary(JSON.parse(renderManifest(games, 'note')));
    expect(parsed.games.map((game) => game.id).sort()).toEqual(['demo-cart', 'existing-cart']);
  });

  it('generates the id list the manifest and SEO read', () => {
    const module = renderShelfModule(mergeShelf([shelfRow()], []));
    expect(module).toContain('{ id: "existing-cart", title: "Existing Cart" },');
    expect(module).toContain('GENERATED FILE');
  });
});

/* -------------------------------------------------------------- the runner */

const tree: GitTreeFile[] = [
  { path: 'entries/demo_cart/game.json', sha: 'sha-game', bytes: 400, type: 'blob' },
  { path: 'entries/demo_cart/files/cart.gba', sha: 'sha-rom', bytes: 1024, type: 'blob' },
  { path: 'entries/demo_cart/LICENSE', sha: 'sha-license', bytes: 1066, type: 'blob' },
  { path: 'entries/no_license/game.json', sha: 'sha-game-2', bytes: 300, type: 'blob' },
  { path: 'entries/no_license/cart.gba', sha: 'sha-rom-2', bytes: 2048, type: 'blob' },
  { path: 'LICENSE', sha: 'sha-db', bytes: 35000, type: 'blob' },
];

const completeCache = (): MetadataCache => {
  const cache = emptyCache('master');
  cache.blobs['sha-game'] = { kind: 'json', value: { ...rawEntry, gameLicense: undefined } };
  cache.blobs['sha-license'] = { kind: 'text', value: MIT_TEXT };
  cache.blobs['sha-game-2'] = {
    kind: 'json',
    value: { ...rawEntry, slug: 'no_license', title: 'No Licence', gameLicense: undefined, license: undefined },
  };
  return cache;
};

describe('planner', () => {
  it('indexes only real entries and only their own licence files', () => {
    const index = indexEntries(tree);
    expect(index.map((entry) => entry.slug)).toEqual(['demo_cart', 'no_license']);
    expect(index[0].licenseFiles).toEqual([{ path: 'LICENSE', sha: 'sha-license' }]);
    // The database's own LICENSE at the repo root is not an entry file.
    expect(index[1].licenseFiles).toEqual([]);
  });

  it('asks for exactly the metadata it cannot find in the cache', () => {
    const plan = buildPlan({ index: indexEntries(tree), cache: emptyCache('master'), shelf: [], options: {} });
    expect(plan.needs.manifests.map((n) => n.slug)).toEqual(['demo_cart', 'no_license']);
    expect(plan.catalog.entries).toHaveLength(0);
  });

  it('asks for a licence file only when the entry declares no SPDX id', () => {
    const cache = completeCache();
    delete cache.blobs['sha-license'];
    const plan = buildPlan({ index: indexEntries(tree), cache, shelf: [], options: {} });
    expect(plan.needs.licenseFiles).toEqual([{ slug: 'demo_cart', path: 'LICENSE', sha: 'sha-license' }]);
  });

  it('plans from a complete cache without touching the network', () => {
    const plan = buildPlan({ index: indexEntries(tree), cache: completeCache(), shelf: [], options: {} });
    expect(plan.needs.manifests).toHaveLength(0);
    expect(plan.needs.licenseFiles).toHaveLength(0);
    expect(plan.toDownload.map((row) => row.slug)).toEqual(['demo_cart']);
    const skipped = plan.catalog.entries.find((row) => row.slug === 'no_license');
    expect(skipped?.verdict).toMatchObject({ status: 'skipped', reason: 'license-missing' });
  });

  it('marks an archive entry that is already on the shelf as installed, not importable', () => {
    const plan = buildPlan({
      index: indexEntries(tree),
      cache: completeCache(),
      shelf: [shelfRow({ id: 'demo-cart', rom: 'roms/demo-cart.gba' })],
      options: {},
    });
    expect(plan.toDownload).toHaveLength(0);
    expect(plan.catalog.entries.find((row) => row.slug === 'demo_cart')?.verdict.status).toBe('installed');
  });

  it('treats an archive entry with a different author prefix as the same game', () => {
    const tree: GitTreeFile[] = [
      { path: 'entries/edefelice_lander-advance/game.json', sha: 'sha-lander', size: 100, type: 'blob' },
      { path: 'entries/edefelice_lander-advance/files/lander-advance_jam.gba', sha: 'sha-rom', size: 1024, type: 'blob' },
    ];
    const cache = emptyCache('master');
    cache.blobs['sha-lander'] = {
      kind: 'json',
      value: {
        ...rawEntry,
        slug: 'edefelice_lander-advance',
        title: 'Lander Advance (GB Jam)',
        files: [{ filename: 'files/lander-advance_jam.gba', playable: true, default: true }],
      },
    };
    const plan = buildPlan({
      index: indexEntries(tree),
      cache,
      shelf: [shelfRow({ id: 'lander-advance', title: 'Lander Advance' })],
      options: {},
    });
    expect(plan.toDownload).toHaveLength(0);
    expect(plan.catalog.entries[0].verdict).toMatchObject({ status: 'installed' });
  });

  it('counts what it found, in the shape the report prints', () => {
    const plan = buildPlan({
      index: indexEntries(tree),
      cache: completeCache(),
      shelf: [shelfRow()],
      options: { commit: 'abc', now: '2024-01-01T00:00:00.000Z' },
    });
    expect(plan.catalog.stats).toMatchObject({
      discovered: 2,
      gbaGames: 2,
      withLicense: 1,
      importable: 1,
      installed: 0,
      skipped: 1,
      failed: 0,
    });
    expect(plan.catalog.source.commit).toBe('abc');
    expect(plan.catalog.entries.map((row) => row.title)).toEqual(['Demo Cart', 'No Licence']);
  });

  it('folds a run’s outcomes back into the catalogue', () => {
    const plan = buildPlan({ index: indexEntries(tree), cache: completeCache(), shelf: [], options: {} });
    const installed: CatalogEntry[] = plan.toDownload;
    const shelf = mergeShelf(
      [],
      installed.map((entry) => ({
        entry,
        installed: {
          cover: `covers/${entry.id}.png`,
          bytes: 1024,
          accent: '#ffd24d',
          playtest: { status: 'passed' as const, colours: 20, at: '2024-01-01T00:00:00.000Z' },
        },
      })),
    );
    const catalog: CatalogFile = applyOutcomes(plan.catalog, shelf, {
      demo_cart: { status: 'installed', reason: null, detail: 'ok' },
    });
    expect(catalog.stats).toMatchObject({ shelfGames: 1, installed: 1 });
    expect(catalog.entries.find((row) => row.slug === 'demo_cart')?.verdict.status).toBe('installed');
  });
});

describe('save-data claims', () => {
  const installed = {
    cover: 'covers/demo-cart.png',
    bytes: 1024,
    accent: '#ffd24d',
    playtest: { status: 'passed' as const, colours: 20, at: '2024-01-01T00:00:00.000Z' },
  };

  it('does not claim an imported cartridge has no battery saves', () => {
    const row = toShelfGame(entryOf(), installed) as unknown as RetroGame;
    expect(row.save).toBeNull();
    expect(validateRetroGame(row)).not.toBeNull();
  });

  it('keeps a hand-written save flag, and refuses a nonsense one', () => {
    expect(validateRetroGame(shelfRow({ save: false }))?.save).toBe(false);
    expect(validateRetroGame(shelfRow({ save: true }))?.save).toBe(true);
    expect(validateRetroGame({ ...shelfRow(), save: 'sometimes' })?.save).toBeNull();
  });
});

describe('title keys', () => {
  it('ignores case, punctuation and a jam/edition suffix', () => {
    expect(titleKey('Lander Advance')).toBe(titleKey('lander advance'));
    expect(titleKey('MeteoRain (GBA Jam 2021)')).toBe('meteorain');
    expect(titleKey('  The Purple  Night! ')).toBe('the purple night');
    expect(titleKey('Apóllo')).not.toBe(titleKey('Apollo'));
  });
});

describe('failure state', () => {
  it('counts attempts and offers retryable failures back', () => {
    let state = emptyState();
    const entry = entryOf();
    state = recordResult(state, entry, { status: 'failed', reason: 'download-failed', detail: 'boom' }, '2024-01-01T00:00:00.000Z');
    state = recordResult(state, entry, { status: 'failed', reason: 'download-failed', detail: 'boom' }, '2024-01-02T00:00:00.000Z');
    expect(state.failures.demo_cart).toMatchObject({ attempts: 2, reason: 'download-failed' });
    expect(retryList(state)).toEqual(['demo_cart']);
  });

  it('forgets a failure once the cartridge installs, and remembers the hash', () => {
    let state = emptyState();
    const entry = entryOf();
    state = recordResult(state, entry, { status: 'failed', reason: 'playtest-failed', detail: 'blank' }, '2024-01-01T00:00:00.000Z');
    state = recordResult(
      state,
      entry,
      { status: 'installed', reason: null, detail: 'ok' },
      '2024-01-03T00:00:00.000Z',
      { sha256: 'b'.repeat(64), bytes: 1024 },
    );
    expect(state.failures.demo_cart).toBeUndefined();
    expect(state.installed['demo-cart']).toMatchObject({ sha256: 'b'.repeat(64), license: 'MIT' });
  });

  it('does not treat a licensing refusal as retryable', () => {
    const state = recordResult(
      emptyState(),
      entryOf(),
      { status: 'skipped', reason: 'license-noncommercial', detail: 'no' },
      '2024-01-01T00:00:00.000Z',
    );
    expect(Object.keys(state.failures)).toHaveLength(0);
  });
});

describe('download checks', () => {
  const facts = { bytes: 1024, gitSha: 'a'.repeat(40), sha256: 'b'.repeat(64), header: true };
  const expected = { bytes: 1024, gitSha: 'a'.repeat(40), sha256: 'b'.repeat(64) };

  it('accepts a cartridge the archive and its own metadata both agree on', () => {
    expect(judgeIntegrity(facts, expected)).toMatchObject({ status: 'ok', staleHash: false });
  });

  it('imports a cartridge whose published hash is older than the file, and says so', () => {
    const verdict = judgeIntegrity(facts, { ...expected, sha256: 'c'.repeat(64) });
    expect(verdict).toMatchObject({ status: 'ok', staleHash: true });
    if (verdict.status === 'ok') expect(verdict.detail).toContain('stale');
  });

  it('rejects bytes of the wrong size, and bytes that are not the archive blob', () => {
    expect(judgeIntegrity({ ...facts, bytes: 2048 }, expected)).toMatchObject({
      status: 'rejected',
      reason: 'integrity',
    });
    expect(judgeIntegrity({ ...facts, gitSha: 'd'.repeat(40) }, expected)).toMatchObject({
      status: 'rejected',
      reason: 'integrity',
    });
  });

  it('rejects a file that is not a cartridge at all', () => {
    expect(judgeIntegrity({ ...facts, header: false }, expected)).toMatchObject({
      status: 'rejected',
      reason: 'not-gba',
    });
  });
});

describe('cartridge header', () => {
  it('accepts a real GBA header and rejects everything else', () => {
    const logo =
      '24ffae51699aa2213d84820a84e409ad11248b98c0817f21a352be199309ce2010464a4af82731ec58c7e83382e3cebf85f4df94ce4b09c194568ac01372a7fc9f844d73a3ca9a615897a327fc039876231dc7610304ae56bf38840040a70efdff52fe036f9530f197fbc08560d68025a963be03014e38e2f9a234ffbb3e0344780090cb88113a9465c07c6387f03cafd625e48b380aac7221d4f807';
    const rom = new Uint8Array(0xc0);
    for (let i = 0; i < 156; i += 1) rom[4 + i] = parseInt(logo.slice(i * 2, i * 2 + 2), 16);
    expect(hasGbaHeader(rom)).toBe(true);
    rom[40] = 0;
    expect(hasGbaHeader(rom)).toBe(false);
    expect(hasGbaHeader(new Uint8Array(8))).toBe(false);
    expect(hasOfficialLogo(rom)).toBe(false);
  });

  it('accepts a homebrew build that blanks the logo, on its ARM entry branch', () => {
    /* `grimlight` ships `2e 00 00 ea` at 0x00 and a zeroed logo area: mGBA runs
       it, so the pre-filter must not throw it away. */
    const rom = new Uint8Array(0x1000);
    rom.set([0x2e, 0x00, 0x00, 0xea]);
    expect(hasGbaHeader(rom)).toBe(true);
    expect(hasOfficialLogo(rom)).toBe(false);
    rom[3] = 0x00;
    expect(hasGbaHeader(rom)).toBe(false);
  });
});
