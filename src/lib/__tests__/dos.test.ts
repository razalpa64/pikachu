import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MAX_BUNDLE_BYTES,
  autoexecProgram,
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
import { buildZip, crc32, readZipDirectory, readZipEntry } from '../zip';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const shelfRaw = JSON.parse(readFileSync(join(root, 'public/retro/dos/shelf.json'), 'utf8')) as unknown;
const calibration = readFileSync(join(root, 'public/retro/dos/bundles/pikachu-calibration.jsdos'));
const calibrationBytes = new Uint8Array(calibration.buffer, calibration.byteOffset, calibration.byteLength);
const text = (bytes: Uint8Array | null) => (bytes ? new TextDecoder().decode(bytes) : null);
/** `readZipEntry` is async because deflated entries go through
 *  `DecompressionStream`; the tests await it like the callers do. */
const entry = (zip: Uint8Array, name: string) => readZipEntry(zip, name);

/**
 * A ZIP the way a stream writes one: no sizes in the local headers, a data
 * descriptor after each payload, and a correct central directory at the end.
 * `buildZip` writes the other shape (sizes up front), so this cannot be made
 * with it — and the difference is exactly the bug this test pins.
 */
function streamedZip(files: { name: string; body: string }[]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: { name: Uint8Array; data: Uint8Array; offset: number }[] = [];
  let offset = 0;
  const header = (fields: [number, number][], nameLen: number, dataLen: number) => {
    const out = new Uint8Array(30 + nameLen);
    const view = new DataView(out.buffer);
    view.setUint32(0, 0x04034b50, true);
    for (const [at, value] of fields) view.setUint16(at, value, true);
    view.setUint16(26, nameLen, true);
    view.setUint16(28, 0, true);
    void dataLen;
    return out;
  };
  for (const file of files) {
    const name = enc.encode(file.name);
    const data = enc.encode(file.body);
    /* local header: everything the format wants, with crc and sizes at zero */
    const local = header([[4, 20], [6, 0], [8, 0], [10, 0], [12, 0]], name.length, data.length);
    local.set(name, 30);
    const descriptor = new Uint8Array(16);
    const dv = new DataView(descriptor.buffer);
    dv.setUint32(0, 0x08074b50, true);
    dv.setUint32(4, crc32(data), true);
    dv.setUint32(8, data.length, true);
    dv.setUint32(12, data.length, true);
    central.push({ name, data, offset });
    parts.push(local, data, descriptor);
    offset += local.length + data.length + descriptor.length;
  }
  const cd: Uint8Array[] = [];
  let cdSize = 0;
  for (const { name, data, offset: at } of central) {
    const rec = new Uint8Array(46 + name.length);
    const v = new DataView(rec.buffer);
    v.setUint32(0, 0x02014b50, true);
    v.setUint16(4, 20, true);        // version made by
    v.setUint16(6, 20, true);        // version needed
    v.setUint16(10, 0, true);        // method: stored
    v.setUint32(16, crc32(data), true);
    v.setUint32(20, data.length, true);
    v.setUint32(24, data.length, true);
    v.setUint16(28, name.length, true);
    v.setUint32(42, at, true);       // where the local header is
    rec.set(name, 46);
    cd.push(rec);
    cdSize += rec.length;
  }
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const all = [...parts, ...cd, end];
  const total = all.reduce((n, part) => n + part.length, 0);
  const zip = new Uint8Array(total);
  let at = 0;
  for (const part of all) { zip.set(part, at); at += part.length; }
  return zip;
}


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

    /* The .COM is a few hundred bytes and is not a ZIP itself — proves we are
       not handing back the whole archive for any name. It is bounded rather than
       pinned: the program grew when it stopped exiting to the DOS prompt and
       started looping instead, and a frozen size would only ever fail the build
       for a legitimate edit. */
    const com = await entry(calibrationBytes, 'CALIB.COM');
    expect(com?.length).toBeGreaterThan(64);
    expect(com?.length).toBeLessThan(1024);
    expect(com?.[0]).not.toBe(0x50); // not "PK"
  });

  it('leaves the calibration card running instead of exiting to the DOS prompt', async () => {
    /* CALIB.COM used to end with INT 21h AH=4Ch. Returning to DOS makes DOSBox
       clear video mode 13h and draw a bare `C:\>`, so the cartridge whose whole
       job is to prove the player works finished on a black screen. It now jumps
       back to its banner, which means the byte sequence 4C 00 (mov ax, 4C00h)
       must not be in the program. */
    const com = await entry(calibrationBytes, 'CALIB.COM');
    expect(com).not.toBeNull();
    const bytes = com as Uint8Array;
    for (let i = 0; i + 1 < bytes.length; i += 1) {
      const exits = bytes[i] === 0xb8 && bytes[i + 1] === 0x00 && bytes[i + 2] === 0x4c;
      expect(exits, `mov ax, 4C00h at offset ${i}`).toBe(false);
    }
  });

  it('reads past the first entry of a streamed zip, which is how js-dos writes them', async () => {
    /* An archive written to a stream leaves the size fields in each local header
       at zero and puts the real sizes in a trailing data descriptor. The reader
       used to walk local headers and trust their sizes, so it found the *first*
       entry and declared every later one missing — which meant a .jsdos bundle
       built in the browser could be uploaded and never read. The central
       directory always knows where each entry starts; that is what is used now,
       and this fixture is the shape that broke it. */
    const files = [
      { name: '.jsdos/dosbox.conf', body: '[autoexec]\nGAME.EXE\n' },
      { name: 'GAME.EXE', body: 'MZ-not-really-this-is-a-test' },
    ];
    const zip = streamedZip(files);

    expect(readZipDirectory(zip)?.map((e) => e.name)).toEqual(files.map((f) => f.name));
    expect(text(await entry(zip, '.jsdos/dosbox.conf'))).toBe(files[0].body);
    /* The second entry is the one the old walk could not reach. */
    expect(text(await entry(zip, 'GAME.EXE'))).toBe(files[1].body);
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

  it('starts the machine without waiting for a click on js-dos’s pre-run screen', () => {
    /* js-dos defaults `autoStart` to false. With it false, a loaded bundle ends
       up on the library's own pre-run window — Play button, no canvas — and the
       player's canvas watcher could never succeed. See
       `src/screens/__tests__/dos-player.test.ts` for the behavioural version. */
    const call = /window\.Dos\(host,\s*\{([\s\S]*?)\}\)/.exec(html)?.[1] ?? '';
    expect(call).toContain('autoStart: true');
    expect(call).toContain('countDownStart: 0');
    expect(call).toContain('kiosk: true');
    expect(call).toContain('onEvent');
    expect(html).toContain('"ci-ready"');
  });

  it('never ships `autolock=true`, which puts a capture overlay over the game', async () => {
    /* js-dos reads `autolock` out of dosbox.conf and, when it is on, requires a
       pointer-lock click before the game can be used — it draws a full-screen
       "Click to capture mouse" card and a sensitivity slider over the picture.
       DOSBox's own default is true and authors copy their conf from a template,
       so every bundle generated here turned it off. None of these nine is a
       mouse-look first-person game; the two adventures move the DOS cursor
       absolutely, which does not need the lock. */
    for (const game of parseDosShelf(shelfRaw).games) {
      const bytes = new Uint8Array(readFileSync(join(root, 'public/retro/dos', game.bundle)));
      const conf = text(await entry(bytes, '.jsdos/dosbox.conf')) ?? '';
      expect(conf, game.id).not.toMatch(/autolock\s*=\s*true/i);
    }
  });

  it('reads an [autoexec] program with its switches, and ignores comments', () => {
    /* DOOM is launched into a level, which means the run line is a program *and*
       arguments. Three scripts used to match the whole line against
       `/\.(exe|com|bat)$/`, so a correct bundle was rejected as "never starts a
       program". */
    expect(autoexecProgram('[autoexec]\n@echo off\nmount c .\nc:\nDOOM.EXE -warp 1 1 -skill 3\n'))
      .toEqual({ file: 'DOOM.EXE', args: ['-warp', '1', '1', '-skill', '3'] });
    /* A `rem` line is DOS's own comment, not a program called REM. */
    expect(autoexecProgram('[autoexec]\nmount c .\nrem straight into the level\nGAME.BAT\n'))
      .toEqual({ file: 'GAME.BAT', args: [] });
    /* The last thing that runs wins, because that is what the machine ends on. */
    expect(autoexecProgram('[autoexec]\nSETUP.EXE\nGAME.EXE\n')?.file).toBe('GAME.EXE');
    expect(autoexecProgram('[autoexec]\nmount c .\nc:\n')).toBeNull();
    expect(autoexecProgram(null)).toBeNull();
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

describe('the vendored js-dos still honours the player’s contract', () => {
  /* The player passes `autoStart`/`kiosk`/`onEvent` and watches for a canvas and
     a `.pre-run-window`. Every one of those is js-dos's own vocabulary, not
     ours: if an upgrade renames the event, the option or the window class, the
     player stops working in a way no type checker and no HTTP check can see.
     These assertions fail the build before that ships. */
  const lib = readFileSync(join(root, 'public/retro/jsdos/js-dos.js'), 'utf8');

  it('has the autoStart option the player relies on', () => {
    expect(lib).toContain('autoStart');
    /* The gate itself: `bndReady` only plays by itself when autoStart is set and
       there is no countdown. This is the line that was missing from our call. */
    expect(lib).toMatch(/autoStart&&0===e\.countDownStart\?/);
  });

  it('emits the events the player listens for', () => {
    for (const event of ['ci-ready', 'emu-ready', 'fullscreen-change']) {
      expect(lib, event).toContain(event);
    }
  });

  it('still has the pre-run window the player clicks through', () => {
    expect(lib).toContain('pre-run-window');
    expect(lib).toContain('jsdos-rso');
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
      'Calibration', 'Celis', 'DOOM', 'Floppybird', 'Moth Hunter', 'nasm-tetris',
      'Out of Cash', 'Sadist', 'Snake (54 bytes)', 'Super Vinnie-Pooh',
    ]);
    for (const game of shelf.games) {
      expect(game.rights.length).toBeGreaterThan(8);
      /* A formal licence, not an aggregator's label — this is the whole point.
         One exception, and it is not a label: DOOM's shareware episode ships
         under id's own terms, confirmed in writing by John Carmack on
         23 October 1999 and relied on by Debian and RPM Fusion to this day, so
         it is held to its own, stricter test below. */
      expect(game.license, game.id).toMatch(/^(CC0|MIT|GPL|ISC|Apache|BSD|Distributable)/);
      expect(game.bundle).toMatch(/^bundles\/[a-z0-9-]+\.jsdos$/);
      expect(game.sourceUrl.startsWith('https://')).toBe(true);
    }
    expect(dosGameById(shelf.games, 'pikachu-calibration')?.title).toBe('Calibration');
    expect(dosGameById(shelf.games, 'sadist')?.license).toBe('GPL-3.0');
    expect(dosGameById(shelf.games, 'moth-hunter')?.license).toBe('MIT');
    /* DOOM is here on the shareware basis, and the record has to say so: the
       bytes are id's, the permission rests on a written statement, and the
       registered episodes are not in the bundle. */
    const doom = dosGameById(shelf.games, 'doom-shareware');
    expect(doom?.title).toBe('DOOM');
    expect(doom?.license).toMatch(/^Distributable/);
    expect(doom?.rights).toMatch(/Carmack/);
    expect(doom?.rights.toLowerCase()).toContain('freely distributable');
    /* Vice City still has no DOS release, so it is still not here. */
    expect(dosGameById(shelf.games, 'vice-city')).toBeNull();
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

      /* The program the autoexec names has to exist at the archive root. The
         line may carry switches — DOOM boots straight into a level — so this
         reads the program the same way the build scripts do. */
      const program = autoexecProgram(report.autoexec)?.file;
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
