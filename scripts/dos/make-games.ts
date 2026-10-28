/**
 * `npm run dos:games` — build the `.jsdos` bundles for the free-software shelf.
 *
 * The DOS shelf started with one cartridge: our own CC0 calibration program. A
 * test card proves the player boots; it is not a game. This script fills the
 * shelf with actual games, and it is deliberately narrow about which ones:
 *
 *   · The rights must be a real grant, held by the person who published the
 *     build. Most titles come from the author's own repository with a LICENSE
 *     file at the commit recorded beside it — GPL-3.0 for the two Polish games
 *     and the Spanish adventure, MIT for the 508-byte one. There is no
 *     "freeware" label anywhere in this list, because that label is not a grant.
 *   · The shareware shelf is the other kind of grant, and it is quoted rather
 *     than assumed: Apogee's VENDOR.DOC and Epic's LICENSE.DOC say in as many
 *     words that the release may be copied and passed on without charge, and
 *     those files ship inside each cartridge. Only the shareware editions are
 *     here — the registered episodes were sold, and are not.
 *   · The files must already exist in the repository. Nothing here is compiled:
 *     there is no DOS toolchain in this project, and shipping a binary somebody
 *     else built from a tarball we cannot reproduce would be worse than shipping
 *     nothing. Where the project publishes a ready `.jsdos` bundle (Out of Cash
 *     does), we take it byte for byte instead of repacking it.
 *   · The layout must match what js-dos actually mounts. A bundle is unpacked
 *     into `C:\`, so the program the `[autoexec]` runs has to sit at the archive
 *     root — not in a subdirectory. `inspectBundle` checks the structure, this
 *     script checks the program name resolves, and neither of those is a
 *     gameplay test: see docs/pikachu-arcade.md for what was and was not run.
 *
 * Outputs:
 *   public/retro/dos/bundles/<id>.jsdos     the cartridge
 *   scripts/dos/records.json                shelf records with real byte counts
 *
 * `npm run dos:shelf` then merges those records with the calibration cartridge
 * and writes the manifest, so the shelf can be rebuilt offline afterwards.
 *
 * Downloads are cached under node_modules/.cache/ (never committed). Two repos
 * are small enough to take as one codeload zip; the other two are fetched as
 * individual blobs, because their repositories are tens of megabytes of art and
 * source we do not need. Set GITHUB_TOKEN to lift the anonymous rate limit.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { autoexecProgram, inspectBundle } from '../../src/lib/dos';
import { buildZip, readZipDirectory, readZipEntry } from '../../src/lib/zip';

/* --------------------------------------------------------------- plumbing */

const CACHE = resolve('node_modules/.cache/pikachu-dos-games');
const BUNDLE_DIR = resolve('public/retro/dos/bundles');
const RECORDS = resolve('scripts/dos/records.json');
const USER_AGENT = 'pikachu-arcade-dos-shelf (+https://github.com/razalpa64/pikachu)';

const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? '';
const authHeaders: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const text = (value: string): Uint8Array => new TextEncoder().encode(value);

function cached(name: string): string {
  const file = resolve(CACHE, name);
  mkdirSync(dirname(file), { recursive: true });
  return file;
}

/** One request per repository, cached on disk: the whole tree of a small repo. */
async function repoZip(repo: string, ref: string): Promise<Uint8Array> {
  const file = cached(`${repo.replace('/', '_')}@${ref}.zip`);
  if (existsSync(file)) return new Uint8Array(readFileSync(file));
  const url = `https://codeload.github.com/${repo}/zip/${ref}`;
  process.stdout.write(`  ↓ ${repo} @ ${ref.slice(0, 7)} (zip)\n`);
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT, ...authHeaders } });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  writeFileSync(file, bytes);
  return bytes;
}

/** One blob out of a big repository, through the contents API (raw accept). */
async function blob(repo: string, ref: string, path: string): Promise<Uint8Array> {
  const name = `${repo.replace('/', '_')}@${ref}/${path.replace(/[\\/]/g, '__')}`;
  const file = cached(name);
  if (existsSync(file)) return new Uint8Array(readFileSync(file));
  process.stdout.write(`  ↓ ${repo}/${path} @ ${ref.slice(0, 7)}\n`);
  const url = `https://api.github.com/repos/${repo}/contents/${path}?ref=${ref}`;
  const res = await fetch(url, {
    headers: { accept: 'application/vnd.github.raw', 'user-agent': USER_AGENT, ...authHeaders },
  });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  writeFileSync(file, bytes);
  return bytes;
}

/**
 * The archive the 1990s shareware releases are taken from, pinned to a commit.
 *
 * These are the publishers' own distribution copies — Apogee, id and Epic
 * shipped them to be copied, and each one carries the notice that says so
 * inside the release itself (VENDOR.DOC for Apogee's titles, LICENSE.DOC for
 * Epic's), which is why those files are in every bundle. The archive is a
 * catalogue of those releases, not a ROM site: it holds the shareware package,
 * not the registered game, and it is addressed file by file so a bundle can pin
 * a whole directory's contents by one digest (see `shareware` below).
 */
const SHAREWARE_REPO = 'flynnsbit/DOS_Shareware_MyMenu';
const SHAREWARE_REF = '1b40b8e3c09f73bed1634686f82822c35e0fc138';

/**
 * What a shareware directory carries that is not the game: the vendor's own
 * screenshots, DOS backup files, and the extra archives some releases shipped
 * beside the game. Everything else at the top level goes in, including the
 * licence documents, because they are the permission.
 */
const SHAREWARE_SKIP = /^~\$|^-Cover-|\.(swp|swc|zip|jpg)$/i;

/** The folder a shareware release was taken from, at the pinned commit. */
const sharewareUrl = (dir: string): string =>
  `https://github.com/${SHAREWARE_REPO}/tree/${SHAREWARE_REF}/GAMES/${encodeURIComponent(dir)}`;

/** A directory listing, cached like a blob: one request, then offline. */
async function listing(repo: string, ref: string, dir: string): Promise<{ name: string; type: string }[]> {
  const name = `${repo.replace('/', '_')}@${ref}/LISTING/${dir.replace(/[\\/ ]/g, '_')}.json`;
  const file = cached(name);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const url = `https://api.github.com/repos/${repo}/contents/${encodeURI(dir)}?ref=${ref}`;
  process.stdout.write(`  ↓ ${repo}/${dir} (listing)\n`);
  const res = await fetch(url, { headers: { accept: 'application/vnd.github+json', 'user-agent': USER_AGENT, ...authHeaders } });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  const body = (await res.json()) as { name: string; type: string }[];
  writeFileSync(file, JSON.stringify(body.map(({ name: n, type }) => ({ name: n, type })), null, 1));
  return body;
}

/* ------------------------------------------------------------- the shelf */

/** A directory whose files are copied into the bundle, flattened or kept. */
interface DirRule {
  /** Path inside the repository. */
  from: string;
  /** Where the files land in the bundle; `''` is the archive root. */
  to: string;
  /** Keep only these extensions (lower case, with the dot). */
  only?: string[];
  /** Skip any file whose name matches — backups, installers, duplicates. */
  skip?: RegExp;
}

interface Title {
  id: string;
  repo: string;
  /** Commit, not branch: a bundle has to point at bytes that will not move. */
  ref: string;
  /** Copy whole-tree files out of a codeload zip. */
  zip?: { files: { from: string; as: string }[]; dirs: DirRule[] };
  /** Or take a handful of blobs (big repositories). */
  blobs?: { from: string; as: string; sha256?: string }[];
  /**
   * Or open a zip that is hosted in somebody's repository and take named files
   * out of it. A shareware release is published as one archive; the mirror keeps
   * the archive, not its parts, so this is the only way to get the release's own
   * DOOM.EXE and DOOM1.WAD without unpacking anything by hand.
   */
  archives?: { from: string; entries: { path: string; as: string; sha256?: string }[] }[];
  /**
   * Or take a shareware release's directory, file by file, from the archive
   * above. Every file at the top level is kept — executable, data, and the
   * release's own licence and readme files — because the notice that permits
   * redistribution travels with the game. The digest is over the sorted
   * `name<TAB>sha256` lines of exactly the files that were kept, so a mirror
   * that adds, drops, edits or replaces any of them fails the build.
   */
  shareware?: { dir: string; sha256: string; skip?: RegExp };
  /** Or ship the project's own published bundle, untouched. */
  prebuilt?: string;
  /** Only for bundles we build: the conf and the program its autoexec starts. */
  boot?: { conf: string; entry: string };
  /** A committed screenshot of the running game, used as its card cover. */
  cover?: string | null;
  /**
   * Where the game files came from, when it is not the author's own repository.
   * The default note in `sourceNote` claims the bundles are the project's own
   * files under a free licence; that is true of every title above and false for
   * a vendor's shareware release, so the note has to be able to say so.
   */
  origin?: 'author' | 'vendor-shareware';
  record: {
    title: string;
    tagline: string;
    year: number | null;
    author: string;
    license: string;
    licenseUrl: string;
    sourceUrl: string;
    description: string;
    accent: string;
    tags: string[];
    rights: string;
  };
}

const GPL3 = 'https://www.gnu.org/licenses/gpl-3.0.html';
const GPL3_RIGHTS =
  'GPL-3.0. The copyright holder published the game, its data files and its source in this ' +
  'repository under the GPL, so hosting an unmodified build is permission the licence itself ' +
  'grants — no aggregator label, no upload from a third party, no ROM site. The licence text ' +
  'ships inside the bundle as LICENSE.TXT and the source is the repository at the commit below.';

/* Every generated [autoexec] ends with the program and nothing after it.
   It used to end with `exit`, which quits DOS — and js-dos tears the whole
   session down when DOS quits, so a game that ends (or fails to start) looked
   like the emulator crashing. Leaving the prompt up keeps the screen alive.

   `autolock` is false in every conf this repository writes, and that is a UI
   decision as much as an input one. js-dos turns `autolock=true` into pointer
   lock, and while capture is on it draws two things over the game: a full-screen
   "Click to capture mouse" overlay and a sensitivity slider down the left edge.
   Both are right for a first-person game with mouse-look; neither is right for
   an arrow-key arcade game, and none of the nine cartridges here is the former —
   the adventures among them (Celis, Sadist) move the DOS cursor absolutely,
   which works without the lock. DOSBox's own default is `autolock=true`, and
   authors usually copy their conf from a template, so it arrives switched on.
   Dragging the pointer without capture is handled by js-dos's own swipe mapping;
   the mouse is not disabled, it is simply not trapped. */

const CELIS_CONF = `[sdl]
fullscreen=false
fulldouble=false
autolock=false
sensitivity=100
waitonerror=true
usescancodes=true

[dosbox]
machine=svga_s3
memsize=32

[render]
frameskip=0
aspect=false

[cpu]
core=dynamic
cputype=auto
cycles=fixed 130000
cycleup=500
cycledown=20

[mixer]
nosound=false
rate=44100
blocksize=2048
prebuffer=10

[sblaster]
sbtype=sb16
sbbase=220
irq=7
dma=1
sbmixer=true
oplmode=auto
oplemu=default

[dos]
xms=true
ems=true
umb=true

[autoexec]
@echo off
mount c .
c:
CELIS.EXE
`;

const SADIST_CONF = `[sdl]
fullscreen=false
fulldouble=false
autolock=false
sensitivity=100
waitonerror=true

[dosbox]
machine=svga_s3
memsize=16

[render]
frameskip=0
aspect=false

[cpu]
core=dynamic
cputype=auto
cycles=fixed 30000
cycleup=500
cycledown=20

[mixer]
nosound=false
rate=44100
blocksize=1024
prebuffer=20

[sblaster]
sbtype=sb16
sbbase=220
irq=7
dma=1
sbmixer=true
oplmode=auto
oplemu=default

[dos]
xms=true
ems=true
umb=true

[autoexec]
@echo off
mount c .
c:
SADIST.EXE
`;

/* DOOM's own setup asks for 8 MB of EMS and VGA; 16 MB of machine and a fixed
   20 000 cycles is what keeps its timed code steady in a browser. Sound is a
   Sound Blaster 16, the card SETUP defaults to, so the shotgun has a report. */
const DOOM_CONF = `[sdl]
fullscreen=false
fulldouble=false
autolock=false
waitonerror=true

[dosbox]
machine=svga_s3
memsize=16

[render]
frameskip=0
aspect=false

[cpu]
core=dynamic
cputype=auto
cycles=fixed 20000
cycleup=500
cycledown=20

[mixer]
nosound=false
rate=44100
blocksize=1024
prebuffer=20

[sblaster]
sbtype=sb16
sbbase=220
irq=7
dma=1
sbmixer=true
oplmode=auto
oplemu=default

[dos]
xms=true
ems=true
umb=true

[autoexec]
@echo off
mount c .
c:
rem Straight into Knee-Deep in the Dead, mission 1, on the middle skill: the
rem menu is four screens of red-on-red on a phone, and the point of pressing
rem Play on a shelf is to be in the game. "Hurt me plenty" is DOOM's own name
rem for skill 3, the difficulty id called the default.
DOOM.EXE -warp 1 1 -skill 3
`;

const MOTH_CONF = `[sdl]
fullscreen=false
fulldouble=false
autolock=false
waitonerror=true

[dosbox]
machine=svga_s3
memsize=16

[cpu]
core=auto
cycles=fixed 8000
cycleup=500
cycledown=500

[mixer]
nosound=false
rate=44100
blocksize=1024
prebuffer=20

[dos]
xms=true
ems=true
umb=true

[autoexec]
@echo off
mount c .
c:
MOTH.COM
`;

const VINNIE_CONF = `[sdl]
fullscreen=false
fulldouble=false
autolock=false
waitonerror=true

[dosbox]
machine=svga_s3
memsize=16

[cpu]
core=auto
cycles=fixed 30000
cycleup=500
cycledown=20

[mixer]
nosound=false
rate=44100
blocksize=1024
prebuffer=20

[sblaster]
sbtype=sb16
sbbase=220
irq=7
dma=1
sbmixer=true
oplmode=auto
oplemu=default

[dos]
xms=true
ems=true
umb=true

[autoexec]
@echo off
mount c .
c:
POOH.EXE
`;

const BIRD_CONF = `[sdl]
fullscreen=false
fulldouble=false
autolock=false
waitonerror=true

[dosbox]
machine=svga_s3
memsize=16

[cpu]
core=auto
cycles=fixed 10000
cycleup=500
cycledown=500

[mixer]
nosound=false
rate=44100
blocksize=1024
prebuffer=20

[dos]
xms=true
ems=true
umb=true

[autoexec]
@echo off
mount c .
c:
FLPYBIRD.COM
`;

const TETRIS_CONF = `[sdl]
fullscreen=false
fulldouble=false
autolock=false
waitonerror=true

[dosbox]
machine=svga_s3
memsize=16

[cpu]
core=auto
cycles=fixed 8000
cycleup=500
cycledown=500

[mixer]
nosound=false
rate=44100
blocksize=1024
prebuffer=20

[dos]
xms=true
ems=true
umb=true

[autoexec]
@echo off
mount c .
c:
TETRIS.EXE
`;

const SNAKE54_CONF = `[sdl]
fullscreen=false
fulldouble=false
autolock=false
waitonerror=true

[dosbox]
machine=svga_s3
memsize=16

[cpu]
core=auto
cycles=fixed 8000
cycleup=500
cycledown=500

[mixer]
nosound=true

[dos]
xms=true
ems=true
umb=true

[autoexec]
@echo off
mount c .
c:
SNAKE.COM
`;

/* `aspect=false`, and why it is not a taste decision: with `aspect=true` DOSBox
   stretches 320x200 to 4:3, js-dos 8.5.3 sizes its canvas 320x240 for that, and
   its wdosbox core then paints only the top 320x200 of it. The last 40 rows keep
   whatever was drawn there last — the emulator's own "Working..." loader bar,
   frozen under every game's HUD. With `aspect=false` the canvas is exactly the
   video mode's size, nothing is left unpainted, and the browser upscales the
   game's own pixels (the screen element asks for `image-rendering: pixelated`).
   The same line is set in every hand-written conf in this file, including the
   ones for the free-software games, because the bug was never game-specific. */

/* One conf template for the ten shareware releases.
 *
 * They are all DOS games from 1991 to 1996 that expect a VGA card, a Sound
 * Blaster and a mouse-free keyboard, so the blocks that matter are the same in
 * every one and only three numbers change: the machine's memory, the cycle
 * count, and the line the [autoexec] runs. Writing that out ten times would be
 * ten chances to typo a port number.
 *
 * `autolock` stays false for the same reason as above: these are keyboard games
 * and js-dos's pointer lock draws a capture overlay and a sensitivity slider
 * over the screen. `core=dynamic` and a fixed cycle count keep the timing of
 * games that read the PIT for their speed (Wolfenstein, Raptor) steady enough to
 * play on a phone rather than sprinting or crawling with the host's load.
 */
function sharewareConf(options: {
  entry: string;
  cycles: number;
  memsize?: number;
  /** Sound Blaster IRQ. DOSBox defaults to 7; some 1995 games assume 5. */
  irq?: number;
  note: string[];
}): string {
  return `[sdl]
fullscreen=false
fulldouble=false
autolock=false
waitonerror=true

[dosbox]
machine=svga_s3
memsize=${options.memsize ?? 16}

[render]
frameskip=0
aspect=false

[cpu]
core=dynamic
cputype=auto
cycles=fixed ${options.cycles}
cycleup=500
cycledown=20

[mixer]
nosound=false
rate=44100
blocksize=1024
prebuffer=20

[sblaster]
sbtype=sb16
sbbase=220
irq=${options.irq ?? 7}
dma=1
hdma=5
sbmixer=true
oplmode=auto
oplemu=default

[dos]
xms=true
ems=true
umb=true

[autoexec]
@echo off
mount c .
c:
rem ${options.note.join('\nrem ')}
${options.entry}
`;
}

const TITLES: Title[] = [
  {
    id: 'celis',
    repo: 'GadZombie/celis',
    ref: '01bea787b64e0033bc0fcb26784d8a5af55b6c9e',
    zip: {
      files: [
        { from: 'CELIS.EXE', as: 'CELIS.EXE' },
        { from: 'CELIS.DAT', as: 'CELIS.DAT' },
        { from: 'CELIS.CFG', as: 'CELIS.CFG' },
        { from: 'CELIS.TXT', as: 'CELIS.TXT' },
        { from: 'DZWIEK.CFG', as: 'DZWIEK.CFG' },
        { from: 'USTAW.EXE', as: 'USTAW.EXE' },
        { from: 'LICENSE', as: 'LICENSE.TXT' },
      ],
      /* `dane/` is the unpacked source of the .OBR/.GDR files the game reads out
         of CELIS.DAT — every resource is addressed as an entry inside that one
         archive, so the folder is build input, not runtime data. */
      dirs: [],
    },
    boot: { conf: CELIS_CONF, entry: 'CELIS.EXE' },
    record: {
      title: 'Celis',
      tagline: 'Polish shoot-’em-up, unfinished but playable',
      year: 2000,
      author: 'Grzegorz “GAD” Drozd',
      license: 'GPL-3.0',
      licenseUrl: GPL3,
      sourceUrl: 'https://github.com/GadZombie/celis',
      description:
        'A side-scrolling shooter for MS-DOS written in Turbo Pascal, which its author compares to ' +
        'Gradius, R-Type and Zybex. The repository labels the build “demo version 0.667” and says the ' +
        'game was never finished but is playable. Packaged from the project’s own files at commit ' +
        '01bea78; the VGA, memory and Sound Blaster settings come from the DOSBox config the author ' +
        'ships in DOSBox/Celis.conf.',
      accent: '#5cc8ff',
      tags: ['shooter', 'arcade'],
      rights: GPL3_RIGHTS,
    },
  },
  {
    id: 'sadist',
    repo: 'GadZombie/sadist',
    ref: '237267637e41e3368cf3137dc743e69db280bc83',
    zip: {
      files: [
        { from: 'SADIST.EXE', as: 'SADIST.EXE' },
        { from: 'SADIST.DAT', as: 'SADIST.DAT' },
        { from: 'GRAF.DAT', as: 'GRAF.DAT' },
        { from: 'SADIST.CFG', as: 'SADIST.CFG' },
        { from: 'DZWIEK.CFG', as: 'DZWIEK.CFG' },
        { from: 'SADIST.HSC', as: 'SADIST.HSC' },
        { from: 'SADIST.TXT', as: 'SADIST.TXT' },
        { from: 'LICENSE', as: 'LICENSE.TXT' },
      ],
      dirs: [
        { from: 'POSTACI', to: 'POSTACI' },
        { from: 'TERENY', to: 'TERENY' },
        /* The game opens 'sadist.dat', 'graf.dat', 'sadist.cfg', 'dzwiek.cfg',
           'brzeg1.bmp', 'obiekt<N>.bmp', 'textur<N>.bmp' and the WAV banks as
           bare names in the current directory — those live in Data/ in the
           repository, which is what the installer flattens into an install. So
           the assets are lifted to the bundle root, minus the Install/ folder,
           the editor/tools, and the duplicate copies of the two .DAT files that
           are already at the root. */
        { from: 'Data/!dane!', to: '', only: ['.wav', '.bmp', '.obr', '.cfg', '.kpr', '.pal', '.pmc', '.kod', '.fnt', '.txt'] },
        { from: 'Data/!textury!', to: '', only: ['.wav', '.bmp', '.obr', '.cfg', '.kpr', '.pal', '.pmc', '.kod', '.fnt', '.txt'] },
      ],
    },
    boot: { conf: SADIST_CONF, entry: 'SADIST.EXE' },
    record: {
      title: 'Sadist',
      tagline: 'The author’s own 1998 DOS game',
      year: 1998,
      author: 'Grzegorz “GAD” Drozd',
      license: 'GPL-3.0',
      licenseUrl: GPL3,
      sourceUrl: 'https://github.com/GadZombie/sadist',
      description:
        'A 1998 DOS game by Grzegorz “GAD” Drozd, who published it — binaries, data, artwork and the ' +
        'Turbo Pascal source — under the GPL. Packaged from commit 2372676 with the files the source ' +
        'opens at runtime: GRAF.DAT, SADIST.DAT, both .CFG files, the character packs in POSTACI/, the ' +
        'terrain packs in TERENY/ and the loose bitmaps and WAV banks lifted out of Data/. Its audio is ' +
        'wired to a Sound Blaster 16 in the bundle’s dosbox.conf.',
      accent: '#ff7a6b',
      tags: ['action', '1998'],
      rights: GPL3_RIGHTS,
    },
  },
  {
    id: 'out-of-cash',
    repo: 'warrior-rockk/out-of-cash',
    ref: '8dd5c620197f4b2f40666a35693f2ab34215d865',
    prebuilt: 'web/out-of-cash.jsdos',
    blobs: [{ from: 'LICENSE', as: 'LICENSE.TXT' }],
    record: {
      title: 'Out of Cash',
      tagline: 'A hand-drawn 90s high-school adventure',
      year: null,
      author: 'warrior-rockk',
      license: 'GPL-3.0',
      licenseUrl: GPL3,
      sourceUrl: 'https://github.com/warrior-rockk/out-of-cash',
      description:
        'A point-and-click graphic adventure: your favourite rock band is in town, the ticket costs ' +
        'money you do not have, and the plan is deception. Written for DOS with DJGPP and Allegro and ' +
        'released under the GPL. This bundle is the project’s own published web/out-of-cash.jsdos, ' +
        'byte for byte from commit 8dd5c62 — not repacked here, so its own dosbox.conf and CWSDPMI are ' +
        'exactly as its author tested them.',
      accent: '#ffb347',
      tags: ['adventure', 'point-and-click'],
      rights:
        'GPL-3.0, published by the game’s author with its source. The .jsdos bundle is the ' +
        'project’s own committed build, served unmodified; the licence text sits beside this shelf ' +
        'in public/retro/licenses/ and the source is the repository at the commit below.',
    },
  },
  {
    id: 'moth-hunter',
    repo: 'w84death/x86-assembly',
    ref: '83a8662fec59b66d80940901f0ff739ca5908810',
    blobs: [
      { from: 'dos/game7/game7.com', as: 'MOTH.COM' },
      { from: 'LICENSE', as: 'LICENSE.TXT' },
    ],
    boot: { conf: MOTH_CONF, entry: 'MOTH.COM' },
    record: {
      title: 'Moth Hunter',
      tagline: 'A 508-byte arcade game for the mouse',
      year: null,
      author: 'Krzysztof Krystian Jankowski',
      license: 'MIT',
      licenseUrl: 'https://opensource.org/license/mit',
      sourceUrl: 'https://github.com/w84death/x86-assembly',
      description:
        'One .COM file, 508 bytes: it switches the machine to VGA mode 13h, sets up a double buffer, ' +
        'hides the cursor and runs a mouse-aimed shooting loop against alien sprites, with health, ' +
        'hits and a game-over state. Part of x86-assembly, the author’s collection of programs written ' +
        'small on purpose for 8086-class machines. Packaged from dos/game7/game7.com at commit 83a8662, ' +
        'with the MIT licence beside it; the .asm source is in the repository.',
      accent: '#9ee37d',
      tags: ['arcade', 'tiny'],
      rights:
        'MIT (c) Krzysztof Krystian Jankowski, who published both the .COM build and the assembly ' +
        'source in this repository under that licence. An unmodified copy of the build is packaged here ' +
        'with the MIT text as LICENSE.TXT, which is the notice the licence asks us to keep.',
    },
  },
  {
    id: 'vinnie-pooh',
    repo: 'D0NM/Vinnie',
    ref: 'b84f07bd63e0ad7a6e9aebd5d06736c25c38aa7e',
    zip: {
      files: [
        { from: 'POOH.exe', as: 'POOH.EXE' },
        { from: 'POOH.CFG', as: 'POOH.CFG' },
        { from: 'SETPOOH.EXE', as: 'SETPOOH.EXE' },
        { from: 'readmespooh.txt', as: 'README.TXT' },
        { from: 'LICENSE.md', as: 'LICENSE.TXT' },
        ...['BOSS', 'COMING', 'GLOOM', 'ICE', 'INTRO', 'LEAF', 'LYRA', 'SIMPLE', 'SPECCY', 'TECHPOOH']
          .map((name) => ({ from: `${name}.FMS`, as: `${name}.FMS` })),
        ...['GRAPH', 'LEVELS', 'MULT'].map((name) => ({ from: `${name}.FML`, as: `${name}.FML` })),
      ],
      dirs: [],
    },
    boot: { conf: VINNIE_CONF, entry: 'POOH.EXE' },
    record: {
      title: 'Super Vinnie-Pooh',
      tagline: 'A 1995 platformer, open-sourced by its author',
      year: 1995,
      author: 'Mikhail Bratus (FaMe SoftWare)',
      license: 'Apache-2.0',
      licenseUrl: 'https://www.apache.org/licenses/LICENSE-2.0',
      sourceUrl: 'https://github.com/D0NM/Vinnie',
      description:
        'A platformer from 1995, sold commercially in Russia as Super Vinnie-Pooh and published by its ' +
        'author — code, graphics, levels — under Apache-2.0 in 2022. Packaged from commit b84f07b with ' +
        'POOH.EXE, the ten .FMS sprite banks, the three .FML graphics and level libraries, its config and ' +
        'the original 1995 readme. The game text is Russian; nothing here was translated or redrawn.',
      accent: '#c98bff',
      tags: ['platformer', '1995'],
      rights:
        'Apache-2.0, granted by the game’s author and copyright holder, Mikhail Bratus, who added the ' +
        'licence file to this repository in 2022 next to the source and the assets. The build shipped here ' +
        'is his published POOH.exe plus the data files its code opens; no third-party art or sound.',
    },
  },
  {
    id: 'floppybird',
    repo: 'icebreaker/floppybird',
    ref: '511ffa5f5f7e6d5dbe9c2942557670ae6fc85a53',
    blobs: [
      { from: 'build/flpybird.com', as: 'FLPYBIRD.COM' },
      { from: 'LICENSE', as: 'LICENSE.TXT' },
    ],
    boot: { conf: BIRD_CONF, entry: 'FLPYBIRD.COM' },
    record: {
      title: 'Floppybird',
      tagline: 'Flappy Bird, 8 704 bytes of assembly',
      year: null,
      author: 'Mihail Szabolcs',
      license: 'MIT',
      licenseUrl: 'https://opensource.org/license/mit',
      sourceUrl: 'https://github.com/icebreaker/floppybird',
      description:
        'A clone of Flappy Bird written in 16-bit x86 assembly. The repository builds two things from one ' +
        'source: a raw-metal boot image for a floppy, and this 8 704-byte .COM that runs under DOS — its own ' +
        'Makefile starts it with dosbox -conf dosbox.conf build/flpybird.com. Packaged from commit 511ffa5 ' +
        'with the MIT text; the .tga graphics it draws are the author’s own files from the same repository.',
      accent: '#ffd166',
      tags: ['arcade', 'tiny'],
      rights:
        'MIT (c) Mihail Szabolcs, who published the source, the .COM build and the sprite data in this ' +
        'repository under that licence. Served unmodified with the MIT text as LICENSE.TXT.',
    },
  },
  {
    id: 'nasm-tetris',
    repo: 'Arkowski24/nasm-tetris',
    ref: '3fc95987c68e71200538b2f52f1b032e9b15b85f',
    zip: {
      files: [
        { from: 'bin/TETRIS.EXE', as: 'TETRIS.EXE' },
        { from: 'README.md', as: 'README.TXT' },
        { from: 'LICENSE', as: 'LICENSE.TXT' },
      ],
      dirs: [],
    },
    boot: { conf: TETRIS_CONF, entry: 'TETRIS.EXE' },
    record: {
      title: 'nasm-tetris',
      tagline: 'An unofficial Tetris clone in 2 820 bytes',
      year: null,
      author: 'Arkadiusz Placha',
      license: 'MIT',
      licenseUrl: 'https://opensource.org/license/mit',
      sourceUrl: 'https://github.com/Arkowski24/nasm-tetris',
      description:
        'In the author’s words: an unofficial Tetris clone for DOS, written purely in NASM assembly. The ' +
        'whole game is the single 2 820-byte TETRIS.EXE in bin/, drawn in text mode, with its assembly ' +
        'source beside it in the repository. Packaged from commit 3fc9598 with the MIT licence and the ' +
        'readme. It is a clone — the name belongs to somebody else, and this site does not present it as ' +
        'the original.',
      accent: '#8ad6c1',
      tags: ['puzzle', 'tiny'],
      rights:
        'MIT (c) Arkadiusz Placha: his own clone, his own assembly source, published together under that ' +
        'licence. The MIT text ships inside the bundle as LICENSE.TXT.',
    },
  },
  {
    id: 'snake-54',
    repo: 'donno2048/snake',
    ref: '45b21177a811d62f7300f327cb58a44c52236d29',
    blobs: [
      { from: 'demo/snake.com', as: 'SNAKE.COM' },
      { from: 'LICENSE', as: 'LICENSE.TXT' },
    ],
    boot: { conf: SNAKE54_CONF, entry: 'SNAKE.COM' },
    record: {
      title: 'Snake (54 bytes)',
      tagline: 'A whole game in 54 bytes of machine code',
      year: null,
      author: 'donno2048',
      license: 'MIT',
      licenseUrl: 'https://opensource.org/license/mit',
      sourceUrl: 'https://github.com/donno2048/snake',
      description:
        'A complete snake game in 54 bytes of 16-bit x86 machine code — a code-golf exercise that draws ' +
        'in VGA mode 13h, reads the arrow keys straight from the keyboard controller at port 60h and ' +
        'stops on Escape (the pause key pauses). Packaged from commit 45b2117 with the MIT licence; the ' +
        'assembly it is built from, snake.asm, is in the same repository.',
      accent: '#7fd1ae',
      tags: ['arcade', 'tiny'],
      rights:
        'MIT, published with the .COM and with the assembly source it is generated from, by its author. ' +
        'Fifty-four bytes of machine code; there is no third-party data inside it.',
    },
  },
  /* ----------------------------------------------------- the shareware era
   *
   * Ten releases that a person who owned a PC in 1994 will recognise on sight,
   * each one taken from the publisher's own shareware distribution rather than
   * from a ROM site: Apogee's VENDOR.DOC tells every reader they "can -- and
   * are encouraged! -- to copy, upload and generally pass around this Program
   * without charging for it", and Epic's LICENSE.DOC says the same for its
   * MegaGames. Those notices ship inside the cartridges, unedited.
   *
   * What is here is the shareware edition and nothing else: Wolfenstein 3D's
   * episode one out of six, Keen's Goodbye Galaxy episode one, Duke's L.A.
   * Meltdown, Heretic's City of the Damned. The registered episodes are
   * commercial, are not in the archive, and are not here. Every bundle mounts
   * the release's top-level files as they were published and is checked against
   * one digest over all of them, so a mirror that swapped a file cannot pass.
   */
  {
    id: 'wolfenstein-3d-shareware',
    repo: SHAREWARE_REPO,
    ref: SHAREWARE_REF,
    origin: 'vendor-shareware',
    shareware: {
      dir: 'Wolfenstein 3d',
      sha256: '9fe02ee4f340c5644d0d5216d655641a0a9242e631251d25e4db47fa4f759509',
    },
    boot: {
      conf: sharewareConf({
        entry: 'WOLF3D.EXE',
        cycles: 12000,
        note: [
          'Straight from the title screen into episode one: Esc opens the menu,',
          '"New Game" is the first item, and Enter takes it to the episode list.',
        ],
      }),
      entry: 'WOLF3D.EXE',
    },
    record: {
      title: 'Wolfenstein 3D',
      tagline: 'Episode one, the one that started it all',
      year: 1992,
      author: 'id Software, published by Apogee',
      license: 'Distributable (Apogee shareware terms)',
      licenseUrl: 'https://www.3drealms.com/',
      sourceUrl: sharewareUrl('Wolfenstein 3d'),
      description:
        'Castle Wolfenstein, in first person, in 1992, and the reason a generation of PCs got ' +
        'a sound card. This is v1.4 shareware: episode one, Escape from Wolfenstein, with the ' +
        'guard chatter, the dogs and the blue stone walls. Push forward with the up arrow, Ctrl ' +
        'fires, Space opens doors and Esc brings up the menu; the whole file set is the ' +
        'publisher\u2019s distribution copy, unmodified, and still 1.7 MB.',
      accent: '#8a6d3b',
      tags: ['shooter', 'classic'],
      rights:
        'id Software\u2019s 1992 shareware episode, distributed by Apogee, who encouraged readers ' +
        'to copy and pass it on without charge. Shareware edition only \u2014 episodes two to six ' +
        'were sold. Files unmodified, no charge, archive pinned by digest. Wolfenstein is a ' +
        'trademark of id Software; this site is not affiliated.',
    },
  },
  {
    id: 'commander-keen-4-shareware',
    repo: SHAREWARE_REPO,
    ref: SHAREWARE_REF,
    origin: 'vendor-shareware',
    shareware: {
      dir: 'Commander Keen 4',
      sha256: '2af94eda8bba5460c4e6d4a4590b6e7eec9bfb36521ad669f2d1f7b9be30be2c',
    },
    boot: {
      conf: sharewareConf({
        entry: 'KEEN4E.EXE',
        cycles: 8000,
        memsize: 16,
        note: [
          'The Oracle answers to the arrow keys and Ctrl jumps; Enter takes the',
          'first menu item, which starts the game proper.',
        ],
      }),
      entry: 'KEEN4E.EXE',
    },
    record: {
      title: 'Commander Keen 4',
      tagline: 'Goodbye Galaxy, episode one',
      year: 1991,
      author: 'id Software, published by Apogee',
      license: 'Distributable (Apogee shareware terms)',
      licenseUrl: 'https://www.3drealms.com/',
      sourceUrl: sharewareUrl('Commander Keen 4'),
      description:
        'Secret of the Oracle: eight-year-old Billy Blaze lands on Gnosticus IV, meets the ' +
        'Oracle and sets off to rescue the Council Members. id\u2019s smooth-scrolling EGA ' +
        'platformer is 805 KB of cartridges and dopefish, and this is the shareware episode in ' +
        'full, not a demo. Arrows walk, Ctrl jumps, Enter uses a door, and the VENDOR.DOC that ' +
        'permits copying is inside the cartridge along with the game.',
      accent: '#3f7dbb',
      tags: ['platformer', 'classic'],
      rights:
        'id Software\u2019s shareware episode, licensed for distribution by Apogee, whose ' +
        'VENDOR.DOC in this bundle says everyone "can -- and is encouraged! -- to copy, upload ' +
        'and generally pass around this Program without charging for it". Unmodified, no charge. ' +
        'Commander Keen is a trademark of id Software; this site is not affiliated.',
    },
  },
  {
    id: 'jazz-jackrabbit-shareware',
    repo: SHAREWARE_REPO,
    ref: SHAREWARE_REF,
    origin: 'vendor-shareware',
    shareware: {
      dir: 'Jazz Jackrabbit',
      sha256: '2bca25bf3b62e722f5799fc6046e0425da8f024f78c98532c47513da3d2e528a',
    },
    boot: {
      conf: sharewareConf({
        entry: 'JAZZ.EXE',
        cycles: 20000,
        memsize: 16,
        note: [
          'Epic\u2019s setup wizard wants a sound card picked by hand; DOSBox already has a',
          'Sound Blaster 16 at 220h, and Jazz starts without it. Enter on the menu plays.',
        ],
      }),
      entry: 'JAZZ.EXE',
    },
    record: {
      title: 'Jazz Jackrabbit',
      tagline: 'Epic\u2019s green rabbit, episode one',
      year: 1994,
      author: 'Epic MegaGames',
      license: 'Distributable (Epic shareware terms)',
      licenseUrl: 'https://www.epicgames.com/',
      sourceUrl: sharewareUrl('Jazz Jackrabbit'),
      description:
        'A 256-colour VGA platformer with a soundtrack by Robert A. Allen and Alexander ' +
        'Brandon, running at a speed that made 1994 hardware look slow. This is the shareware ' +
        'episode, Turtle Terror, with its own menu, its own demos and 84 files of MOD music and ' +
        'sprite banks, exactly as Epic packaged it. Arrows run and jump up, Ctrl fires, Enter ' +
        'confirms. Epic\u2019s LICENSE.DOC, which permits the copying, ships inside the cartridge.',
      accent: '#2f9e63',
      tags: ['platformer', 'classic'],
      rights:
        'Epic MegaGames shareware episode one of six. Epic\u2019s LICENSE.DOC in this bundle ' +
        'permits and encourages redistribution by BBS and online service provided no files are ' +
        'altered or removed, which is why the release ships complete and unmodified, at no ' +
        'charge. Jazz Jackrabbit is a trademark of Epic Games; this site is not affiliated.',
    },
  },
  {
    id: 'duke-nukem-3d-shareware',
    repo: SHAREWARE_REPO,
    ref: SHAREWARE_REF,
    origin: 'vendor-shareware',
    shareware: {
      dir: 'Duke Nukem 3D',
      sha256: '6564db968dd2aedec18b052194ec64f357763f1d6d4e586b6990fd58fd7e08cc',
    },
    boot: {
      conf: sharewareConf({
        entry: 'DUKE3D.EXE',
        cycles: 60000,
        memsize: 32,
        /* DUKE3D.CFG in the release names IRQ 5, DMA 1 and 16-bit DMA 5 — the
           Sound Blaster settings of 1995. DOSBox defaults to IRQ 7, and Duke
           refuses to start with "Playback failed, possibly due to an invalid or
           conflicting IRQ". Matching the file it ships with is the fix. */
        irq: 5,
        note: [
          'L.A. Meltdown, as shipped: the shareware episode, one of four. Build\u2019s',
          'engine needs the bigger machine, hence 32 MB and 60 000 cycles.',
        ],
      }),
      entry: 'DUKE3D.EXE',
    },
    record: {
      title: 'Duke Nukem 3D',
      tagline: 'L.A. Meltdown, shareware episode',
      year: 1996,
      author: '3D Realms',
      license: 'Distributable (3D Realms terms)',
      licenseUrl: 'https://www.3drealms.com/',
      sourceUrl: sharewareUrl('Duke Nukem 3D'),
      description:
        'The Build engine, a strip club, a shrink ray and a Duke who will not shut up: the ' +
        '1996 shareware release, v1.3D, all 12.9 MB of DUKE3D.GRP included. This is episode ' +
        'one, L.A. Meltdown, the one everybody actually played. Arrows move and turn, Ctrl ' +
        'fires, Space jumps, and the in-game help is on F1. 3D Realms\u2019 LICENSE.DOC is in ' +
        'the cartridge and asks only that copies be given away free.',
      accent: '#b03a2e',
      tags: ['shooter', 'classic'],
      rights:
        '3D Realms\u2019 1996 shareware release, episode one of four. Its LICENSE.DOC, shipped ' +
        'here, grants "LIMITED DISTRIBUTION RIGHTS": individuals "can -- and are encouraged! -- ' +
        'to give away copies of the Game without charge". Registered episodes are not present. ' +
        'Duke Nukem is a trademark of Gearbox; this site is not affiliated.',
    },
  },
  {
    id: 'heretic-shareware',
    repo: SHAREWARE_REPO,
    ref: SHAREWARE_REF,
    origin: 'vendor-shareware',
    shareware: {
      dir: 'Heretic',
      sha256: '2dea294dbe80f06a6b4edbc110b850e0927f1ad2f832830ed69e89eef4bff81c',
    },
    boot: {
      conf: sharewareConf({
        entry: 'HERETIC.EXE',
        cycles: 20000,
        memsize: 16,
        note: [
          'DOOM\u2019s engine with a wand instead of a shotgun: -warp drops straight into',
          'City of the Damned, and -skill 3 is the difficulty id called "Hurt me plenty".',
        ],
      }),
      entry: 'HERETIC.EXE',
    },
    record: {
      title: 'Heretic',
      tagline: 'City of the Damned, shareware episode',
      year: 1994,
      author: 'Raven Software, published by id Software',
      license: 'Distributable (id shareware terms)',
      licenseUrl: 'https://www.idsoftware.com/',
      sourceUrl: sharewareUrl('Heretic'),
      description:
        'Raven took the DOOM engine, replaced the space station with a cathedral and gave the ' +
        'player a crossbow that freezes people. This is the shareware episode, City of the ' +
        'Damned, with HERETIC1.WAD and the release\u2019s own LICENSE.DOC. It launches straight ' +
        'into the first level because id\u2019s engine understands -warp; arrows move, Ctrl ' +
        'fires, Space opens doors, and F1 shows the keys.',
      accent: '#6c5b7b',
      tags: ['shooter', 'classic'],
      rights:
        'id Software\u2019s shareware release of Heretic, licensed by its own LICENSE.DOC, ' +
        'which covers "the shareware version or episode one" and is shipped unmodified in this ' +
        'bundle. VENDOR.DOC routes retail resale through GT Interactive and exempts BBS and FTP ' +
        'distribution. No charge for this copy; registered episodes absent.',
    },
  },
  {
    id: 'rise-of-the-triad-shareware',
    repo: SHAREWARE_REPO,
    ref: SHAREWARE_REF,
    origin: 'vendor-shareware',
    shareware: {
      dir: 'Rise of the Triad',
      sha256: 'ff2052cc961f013a4bfb9737430c017286fb9c66607908a79f84e006684657fe',
    },
    boot: {
      conf: sharewareConf({
        entry: 'ROTT.EXE',
        cycles: 30000,
        memsize: 16,
        /* ROTT probes its sound card at IRQ 5 by default and drops into its own
           SNDSETUP screen when the probe fails at DOSBox's default 7. */
        irq: 5,
        note: [
          'ROTT starts at its own menu with the shareware episode loaded; arrows pick a',
          'difficulty, Enter starts, and Esc returns to the menu.',
        ],
      }),
      entry: 'ROTT.EXE',
    },
    record: {
      title: 'Rise of the Triad',
      tagline: 'Dark War, shareware episode',
      year: 1995,
      author: 'Apogee Software',
      license: 'Distributable (Apogee shareware terms)',
      licenseUrl: 'https://www.3drealms.com/',
      sourceUrl: sharewareUrl('Rise of the Triad'),
      description:
        'The loudest game Apogee ever shipped: monks, missile launchers, a score counter lifted ' +
        'from pinball and an episode that ends with you flying a hang glider. ROTT\u2019s ' +
        'shareware build is episode one, and its VENDOR.DOC is emphatic about what that means ' +
        '\u2014 "No right is given by this Vendor.Doc to copy, use or distribute any other ' +
        'version". Arrows move, Ctrl fires, Space jumps, Enter confirms.',
      accent: '#c27c1a',
      tags: ['shooter', 'classic'],
      rights:
        'Apogee\u2019s shareware release, marked "Shareware" and containing "episode #1" as its ' +
        'VENDOR.DOC requires; that document also states everyone is encouraged to pass it around ' +
        'without charge. Unmodified, complete, no fee. Registered episodes are not here. Rise of ' +
        'the Triad is a trademark of its owners; this site is not affiliated.',
    },
  },
  {
    id: 'blake-stone-shareware',
    repo: SHAREWARE_REPO,
    ref: SHAREWARE_REF,
    origin: 'vendor-shareware',
    shareware: {
      dir: 'Blake Stone',
      sha256: '8168b0211fd082ab42d6d378a373e3999c1818886ccbac3145f4744c2037a8d2',
    },
    boot: {
      conf: sharewareConf({
        entry: 'BS_AOG.EXE',
        cycles: 12000,
        memsize: 16,
        note: [
          'Wolfenstein\u2019s engine, upgraded: the game opens on its own menu, and Enter',
          'on "Begin New Game" is all it takes to be inside the base.',
        ],
      }),
      entry: 'BS_AOG.EXE',
    },
    record: {
      title: 'Blake Stone',
      tagline: 'Aliens of Gold, shareware release',
      year: 1993,
      author: 'Jam Productions, published by Apogee',
      license: 'Distributable (Apogee shareware terms)',
      licenseUrl: 'https://www.3drealms.com/',
      sourceUrl: sharewareUrl('Blake Stone'),
      description:
        'A British agent, a lunar base and the last game Apogee shipped on the Wolfenstein ' +
        'engine \u2014 with ceilings and floors, animated walls and an informant who sells you ' +
        'hints for credits. The shareware release runs the first floors of Aliens of Gold. ' +
        'Arrows move, Ctrl fires, Space opens doors, and the VENDOR.DOC granting the copying is ' +
        'inside the cartridge rather than paraphrased on a card.',
      accent: '#4f7f8c',
      tags: ['shooter', 'classic'],
      rights:
        'Jam Productions\u2019 shareware release, licensed for distribution by Apogee: its ' +
        'VENDOR.DOC, shipped unmodified in this bundle, encourages everyone to "copy, upload and ' +
        'generally pass around this Program without charging for it". No charge, no registered ' +
        'content. Blake Stone is a trademark of its owners; this site is not affiliated.',
    },
  },
  {
    id: 'raptor-shareware',
    repo: SHAREWARE_REPO,
    ref: SHAREWARE_REF,
    origin: 'vendor-shareware',
    shareware: {
      dir: 'Raptor Call of the Shadows',
      sha256: 'd9ca3d19a53a21aa1bc8d1e772855a46268142e5ad9fc909237bf7088d540105',
    },
    boot: {
      conf: sharewareConf({
        entry: 'RAP.EXE',
        cycles: 20000,
        memsize: 16,
        note: [
          'Raptor\u2019s menu wants three keys: Enter on "Start New Game" then a pilot',
          'and a difficulty. Arrows fly, Ctrl fires, Alt launches a missile.',
        ],
      }),
      entry: 'RAP.EXE',
    },
    record: {
      title: 'Raptor',
      tagline: 'Call of the Shadows, shareware release',
      year: 1994,
      author: 'Cygnus Studios, published by Apogee',
      license: 'Distributable (Apogee shareware terms)',
      licenseUrl: 'https://www.3drealms.com/',
      sourceUrl: sharewareUrl('Raptor Call of the Shadows'),
      description:
        'The vertical shooter that sold a million shareware copies: a mercenary pilot buying ' +
        'better guns between waves of tanks, gunboats and things with too many engines. Apogee ' +
        'shipped it on three disks with a shop, a soundtrack and 5 MB of artwork, all of which ' +
        'is here. Arrows fly, Ctrl fires, Alt fires a missile, Enter confirms a menu entry.',
      accent: '#7d3c98',
      tags: ['shooter', 'arcade'],
      rights:
        'Cygnus Studios\u2019 shareware release, distributed by Apogee. Its VENDOR.DOC in this ' +
        'bundle reads: everyone "can -- and is encouraged! -- to copy, upload and generally pass ' +
        'around this Program without charging for it". Shipped complete and unmodified, at no ' +
        'charge. Raptor is a trademark of its owners; this site is not affiliated.',
    },
  },
  {
    id: 'hocus-pocus-shareware',
    repo: SHAREWARE_REPO,
    ref: SHAREWARE_REF,
    origin: 'vendor-shareware',
    shareware: {
      dir: 'Hocus Pocus',
      sha256: '0cd9a702656e66cbba10691a57083b4aec18d0096524d086890e5ef2b73cacc4',
    },
    boot: {
      conf: sharewareConf({
        entry: 'HOCUS.EXE',
        cycles: 15000,
        memsize: 16,
        note: [
          'Apogee\u2019s own launcher wants a sound choice first; DOSBox already has the',
          'Sound Blaster 16, so the game is started directly and reads its defaults.',
        ],
      }),
      entry: 'HOCUS.EXE',
    },
    record: {
      title: 'Hocus Pocus',
      tagline: 'Apogee\u2019s VGA platformer, shareware levels',
      year: 1994,
      author: 'Moonlite Software, published by Apogee',
      license: 'Distributable (Apogee shareware terms)',
      licenseUrl: 'https://www.3drealms.com/',
      sourceUrl: sharewareUrl('Hocus Pocus'),
      description:
        'A wizard\u2019s apprentice collects crystals across 320\u00d7200 VGA levels while a ' +
        'soundtrack by the Fat Man plays behind him. Moonlite\u2019s game was the first Apogee ' +
        'platformer with a scrolling background and a shop, and the shareware release is the ' +
        'opening levels in full. Arrows walk, Ctrl jumps, Space casts, Enter picks a menu entry.',
      accent: '#2e86c1',
      tags: ['platformer', 'classic'],
      rights:
        'Moonlite Software\u2019s shareware release, distributed by Apogee, whose VENDOR.DOC ' +
        'ships in this bundle and encourages everyone to copy and pass the program around ' +
        'without charge. Files unmodified, no charge, no registered levels. Hocus Pocus is a ' +
        'trademark of its owners; this site is not affiliated.',
    },
  },
  {
    id: 'jill-of-the-jungle-shareware',
    repo: SHAREWARE_REPO,
    ref: SHAREWARE_REF,
    origin: 'vendor-shareware',
    shareware: {
      dir: 'Jill of the Jungle',
      sha256: '848ccdeb5f2fda4886bd16629ee26d3e80a7dfd3d615fba44e512cfc82de4567',
    },
    boot: {
      conf: sharewareConf({
        entry: 'JILL.EXE',
        cycles: 12000,
        memsize: 16,
        note: [
          'Jill boots into her own title screen and Enter starts episode one; arrows run,',
          'Ctrl jumps and Space throws a dagger once she has one.',
        ],
      }),
      entry: 'JILL.EXE',
    },
    record: {
      title: 'Jill of the Jungle',
      tagline: 'Epic\u2019s platformer, episode one',
      year: 1992,
      author: 'Epic MegaGames',
      license: 'Distributable (Epic shareware terms)',
      licenseUrl: 'https://www.epicgames.com/',
      sourceUrl: sharewareUrl('Jill of the Jungle'),
      description:
        'Tim Sweeney wrote the engine, Allen Pilgrim drew the jungle, and Jill jumped through ' +
        'it in 16 colours with a knife and a key. Episode one is 1.1 MB and loads instantly, ' +
        'which is how a whole generation met Epic before Jazz and Unreal. Arrows move, Ctrl ' +
        'jumps, Space uses a weapon, and Epic\u2019s LICENSE.DOC \u2014 the permission to copy ' +
        '\u2014 is inside the cartridge.',
      accent: '#27ae60',
      tags: ['platformer', 'classic'],
      rights:
        'Epic MegaGames shareware episode one. Epic\u2019s LICENSE.DOC in this bundle says ' +
        'readers are "permitted, and encouraged, to make and distribute copies of the Program to ' +
        'their friends, family members and co-workers without charge". Unmodified, no fee, no ' +
        'registered episodes. Jill of the Jungle is a trademark of Epic Games.',
    },
  },
  /* ------------------------------------------------------------------ DOOM */
  {
    /* The shareware episode, and the one title on this shelf whose files are a
     * vendor's rather than an author's. The basis is not a label and not a
     * guess:
     *
     *   · John Carmack, 23 October 1999: "The DOOM shareware wad is freely
     *     distributable." Debian quotes that sentence in the copyright file of
     *     its non-free `doom-wad-shareware` package and has shipped the file on
     *     that basis for twenty-five years; RPM Fusion does the same in
     *     `doom-shareware`, with `License: Distributable`.
     *   · The bytes are checked, not trusted: DOOM1.WAD's SHA-256 is pinned
     *     below to the official 4,196,020-byte release, so a mirror that swapped
     *     in a patched or registered WAD fails the build instead of shipping.
     *   · The registered episodes and DOOM II are commercial and are not here.
     *     Nothing on this shelf is sold, gated, or charged for.
     */
    id: 'doom-shareware',
    repo: 'JuansesDev/AerionOs',
    ref: 'f759adad3d9571f9c755e9d7fb5216cfd55c97bd',
    origin: 'vendor-shareware',
    cover: 'covers/doom-shareware.png',
    archives: [{
      /* The mirror holds the release as it was published: one archive. Its parts
         are taken by name, and both executables are pinned by checksum, so a
         different build cannot slip in under the same file name. */
      from: 'public/roms/doom19s/DOOMS_19_COMBINED.zip',
      entries: [
        { path: 'DOOM.EXE', as: 'DOOM.EXE', sha256: 'b8020523561a5ad9706e009a52d61c578f37faafd85ac471962308406292ce27' },
        { path: 'DOOM1.WAD', as: 'DOOM1.WAD', sha256: '1d7d43be501e67d927e415e0b8f3e29c3bf33075e859721816f652a526cac771' },
        { path: 'README.TXT', as: 'README.TXT', sha256: '17878ebe5ca179de7ec2cc90bbabbc922ab69924118be168a25f8d317f65a2ff' },
        { path: 'SETUP.EXE', as: 'SETUP.EXE', sha256: 'c9d328bff268854414feae5459870aac6f779e55a9cbf4568a83fef9b7be6e15' },
      ],
    }],
    boot: { conf: DOOM_CONF, entry: 'DOOM.EXE' },
    record: {
      title: 'DOOM',
      tagline: 'Shareware episode one, unmodified',
      year: 1993,
      author: 'id Software',
      license: 'Distributable (id shareware terms)',
      licenseUrl: 'https://www.doomworld.com/idgames/idstuff/doom/doom19s',
      sourceUrl: 'https://www.doomworld.com/idgames/idstuff/doom/doom19s',
      description:
        'Episode one, Knee-Deep in the Dead, exactly as id shipped it in 1994: DOOM.EXE v1.9 and ' +
        'DOOM1.WAD, byte for byte, with the README that came in the archive. The IWAD is checked ' +
        'against the SHA-256 of the official 4,196,020-byte shareware file every time the bundle is ' +
        'built, so what runs here is id\u2019s own release and not a repack. Arrow keys move and turn, ' +
        'Ctrl fires, Space opens doors, F1 shows the key card.',
      accent: '#c0392b',
      tags: ['shooter', 'classic'],
      /* 400 characters is the shelf's limit for this field, and the citation has
         to survive it: the permission is an email, not a licence grant. */
      rights:
        'id Software\u2019s shareware release. John Carmack, 23 Oct 1999: "The DOOM shareware wad is ' +
        'freely distributable." Debian ships these files as doom-wad-shareware on that basis; RPM ' +
        'Fusion as doom-shareware, License: Distributable. Unmodified, no charge, registered ' +
        'episodes excluded. DOOM is a trademark of id Software; this site is not affiliated.',
    },
  },
];

/* ------------------------------------------------------------- packaging */

function sourceNote(title: Title): string {
  const vendor = title.origin === 'vendor-shareware';
  return [
    `${title.record.title} — packaged for the Pikachu Arcade DOS shelf.`,
    '',
    `  project   ${title.record.sourceUrl}`,
    `  commit    ${title.ref}`,
    ...(title.shareware
      ? [
          `  archive   ${SHAREWARE_REPO} @ ${SHAREWARE_REF.slice(0, 7)}`,
          `  folder    GAMES/${title.shareware.dir}`,
          `  digest    ${title.shareware.sha256}`,
        ]
      : []),
    `  licence   ${title.record.license}`,
    `  author    ${title.record.author}`,
    '  emulator  js-dos 8.5.3 (GPL-2.0) with its DOSBox core',
    '',
    vendor
      ? 'The game files in this bundle are the vendor’s own shareware release, unmodified'
      : 'The game files in this bundle are the project’s own published files at the commit',
    vendor
      ? '— not a repack, not a rip, and not the registered episodes. The copy above is the'
      : 'above, unmodified. Pikachu Arcade added this note, the licence text, and (where the',
    vendor
      ? 'mirror the files were fetched from. Pikachu Arcade added this note and a dosbox.conf'
      : 'project did not publish a .jsdos bundle of its own) a dosbox.conf that starts the',
    vendor
      ? 'that starts the game on its own. See the rights field of the shelf record for the'
      : 'game on its own. The corresponding source is the repository above at that commit.',
    ...(vendor
      ? ['basis on which it is redistributed.', '']
      : []),
    '',
    'Every cartridge on the shelf was launched in a headless browser during',
    'development: each one booted and drew its own screen, and whether it was',
    'also seen taking keyboard input is recorded, game by game, in',
    'docs/pikachu-arcade.md. That file is the honest record of what was',
    'checked and what was not; no game here has been played to completion.',
    '',
  ].join('\n');
}

/** Every blob under `prefix + dir/`, flattened or kept, filtered by rule. */
async function dirFiles(
  zipBytes: Uint8Array,
  prefix: string,
  rule: DirRule,
  taken: Set<string>,
): Promise<{ name: string; data: Uint8Array }[]> {
  const entries = readZipDirectory(zipBytes);
  if (!entries) throw new Error('the downloaded repository is not a zip');
  const root = `${prefix}${rule.from.replace(/^\/+|\/+$/g, '')}/`;
  const out: { name: string; data: Uint8Array }[] = [];
  const names = entries
    .map((e) => e.name)
    .filter((name) => name.startsWith(root))
    .sort();

  for (const name of names) {
    const rest = name.slice(root.length);
    if (!rest || rest.endsWith('/')) continue;
    /* A nested folder is a backup or an alternate set (sadist keeps one under
       Data/!dane!/a/). One level, no surprises. */
    if (rest.includes('/')) continue;
    if (rule.only && !rule.only.some((ext) => rest.toLowerCase().endsWith(ext))) continue;
    if (rule.skip?.test(rest)) continue;
    const as = rule.to ? `${rule.to.replace(/\/+$/, '')}/${rest}` : rest;
    if (taken.has(as.toLowerCase())) continue;
    const data = await readZipEntry(zipBytes, name);
    if (!data) throw new Error(`${name} could not be read out of the archive`);
    taken.add(as.toLowerCase());
    out.push({ name: as, data });
  }
  return out;
}

async function buildBundle(title: Title): Promise<{ bytes: Uint8Array; entry: string | null }> {
  const files: { name: string; data: Uint8Array }[] = [];

  if (title.prebuilt) {
    const bytes = await blob(title.repo, title.ref, title.prebuilt);
    return { bytes, entry: null };
  }

  if (!title.boot) throw new Error(`${title.id}: a built bundle needs a boot config`);

  files.push({ name: '.jsdos/dosbox.conf', data: text(title.boot.conf) });
  files.push({ name: 'SOURCE.TXT', data: text(sourceNote(title)) });

  const taken = new Set(files.map((f) => f.name.toLowerCase()));

  if (title.zip) {
    const zipBytes = await repoZip(title.repo, title.ref);
    const entries = readZipDirectory(zipBytes);
    if (!entries || entries.length === 0) throw new Error(`${title.repo}: empty archive`);
    /* codeload zips put everything under one `<repo>-<sha>/` folder. */
    const prefix = `${entries[0].name.split('/')[0]}/`;

    for (const file of title.zip.files) {
      const data = await readZipEntry(zipBytes, `${prefix}${file.from}`);
      if (!data) throw new Error(`${title.id}: ${file.from} is not in ${title.ref.slice(0, 7)}`);
      if (taken.has(file.as.toLowerCase())) continue;
      taken.add(file.as.toLowerCase());
      files.push({ name: file.as, data });
    }
    for (const rule of title.zip.dirs) {
      files.push(...await dirFiles(zipBytes, prefix, rule, taken));
    }
  }

  if (title.shareware) {
    const { dir, sha256: expected, skip } = title.shareware;
    const entries = await listing(SHAREWARE_REPO, SHAREWARE_REF, `GAMES/${dir}`);
    const names = entries
      .filter((entry) => entry.type === 'file' && !(skip ?? SHAREWARE_SKIP).test(entry.name))
      .map((entry) => entry.name)
      .sort();
    const digest = createHash('sha256');
    for (const name of names) {
      const data = await blob(SHAREWARE_REPO, SHAREWARE_REF, `GAMES/${dir}/${name}`);
      digest.update(`${name}\t${sha256(data)}\n`);
      if (taken.has(name.toLowerCase())) continue;
      taken.add(name.toLowerCase());
      files.push({ name, data });
    }
    const actual = digest.digest('hex');
    if (actual !== expected) {
      throw new Error(`${title.id}: ${dir} is not the directory its digest describes (${actual})`);
    }
  }

  for (const pack of title.archives ?? []) {
    const archive = await blob(title.repo, title.ref, pack.from);
    for (const entry of pack.entries) {
      const data = await readZipEntry(archive, entry.path);
      if (!data) throw new Error(`${title.id}: ${entry.path} is not inside ${pack.from}`);
      if (entry.sha256 && sha256(data) !== entry.sha256) {
        throw new Error(`${title.id}: ${entry.path} is not the file its checksum describes`);
      }
      if (taken.has(entry.as.toLowerCase())) continue;
      taken.add(entry.as.toLowerCase());
      files.push({ name: entry.as, data });
    }
  }

  for (const file of title.blobs ?? []) {
    const data = await blob(title.repo, title.ref, file.from);
    /* Where the publisher states a checksum, the download has to match it. A
       shareware release is identified by its bytes; if the mirror silently
       swapped in a different build (a patched WAD, a registered one), that is
       exactly the thing this shelf must not ship. */
    if (file.sha256 && sha256(data) !== file.sha256) {
      throw new Error(`${title.id}: ${file.from} is not the file its checksum describes`);
    }
    if (taken.has(file.as.toLowerCase())) continue;
    taken.add(file.as.toLowerCase());
    files.push({ name: file.as, data });
  }

  const game = files.filter((f) => f.name !== '.jsdos/dosbox.conf' && f.name !== 'SOURCE.TXT' && f.name !== 'LICENSE.TXT');
  if (game.length === 0) throw new Error(`${title.id}: nothing but paperwork`);

  return { bytes: buildZip(files), entry: title.boot.entry };
}

/* ----------------------------------------------------------------- check */

async function verify(id: string, bytes: Uint8Array, entry: string | null): Promise<string> {
  const entries = readZipDirectory(bytes);
  const confBytes = await readZipEntry(bytes, '.jsdos/dosbox.conf');
  const report = inspectBundle({
    bytes,
    entries,
    conf: confBytes ? new TextDecoder().decode(confBytes) : null,
  });
  if (!report.ok) throw new Error(`${id}: bundle failed its own structural check (${report.problems.join(', ')})`);
  if (!report.autoexec) throw new Error(`${id}: bundle has no [autoexec]`);
  if (entry && report.autoexec) {
    /* The run line has to name a program that is actually at the archive root,
       because the bundle is mounted as C: — a typo here is a black screen. */
    /* A line may carry arguments — DOOM is started straight into a level — so the
       program is the first word of the last line that runs something. */
    const program = autoexecProgram(report.autoexec)?.file;
    if (!program) throw new Error(`${id}: [autoexec] never starts a program`);
    const present = entries?.some((e) => e.name.toLowerCase() === program.toLowerCase());
    if (!present) throw new Error(`${id}: [autoexec] runs ${program}, which is not at the archive root`);
    if (program.toLowerCase() !== entry.toLowerCase()) {
      throw new Error(`${id}: [autoexec] runs ${program}, not the advertised ${entry}`);
    }
    /* And it has to be the right *kind* of file. A renamed blob with no `MZ`
       header is not a DOS program: that is how a bundle ends up shipping a
       file that cannot be started, which no amount of zip structure checks
       would notice. */
    const body = await readZipEntry(bytes, program);
    if (!body || body.length < 32) throw new Error(`${id}: ${program} could not be read back out of the bundle`);
    if (/\.exe$/i.test(program) && !(body[0] === 0x4d && body[1] === 0x5a)) {
      throw new Error(`${id}: ${program} has no MZ header — it is not a DOS executable`);
    }
  }
  return `ok · ${report.entries} entries · ${report.autoexec.split('\n').slice(-1)[0]}`;
}

/* ------------------------------------------------------------------ main */

async function main() {
  mkdirSync(BUNDLE_DIR, { recursive: true });
  const records: unknown[] = [];

  process.stdout.write('\nDOS shelf — building cartridges\n\n');

  for (const title of TITLES) {
    const { bytes, entry } = await buildBundle(title);
    const where = resolve(BUNDLE_DIR, `${title.id}.jsdos`);
    writeFileSync(where, bytes);
    const verdict = await verify(title.id, bytes, entry);

    process.stdout.write(
      `  ${title.id.padEnd(12)} ${String(bytes.length).padStart(9)} bytes  ${verdict}\n` +
      `               → public/retro/dos/bundles/${title.id}.jsdos · sha256 ${sha256(bytes).slice(0, 16)}…\n`,
    );

    records.push({
      ...title.record,
      id: title.id,
      bundle: `bundles/${title.id}.jsdos`,
      bytes: bytes.length,
      /* A cover captured from the running game by `npm run dos:covers`, if one
         has been captured yet. The card falls back to a typographic plate when
         this is null, which is honest rather than a broken image. */
      cover: title.cover ?? (existsSync(resolve('public/retro/dos/covers', `${title.id}.png`)) ? `covers/${title.id}.png` : null),
      /* Not part of the shelf record the site validates; kept here so a
         maintainer can tell whether a bundle changed under them. */
      provenance: {
        repo: title.repo,
        commit: title.ref,
        license: title.record.license,
        prebuilt: title.prebuilt ?? null,
        sha256: sha256(bytes),
      },
    });
  }

  writeFileSync(RECORDS, `${JSON.stringify({ generatedBy: 'scripts/dos/make-games.ts', games: records }, null, 2)}\n`);
  process.stdout.write(`\n  ${records.length} record(s) → scripts/dos/records.json\n`);
  process.stdout.write('  next: npm run dos:shelf\n\n');

  if (!token) {
    process.stdout.write('  note: no GITHUB_TOKEN in the environment — anonymous requests are rate-limited.\n\n');
  }
}

main().catch((error) => {
  console.error(`\n  ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
