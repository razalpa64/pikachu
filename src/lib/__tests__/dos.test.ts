import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MAX_BUNDLE_BYTES,
  countStages,
  dosGameById,
  extractAutoexec,
  inspectBundle,
  judgeRedistribution,
  parseDosCatalog,
  parseDosShelf,
  searchIndex,
  stageFor,
  validateDosCandidate,
  validateDosGame,
  type DosCandidate,
} from '../dos';
import { buildZip, readZipDirectory, readZipEntry } from '../zip';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const shelfRaw = JSON.parse(readFileSync(join(root, 'public/retro/dos/shelf.json'), 'utf8')) as unknown;
const calibration = readFileSync(join(root, 'public/retro/dos/bundles/pikachu-calibration.jsdos'));
const calibrationBytes = new Uint8Array(calibration.buffer, calibration.byteOffset, calibration.byteLength);
const text = (bytes: Uint8Array | null) => (bytes ? new TextDecoder().decode(bytes) : null);
/** `readZipEntry` is async because deflated entries go through
 *  `DecompressionStream`; the tests await it like the callers do. */
const entry = (zip: Uint8Array, name: string) => readZipEntry(zip, name);

/* ------------------------------------------------------------------- zip */

describe('the zip reader and writer', () => {
  it('round-trips what we write', async () => {
    const zip = buildZip([
      { name: '.jsdos/dosbox.conf', data: new TextEncoder().encode('[autoexec]\nEXIT\n') },
      { name: 'GAME/READ.ME', data: new TextEncoder().encode('hello') },
    ]);
    const entries = readZipDirectory(zip);
    expect(entries?.map((e) => e.name)).toEqual(['.jsdos/dosbox.conf', 'GAME/READ.ME']);
    expect(text(await entry(zip, 'GAME/READ.ME'))).toBe('hello');
    /* Paths are matched exactly; a request for something absent is a null, never
       an empty file that the caller might treat as valid. */
    expect(await entry(zip, 'GAME/read.me')).toBeNull();
    expect(await entry(zip, 'GAME/MISSING')).toBeNull();
  });

  it('reads the bundle we actually ship', async () => {
    const entries = readZipDirectory(calibrationBytes);
    expect(entries).not.toBeNull();
    const names = (entries ?? []).map((e) => e.name);
    expect(names).toContain('.jsdos/dosbox.conf');
    /* The binary is at the archive root, not in a folder: js-dos mounts the
       bundle as C:\, so a subdirectory would not be found by the autoexec. */
    expect(names).toContain('CALIB.COM');

    const conf = text(await entry(calibrationBytes, '.jsdos/dosbox.conf')) ?? '';
    expect(conf).toMatch(/\[autoexec\]/);
    expect(extractAutoexec(conf)).toContain('CALIB.COM');

    /* The .COM is 179 bytes and is not a ZIP itself — proves we are not handing
       back the whole archive for any name. */
    const com = await entry(calibrationBytes, 'CALIB.COM');
    expect(com?.length).toBe(179);
    expect(com?.[0]).not.toBe(0x50); // not "PK"
  });

  it('says null for something that is not a zip at all', async () => {
    expect(readZipDirectory(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(readZipDirectory(new Uint8Array(64))).toBeNull();
    const gba = new Uint8Array(0x100);
    gba.set([0x24, 0xff, 0xae, 0x51]);
    expect(readZipDirectory(gba)).toBeNull();
    expect(await entry(gba, '.jsdos/dosbox.conf')).toBeNull();
  });
});

/* ------------------------------------------------------------ the player */

describe('the DOS player document', () => {
  const html = readFileSync(join(root, 'public/retro/dos.html'), 'utf8');
  const prefix = /EMULATOR_PREFIX\s*=\s*"([^"]+)"/.exec(html)?.[1] ?? '';

  it('points js-dos at the directory its cores are actually in', () => {
    /* js-dos builds its URLs as `pathPrefix + "emulators.js"` and
       `pathPrefix + "wdosbox.js"`. A prefix of `/retro/jsdos/` therefore asks
       for `/retro/jsdos/emulators.js`, which does not exist — js-dos logs the
       404 and never creates a canvas, and the player reported that as "DOS
       started, but no screen appeared". This pins the prefix to a directory
       that holds the files, so the bug cannot come back silently. */
    expect(prefix).toBe('/retro/jsdos/emulators/');
    for (const name of ['emulators.js', 'wdosbox.js', 'wdosbox.wasm']) {
      expect(existsSync(join(root, 'public', prefix, name)), `${prefix}${name}`).toBe(true);
    }
    expect(html).not.toContain('pathPrefix: "/retro/jsdos/"');
    expect(html).toContain('pathPrefix: EMULATOR_PREFIX');
  });

  it('checks those files before it blames the game for a black screen', () => {
    expect(html).toContain('preflightCore');
  });

  it('never ends an [autoexec] with `exit`, which shuts the emulator down', async () => {
    /* `exit` quits DOS, and js-dos tears the session down when DOS quits — a
       game that ends, or a test card that finishes, would look like a crash.
       Every bundle here starts its program and then leaves the prompt alone. */
    for (const game of parseDosShelf(shelfRaw).games) {
      const bytes = new Uint8Array(readFileSync(join(root, 'public/retro/dos', game.bundle)));
      const conf = text(await entry(bytes, '.jsdos/dosbox.conf')) ?? '';
      const lines = (extractAutoexec(conf) ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
      expect(lines, game.id).not.toContain('exit');
    }
  });
});

/* -------------------------------------------------------------- bundles */

describe('inspecting a bundle before it is hosted', () => {
  const goodConf = '[autoexec]\nmount c .\nc:\nGAME.EXE\nexit\n';

  it('accepts the calibration bundle', async () => {
    const report = inspectBundle({
      bytes: calibrationBytes,
      entries: readZipDirectory(calibrationBytes),
      conf: text(await entry(calibrationBytes, '.jsdos/dosbox.conf')),
    });
    expect(report.ok).toBe(true);
    expect(report.problems).toEqual([]);
    expect(report.hasConf).toBe(true);
    expect(report.autoexec).toContain('CALIB.COM');
  });

  it('refuses an archive with no dosbox.conf', () => {
    const zip = buildZip([{ name: 'GAME/GAME.EXE', data: new Uint8Array([0x4d, 0x5a]) }]);
    const report = inspectBundle({ bytes: zip, entries: readZipDirectory(zip), conf: null });
    expect(report.ok).toBe(false);
    expect(report.problems).toContain('no-conf');
  });

  it('refuses path traversal, a bomb, and an implausible entry count', () => {
    const traversal = buildZip([{ name: '../../etc/passwd', data: new Uint8Array([1]) }]);
    expect(inspectBundle({ bytes: traversal, entries: readZipDirectory(traversal) }).problems).toContain('path-traversal');

    const absolute = buildZip([{ name: '/etc/shadow', data: new Uint8Array([1]) }]);
    expect(inspectBundle({ bytes: absolute, entries: readZipDirectory(absolute) }).problems).toContain('path-traversal');

    const drive = buildZip([{ name: 'C:\\WINDOWS\\SYSTEM.INI', data: new Uint8Array([1]) }]);
    expect(inspectBundle({ bytes: drive, entries: readZipDirectory(drive) }).problems).toContain('path-traversal');

    /* A directory entry that *claims* to be 200 MB inside a 4 KB file. The
       header is enough to catch it; nothing is decompressed. */
    const bomb = [{
      name: 'GAME/HUGE.BIN',
      size: 200 * 1024 * 1024,
      compressedSize: 900,
      method: 8,
      crc32: 0,
      isDirectory: false,
    }];
    const small = new Uint8Array(4096);
    expect(inspectBundle({ bytes: small, entries: bomb, conf: goodConf }).problems).toContain('absurd-size');

    const many = Array.from({ length: 4001 }, (_, i) => ({
      name: `GAME/F${i}.DAT`, size: 1, compressedSize: 1, method: 0, crc32: 0, isDirectory: false,
    }));
    expect(inspectBundle({ bytes: small, entries: many, conf: goodConf }).problems).toContain('too-many-entries');
  });

  it('refuses an empty file and one past the cap', () => {
    expect(inspectBundle({ bytes: new Uint8Array(0), entries: null }).problems).toContain('empty');
    expect(inspectBundle({ bytes: new Uint8Array(MAX_BUNDLE_BYTES + 1), entries: null }).problems).toContain('too-big');
  });

  it('reads [autoexec] without inventing one', () => {
    expect(extractAutoexec('[autoexec]\nRUN.BAT\nexit\n')).toBe('RUN.BAT\nexit');
    expect(extractAutoexec('[sdl]\nfullscreen=false\n')).toBeNull();
    /* Sections after [autoexec] are not part of it. */
    expect(extractAutoexec('[autoexec]\nA.EXE\n[dosbox]\nmemsize=16\n')).toBe('A.EXE');
  });
});

/* ------------------------------------------------------------ permission */

describe('who may host what', () => {
  it('never treats an aggregator label as a grant', () => {
    for (const label of ['Freeware', 'Shareware', 'freeware', ' shareware ', '', null, undefined, 'Commercial']) {
      const verdict = judgeRedistribution({ license: label });
      expect(verdict.status, String(label)).toBe('pending');
      expect(verdict.evidence).toBeNull();
    }
  });

  it('accepts a real licence, and a dated piece of evidence', () => {
    expect(judgeRedistribution({ license: 'CC0-1.0' }).status).toBe('approved');
    expect(judgeRedistribution({ license: 'mit' }).status).toBe('approved');
    expect(judgeRedistribution({ license: 'Shareware', evidence: 'author posted a redistribution grant on 2024-05-02' }).status)
      .toBe('approved');
    /* Twelve characters is the floor, and eleven is not twelve. */
    expect(judgeRedistribution({ license: 'Shareware', evidence: '12345678901' }).status).toBe('pending');
    expect(judgeRedistribution({ license: 'Shareware', evidence: '123456789012' }).status).toBe('approved');
  });

  it('derives the stage instead of trusting a flag', () => {
    const pending = judgeRedistribution({ license: 'Shareware' });
    const approved = judgeRedistribution({ license: 'CC0-1.0' });
    expect(stageFor({ hasBundle: false, permission: pending })).toBe('metadata-only');
    expect(stageFor({ hasBundle: true, permission: pending })).toBe('pending-rights-review');
    expect(stageFor({ hasBundle: true, permission: approved })).toBe('ready-for-testing');
    expect(stageFor({ hasBundle: true, permission: approved, playable: true })).toBe('playable');
    expect(stageFor({
      hasBundle: true,
      permission: { status: 'blocked', reason: 'no-grant', evidence: null, checkedAt: null },
    })).toBe('disabled');
  });
});

/* ------------------------------------------------------------- shelf data */

describe('the committed DOS shelf', () => {
  const shelf = parseDosShelf(shelfRaw);

  it('holds the games this project can justify, and nothing else', () => {
    /* Sorted by title, which is the order the manifest is written in. */
    expect(shelf.games.map((g) => g.title)).toEqual([
      'Calibration', 'Celis', 'Floppybird', 'Moth Hunter', 'nasm-tetris',
      'Out of Cash', 'Sadist', 'Snake (54 bytes)', 'Super Vinnie-Pooh',
    ]);
    for (const game of shelf.games) {
      expect(game.rights.length).toBeGreaterThan(8);
      /* A formal licence, not an aggregator's label — this is the whole point. */
      expect(game.license).toMatch(/^(CC0|MIT|GPL|ISC|Apache|BSD)/);
      expect(game.bundle).toMatch(/^bundles\/[a-z0-9-]+\.jsdos$/);
      expect(game.sourceUrl.startsWith('https://')).toBe(true);
    }
    expect(dosGameById(shelf.games, 'pikachu-calibration')?.title).toBe('Calibration');
    expect(dosGameById(shelf.games, 'sadist')?.license).toBe('GPL-3.0');
    expect(dosGameById(shelf.games, 'moth-hunter')?.license).toBe('MIT');
    /* The two titles people ask for are not here, and the manifest says so by
       simply not containing them. */
    expect(dosGameById(shelf.games, 'doom')).toBeNull();
    expect(dosGameById(shelf.games, 'vice-city')).toBeNull();
    expect(dosGameById(shelf.games, undefined)).toBeNull();
  });

  it('ships a bundle for every record, at the size the record claims, with a runnable autoexec', async () => {
    for (const game of shelf.games) {
      const bytes = new Uint8Array(readFileSync(join(root, 'public/retro/dos', game.bundle)));
      expect(bytes.length, game.id).toBe(game.bytes);

      const entries = readZipDirectory(bytes);
      const report = inspectBundle({
        bytes,
        entries,
        conf: text(await entry(bytes, '.jsdos/dosbox.conf')),
      });
      expect(report.problems, game.id).toEqual([]);

      /* The program the autoexec names has to exist at the archive root. */
      const program = (report.autoexec ?? '')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#') && !line.startsWith(';'))
        .filter((line) => /\.(exe|com|bat)$/i.test(line))
        .pop();
      expect(program, game.id).toBeTruthy();
      expect(entries?.some((e) => e.name.toLowerCase() === program!.toLowerCase()), `${game.id}: ${program}`).toBe(true);

      /* A .EXE has to be an MZ executable, not a renamed blob. */
      if (/\.exe$/i.test(program!)) {
        const body = await entry(bytes, program!);
        expect(body?.[0], `${game.id}: ${program}`).toBe(0x4d);
        expect(body?.[1], `${game.id}: ${program}`).toBe(0x5a);
      }
    }
  });

  it('drops a seller’s bundle URL, an absolute host path, and a javascript: source', () => {
    const base = shelf.games[0] as unknown as Record<string, unknown>;
    const bad: Partial<Record<string, unknown>>[] = [
      { bundle: 'https://example.com/game.jsdos' },       // committed shelf: local only
      { bundle: '/retro/dos/bundles/x.jsdos' },           // absolute path inside our own site
      { bundle: '../secret.jsdos' },
      { sourceUrl: 'javascript:alert(1)' },
      { sourceUrl: 'http://example.com/game' },           // not https
      { licenseUrl: '' },
      { rights: '' },                                     // no recorded right, no entry
      { accent: 'red' },
      { id: 'Bad Id' },
      { bytes: MAX_BUNDLE_BYTES + 1 },
      { cover: 'https://example.com/x.png' },             // committed shelf: local only
    ];
    for (const over of bad) {
      expect(validateDosGame({ ...base, ...over }), JSON.stringify(over)).toBeNull();
    }
  });

  it('lets an uploaded game in, because storage is absolute https', () => {
    const base = shelf.games[0] as unknown as Record<string, unknown>;
    const remote = {
      ...base,
      id: 'doomed',
      bundle: 'https://project.supabase.co/storage/v1/object/public/retro/doomed/game.jsdos',
      cover: 'https://project.supabase.co/storage/v1/object/public/retro/doomed/cover.png',
    };
    expect(validateDosGame(remote, { remote: true })).not.toBeNull();
    /* …and the same row is refused by the committed-shelf door. */
    expect(validateDosGame(remote)).toBeNull();
    /* An http URL is refused either way: no mixed content, no downgrade. */
    expect(validateDosGame({ ...remote, bundle: 'http://x/game.jsdos' }, { remote: true })).toBeNull();
  });
});

/* ---------------------------------------------------------------- catalog */

describe('the discovery index', () => {
  const candidate = {
    id: 'doomed',
    title: 'Doomed',
    year: 1993,
    genre: 'Shooter',
    sourceLicense: 'Shareware',
    sourceUrl: 'https://example.com/doomed',
    hasBundle: true,
    bundleBytes: 1234,
    stage: 'pending-rights-review',
    permission: { status: 'pending', reason: 'shareware-label', evidence: null, checkedAt: null },
  };

  it('validates a candidate record, and refuses one with no source', () => {
    expect(validateDosCandidate(candidate)?.id).toBe('doomed');
    expect(validateDosCandidate({ ...candidate, sourceUrl: 'http://example.com' })).toBeNull();
    expect(validateDosCandidate({ ...candidate, sourceUrl: '' })).toBeNull();
    expect(validateDosCandidate({ ...candidate, stage: 'playable' })?.stage).toBe('playable');
    /* An unknown stage is not trusted as written — it is re-derived from the
       bundle and the permission, which is the only combination that means
       anything. */
    expect(validateDosCandidate({ ...candidate, stage: 'available' })?.stage).toBe('pending-rights-review');
    expect(validateDosCandidate(null)).toBeNull();
  });

  it('counts stages and searches without pretending to own the titles', () => {
    const entries = [
      validateDosCandidate(candidate),
      validateDosCandidate({ ...candidate, id: 'doomed-two', title: 'Doomed II', year: 1994, genre: 'Puzzle' }),
      validateDosCandidate({ ...candidate, id: 'meta-only', title: 'Only Metadata', hasBundle: false, stage: 'metadata-only' }),
    ].filter(Boolean) as DosCandidate[];

    const counts = countStages(entries);
    expect(counts['pending-rights-review']).toBe(2);
    expect(counts['metadata-only']).toBe(1);
    expect(counts.playable).toBe(0);

    expect(searchIndex(entries, 'doomed', null).map((e) => e.id)).toEqual(['doomed', 'doomed-two']);
    expect(searchIndex(entries, '1994', null).map((e) => e.id)).toEqual(['doomed-two']);
    expect(searchIndex(entries, '', 'Puzzle').map((e) => e.id)).toEqual(['doomed-two']);
    expect(searchIndex(entries, 'nintendo', null)).toEqual([]);
  });

  it('reads the committed catalog without promoting anything', () => {
    const raw = JSON.parse(readFileSync(join(root, 'public/retro/dos/catalog.json'), 'utf8')) as unknown;
    const catalog = parseDosCatalog(raw);
    expect(catalog.entries.length).toBeGreaterThan(1000);
    /* The rule the whole phase rests on: a freeware label is not a Play button. */
    expect(catalog.entries.some((e) => e.stage === 'playable')).toBe(false);
    expect(catalog.entries.filter((e) => e.permission.status === 'approved')).toEqual([]);
    expect(catalog.entries.every((e) => e.sourceUrl.startsWith('https://'))).toBe(true);
  });
});
