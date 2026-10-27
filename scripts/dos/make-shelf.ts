/**
 * `npm run dos:shelf` — build the calibration bundle and the DOS shelf manifest.
 *
 * The shelf has to contain *something* that is provably ours, or "the DOS player
 * works" would be an untested claim. So this generates one cartridge from first
 * principles: a 16-bit DOS program assembled byte by byte here, wrapped in a
 * `.jsdos` bundle with the `dosbox.conf` the format requires.
 *
 * It is not a game. It is the DOS equivalent of a test card: it prints a banner
 * in text mode, then paints four colour bars in mode 13h, then exits on a
 * keypress. That exercises the things an emulator can get wrong — DOS boot,
 * `[autoexec]`, INT 21h, INT 10h, a VGA mode switch, direct writes to `A000:0` —
 * without shipping anybody else's game or claiming anybody else's rights.
 *
 * Everything here is authored for this project and released CC0, which is the
 * one kind of permission that needs no verification.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildZip } from '../../src/lib/zip';

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
 *   text mode:  print a two-line banner, wait for a key
 *   mode 13h:   fill 4 × 16000 bytes of A000:0 with four colours, wait for a key
 *   mode 3:     restore text, exit to DOS
 *
 * Only three interrupts are used, all of them BIOS/DOS staples: INT 10h AL=0Eh
 * (teletype), INT 10h AH=00h (set video mode), INT 21h AH=09h/01h/4Ch (print,
 * read key, exit). Nothing here depends on the emulator beyond running x86.
 */
function calibrationProgram(): Uint8Array {
  const p = new Program();

  /* ---- banner, in the default text mode ---- */
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

  /* ---- back to text and out ---- */
  p.db(0xb8, 0x03, 0x00);      // mov ax, 0003h
  p.db(0xcd, 0x10);            // int 10h
  p.db(0xb8, 0x00, 0x4c);      // mov ax, 4C00h
  p.db(0xcd, 0x21);            // int 21h

  p.label('banner');
  const text =
    '\r\n' +
    '  PIKACHU ARCADE / DOS CALIBRATION\r\n' +
    '  ----------------------------------\r\n' +
    '  Text mode: OK. Press a key for graphics...\r\n' +
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
exit
`;

const SHELF_NOTE =
  'The DOS shelf here holds only builds this project may host: the calibration cartridge below is ' +
  'our own work, released CC0. The 1,499 titles in the discovery index are somebody else’s games with ' +
  'an aggregator’s "Freeware" or "Shareware" label, which is not a redistribution grant — so they are ' +
  'listed, searchable and linked to their original source, and they have no Play button until an ' +
  'administrator records evidence on the desk.';

function main() {
  const bundleDir = resolve('public/retro/dos/bundles');
  mkdirSync(bundleDir, { recursive: true });

  const program = calibrationProgram();
  const conf = new TextEncoder().encode(DOSBOX_CONF);
  const readme = new TextEncoder().encode(
    'PIKACHU ARCADE — DOS calibration cartridge\r\n' +
    'Written for this project, released under CC0 1.0.\r\n' +
    'It is a test pattern, not a game.\r\n',
  );

  const bundle = buildZip([
    { name: '.jsdos/dosbox.conf', data: conf },
    { name: 'GAME/CALIB.COM', data: program },
    { name: 'GAME/README.TXT', data: readme },
  ]);

  writeFileSync(resolve(bundleDir, 'pikachu-calibration.jsdos'), bundle);

  const shelf = {
    version: 1,
    system: 'MS-DOS',
    note: SHELF_NOTE,
    games: [
      {
        id: 'pikachu-calibration',
        title: 'Calibration',
        tagline: 'The player’s own test card',
        year: 2026,
        author: 'Pikachu Arcade',
        license: 'CC0-1.0',
        licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
        sourceUrl: 'https://github.com/razalpa64/pikachu',
        description:
          `A ${program.length}-byte program written for this site and assembled byte by byte in ` + '`scripts/dos/make-shelf.ts`. ' +
          'It prints a banner in text mode, paints four colour bars in VGA mode 13h, then returns to DOS. ' +
          'If the DOS player is working, this runs — which is why it ships: it is the one cartridge whose ' +
          'behaviour we can describe exactly.',
        bundle: 'bundles/pikachu-calibration.jsdos',
        bytes: bundle.length,
        cover: null,
        accent: '#f2c14e',
        tags: ['test', 'utility'],
        rights: 'Authored for this project and released CC0 1.0. Contains no third-party code or data.',
      },
    ],
  };

  writeFileSync(resolve('public/retro/dos/shelf.json'), `${JSON.stringify(shelf, null, 2)}\n`);

  process.stdout.write(
    `\n  CALIB.COM   ${program.length} bytes\n` +
    `  bundle      ${bundle.length} bytes  → public/retro/dos/bundles/pikachu-calibration.jsdos\n` +
    `  shelf       1 cartridge → public/retro/dos/shelf.json\n\n`,
  );
}

main();
