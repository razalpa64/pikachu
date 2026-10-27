/**
 * `npm run dos:import` — build the DOS discovery index from the freeware library.
 *
 * The source is `YAL-PJ/dos-freeware-games-library`: a `library.json` of ~1500
 * records plus a `bundles/` directory of pre-built `.jsdos` archives, one per
 * game. Two things about it decide how this importer behaves:
 *
 *   1. **The catalogue's licence field is a shop's label, not a grant.** Every
 *      record says "Freeware" or "Shareware", sourced from one aggregator. Both
 *      mean "the original site offered this", neither means "you may host it".
 *      So nothing here is ever published: records land in `metadata-only` or
 *      `pending-rights-review`, and the shelf only grows when a human records
 *      evidence (see `judgeRedistribution`).
 *
 *   2. **A downloadUrl is not evidence that a file exists.** The record is
 *      written by a bot, and a handful point at bundles that are not in the tree.
 *      Availability is therefore decided from one recursive tree listing of the
 *      repository — real paths and real sizes — not from the JSON's own fields.
 *
 * Output is a JSON *index*: titles, years, genres, source links, availability and
 * the permission verdict. No game files are downloaded for the index, and none
 * are committed: `.jsdos` bundles belong to other people.
 *
 *   npm run dos:import                 build the index
 *   npm run dos:import -- --dry-run    parse and report, write nothing
 *   npm run dos:import -- --inspect 3  also fetch 3 bundles and check their structure
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { inspectBundle, judgeRedistribution, stageFor, type DosCandidate } from '../../src/lib/dos';
import { readZipDirectory } from '../../src/lib/zip';

const REPO = 'YAL-PJ/dos-freeware-games-library';
const API = 'https://api.github.com';
const OUT = resolve('public/retro/dos/catalog.json');

type Json = Record<string, unknown>;

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const intArg = (name: string, fallback: number) => {
  const i = args.indexOf(name);
  if (i < 0) return fallback;
  const n = Number(args[i + 1]);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
};

const log = (msg: string) => process.stdout.write(`${msg}\n`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One HTTP GET, with the behaviour a public API deserves: an explicit User-Agent,
 * `retry-after` honoured on a rate limit, exponential backoff on a 5xx, and no
 * retry at all on a 404 (that is an answer, not a failure).
 */
async function get(url: string, options: { accept?: string; raw?: boolean; tries?: number } = {}): Promise<Response> {
  const tries = options.tries ?? 4;
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: {
          accept: options.accept ?? 'application/vnd.github+json',
          'user-agent': 'pikachu-arcade-dos-importer',
          'x-github-api-version': '2022-11-28',
          ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
        },
      });
      if (res.status === 404) return res;
      if (res.status === 403 || res.status === 429) {
        const retryAfter = Number(res.headers.get('retry-after'));
        const reset = Number(res.headers.get('x-ratelimit-reset'));
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : Number.isFinite(reset) && reset > 0
            ? Math.min(60_000, Math.max(1000, reset * 1000 - Date.now() + 500))
            : 2000 * attempt;
        const remaining = res.headers.get('x-ratelimit-remaining');
        log(`  · rate limited (remaining ${remaining ?? '?'}); waiting ${Math.round(waitMs / 100) / 10}s`);
        await sleep(waitMs);
        continue;
      }
      if (res.status >= 500) throw new Error(`${url} answered ${res.status}`);
      return res;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      await sleep(500 * attempt ** 2);
    }
  }
  throw lastError ?? new Error(`${url} failed`);
}

const slug = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

async function main() {
  log('\nDOS discovery — YAL-PJ/dos-freeware-games-library\n');

  /* 1 — the repository itself: default branch and its own licence. */
  const repoRes = await get(`${API}/repos/${REPO}`);
  if (!repoRes.ok) {
    log(`  fail  repository   — answered ${repoRes.status}`);
    process.exitCode = 1;
    return;
  }
  const repo = (await repoRes.json()) as Json;
  const branch = String(repo.default_branch ?? 'main');
  log(`  ok    repository   — ${REPO} @ ${branch}`);

  /* 2 — one tree listing: every path, every size. This is what decides whether a
         bundle really exists, instead of trusting the record's downloadUrl. */
  const treeRes = await get(`${API}/repos/${REPO}/git/trees/${branch}?recursive=1`);
  if (!treeRes.ok) {
    log(`  fail  file tree    — answered ${treeRes.status}`);
    process.exitCode = 1;
    return;
  }
  const tree = (await treeRes.json()) as { tree?: { path: string; type: string; size?: number }[]; truncated?: boolean };
  const blobs = new Map<string, number>();
  for (const item of tree.tree ?? []) {
    if (item.type === 'blob') blobs.set(item.path, item.size ?? 0);
  }
  log(`  ok    file tree    — ${blobs.size} files${tree.truncated ? ' (truncated — availability is a floor, not a ceiling)' : ''}`);

  /* 3 — the catalogue */
  const libRes = await get(`${API}/repos/${REPO}/contents/library.json`, {
    accept: 'application/vnd.github.raw',
  });
  if (!libRes.ok) {
    log(`  fail  library.json — answered ${libRes.status}`);
    process.exitCode = 1;
    return;
  }
  const library = (await libRes.json()) as unknown;
  const records = Array.isArray(library) ? library : [];
  log(`  ok    library.json — ${records.length} records`);

  /* 4 — normalise, de-duplicate, judge permissions, decide stages. */
  const entries: DosCandidate[] = [];
  const seen = new Set<string>();
  const dropped: Record<string, number> = {};
  const drop = (reason: string) => { dropped[reason] = (dropped[reason] ?? 0) + 1; };

  for (const raw of records) {
    if (!raw || typeof raw !== 'object') { drop('not-an-object'); continue; }
    const r = raw as Json;
    const title = typeof r.title === 'string' ? r.title.trim() : '';
    const sourceId = typeof r.id === 'string' ? r.id.trim() : '';
    const id = slug(sourceId || title);
    if (!title) { drop('no-title'); continue; }
    if (!ID_RE.test(id)) { drop('unusable-id'); continue; }

    const sourceUrl = typeof r.sourceUrl === 'string' && /^https:\/\//i.test(r.sourceUrl)
      ? r.sourceUrl
      : `https://github.com/${REPO}`;
    if (!/^https:\/\//i.test(String(r.sourceUrl ?? ''))) drop('no-source-url');

    /* The bundle is looked up in the tree we already have. A record can claim a
       downloadUrl and have no file behind it — a few do. */
    const bundlePath = `bundles/${sourceId || id}.jsdos`;
    const bundleBytes = blobs.get(bundlePath) ?? null;
    const hasBundle = bundleBytes !== null && bundleBytes > 0;

    const permission = judgeRedistribution({
      license: typeof r.license === 'string' ? r.license : null,
      // Records can never carry evidence: evidence is a human act, recorded by
      // the admin desk, and this importer will never invent one.
      evidence: null,
    });

    if (seen.has(id)) { drop('duplicate-id'); continue; }
    seen.add(id);

    entries.push({
      id,
      title: title.slice(0, 120),
      year: typeof r.year === 'number' && r.year >= 1980 && r.year <= 2100 ? Math.round(r.year) : null,
      genre: typeof r.genre === 'string' && r.genre.trim() ? r.genre.trim().slice(0, 40) : 'Unknown',
      sourceLicense: typeof r.license === 'string' ? r.license.trim().slice(0, 40) : 'Unknown',
      sourceUrl: sourceUrl.slice(0, 300),
      hasBundle,
      bundleBytes: bundleBytes && bundleBytes <= 48 * 1024 * 1024 ? bundleBytes : null,
      stage: stageFor({ hasBundle, permission }),
      permission,
    });
  }

  entries.sort((a, b) => a.title.localeCompare(b.title, 'en', { sensitivity: 'base' }));

  /* 5 — optional structural inspection of a few real bundles. This is the only
         step that downloads game files, it writes them to the system temp
         directory, and it reports what it found rather than storing anything. */
  const inspectCount = intArg('--inspect', 0);
  const inspections: {
    id: string; bytes: number; ok: boolean; entries: number; uncompressed: number;
    problems: string[]; autoexec: string | null; suspicious: string | null;
  }[] = [];
  if (inspectCount > 0) {
    /* A spread, not the smallest N: the smallest bundles in any catalogue are
       usually stubs, so sampling them alone would say "broken" about everything
       and prove nothing. Smallest, median, largest — plus the rest if asked. */
    const withBundle = entries
      .filter((e) => e.hasBundle && e.bundleBytes && e.bundleBytes > 0)
      .sort((a, b) => (a.bundleBytes ?? 0) - (b.bundleBytes ?? 0));
    const sample: DosCandidate[] = [];
    const pick = (index: number) => {
      const item = withBundle[Math.min(withBundle.length - 1, Math.max(0, index))];
      if (item && !sample.some((s) => s.id === item.id)) sample.push(item);
    };
    if (withBundle.length) {
      pick(0);
      pick(Math.floor(withBundle.length / 2));
      pick(withBundle.length - 1);
      for (let i = 1; sample.length < inspectCount && i < withBundle.length; i += Math.max(1, Math.floor(withBundle.length / inspectCount))) {
        pick(i);
      }
    }
    sample.length = Math.min(sample.length, Math.max(inspectCount, 3));
    log(`\n  inspecting ${sample.length} real bundles (structure only — nothing is published):\n`);
    const dir = join(tmpdir(), 'pikachu-dos-inspect');
    mkdirSync(dir, { recursive: true });
    for (const entry of sample) {
      const res = await get(`${API}/repos/${REPO}/contents/bundles/${entry.id}.jsdos`, {
        accept: 'application/vnd.github.raw',
      });
      if (!res.ok) {
        log(`    fail  ${entry.id}  — download answered ${res.status}`);
        inspections.push({ id: entry.id, bytes: 0, ok: false, entries: 0, uncompressed: 0, problems: ['download-failed'], autoexec: null, suspicious: 'no-file' });
        continue;
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      writeFileSync(join(dir, `${entry.id}.jsdos`), bytes);
      const listing = readZipDirectory(bytes);
      const confEntry = listing?.find((e) => e.name === '.jsdos/dosbox.conf');
      let conf: string | null = null;
      if (confEntry) {
        /* The config is small and stored plainly in every bundle we have seen;
           read it through the local file rather than re-implementing deflate. */
        conf = readLocalConf(join(dir, `${entry.id}.jsdos`));
      }
      const report = inspectBundle({ bytes, entries: listing, conf });
      /* Structurally fine is not the same as *a game*: a bundle with a config and
         an empty folder passes every check and launches nothing. Say so. */
      const files = (listing ?? []).filter((e) => !e.isDirectory && e.name !== '.jsdos/dosbox.conf');
      const uncompressed = files.reduce((n, e) => n + e.size, 0);
      const hasProgram = files.some((e) => /\.(exe|com|bat|img|iso)$/i.test(e.name));
      const suspicious = !files.length
        ? 'no-files'
        : !hasProgram
          ? 'no-executable'
          : uncompressed < 64 * 1024
            ? 'tiny-payload'
            : null;
      inspections.push({
        id: entry.id,
        bytes: bytes.length,
        ok: report.ok,
        entries: report.entries,
        uncompressed,
        problems: report.problems,
        autoexec: report.autoexec,
        suspicious,
      });
      log(
        `    ${report.ok ? 'ok  ' : 'fail'}  ${entry.id.padEnd(28)} ${String(report.entries).padStart(4)} entries  ` +
        `${(bytes.length / 1024).toFixed(0).padStart(6)} KB  ${hasProgram ? 'has a program' : 'no program'}` +
        `${suspicious ? `  (${suspicious})` : ''}${report.ok ? '' : `  ${report.problems.join(', ')}`}`,
      );
    }
  }

  /* 6 — the index. */
  const countOf = (predicate: (e: DosCandidate) => boolean) => entries.filter(predicate).length;
  const stats = {
    discovered: entries.length,
    withBundle: countOf((e) => e.hasBundle),
    metadataOnly: countOf((e) => e.stage === 'metadata-only'),
    pendingRightsReview: countOf((e) => e.stage === 'pending-rights-review'),
    readyForTesting: countOf((e) => e.stage === 'ready-for-testing'),
    playable: countOf((e) => e.stage === 'playable'),
    inspected: inspections.length,
    inspectedOk: inspections.filter((i) => i.ok).length,
  };

  /* Compact rows: `permission` and `reason` as plain fields, not a nested object
     repeated 1500 times. Read back by `validateDosCandidate`. */
  const compact = entries.map((e) => ({
    id: e.id,
    title: e.title,
    year: e.year,
    genre: e.genre,
    sourceLicense: e.sourceLicense,
    sourceUrl: e.sourceUrl,
    hasBundle: e.hasBundle,
    bundleBytes: e.bundleBytes,
    stage: e.stage,
    permission: e.permission.status,
    reason: e.permission.reason,
  }));

  const catalogue = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: {
      repo: REPO,
      branch,
      commit: String(treeRes.headers.get('etag') ?? '').replace(/"/g, '') || null,
      license:
        'The library repository’s own licence covers its bot and its bundling scripts, not the games. ' +
        'Every record’s licence field is the aggregator’s label ("Freeware" / "Shareware"), which is a ' +
        'description of how a site once offered the file — not a redistribution grant.',
      note:
        'An index only: titles, years, genres, source links and availability. No game file is downloaded ' +
        'for it and none is hosted. A title becomes playable only when an admin records evidence that ' +
        'this project may redistribute that build.',
    },
    stats,
    dropped,
    inspections,
    permissionCheckedAt: new Date().toISOString(),
    entries: compact,
  };

  if (flag('--dry-run')) {
    log('\n  dry run — nothing written\n');
  } else {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, `${JSON.stringify(catalogue, null, 1)}\n`);
    log(`\n  wrote ${OUT.replace(`${process.cwd()}/`, '')}  (${(JSON.stringify(catalogue).length / 1024).toFixed(0)} KB)\n`);
  }

  log('  report');
  log(`    discovered            ${stats.discovered}`);
  log(`    with a real bundle    ${stats.withBundle}`);
  log(`    metadata only         ${stats.metadataOnly}`);
  log(`    awaiting permission   ${stats.pendingRightsReview}`);
  log(`    ready for testing     ${stats.readyForTesting}`);
  log(`    playable (hosted)     ${stats.playable}`);
  if (inspections.length) log(`    bundles inspected     ${stats.inspectedOk}/${stats.inspected} structurally valid`);
  if (Object.keys(dropped).length) log(`    dropped               ${Object.entries(dropped).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  log('');
}

/** Read `.jsdos/dosbox.conf` out of a bundle we just wrote to disk, with unzip. */
function readLocalConf(path: string): string | null {
  try {
    // `unzip -p` writes to stdout only; nothing is extracted to disk.
    return execFileSync('unzip', ['-p', path, '.jsdos/dosbox.conf'], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  } catch {
    return null;
  }
}

main().catch((error) => {
  console.error('\nimport failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
