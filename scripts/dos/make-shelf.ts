/**
 * `npm run dos:shelf` — build the calibration bundle and the DOS shelf manifest.
 *
 * Two things end up on the shelf, and they are written by two different scripts:
 *
 *   · The **calibration cartridge**, generated here from first principles: a
 *     16-bit DOS program assembled byte by byte, wrapped in a `.jsdos` bundle
 *     with the `dosbox.conf` the format requires. It is not a game, it is the DOS
 *     equivalent of a test card — banner in text mode, four colour bars in mode
 *     13h, exit on a keypress — and it proves the player boots without shipping
 *     anybody's game or claiming anybody's rights. It is authored here and
 *     released CC0.
 *   · The **free-software games** listed in `scripts/dos/records.json`, which
 *     `npm run dos:games` writes after it has downloaded and packaged each one
 *     from its author's repository. This script only reads those records back,
 *     checks the bundle beside each one is the size the record claims, and puts
 *     them in the same manifest — so the shelf can be rebuilt with no network.
 *
 * One layout rule matters and was wrong in the first version of this file: js-dos
 * unpacks a bundle into `C:\`, so an `[autoexec]` line like `CALIB.COM` only
 * resolves if `CALIB.COM` sits at the archive root. The binary used to be put in
 * a `GAME/` subdirectory, which the autoexec would never have found; it is at the
 * root now, and both this script and `scripts/smoke-dos.ts` check the name.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { MAX_BUNDLE_BYTES, inspectBundle, validateDosGame } from '../../src/lib/dos';
import { buildZip, readZipDirectory, readZipEntry } from '../../src/lib/zip';

/* ------------------------------------------------------------- assembler */

type Fixup = { at: number; label: string; kind: 'rel8' | 'abs16' };

/**
 * A label resolver for the 30-or-so instructions below. Not an assembler —
 * `db` and `label` plus two jump fixups — but enough that an offset cannot drift
 * when a byte is added, which is the usual way hand-written machine code rots.
 */
class Program {
  code: number[] = [];
  #labels = new Map<string, number>();
  #fixups: Fixup[] = [];

  label(name: string) {
    this.#labels.set(name, this.code.length);
    return this;
  }

  db(...bytes: number[]) {
    this.code.push(...bytes);
    return this;
  }

  /** `jmp`/`jz`/`loop` with an 8-bit displacement, resolved in `assemble`. */
  rel8(opcode: number, label: string) {
    this.code.push(opcode, 0);
    this.#fixups.push({ at: this.code.length - 1, label, kind: 'rel8' });
    return this;
  }

  /** `mov dx, label` (or any absolute 16-bit immediate), resolved in `assemble`. */
  abs16(opcode: number, label: string) {
    this.code.push(opcode, 0, 0);
    this.#fixups.push({ at: this.code.length - 2, label, kind: 'abs16' });
    return this;
  }

  assemble(): Uint8Array {
    for (const fix of this.#fixups) {
      const target = this.#labels.get(fix.label);
      if (target === undefined) throw new Error(`undefined label ${fix.label}`);
      if (fix.kind === 'abs16') {
        /* .COM programs are loaded at 0x100, so a label's file offset is also its
           runtime address once 0x100 is added. */
        const value = target + 0x100;
        this.code[fix.at] = value & 0xff;
        this.code[fix.at + 1] = (value >> 8) & 0xff;
      } else {
        /* `at` is the displacement byte, which is the last byte of the 2-byte
           instruction: the next instruction starts one past it. Getting this
           wrong is a one-byte jump into the middle of an instruction, which is
           exactly the kind of bug that shows up as a black screen. */
        const after = fix.at + 1;
        const delta = target - after;
        if (delta < -128 || delta > 127) throw new Error(`jump to ${fix.label} is out of range (${delta})`);
        this.code[fix.at] = delta & 0xff;
      }
    }
    return Uint8Array.from(this.code);
  }
}

/**
 * CALIB.COM
 *
 *   text mode:  print the banner, wait for a key
 *   mode 13h:   fill 4 × 16000 bytes of A000:0 with four colours, wait for a key
 *   mode 3:     back to text, and round again — forever, until the visitor
 *               leaves the page
 *
 * It used to finish with INT 21h AH=4Ch, and that was a mistake worth recording:
 * the program returned to DOS, DOSBox cleared video mode 13h and drew a bare
 * `C:\>` prompt, so the cartridge whose entire job is to prove the player works
 * ended on a black screen. A test card should not exit. It now loops, which also
 * gives a visitor something to press and a way to see both video modes.
 *
 * Only three interrupts are used, all of them BIOS/DOS staples: INT 10h AH=00h
 * (set video mode), INT 21h AH=09h/01h (print, read key). Nothing here depends
 * on the emulator beyond running x86.
 */
function calibrationProgram(): Uint8Array {
  const p = new Program();

  /* ---- banner, in the default text mode ---- */
  p.label('top');
  p.db(0xb4, 0x09);            // mov ah, 09h   — write $-terminated string
  p.abs16(0xba, 'banner');     // mov dx, banner
  p.db(0xcd, 0x21);            // int 21h
  p.db(0xb4, 0x01);            // mov ah, 01h   — wait for a key
  p.db(0xcd, 0x21);            // int 21h

  /* ---- graphics: mode 13h, four colour bars ---- */
  p.db(0xb8, 0x13, 0x00);      // mov ax, 0013h — 320×200×256 VGA
  p.db(0xcd, 0x10);            // int 10h
  p.db(0xb8, 0x00, 0xa0);      // mov ax, A000h — video memory segment
  p.db(0x8e, 0xc0);            // mov es, ax
  p.db(0x31, 0xff);            // xor di, di
  p.db(0xb3, 0x04);            // mov bl, 4     — four bars
  p.db(0xb0, 0x01);            // mov al, 1     — colour 1 (blue)

  p.label('bar');
  p.db(0xb9, 0x80, 0x3e);      // mov cx, 16000 — 320 * 50 pixels = one bar
  p.label('fill');
  p.db(0x26, 0x88, 0x05);      // mov [es:di], al
  p.db(0x47);                  // inc di
  p.rel8(0xe2, 'fill');        // loop fill
  p.db(0xfe, 0xc0);            // inc al        — next colour
  p.db(0xfe, 0xcb);            // dec bl
  p.rel8(0x75, 'bar');         // jnz bar

  p.db(0xb4, 0x01);            // mov ah, 01h   — wait for a key
  p.db(0xcd, 0x21);            // int 21h

  /* ---- back to text, and round again ---- */
  p.db(0xb8, 0x03, 0x00);      // mov ax, 0003h — 80×25 text, which clears
  p.db(0xcd, 0x10);            // int 10h
  p.rel8(0xeb, 'top');         // jmp top       — never exits to the DOS prompt

  p.label('banner');
  const text =
    '\r\n' +
    '  PIKACHU ARCADE / DOS CALIBRATION\r\n' +
    '  ----------------------------------\r\n' +
    '  Text mode is working. Press any key for the colour bars,\r\n' +
    '  and any key again to come back to this screen.\r\n' +
    '\r\n' +
    '  If you can read this and see four coloured bars, the player,\r\n' +
    '  its DOSBox core and this cartridge are all working.\r\n' +
    '$';
  p.db(...new TextEncoder().encode(text));

  return p.assemble();
}

/**
 * The `dosbox.conf` a `.jsdos` bundle is required to carry.
 *
 * Conservative on purpose: the smallest sensible memory size, a fixed cycle count
 * so a calibration run is reproducible, and an `[autoexec]` that mounts the
 * bundle and starts the program — no installer, no interactive prompt.
 */
/* No `exit` at the end of the [autoexec]: quitting DOS shuts js-dos down, and a
   test card that ends by itself would look like a crash. */
const DOSBOX_CONF = `[sdl]
fullscreen=false
fulldouble=false

[dosbox]
machine=svga_s3
memsize=16

[cpu]
core=auto
cycles=8000
cycleup=500
cycledown=500

[mixer]
nosound=false
rate=44100
blocksize=1024
prebuffer=20

[autoexec]
@echo off
mount c .
c:
CALIB.COM
`;

const SHELF_NOTE =
  'The DOS shelf holds only builds this project may host: four games published by their own authors ' +
  'under the GPL or MIT, plus our CC0 calibration cartridge. None of them is a commercial title. The ' +
  '1,499 titles in the discovery index are somebody else’s games with an aggregator’s "Freeware" or ' +
  '"Shareware" label, which is not a redistribution grant — so they stay in the review queue, ' +
  'searchable and linked to their original source, with no Play button until an administrator records ' +
  'evidence on the desk.';

/** The cartridge this script builds, in the shape the shelf manifest expects. */
function calibrationRecord(programBytes: number, bundleBytes: number) {
  return {
    id: 'pikachu-calibration',
    title: 'Calibration',
    tagline: 'The player’s own test card',
    year: 2026,
    author: 'Pikachu Arcade',
    license: 'CC0-1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    sourceUrl: 'https://github.com/razalpa64/pikachu',
    description:
      `A ${programBytes}-byte program written for this site and assembled byte by byte in ` +
      '`scripts/dos/make-shelf.ts`. It prints a banner in text mode, paints four colour bars in VGA ' +
      'mode 13h, then loops back to the banner — press any key to alternate between the two screens. ' +
      'If the DOS player is working, this runs — which is why it ships: it is the one cartridge whose ' +
      'behaviour we can describe exactly.',
    bundle: 'bundles/pikachu-calibration.jsdos',
    bytes: bundleBytes,
    cover: null,
    accent: '#f2c14e',
    tags: ['test', 'utility'],
    rights: 'Authored for this project and released CC0 1.0. Contains no third-party code or data.',
  };
}

/**
 * Read the records `npm run dos:games` wrote, and refuse to publish a record the
 * site would not accept or whose bundle is missing or a different size. A shelf
 * that silently drops a game is a shelf that lies about what it holds.
 */
interface ShelfRow {
  id: string;
  title: string;
  bundle: string;
  bytes: number;
}

function readBuiltGames(): ShelfRow[] {
  const file = resolve('scripts/dos/records.json');
  if (!existsSync(file)) {
    process.stdout.write('  no scripts/dos/records.json — run `npm run dos:games` to package the games\n');
    return [];
  }
  const raw = JSON.parse(readFileSync(file, 'utf8')) as { games?: unknown[] };
  const out: ShelfRow[] = [];
  for (const item of raw.games ?? []) {
    const game = validateDosGame(item);
    if (!game) throw new Error(`records.json holds a record the shelf would reject: ${JSON.stringify(item).slice(0, 120)}`);
    const bundleFile = resolve('public/retro/dos', game.bundle);
    if (!existsSync(bundleFile)) throw new Error(`${game.id}: ${game.bundle} is missing — run npm run dos:games`);
    const onDisk = statSync(bundleFile).size;
    if (onDisk !== game.bytes) throw new Error(`${game.id}: record says ${game.bytes} bytes, bundle is ${onDisk}`);
    /* The whole record goes into the manifest, not just its size: this is the
       authored text (description, rights, licence link) from records.json. */
    out.push(game as unknown as ShelfRow);
  }
  return out;
}

/** The bundle the manifest advertises has to be one the player will accept. */
async function checkBundle(id: string, file: string): Promise<string> {
  const bytes = new Uint8Array(readFileSync(file));
  if (bytes.length === 0 || bytes.length > MAX_BUNDLE_BYTES) throw new Error(`${id}: bundle size ${bytes.length} is out of bounds`);
  const entries = readZipDirectory(bytes);
  const conf = await readZipEntry(bytes, '.jsdos/dosbox.conf');
  const report = inspectBundle({ bytes, entries, conf: conf ? new TextDecoder().decode(conf) : null });
  if (!report.ok) throw new Error(`${id}: bundle failed the structural check (${report.problems.join(', ')})`);

  /* The program the autoexec starts must exist at the archive root: js-dos
     mounts the bundle as C:, so a subdirectory would be a black screen. */
  const program = (report.autoexec ?? '')
    .split('\n')
    .map((line) => line.trim())
    /* Out of Cash's conf ends with a block of `# Generated using ...` comments,
       and one of them mentions js-dos.com — strip comments before guessing
       which line is the program. */
    .filter((line) => line && !line.startsWith('#') && !line.startsWith(';'))
    .filter((line) => /\.(exe|com|bat)$/i.test(line))
    .pop();
  const present = program && entries?.some((e) => e.name.toLowerCase() === program.toLowerCase());
  if (program && !present) {
    throw new Error(`${id}: [autoexec] starts ${program}, which is not at the bundle root (${entries?.length ?? 0} entries)`);
  }
  if (program && /\.exe$/i.test(program)) {
    const body = await readZipEntry(bytes, program);
    if (!body || !(body[0] === 0x4d && body[1] === 0x5a)) {
      throw new Error(`${id}: ${program} has no MZ header — it is not a DOS executable`);
    }
  }
  return `${report.entries} entries · ${program ?? 'no program'}`;
}

async function main() {
  const bundleDir = resolve('public/retro/dos/bundles');
  mkdirSync(bundleDir, { recursive: true });

  const program = calibrationProgram();
  const conf = new TextEncoder().encode(DOSBOX_CONF);
  const readme = new TextEncoder().encode(
    'PIKACHU ARCADE — DOS calibration cartridge\r\n' +
    'Written for this project, released under CC0 1.0.\r\n' +
    'It is a test pattern, not a game.\r\n',
  );

  /* Flat: `.jsdos/` holds the config, everything else lands in C:\ — the same
     shape as the bundles js-dos itself generates. */
  const bundle = buildZip([
    { name: '.jsdos/dosbox.conf', data: conf },
    { name: 'CALIB.COM', data: program },
    { name: 'README.TXT', data: readme },
  ]);

  const calibrationFile = resolve(bundleDir, 'pikachu-calibration.jsdos');
  writeFileSync(calibrationFile, bundle);

  const built = readBuiltGames();

  const file = resolve('public/retro/dos/shelf.json');
  const existing = existsSync(file)
    ? (JSON.parse(readFileSync(file, 'utf8')) as { games?: ShelfRow[] }).games ?? []
    : [];
  const known = new Set(['pikachu-calibration', ...built.map((g) => g.id)]);
  /* Anything an administrator published earlier is left alone; this script only
     owns the calibration cartridge and the records npm run dos:games built. */
  const extras = existing.filter((g) => g && !known.has(g.id));

  const games = [calibrationRecord(program.length, bundle.length), ...built, ...extras];
  for (const game of games) {
    if (!game) continue;
    const verdict = await checkBundle(game.id, resolve('public/retro/dos', game.bundle));
    process.stdout.write(`  ${game.id.padEnd(24)} ${String(game.bytes).padStart(9)} bytes  ${verdict}\n`);
  }
  games.sort((a, b) => (a && b ? a.title.localeCompare(b.title) : 0));

  const shelf = { version: 1, system: 'MS-DOS', note: SHELF_NOTE, games };

  writeFileSync(file, `${JSON.stringify(shelf, null, 2)}\n`);

  process.stdout.write(
    `\n  CALIB.COM   ${program.length} bytes\n` +
    `  bundle      ${bundle.length} bytes  → public/retro/dos/bundles/pikachu-calibration.jsdos\n` +
    `  shelf       ${games.length} cartridge(s) → public/retro/dos/shelf.json\n\n`,
  );
}

main().catch((error) => {
  console.error(`\n  ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
