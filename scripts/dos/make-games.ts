/**
 * `npm run dos:games` — build the `.jsdos` bundles for the free-software shelf.
 *
 * The DOS shelf started with one cartridge: our own CC0 calibration program. A
 * test card proves the player boots; it is not a game. This script fills the
 * shelf with actual games, and it is deliberately narrow about which ones:
 *
 *   · The rights must be a real licence, held by the person who published the
 *     build. Every title here comes from the author's own repository with a
 *     LICENSE file at the commit recorded beside it — GPL-3.0 for the two Polish
 *     games and the Spanish adventure, MIT for the 508-byte one. There is no
 *     "freeware" label anywhere in this list, because that label is not a grant.
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

import { inspectBundle } from '../../src/lib/dos';
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
  blobs?: { from: string; as: string }[];
  /** Or ship the project's own published bundle, untouched. */
  prebuilt?: string;
  /** Only for bundles we build: the conf and the program its autoexec starts. */
  boot?: { conf: string; entry: string };
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

const CELIS_CONF = `[sdl]
fullscreen=false
fulldouble=false
autolock=true
sensitivity=100
waitonerror=true
usescancodes=true

[dosbox]
machine=svga_s3
memsize=32

[render]
frameskip=0
aspect=true

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
exit
`;

const SADIST_CONF = `[sdl]
fullscreen=false
fulldouble=false
autolock=true
sensitivity=100
waitonerror=true

[dosbox]
machine=svga_s3
memsize=16

[render]
frameskip=0
aspect=true

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
exit
`;

const MOTH_CONF = `[sdl]
fullscreen=false
fulldouble=false
autolock=true
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
exit
`;

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
];

/* ------------------------------------------------------------- packaging */

function sourceNote(title: Title): string {
  return [
    `${title.record.title} — packaged for the Pikachu Arcade DOS shelf.`,
    '',
    `  project   ${title.record.sourceUrl}`,
    `  commit    ${title.ref}`,
    `  licence   ${title.record.license}`,
    `  author    ${title.record.author}`,
    '  emulator  js-dos 8.5.3 (GPL-2.0) with its DOSBox core',
    '',
    'The game files in this bundle are the project’s own published files at the commit',
    'above, unmodified. Pikachu Arcade added this note, the licence text, and (where the',
    'project did not publish a .jsdos bundle of its own) a dosbox.conf that starts the',
    'game on its own. The corresponding source is the repository above at that commit.',
    '',
    'This build has not been played by the maintainers in a browser: see',
    'docs/pikachu-arcade.md for what has been checked and what has not.',
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

  for (const file of title.blobs ?? []) {
    const data = await blob(title.repo, title.ref, file.from);
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
    const program = report.autoexec
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && !line.startsWith(';'))
      .filter((line) => /\.(exe|com|bat)$/i.test(line))
      .pop();
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

  process.stdout.write('\nDOS shelf — building free-software bundles\n\n');

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
      cover: null,
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
