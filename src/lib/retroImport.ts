/**
 * The plumbing between the Homebrew Hub catalogue and the shelf — still pure.
 *
 * `gbadevCatalog.ts` answers "may this entry be redistributed, and what does it
 * look like on the shelf". This module answers "what does a *run* of the
 * importer do": what to reuse from the previous catalogue, what still needs
 * fetching, what may be downloaded, what the shelf looks like once the new
 * cartridges are in, and which failures are worth retrying. It talks to no
 * network and touches no disk, so `scripts/retro/import.ts` stays a thin CLI and
 * every decision here is unit-tested.
 */

import {
  classifyLicenseText,
  decideEntry,
  isEntryLicenseFile,
  parseEntry,
  toShelfGame,
  type CatalogEntry,
  type InstalledCartridge,
  type LicenseTextRuling,
  type TreeFile,
  type Verdict,
  type VerdictReason,
} from './gbadevCatalog.ts';
import type { RetroGame } from './retro.ts';

/* --------------------------------------------------------------- the tree */

export interface GitTreeFile {
  path: string;
  /** Git blob sha — the cache key for metadata. */
  sha: string;
  /** Blob size. The API calls this `size`; both spellings are accepted. */
  bytes?: number;
  size?: number;
  type: 'blob' | 'tree';
}

const blobBytes = (file: GitTreeFile): number => {
  const value = file.bytes ?? file.size ?? 0;
  return Number.isFinite(value) && value > 0 ? value : 0;
};

export interface EntryIndex {
  slug: string;
  /** Blob sha of `entries/<slug>/game.json`. */
  gameJsonSha: string;
  /** Every blob inside the entry folder, paths relative to it. */
  files: TreeFile[];
  /** Files inside the entry that could carry the entry's licence. */
  licenseFiles: { path: string; sha: string }[];
}

/**
 * Splits `entries/<slug>/…` blobs into one index per entry. Paths are relative
 * to the entry folder so they line up with `filename` in `game.json`.
 */
export function indexEntries(tree: GitTreeFile[]): EntryIndex[] {
  const bySlug = new Map<string, EntryIndex>();
  const shaByPath = new Map<string, string>();
  for (const file of tree) if (file.type === 'blob') shaByPath.set(file.path, file.sha);

  for (const file of tree) {
    if (file.type !== 'blob' || !file.path.startsWith('entries/')) continue;
    const rest = file.path.slice('entries/'.length);
    const cut = rest.indexOf('/');
    if (cut < 0) continue;
    const slug = rest.slice(0, cut);
    const rel = rest.slice(cut + 1);
    if (!slug || !rel) continue;
    let entry = bySlug.get(slug);
    if (!entry) {
      entry = { slug, gameJsonSha: '', files: [], licenseFiles: [] };
      bySlug.set(slug, entry);
    }
    entry.files.push({ path: rel, bytes: blobBytes(file) });
    if (rel !== 'game.json' && isEntryLicenseFile(rel)) {
      entry.licenseFiles.push({ path: rel, sha: file.sha });
    }
  }
  for (const entry of bySlug.values()) {
    entry.gameJsonSha = shaByPath.get(`entries/${entry.slug}/game.json`) ?? '';
    entry.files.sort((a, b) => a.path.localeCompare(b.path));
    entry.licenseFiles.sort((a, b) => a.path.localeCompare(b.path));
  }
  return [...bySlug.values()].filter((entry) => entry.gameJsonSha).sort((a, b) => a.slug.localeCompare(b.slug));
}

/* -------------------------------------------------------------- the cache */

export type MetadataBlob = { kind: 'json'; value: unknown } | { kind: 'text'; value: string };

export interface MetadataCache {
  version: 1;
  branch: string;
  /** Git blob sha → the blob's body. Never a ROM. */
  blobs: Record<string, MetadataBlob>;
}

export const emptyCache = (branch: string): MetadataCache => ({ version: 1, branch, blobs: {} });

/** What a run still has to fetch: entry manifests first, then licence texts. */
export interface FetchNeeds {
  manifests: { slug: string; sha: string }[];
  licenseFiles: { slug: string; path: string; sha: string }[];
}

export const needsAnything = (needs: FetchNeeds): boolean =>
  needs.manifests.length > 0 || needs.licenseFiles.length > 0;

/* ------------------------------------------------------------- the plan */

export interface CatalogRow extends CatalogEntry {
  cached: {
    gameJsonSha: string;
    /** Entry-relative licence path → blob sha, so licences are never refetched. */
    licenseFiles: Record<string, string>;
  };
}

export interface CatalogStats {
  discovered: number;
  gbaGames: number;
  withLicense: number;
  importable: number;
  installed: number;
  skipped: number;
  failed: number;
  byReason: Partial<Record<VerdictReason, number>>;
  /** Cartridges on the shelf right now, and how much they weigh. */
  shelfGames: number;
  shelfBytes: number;
}

export interface CatalogFile {
  version: 2;
  generatedAt: string;
  source: {
    repo: string;
    branch: string;
    commit: string;
    /** The database's own licence, stated so nobody mistakes it for the games'. */
    license: string;
    note: string;
  };
  stats: CatalogStats;
  entries: CatalogRow[];
}

/**
 * A title reduced to what makes two listings "the same game": case, punctuation,
 * a trailing `(...)` qualifier such as a jam edition, and spacing all ignored.
 */
export function titleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export interface BuildPlanInput {
  index: EntryIndex[];
  cache: MetadataCache;
  /** The committed shelf, i.e. `public/retro/roms.json`. */
  shelf: RetroGame[];
  options: { allowFanGame?: boolean; maxBytes?: number; commit?: string; now?: string };
}

export interface BuildPlanResult {
  catalog: CatalogFile;
  /** Authorised and valid: download (or re-verify) and playtest these. */
  toDownload: CatalogEntry[];
  /** Metadata the run still needs before it can decide. */
  needs: FetchNeeds;
}

/**
 * One pass of the planner. The CLI calls it with whatever is cached, fetches
 * what it asks for, and calls it again. When `needs` is empty the plan is final.
 */
export function buildPlan(input: BuildPlanInput): BuildPlanResult {
  const { index, cache, shelf, options } = input;
  const takenIds = shelf.map((game) => game.id);
  const needs: FetchNeeds = { manifests: [], licenseFiles: [] };
  const entries: CatalogEntry[] = [];
  const cached: Record<string, CatalogRow['cached']> = {};

  for (const item of index) {
    const manifest = cache.blobs[item.gameJsonSha];
    if (!manifest || manifest.kind !== 'json') {
      needs.manifests.push({ slug: item.slug, sha: item.gameJsonSha });
      continue;
    }

    const entry = parseEntry(item.slug, manifest.value, item.files);
    const licenseFiles: Record<string, string> = {};
    const texts: Record<string, LicenseTextRuling> = {};

    // Only an entry with no SPDX declaration needs its licence text read.
    if (!entry.license.spdx) {
      for (const file of item.licenseFiles) {
        licenseFiles[file.path] = file.sha;
        const blob = cache.blobs[file.sha];
        if (!blob || blob.kind !== 'text') {
          needs.licenseFiles.push({ slug: item.slug, path: file.path, sha: file.sha });
          continue;
        }
        // Re-ruled every run on purpose: the policy can change, the text cannot.
        texts[file.path] = classifyLicenseText(blob.value);
      }
    }

    entry.verdict = decideEntry(entry, {
      allowFanGame: options.allowFanGame,
      maxBytes: options.maxBytes,
      licenseTexts: texts,
      takenIds,
    });
    entries.push(entry);
    cached[item.slug] = { gameJsonSha: item.gameJsonSha, licenseFiles };
  }

  // A cartridge already on the shelf is installed, however it got there. The
  // archive slug carries the author's name, so the same game can arrive as
  // `edefelice_lander-advance` when the shelf calls it `lander-advance`: match on
  // the title as well as the id, or a refresh would shelve the same ROM twice.
  const shelfIds = new Set(shelf.map((game) => game.id));
  const shelfTitles = new Set(shelf.map((game) => titleKey(game.title)));
  for (const row of entries) {
    const onShelf = shelfIds.has(row.id) || shelfTitles.has(titleKey(row.title));
    const duplicate = row.verdict.reason === 'duplicate';
    if (onShelf && (row.verdict.status === 'importable' || duplicate)) {
      row.verdict = { status: 'installed', reason: null, detail: 'already on the shelf' };
    }
  }

  // Two archive entries can normalise to the same shelf id.
  const claimed = new Map<string, CatalogEntry>();
  for (const row of entries) {
    const clash = claimed.get(row.id);
    if (clash && row.verdict.status !== 'skipped' && clash.verdict.status !== 'skipped') {
      row.verdict = { status: 'skipped', reason: 'duplicate', detail: `same shelf id as ${clash.slug}` };
    } else if (!clash) {
      claimed.set(row.id, row);
    }
  }

  const toDownload = entries.filter((row) => row.verdict.status === 'importable');

  return {
    catalog: {
      version: 2,
      generatedAt: options.now ?? new Date().toISOString(),
      source: {
        repo: 'gbadev-org/games',
        branch: cache.branch,
        commit: options.commit ?? '',
        license:
          'The Homebrew Hub database is GPL-3.0-only. That licence covers the database, not the games in it: every entry keeps its own terms, which is what `license` on each row records.',
        note:
          'Metadata is read from a public JSON archive. A cartridge is only downloaded when its own entry declares a redistributable licence — the archive licence is never used as authority for a game.',
      },
      stats: tally(entries, shelf),
      entries: entries
        .map((row) => ({ ...row, cached: cached[row.slug] ?? { gameJsonSha: '', licenseFiles: {} } }))
        .sort((a, b) => a.title.localeCompare(b.title)),
    },
    toDownload,
    needs,
  };
}

function tally(entries: CatalogEntry[], shelf: RetroGame[]): CatalogStats {
  const byReason: Partial<Record<VerdictReason, number>> = {};
  let importable = 0;
  let installed = 0;
  let skipped = 0;
  let failed = 0;
  let withLicense = 0;
  for (const row of entries) {
    if (row.license.spdx) withLicense += 1;
    const { status, reason } = row.verdict;
    if (status === 'importable') importable += 1;
    if (status === 'installed') installed += 1;
    if (status === 'skipped') skipped += 1;
    if (status === 'failed') failed += 1;
    if (reason) byReason[reason] = (byReason[reason] ?? 0) + 1;
  }
  return {
    discovered: entries.length,
    gbaGames: entries.filter((row) => row.platform === 'GBA' && row.typetag === 'game').length,
    withLicense,
    importable,
    installed,
    skipped,
    failed,
    byReason,
    shelfGames: shelf.length,
    shelfBytes: shelf.reduce((sum, game) => sum + (Number.isFinite(game.bytes) ? game.bytes : 0), 0),
  };
}

/**
 * Folds a run's outcomes back into the catalogue: cartridges that passed the
 * playtest become `installed`, failures carry their reason, and anything this
 * run did not touch keeps the verdict the planner gave it.
 */
export function applyOutcomes(
  catalog: CatalogFile,
  shelf: RetroGame[],
  outcomes: Record<string, Verdict>,
): CatalogFile {
  const shelfIds = new Set(shelf.map((game) => game.id));
  const entries = catalog.entries.map((row) => {
    const outcome = outcomes[row.slug];
    if (outcome && outcome.status !== 'importable') return { ...row, verdict: outcome };
    if (shelfIds.has(row.id)) {
      return { ...row, verdict: { status: 'installed' as const, reason: null, detail: 'on the shelf' } };
    }
    return row;
  });
  return { ...catalog, entries, stats: tally(entries, shelf) };
}

/* --------------------------------------------------------------- the shelf */

export interface InstalledRow {
  entry: CatalogEntry;
  installed: InstalledCartridge;
}

/** Shelf = what is already committed + what this run just proved playable. */
export function mergeShelf(existing: RetroGame[], installed: InstalledRow[]): RetroGame[] {
  const byId = new Map<string, RetroGame>();
  for (const game of existing) byId.set(game.id, game);
  for (const row of installed) {
    const game = toShelfGame(row.entry, row.installed) as unknown as RetroGame;
    if (!byId.has(game.id)) byId.set(game.id, game);
  }
  return [...byId.values()].sort((a, b) => a.title.localeCompare(b.title));
}

/** Deterministic JSON for a committed manifest: no churn, no reordering noise. */
export const renderManifest = (games: RetroGame[], note: string): string =>
  `${JSON.stringify({ version: 1, system: 'Nintendo Game Boy Advance', note, games }, null, 2)}\n`;

/** The generated id list `retro.ts` and `seo.ts` read, so ids are never copied by hand. */
export function renderShelfModule(games: RetroGame[]): string {
  const rows = games.map((game) => `  { id: ${JSON.stringify(game.id)}, title: ${JSON.stringify(game.title)} },`).join('\n');
  return `/**
 * GENERATED FILE — do not edit.
 *
 * Written by \`npm run retro:import\` from the shelf it produces. \`retro.ts\` uses
 * it for the manifest-parity guard and \`seo.ts\` for structured data, so the
 * playable shelf has one source of truth: \`public/retro/roms.json\`.
 */
export const RETRO_SHELF = [
${rows}
] as const;
`;
}

/* -------------------------------------------------------- download checks */

export interface CartridgeFacts {
  bytes: number;
  /** git blob sha1 of the bytes we hold; the archive's own key for a file. */
  gitSha: string | null;
  sha256: string;
  /** Passed the cartridge-header pre-filter. */
  header: boolean;
}

export interface ExpectedFacts {
  bytes: number | null;
  gitSha: string | null;
  /** The entry's own published sha256, when it publishes one. */
  sha256: string | null;
}

export type IntegrityVerdict =
  | { status: 'ok'; staleHash: boolean; detail: string }
  | { status: 'rejected'; reason: 'integrity' | 'not-gba'; detail: string };

/**
 * Three checks, in order of authority: the size, the archive's git blob sha1
 * (which is what the archive itself commits, so it cannot be stale), and then
 * the entry's published sha256, which *can* be — `ucity-advance` publishes a
 * hash for an older build. A stale hash does not block an import whose content
 * is proven by the blob, but it is never silently ignored either: the caller
 * records it.
 */
export function judgeIntegrity(actual: CartridgeFacts, expected: ExpectedFacts): IntegrityVerdict {
  if (expected.bytes !== null && actual.bytes !== expected.bytes) {
    return {
      status: 'rejected',
      reason: 'integrity',
      detail: `${actual.bytes} bytes, archive says ${expected.bytes}`,
    };
  }
  if (expected.gitSha && actual.gitSha && expected.gitSha !== actual.gitSha) {
    return {
      status: 'rejected',
      reason: 'integrity',
      detail: `git blob ${actual.gitSha.slice(0, 12)} ≠ archive blob ${expected.gitSha.slice(0, 12)}`,
    };
  }
  if (!actual.header) return { status: 'rejected', reason: 'not-gba', detail: 'no GBA cartridge header' };
  if (expected.sha256 && expected.sha256 !== actual.sha256) {
    return {
      status: 'ok',
      staleHash: true,
      detail: `published sha256 is stale; content matches the archive blob ${expected.gitSha?.slice(0, 12) ?? ''}`.trim(),
    };
  }
  return { status: 'ok', staleHash: false, detail: '' };
}

/* ------------------------------------------------------------- the state */

export interface ImportState {
  version: 1;
  /** Failures that `--retry-failed` picks up again. */
  failures: Record<string, { reason: VerdictReason; detail: string; attempts: number; lastAt: string }>;
  /** Cartridges installed by the importer, with their integrity facts. */
  installed: Record<string, { slug: string; bytes: number; sha256: string; license: string; at: string }>;
}

export const emptyState = (): ImportState => ({ version: 1, failures: {}, installed: {} });

export const isRetryableReason = (reason: VerdictReason | null): boolean =>
  reason === 'download-failed' ||
  reason === 'integrity' ||
  reason === 'not-gba' ||
  reason === 'playtest-failed' ||
  reason === 'playtest-unavailable' ||
  reason === 'rom-not-in-archive';

/** Folds one attempt into the state file. */
export function recordResult(
  state: ImportState,
  row: CatalogEntry,
  verdict: Verdict,
  at: string,
  extras?: { sha256?: string; bytes?: number },
): ImportState {
  const failures = { ...state.failures };
  const installed = { ...state.installed };

  if (verdict.status === 'failed' && isRetryableReason(verdict.reason)) {
    const prior = failures[row.slug];
    failures[row.slug] = {
      reason: verdict.reason as VerdictReason,
      detail: verdict.detail,
      attempts: (prior?.attempts ?? 0) + 1,
      lastAt: at,
    };
  } else {
    delete failures[row.slug];
  }

  if (verdict.status === 'installed' && extras?.sha256) {
    installed[row.id] = {
      slug: row.slug,
      bytes: extras.bytes ?? 0,
      sha256: extras.sha256,
      license: row.license.spdx ?? 'unknown',
      at,
    };
  }
  return { ...state, failures, installed };
}

/** Slugs the state file says are worth another go, newest failure first. */
export const retryList = (state: ImportState): string[] =>
  Object.entries(state.failures)
    .filter(([, f]) => isRetryableReason(f.reason))
    .sort((a, b) => b[1].lastAt.localeCompare(a[1].lastAt))
    .map(([slug]) => slug);
