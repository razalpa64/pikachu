/**
 * `npm run retro:import` — the admin-only importer for the GBA shelf.
 *
 * Discovery source: `gbadev-org/games` (the JSON database behind Homebrew Hub).
 * Read `src/lib/gbadevCatalog.ts` before changing anything here: the licence
 * rules live there, and they are the reason this command is allowed to download
 * some entries and not others.
 *
 *   PIKACHU_MAINTAINER=1 npm run retro:import -- --dry-run
 *   PIKACHU_MAINTAINER=1 npm run retro:import
 *   PIKACHU_MAINTAINER=1 npm run retro:import -- --only apotris,gbatris
 *   PIKACHU_MAINTAINER=1 npm run retro:import -- --retry-failed
 *   PIKACHU_MAINTAINER=1 npm run retro:import -- --retest --only ucity-advance
 *
 * What a run does, in order:
 *
 *   1. reads the archive's git tree (one request) and indexes every entry;
 *   2. reads `entries/<slug>/game.json` for entries whose blob it has not seen —
 *      the metadata cache is committed at `data/retro/metadata.json`, so a
 *      refresh never re-downloads metadata it already has;
 *   3. reads the entry's own licence file for entries that declare no SPDX id;
 *   4. decides, per entry, whether the cartridge may be redistributed here;
 *   5. downloads only the authorised ROMs, verifying size against the git blob,
 *      sha256 against the entry's own hash when it publishes one, and the GBA
 *      cartridge header;
 *   6. boots every downloaded ROM in a real Chromium against the real player,
 *      refuses to install anything that does not paint a live frame, and
 *      captures that frame as the 240×160 cover;
 *   7. writes the shelf, the catalogue, the generated id list and the notice.
 *
 * Nothing here is reachable from the running site: it is a command run by
 * whoever maintains the repository, against files it then commits.
 */
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  GBADEV_BRANCH,
  GBADEV_REPO,
  MAX_ROM_BYTES,
  hasGbaHeader,
  type CatalogEntry,
  type Verdict,
} from '../../src/lib/gbadevCatalog.ts';
import {
  buildPlan,
  emptyCache,
  emptyState,
  indexEntries,
  mergeShelf,
  needsAnything,
  recordResult,
  renderManifest,
  renderShelfModule,
  retryList,
  applyOutcomes,
  judgeIntegrity,
  type CatalogFile,
  type GitTreeFile,
  type ImportState,
  type MetadataBlob,
  type MetadataCache,
} from '../../src/lib/retroImport.ts';
import { parseRetroLibrary, type RetroGame } from '../../src/lib/retro.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PUBLIC = join(ROOT, 'public', 'retro');
const ROMS = join(PUBLIC, 'roms');
const COVERS = join(PUBLIC, 'covers');
const LICENSES = join(PUBLIC, 'licenses');
const DATA = join(ROOT, 'data', 'retro');
const MANIFEST = join(PUBLIC, 'roms.json');
const CATALOG = join(PUBLIC, 'catalog.json');
const CACHE = join(DATA, 'metadata.json');
const STATE = join(DATA, 'import-state.json');
const REPORT = join(DATA, 'last-report.json');
const GENERATED = join(ROOT, 'src', 'lib', 'retroShelf.generated.ts');
const IMPORTED_NOTICE = join(LICENSES, 'imported.txt');

/**
 * How much cartridge the shelf will hold per game. This is a shipping budget,
 * not a licensing rule: `--max-bytes` raises it for a one-off import, and the
 * entries it holds back keep their verdict so a later run can pick them up.
 */
const SHELF_BUDGET_BYTES = 8 * 1024 * 1024;

const MANIFEST_NOTE =
  'Every entry is a freely redistributable homebrew build whose own licence permits redistribution; the archive licence is never used as authority for a game. No commercial ROMs are hosted here. Covers are real 240x160 frames captured from the running emulator.';

/* ------------------------------------------------------------------ args */

interface Args {
  dryRun: boolean;
  refresh: boolean;
  allowFanGame: boolean;
  maxBytes: number;
  only: string[];
  retryFailed: boolean;
  limit: number;
  explain: boolean;
  retest: boolean;
  token: string | null;
}

function parseArgs(argv: string[]): Args {
  const has = (flag: string) => argv.includes(flag);
  const value = (flag: string): string | null => {
    const i = argv.indexOf(flag);
    if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1];
    const inline = argv.find((a) => a.startsWith(`${flag}=`));
    return inline ? inline.slice(flag.length + 1) : null;
  };
  return {
    dryRun: has('--dry-run'),
    refresh: has('--refresh'),
    allowFanGame: has('--allow-fangame'),
    maxBytes: Number(value('--max-bytes') ?? Math.min(SHELF_BUDGET_BYTES, MAX_ROM_BYTES)),
    only: (value('--only') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    retryFailed: has('--retry-failed'),
    limit: Number(value('--limit') ?? 0),
    explain: has('--explain'),
    retest: has('--retest'),
    token: value('--token') ?? process.env.GITHUB_TOKEN ?? null,
  };
}

const log = (...parts: unknown[]) => console.log(...parts);
const bold = (s: string) => `\u001b[1m${s}\u001b[0m`;
const grey = (s: string) => `\u001b[2m${s}\u001b[0m`;

/* ----------------------------------------------------------------- gate */

if (process.env.PIKACHU_MAINTAINER !== '1') {
  console.error(
    [
      'retro:import is an admin command: it writes the shelf, the catalogue and the ROMs.',
      '',
      'Enable it for this shell only:',
      '',
      '  PIKACHU_MAINTAINER=1 npm run retro:import -- --dry-run',
      '',
      'It needs a GitHub token in GITHUB_TOKEN (or a logged-in `gh`) because it reads',
      `the ${GBADEV_REPO} archive through the API, and it needs a Chromium for the`,
      'playtest step (PIKACHU_CHROME=/path/to/chromium, plus PIKACHU_LD if your',
      'Chromium needs extra libraries).',
    ].join('\n'),
  );
  process.exit(2);
}

const args = parseArgs(process.argv.slice(2));

if (!args.token) {
  try {
    args.token = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim() || null;
  } catch {
    args.token = null;
  }
}
if (!args.token) {
  console.error('No GitHub token. Set GITHUB_TOKEN or run `gh auth login` first.');
  process.exit(2);
}

/* ---------------------------------------------------------------- github */

const api = 'https://api.github.com';
let requests = 0;

async function github(path: string, accept: string): Promise<Response> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    requests += 1;
    let res: Response;
    try {
      res = await fetch(`${api}${path}`, {
        headers: {
          accept,
          authorization: `Bearer ${args.token}`,
          'user-agent': 'pikachu-arcade-importer',
          'x-github-api-version': '2022-11-28',
        },
      });
    } catch (error) {
      const cause = (error as { cause?: { code?: string } }).cause?.code;
      if (cause && /CERT|SSL|SELF_SIGNED/i.test(cause)) {
        throw new Error(
          `TLS verification failed talking to api.github.com (${cause}). Machines behind a TLS-inspecting proxy need ` +
            'the proxy root certificate: NODE_EXTRA_CA_CERTS=/path/to/ca-bundle.crt npm run retro:import',
        );
      }
      throw error;
    }
    if (res.ok) return res;
    if (res.status !== 403 && res.status !== 429 && res.status < 500) {
      throw new Error(`GitHub ${res.status} for ${path}: ${(await res.text()).slice(0, 160)}`);
    }
    const wait = Number(res.headers.get('retry-after') ?? 0) * 1000 || attempt * 1500;
    log(grey(`  · GitHub ${res.status}, retrying in ${wait}ms`));
    await new Promise((r) => setTimeout(r, wait));
  }
  throw new Error(`GitHub kept failing for ${path}`);
}

const repoPath = (p: string) => `/repos/${GBADEV_REPO}/contents/${p.split('/').map(encodeURIComponent).join('/')}?ref=${GBADEV_BRANCH}`;

async function fetchJson<T>(path: string): Promise<T> {
  const res = await github(path, 'application/vnd.github+json');
  return (await res.json()) as T;
}

async function fetchText(path: string): Promise<string> {
  const res = await github(path, 'application/vnd.github.raw');
  return res.text();
}

/**
 * ROMs can be large, and the contents endpoint is only documented to hand back
 * raw bytes for small files — so try it, and fall back to the blob endpoint
 * (which is keyed by the sha we already have from the tree) when the bytes do
 * not look like a cartridge.
 */
async function fetchBinary(path: string, sha: string, expected: number): Promise<Uint8Array> {
  const attempts: (() => Promise<Uint8Array>)[] = [
    async () => new Uint8Array(await (await github(repoPath(path), 'application/vnd.github.raw')).arrayBuffer()),
    async () => {
      const res = await github(`/repos/${GBADEV_REPO}/git/blobs/${sha}`, 'application/vnd.github+json');
      const body = (await res.json()) as { content?: string; encoding?: string };
      if (!body.content) throw new Error('blob endpoint returned no content');
      return new Uint8Array(Buffer.from(body.content, body.encoding === 'base64' ? 'base64' : 'utf8'));
    },
  ];
  let lastError: unknown = null;
  for (const attempt of attempts) {
    try {
      const bytes = await attempt();
      if (bytes.byteLength === expected) return bytes;
      lastError = new Error(`expected ${expected} bytes, got ${bytes.byteLength}`);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('download failed');
}

/* ----------------------------------------------------------------- files */

const readJson = async <T>(path: string): Promise<T | null> => {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return null;
  }
};

const writeJson = async (path: string, value: unknown) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
};

const writeIfChanged = async (path: string, body: string) => {
  const before = existsSync(path) ? await readFile(path, 'utf8') : null;
  if (before === body) return false;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body);
  return true;
};

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
/** git's own content address for a blob — the key the archive's tree lists. */
const gitBlobSha = (bytes: Uint8Array) =>
  createHash('sha1')
    .update(Buffer.concat([Buffer.from(`blob ${bytes.byteLength}\0`, 'utf8'), Buffer.from(bytes)]))
    .digest('hex');
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

/* ------------------------------------------------------------- playtest */

interface PlaytestResult {
  id: string;
  status: 'passed' | 'failed' | 'unavailable';
  detail: string;
  colours: number;
  /** Share of LCD pixels the presses changed (the larger of the two rounds). */
  moved: number;
  accent: string | null;
  cover: string | null;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.gba': 'application/octet-stream',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.data': 'application/octet-stream',
  '.svg': 'image/svg+xml',
};

/** A tiny static server over `public/` that swaps in a candidate manifest. */
async function servePublic(manifest: unknown): Promise<{ origin: string; close: () => Promise<void> }> {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const pathname = decodeURIComponent(url.pathname);
    if (pathname === '/retro/roms.json') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(manifest));
      return;
    }
    const file = normalize(join(ROOT, 'public', pathname));
    if (!file.startsWith(join(ROOT, 'public'))) {
      res.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, {
        'content-type': MIME[extname(file)] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/**
 * Runs in the page: decodes the two canvas captures, measures how much of the
 * LCD the start press changed, keeps the dominant vivid colour as the cartridge
 * accent, and hands back an exact 240×160 PNG for the cover. Kept as source text
 * (see the call site) so the bundler never rewrites it.
 */
const CAPTURE_SOURCE = `async ({ boot, afterStart, afterPlay }) => {
  const load = async (base64) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + base64;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 240;
    canvas.height = 160;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, 240, 160);
    return { canvas, data: ctx.getImageData(0, 0, 240, 160).data };
  };
  const share = (a, b) => {
    let differing = 0;
    let pixels = 0;
    for (let p = 0; p < a.data.length; p += 4) {
      const delta =
        Math.abs(a.data[p] - b.data[p]) +
        Math.abs(a.data[p + 1] - b.data[p + 1]) +
        Math.abs(a.data[p + 2] - b.data[p + 2]);
      if (delta > 12) differing += 1;
      pixels += 1;
    }
    return differing / pixels;
  };
  const first = await load(boot);
  const second = await load(afterStart);
  const third = await load(afterPlay);
  const counts = new Map();
  const vivid = new Map();
  for (let p = 0; p < third.data.length; p += 4) {
    const r = third.data[p];
    const g = third.data[p + 1];
    const b = third.data[p + 2];
    counts.set(((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2), 1);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    if (sat > 0.35 && max > 70 && max < 250) {
      const hex =
        '#' +
        [r, g, b]
          .map((v) => Math.min(255, Math.round(v / 24) * 24))
          .map((v) => v.toString(16).padStart(2, '0'))
          .join('');
      vivid.set(hex, (vivid.get(hex) || 0) + 1);
    }
  }
  const accent = [...vivid.entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    colours: counts.size,
    afterStart: share(second, first),
    afterPlay: share(third, second),
    accent: accent ? accent[0] : null,
    png: third.canvas.toDataURL('image/png'),
  };
}`;

/**
 * Boots each cartridge in the real player and only reports `passed` when the
 * core started *and* painted more than a blank LCD. The cover is captured from
 * that same run, at 2× then downscaled to the GBA's native size, so no cover can
 * exist for a cartridge that never ran.
 */
async function playtest(entries: CatalogEntry[]): Promise<PlaytestResult[]> {
  const { chromium } = await import('playwright');
  const results: PlaytestResult[] = entries.map((entry) => ({
    id: entry.id,
    status: 'failed',
    detail: 'not run',
    colours: 0,
    moved: 0,
    accent: null,
    cover: null,
  }));

  const manifest = {
    version: 1,
    games: entries.map((entry) => ({ id: entry.id, title: entry.title, rom: `roms/${entry.id}.gba` })),
  };
  const server = await servePublic(manifest);

  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  try {
    browser = await chromium.launch({
      executablePath: process.env.PIKACHU_CHROME || undefined,
      env: process.env.PIKACHU_LD ? { ...process.env, LD_LIBRARY_PATH: process.env.PIKACHU_LD } : undefined,
      args: [
        '--no-sandbox',
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--autoplay-policy=no-user-gesture-required',
      ],
    });
  } catch (error) {
    await server.close();
    const detail = `Chromium unavailable: ${(error as Error).message.slice(0, 120)}`;
    return results.map((r) => ({ ...r, status: 'unavailable', detail }));
  }

  const context = await browser.newContext({ viewport: { width: 480, height: 320 } });
  const page = await context.newPage();

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    const result = results[i];
    const started = Date.now();
    try {
      await page.goto(`${server.origin}/retro/player.html?game=${entry.id}`, { waitUntil: 'domcontentloaded' });
      const button = page.locator('.ejs_start_button');
      await button.waitFor({ timeout: 60_000 });
      await button.click();
      const frame = page.frames().find((f) => f.url().includes('/retro/player.html'));
      if (!frame) throw new Error('player frame vanished');
      await frame.waitForFunction(() => window.EJS_emulator?.started === true, null, { timeout: 90_000 });
      await page.waitForTimeout(4500);

      const paused = await frame.evaluate(() => window.EJS_emulator?.paused !== false);
      /* A booted core that never repaints is a menu, not a game. So: one frame,
         START, a second frame, then A + D-pad + A and a third frame — the
         picture has to change at least once, and the third frame is what a
         player would be looking at. Every press is held for a few emulated
         frames, because the GBA polls input. */
      const canvas = page.locator('canvas').first();
      const boot = (await canvas.screenshot()).toString('base64');
      const hold = async (key: string) => {
        await page.keyboard.down(key);
        await page.waitForTimeout(170);
        await page.keyboard.up(key);
        await page.waitForTimeout(130);
      };
      await hold('Enter');
      await page.waitForTimeout(1600);
      const afterStart = (await canvas.screenshot()).toString('base64');
      /* `z` is A, `x` is B, `Enter` is START. Front-ends differ: Apotris needs
         A, A to get from its title to a mode, uCity needs B out of "no save"
         and then a menu row down before A means anything. So confirm, back out,
         move one row down and confirm again — which lands both of them in a
         running game, and is harmless in a cartridge that was already playing. */
      for (const key of ['z', 'z', 'x', 'ArrowDown', 'z', 'z', 'z']) {
        await hold(key);
        await page.waitForTimeout(950);
      }
      await page.waitForTimeout(2000);
      const shot = await canvas.screenshot();

      /* Downscale + measure inside the page: the browser already has a PNG
         decoder, so the importer needs no image dependency. The body is a
         *string* on purpose — tsx compiles this file with `keepNames`, which
         rewrites named inner functions to `__name(...)`, and that helper does
         not exist in the page. */
      const capture = (await page.evaluate(
        `(${CAPTURE_SOURCE})(${JSON.stringify({ boot, afterStart, afterPlay: shot.toString('base64') })})`,
      )) as { colours: number; afterStart: number; afterPlay: number; accent: string | null; png: string };

      /* Optional evidence trail for whoever reads the report: every capture,
         including the ones that failed, off the committed tree. */
      const evidenceDir = process.env.PIKACHU_PLAYTEST_DIR;
      if (evidenceDir) {
        await mkdir(evidenceDir, { recursive: true });
        const png = Buffer.from(capture.png.split(',')[1] ?? '', 'base64');
        await writeFile(join(evidenceDir, `${entry.id}.png`), png);
      }

      /* Three colours is the floor for "this is a picture of something"; a
         sparse two-tone cartridge still has to show movement to pass. */
      const moved = Math.max(capture.afterStart, capture.afterPlay);
      const passed = !paused && capture.colours >= 3 && moved > 0.001;
      if (passed) {
        const coverFile = `covers/${entry.id}.png`;
        const png = Buffer.from(capture.png.split(',')[1] ?? '', 'base64');
        await mkdir(COVERS, { recursive: true });
        await writeFile(join(PUBLIC, coverFile), png);
        result.status = 'passed';
        result.detail = `${capture.colours} colours, ${(capture.afterStart * 100).toFixed(1)}% changed on START and ${(capture.afterPlay * 100).toFixed(1)}% on the first move, ${Date.now() - started}ms`;
        result.colours = capture.colours;
        result.cover = coverFile;
        result.accent = capture.accent ?? '#ffd24d';
      } else {
        result.detail = paused
          ? 'core stayed paused'
          : capture.colours < 3
            ? `only ${capture.colours} colours on screen — a blank LCD`
            : 'screen never repainted after START, A and the D-pad — a still menu, not gameplay';
      }
    } catch (error) {
      result.detail = (error as Error).message.slice(0, 160);
    }
    const mark = result.status === 'passed' ? 'ok  ' : 'FAIL';
    log(`  ${mark} ${entry.id.padEnd(28)} ${grey(result.detail)}`);
  }

  await context.close();
  await browser.close();
  await server.close();
  return results;
}

/* ------------------------------------------------------------------- run */

async function main() {
  log(bold(`\nRetro Arcade importer — source ${GBADEV_REPO} (${GBADEV_BRANCH})`));

  const previousCatalog = await readJson<CatalogFile>(CATALOG);
  const cache = (await readJson<MetadataCache>(CACHE)) ?? emptyCache(GBADEV_BRANCH);
  const state = (await readJson<ImportState>(STATE)) ?? emptyState();
  const manifestRaw = await readJson<unknown>(MANIFEST);
  let shelf: RetroGame[] = parseRetroLibrary(manifestRaw).games;

  log(grey(`cache: ${Object.keys(cache.blobs).length} metadata blobs, shelf: ${shelf.length} cartridges`));

  if (args.retest) {
    /* Covers and playtest verdicts are only as good as the run that produced
       them: `--retest` takes cartridges off the shelf in memory so they go
       through the download-checks and the playtest again. The ROM on disk is
       reused, so this costs a playtest rather than a download. */
    const wanted = new Set(args.only);
    const owned = new Set(Object.keys(state.installed));
    const before = shelf.length;
    /* Only cartridges this importer installed are fair game: the hand-written
       rows have no archive entry behind them and must never be "refreshed"
       away. A shelf row whose entry the archive still lists goes back through
       the gate, and its title still blocks a same-game duplicate. */
    shelf = shelf.filter((game) => {
      if (!owned.has(game.id)) return true;
      return wanted.size > 0 && !wanted.has(game.id);
    });
    log(grey(`--retest: ${before - shelf.length} of ${before} cartridges will be re-tested`));
  }

  const tree = await fetchJson<{ sha: string; tree: GitTreeFile[]; truncated: boolean }>(
    `/repos/${GBADEV_REPO}/git/trees/${GBADEV_BRANCH}?recursive=1`,
  );
  if (tree.truncated) throw new Error('the archive tree was truncated; refusing to plan from a partial tree');
  const index = indexEntries(tree.tree);
  log(grey(`tree ${tree.sha.slice(0, 10)} · ${index.length} entries indexed (${requests} request${requests === 1 ? '' : 's'})`));

  /* Plan, fetching what it says it needs, until it needs nothing. */
  let plan = buildPlan({
    index,
    cache,
    shelf,
    options: { allowFanGame: args.allowFanGame, maxBytes: args.maxBytes, commit: tree.sha },
  });
  for (let round = 0; round < 4 && needsAnything(plan.needs); round += 1) {
    for (const need of plan.needs.manifests) {
      /* Raw, not JSON: the contents endpoint answers a JSON *envelope* unless the
         raw media type is asked for, and the envelope is not the entry. */
      const body = await fetchText(repoPath(`entries/${need.slug}/game.json`));
      cache.blobs[need.sha] = { kind: 'json', value: JSON.parse(body) } satisfies MetadataBlob;
    }
    for (const need of plan.needs.licenseFiles) {
      const text = await fetchText(repoPath(`entries/${need.slug}/${need.path}`));
      cache.blobs[need.sha] = { kind: 'text', value: text } satisfies MetadataBlob;
    }
    log(
      grey(
        `fetched ${plan.needs.manifests.length} manifests + ${plan.needs.licenseFiles.length} licence files (${requests} requests)`,
      ),
    );
    plan = buildPlan({
      index,
      cache,
      shelf,
      options: { allowFanGame: args.allowFanGame, maxBytes: args.maxBytes, commit: tree.sha },
    });
  }
  if (needsAnything(plan.needs)) throw new Error('metadata still missing after four rounds — aborting');

  /* Which authorised entries this run is allowed to touch. */
  let work = plan.toDownload;
  if (args.only.length > 0) work = work.filter((row) => args.only.includes(row.slug) || args.only.includes(row.id));
  if (args.retryFailed) {
    const retry = new Set(retryList(state));
    work = work.filter((row) => retry.has(row.slug));
    log(grey(`--retry-failed: ${work.length} of ${retry.size} recorded failures are still importable`));
  }
  if (args.limit > 0) work = work.slice(0, args.limit);

  const stats = plan.catalog.stats;
  log(
    `\n${bold('catalogue')}  ${stats.discovered} entries · ${stats.gbaGames} GBA games · ` +
      `${stats.withLicense} with a licence · ${bold(String(stats.importable))} importable · ` +
      `${stats.installed} already installed · ${stats.skipped} skipped · ${stats.failed} failed`,
  );

  if (args.explain) {
    const reasons = new Map<string, string[]>();
    for (const row of plan.catalog.entries) {
      const key = row.verdict.reason ?? row.verdict.status;
      const list = reasons.get(key) ?? [];
      list.push(`${row.slug}${row.verdict.detail ? ` (${row.verdict.detail})` : ''}`);
      reasons.set(key, list);
    }
    for (const [reason, rows] of [...reasons.entries()].sort()) {
      log(`\n${bold(reason)} ${grey(`— ${rows.length}`)}`);
      for (const row of rows) log(grey(`    ${row}`));
    }
    log('');
  }

  if (args.dryRun) {
    for (const row of plan.toDownload) {
      log(`  would import ${row.slug.padEnd(34)} ${(row.license.spdx ?? '?').padEnd(16)} ${mb(row.rom?.bytes ?? 0)}`);
    }
    for (const [reason, count] of Object.entries(stats.byReason).sort()) log(grey(`  skip ${reason}: ${count}`));
    await writeJson(CACHE, cache);
    log(grey(`\ndry run: nothing downloaded, nothing on the shelf changed; metadata cache written. ${requests} GitHub requests.`));
    return;
  }

  /* Download + verify. */
  log(`\n${bold('download')} ${work.length} cartridges`);
  const outcomes: Record<string, Verdict> = {};
  const hashNotes: { slug: string; id: string; detail: string }[] = [];
  const ready: CatalogEntry[] = [];
  await mkdir(ROMS, { recursive: true });

  for (const entry of work) {
    const rom = entry.rom;
    if (!rom || rom.bytes === null) continue;
    const target = join(ROMS, `${entry.id}.gba`);
    try {
      const archiveSha = blobShaFor(tree.tree, entry) || null;
      const expected = { bytes: rom.bytes, gitSha: archiveSha, sha256: rom.sha256 ?? null };
      const facts = (bytes: Uint8Array) => ({
        bytes: bytes.byteLength,
        gitSha: gitBlobSha(bytes),
        sha256: sha256(bytes),
        header: hasGbaHeader(bytes),
      });

      let bytes: Uint8Array;
      let reused = false;
      const existing = existsSync(target) ? await readFile(target) : null;
      if (existing && existing.byteLength === rom.bytes && !args.refresh) {
        bytes = new Uint8Array(existing);
        reused = true;
        log(`  reuse ${entry.id.padEnd(30)} ${grey(`${mb(rom.bytes)} already on disk`)}`);
      } else {
        bytes = await fetchBinary(`entries/${entry.slug}/${rom.filename}`, archiveSha ?? '', rom.bytes);
        log(`  get   ${entry.id.padEnd(30)} ${grey(mb(bytes.byteLength))}`);
      }

      let verdict = judgeIntegrity(facts(bytes), expected);
      if (verdict.status === 'rejected' && reused) {
        /* The copy on disk is ours, not the archive's: fetch again before
           blaming the upstream file. */
        log(`  stale ${entry.id.padEnd(30)} ${grey('re-reading the archive')}`);
        bytes = await fetchBinary(`entries/${entry.slug}/${rom.filename}`, archiveSha ?? '', rom.bytes);
        reused = false;
        verdict = judgeIntegrity(facts(bytes), expected);
      }
      if (verdict.status === 'rejected') {
        outcomes[entry.slug] = { status: 'failed', reason: verdict.reason, detail: verdict.detail };
        log(`  FAIL  ${entry.id.padEnd(30)} ${grey(verdict.detail)}`);
        continue;
      }
      if (verdict.staleHash) {
        hashNotes.push({ slug: entry.slug, id: entry.id, detail: verdict.detail });
        log(`  note  ${entry.id.padEnd(30)} ${grey(verdict.detail)}`);
      }
      if (!reused) await writeFile(target, bytes);
      outcomes[entry.slug] = { status: 'importable', reason: null, detail: '' };
      entry.rom = { ...rom, sha256: sha256(bytes) };
      ready.push(entry);
    } catch (error) {
      outcomes[entry.slug] = {
        status: 'failed',
        reason: 'download-failed',
        detail: (error as Error).message.slice(0, 160),
      };
      log(`  FAIL  ${entry.id.padEnd(30)} ${grey((error as Error).message.slice(0, 100))}`);
    }
  }

  /* Playtest before anything is called playable. */
  log(`\n${bold('playtest')} ${ready.length} cartridges in Chromium`);
  const tested = ready.length > 0 ? await playtest(ready) : [];
  const installed = [];
  for (const entry of ready) {
    const result = tested.find((r) => r.id === entry.id);
    if (!result || result.status !== 'passed' || !result.cover) {
      outcomes[entry.slug] = {
        status: 'failed',
        reason: result?.status === 'unavailable' ? 'playtest-unavailable' : 'playtest-failed',
        detail: result?.detail ?? 'no result',
      };
      continue;
    }
    const digest = entry.rom?.sha256 ?? '';
    outcomes[entry.slug] = { status: 'installed', reason: null, detail: result.detail };
    installed.push({
      entry,
      installed: {
        cover: result.cover,
        bytes: entry.rom?.bytes ?? 0,
        accent: result.accent ?? '#ffd24d',
        playtest: { status: 'passed', colours: result.colours, moved: result.moved, at: new Date().toISOString() },
      },
    });
  }

  /* Redistributing a GPL/MPL cartridge means shipping its licence, not a link
     to one. Where the archive publishes a licence file for an installed entry,
     a copy goes next to the ROM. */
  const licenseCopies: Record<string, string> = {};
  for (const row of installed) {
    const item = index.find((candidate) => candidate.slug === row.entry.slug);
    const file = item?.licenseFiles[0];
    if (!file) continue;
    const blob = cache.blobs[file.sha];
    const text = blob?.kind === 'text' ? blob.value : await fetchText(repoPath(`entries/${row.entry.slug}/${file.path}`));
    cache.blobs[file.sha] = { kind: 'text', value: text } satisfies MetadataBlob;
    await mkdir(LICENSES, { recursive: true });
    await writeFile(join(LICENSES, `${row.entry.id}.txt`), text.endsWith('\n') ? text : `${text}\n`);
    licenseCopies[row.entry.slug] = `licenses/${file.path.split('/').pop() ?? 'LICENSE'}`;
  }

  /* Write everything. */
  const nextShelf = mergeShelf(shelf, installed);
  const catalog = applyOutcomes(plan.catalog, nextShelf, outcomes);
  let nextState = state;
  for (const entry of plan.toDownload) {
    const verdict = outcomes[entry.slug] ?? entry.verdict;
    nextState = recordResult(nextState, entry, verdict, new Date().toISOString(), {
      sha256: entry.rom?.sha256,
      bytes: entry.rom?.bytes ?? undefined,
    });
  }

  await writeJson(CACHE, cache);
  await writeJson(STATE, nextState);
  await writeJson(CATALOG, catalog);
  const manifestChanged = await writeIfChanged(MANIFEST, renderManifest(nextShelf, MANIFEST_NOTE));
  const shelfChanged = await writeIfChanged(GENERATED, renderShelfModule(nextShelf));
  await writeImportedNotice(nextState, catalog, { hashNotes, licenseCopies });

  const report = {
    generatedAt: new Date().toISOString(),
    source: { repo: GBADEV_REPO, branch: GBADEV_BRANCH, tree: tree.sha },
    counts: {
      discovered: stats.discovered,
      gbaGames: stats.gbaGames,
      authorised: stats.importable + stats.installed,
      importable: stats.importable,
      downloaded: ready.length,
      tested: tested.filter((r) => r.status === 'passed').length,
      installed: installed.length,
      skipped: stats.skipped,
      failed: stats.failed,
      shelf: nextShelf.length,
    },
    skippedByReason: stats.byReason,
    hashNotes,
    failures: nextState.failures,
    /* Only what this run put on the shelf, so a report never claims credit for a
       cartridge that was already there. */
    imported: catalog.entries
      .filter((row) => row.verdict.status === 'installed' && outcomes[row.slug]?.status === 'installed')
      .map((row) => ({
        id: row.id,
        slug: row.slug,
        title: row.title,
        license: row.license.spdx,
        bytes: row.rom?.bytes ?? null,
      })),
    /* Authorised, but not downloaded this run because the shelf already has it
       (an archive slug carries the author's name, so the id here can differ). */
    alreadyPresent: catalog.entries
      .filter((row) => row.verdict.status === 'installed' && outcomes[row.slug]?.status !== 'installed')
      .map((row) => ({ slug: row.slug, id: row.id, detail: row.verdict.detail })),
  };
  await writeJson(REPORT, report);

  /* Report. */
  log(`\n${bold('result')}`);
  log(`  discovered          ${report.counts.discovered} entries in ${GBADEV_REPO}`);
  log(`  GBA games           ${report.counts.gbaGames}`);
  log(`  authorised          ${report.counts.authorised} (declared a redistributable licence of their own)`);
  log(`  importable now      ${report.counts.importable}`);
  log(`  downloaded          ${report.counts.downloaded}`);
  log(`  tested playable     ${report.counts.tested}`);
  log(`  installed           ${report.counts.installed}`);
  log(`  shelf total         ${report.counts.shelf} cartridges, ${mb(nextShelf.reduce((s, g) => s + g.bytes, 0))}`);
  if (hashNotes.length) {
    log(`  stale metadata      ${hashNotes.length} — archive blob verified, published hash is older:`);
    for (const note of hashNotes) log(grey(`      ${note.slug}: ${note.detail}`));
  }
  const failures = Object.entries(nextState.failures);
  if (failures.length) {
    log(`  failed (retryable)  ${failures.length} — \`--retry-failed\` will pick these up again`);
    for (const [slug, failure] of failures) log(grey(`      ${slug}: ${failure.reason} — ${failure.detail}`));
  }
  log(grey(`\nwrote ${[manifestChanged && 'roms.json', shelfChanged && 'retroShelf.generated.ts'].filter(Boolean).join(', ') || 'no manifest changes'}, catalog.json, metadata cache, import state`));
  log(grey(`${requests} GitHub requests this run`));
}

function blobShaFor(tree: GitTreeFile[], entry: CatalogEntry): string {
  const rom = entry.rom?.filename ?? '';
  return tree.find((file) => file.path === `entries/${entry.slug}/${rom}`)?.sha ?? '';
}

async function writeImportedNotice(
  state: ImportState,
  catalog: CatalogFile,
  extras: { hashNotes: { slug: string; detail: string }[]; licenseCopies: Record<string, string> },
) {
  const rows = Object.entries(state.installed).sort((a, b) => a[1].slug.localeCompare(b[1].slug));
  if (rows.length === 0) return;
  const byId = new Map(catalog.entries.map((row) => [row.id, row]));
  const lines = [
    'IMPORTED FROM THE HOMEBREW HUB ARCHIVE',
    '======================================',
    '',
    `Source: https://github.com/${GBADEV_REPO} — the JSON database behind Homebrew Hub.`,
    'The archive itself is GPL-3.0-only, but that licence covers the database, not the',
    'games in it: each cartridge below was imported because its own entry declares a',
    'redistributable licence. The catalogue in public/retro/catalog.json records that',
    'per-entry licence, and each player page links back to the entry it came from.',
    '',
    'Every cartridge here was downloaded and checked against the archive blob size and',
    'the GBA cartridge header, then its git blob hash was compared with the archive',
    "tree's. Where an entry publishes its own sha256 it is checked too; a mismatch is",
    'listed at the bottom of this file rather than quietly accepted.',
    '',
    'Each cartridge was then booted in Chromium against this site\'s own player, and',
    'only marked playable if the LCD repainted after a START/A/D-pad sequence.',
    '',
  ];
  for (const [id, record] of rows) {
    const row = byId.get(id);
    const source = row?.links.repository ?? row?.links.website ?? null;
    lines.push(
      `  ${(row?.title ?? record.slug).padEnd(34)} ${(row?.license.spdx ?? record.license).padEnd(18)}`,
      `      ${' '.repeat(34)} ${(record.bytes / 1024 / 1024).toFixed(2)} MB  sha256 ${record.sha256}`,
      `      ${' '.repeat(34)} entry     https://github.com/${GBADEV_REPO}/tree/${GBADEV_BRANCH}/entries/${record.slug}`,
    );
    if (source) lines.push(`      ${' '.repeat(34)} upstream  ${source}`);
    const copy = extras.licenseCopies[record.slug];
    if (copy) lines.push(`      ${' '.repeat(34)} licence   public/retro/${copy.split('/').pop() ?? ''} (copied from the entry)`);
    lines.push('');
  }
  if (extras.hashNotes.length > 0) {
    lines.push(
      'METADATA THAT DID NOT MATCH THE FILE',
      '-----------------------------------',
      '',
      'These entries publish a hash for an older build. The bytes here were verified',
      'against the archive\'s own git blob, so they are exactly what the archive ships.',
      '',
    );
    for (const note of extras.hashNotes) lines.push(`  ${note.slug}: ${note.detail}`);
    lines.push('');
  }
  await writeIfChanged(IMPORTED_NOTICE, `${lines.join('\n')}\n`);
}

await main();
