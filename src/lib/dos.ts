/**
 * Retro Arcade — the DOS shelf.
 *
 * The Game Boy Advance half of this shelf (`retro.ts`) hosts cartridges this
 * project has built or verified itself, and its manifests only ever point inside
 * `/retro/roms/`. DOS is a different problem, and the difference is legal rather
 * than technical:
 *
 *   · A **dosgame shelf record** is a game we host: a `.jsdos` bundle in our own
 *     storage or repository, with a licence and a rights note we can point at.
 *   · A **discovery record** is a game somebody else hosts. There are ~1500 of
 *     them in the freeware catalogue we index, and *none* of their licences are
 *     evidence that we may redistribute them: the catalogue labels each one
 *     "Freeware" or "Shareware" from the aggregator it scraped, which is a
 *     description of how the original site offered it, not a grant.
 *
 * So this module keeps two lists and never mixes them. A discovery record can be
 * searched, read and linked to its original source; it has no Play button until
 * an admin has actually approved it with evidence, at which point it becomes a
 * shelf record and the player will accept its bundle. `stage` is a state
 * machine — `metadata-only`, `pending-rights-review`, `ready-for-testing`,
 * `playable` and the rest are different things, and collapsing them into
 * `isAvailable: boolean` is how a catalogue starts lying to its visitors.
 */

import { formatBytes } from './retro';

export { formatBytes };

/** Where a record is in the import pipeline. Each stage is a decision, not a flag. */
export type DosStage =
  | 'discovered'
  | 'metadata-only'
  | 'pending-rights-review'
  | 'permission-approved'
  | 'download-pending'
  | 'downloading'
  | 'validating'
  | 'ready-for-testing'
  | 'playable'
  | 'failed'
  | 'disabled';

/** Permission to *host* a file, which is not the same as permission to enjoy it. */
export type DosPermission = 'approved' | 'pending' | 'blocked';

export interface DosPermissionState {
  status: DosPermission;
  /** Machine-readable reason, so the UI can be consistent. */
  reason: string;
  /** The admin's evidence: a URL, a quote, a date. Stored, never invented. */
  evidence: string | null;
  /** ISO date the permission was last judged. */
  checkedAt: string | null;
}

/** A game this project hosts and the player will accept. */
export interface DosGame {
  id: string;
  title: string;
  tagline: string;
  year: number | null;
  author: string;
  license: string;
  licenseUrl: string;
  sourceUrl: string;
  description: string;
  /** Path inside `/retro/dos/bundles/` or an absolute https storage URL. */
  bundle: string;
  bytes: number;
  cover: string | null;
  accent: string;
  tags: string[];
  /** Where the rights to host this came from. Required — never blank. */
  rights: string;
}

export interface DosShelf {
  games: DosGame[];
  note: string;
}

export interface DosCandidate {
  id: string;
  title: string;
  year: number | null;
  genre: string;
  /** The source's own label ("Freeware", "Shareware"), quoted not asserted. */
  sourceLicense: string;
  sourceUrl: string;
  /** Whether the source repository actually contains a bundle for it. */
  hasBundle: boolean;
  bundleBytes: number | null;
  stage: DosStage;
  permission: DosPermissionState;
}

export interface DosCatalog {
  entries: DosCandidate[];
  source: { repo: string; commit: string; license: string; note: string } | null;
  stats: Record<string, number>;
  generatedAt: string | null;
}

export const DOS_SHELF_URL = '/retro/dos/shelf.json';
export const DOS_INDEX_URL = '/retro/dos/catalog.json';
export const DOS_PLAYER_URL = '/retro/dos.html';
export const DOS_BUNDLE_DIR = 'bundles/';

/** A bundle is a zip of a DOS installation; 48 MB is generous for anything legit. */
export const MAX_BUNDLE_BYTES = 48 * 1024 * 1024;
const MAX_BUNDLE_ENTRIES = 4000;

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const BUNDLE_PATH_RE = /^bundles\/[a-z0-9]+(?:-[a-z0-9]+)*\.jsdos$/;
const BUNDLE_URL_RE = /^https:\/\/[^\s"'<>]+\.jsdos$/i;
const COVER_PATH_RE = /^covers\/[a-z0-9]+(?:-[a-z0-9]+)*\.png$/;
const COVER_URL_RE = /^https:\/\/[^\s"'<>]+\.png$/i;
const ACCENT_RE = /^#[0-9a-fA-F]{6}$/;

/**
 * Licence labels that *are* a grant, because they are formal licences rather than
 * a description of a shop's price tag. Anything not on this list needs a human.
 */
export const REDISTRIBUTABLE_LICENSES = new Set([
  'public-domain', 'cc0-1.0', 'mit', 'isc', 'zlib', 'apache-2.0',
  'bsd-2-clause', 'bsd-3-clause', 'gpl-2.0', 'gpl-3.0', 'lgpl-2.1', 'lgpl-3.0',
  'mpl-2.0', 'unlicense',
]);

/**
 * Judge whether a recorded licence lets this project host the file.
 *
 * `Freeware` and `Shareware` are the two labels the freeware catalogue uses for
 * all 1499 records, and neither is a redistribution grant — shareware is
 * explicitly *not* free to redistribute in most cases, and "freeware" says only
 * that the original publisher gave it away. The answer for both is therefore
 * `pending`: a human must record evidence before anything is hosted.
 */
export function judgeRedistribution(input: {
  license: string | null | undefined;
  evidence?: string | null;
}): DosPermissionState {
  const raw = String(input.license ?? '').trim();
  const license = raw.toLowerCase().replace(/\s+/g, '-');
  const evidence = (input.evidence ?? '').trim();
  const checkedAt = new Date().toISOString();

  if (evidence.length >= 12) {
    return { status: 'approved', reason: 'evidence-recorded', evidence, checkedAt };
  }
  if (REDISTRIBUTABLE_LICENSES.has(license)) {
    return { status: 'approved', reason: 'free-licence', evidence: raw, checkedAt };
  }
  if (license === 'shareware') {
    return {
      status: 'pending',
      reason: 'shareware-label',
      evidence: null,
      checkedAt,
    };
  }
  if (license === 'freeware') {
    return { status: 'pending', reason: 'freeware-label', evidence: null, checkedAt };
  }
  return { status: 'pending', reason: 'unknown-licence', evidence: null, checkedAt };
}

/** The stage a record sits in, derived — never independently asserted. */
export function stageFor(candidate: {
  hasBundle: boolean;
  permission: DosPermissionState;
  playable?: boolean;
}): DosStage {
  if (candidate.playable) return 'playable';
  if (!candidate.hasBundle) return 'metadata-only';
  if (candidate.permission.status === 'pending') return 'pending-rights-review';
  if (candidate.permission.status === 'blocked') return 'disabled';
  return 'ready-for-testing';
}

/* ------------------------------------------------------------- validation */

const str = (v: unknown, max = 400): string | null =>
  typeof v === 'string' && v.trim().length > 0 && v.length <= max ? v.trim() : null;

const httpsUrl = (v: unknown): string | null => {
  const s = str(v, 300);
  if (!s) return null;
  try {
    return new URL(s).protocol === 'https:' ? new URL(s).toString() : null;
  } catch {
    return null;
  }
};

const relative = (v: unknown, re: RegExp): string | null => {
  const s = str(v, 300);
  return s && re.test(s) ? s : null;
};

/**
 * Validate one shelf record. Two doors again, and for the same reason as the GBA
 * manifest: the committed shelf may only point inside this site, while an
 * approved upload lives in storage and must be an absolute https URL.
 */
export function validateDosGame(raw: unknown, options: { remote?: boolean } = {}): DosGame | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id, 48);
  const title = str(r.title, 60);
  const bundle = options.remote
    ? (relative(r.bundle, BUNDLE_URL_RE) ?? relative(r.bundle, BUNDLE_PATH_RE))
    : relative(r.bundle, BUNDLE_PATH_RE);
  /* Same two doors for the cover: the committed shelf may only point at our own
     `covers/` folder, while an uploaded game's cover is an object in storage. A
     DOS row records its cover as `<id>/cover.png`, which only validates when the
     remote door is open — without this, every uploaded DOS game would be dropped
     by the shelf that reads it. */
  const coverRaw = r.cover === null || r.cover === undefined
    ? null
    : options.remote
      ? (relative(r.cover, COVER_PATH_RE) ?? relative(r.cover, COVER_URL_RE))
      : relative(r.cover, COVER_PATH_RE);
  const licenseUrl = httpsUrl(r.licenseUrl);
  const sourceUrl = httpsUrl(r.sourceUrl);
  const rights = str(r.rights, 400);
  const accent = str(r.accent, 7);
  const bytes = typeof r.bytes === 'number' && Number.isFinite(r.bytes) && r.bytes > 0 && r.bytes <= MAX_BUNDLE_BYTES
    ? Math.round(r.bytes)
    : null;
  const year = typeof r.year === 'number' && r.year >= 1980 && r.year <= 2100 ? Math.round(r.year) : null;

  if (!id || !ID_RE.test(id)) return null;
  if (!title || !bundle || !licenseUrl || !sourceUrl || !rights || !accent || !bytes) return null;
  if (!ACCENT_RE.test(accent)) return null;
  if (coverRaw === null && r.cover !== null && r.cover !== undefined) return null;

  return {
    id,
    title,
    tagline: str(r.tagline, 80) ?? '',
    year,
    author: str(r.author, 60) ?? 'Unknown',
    license: str(r.license, 40) ?? 'Unknown',
    licenseUrl,
    sourceUrl,
    description: str(r.description, 600) ?? '',
    bundle,
    bytes,
    cover: coverRaw,
    accent,
    tags: Array.isArray(r.tags)
      ? r.tags.filter((t): t is string => typeof t === 'string' && t.length > 0 && t.length <= 24).slice(0, 6)
      : [],
    rights,
  };
}

export function parseDosShelf(raw: unknown): DosShelf {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const list = Array.isArray(r.games) ? r.games : [];
  const seen = new Set<string>();
  const games: DosGame[] = [];
  for (const item of list) {
    const game = validateDosGame(item);
    if (!game || seen.has(game.id)) continue;
    seen.add(game.id);
    games.push(game);
  }
  games.sort((a, b) => a.title.localeCompare(b.title));
  return { games, note: str(r.note, 400) ?? '' };
}

/**
 * Validate one discovery record.
 *
 * Deliberately strict about the *shape* and deliberately silent about the
 * *rights*: a malformed row is dropped, but a well-formed row is never promoted
 * to playable here. `playable` is only true when the record carries an approved
 * permission, which only the catalogue writer can set.
 */
export function validateDosCandidate(raw: unknown): DosCandidate | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id, 64);
  const title = str(r.title, 120);
  const sourceUrl = httpsUrl(r.sourceUrl);
  if (!id || !ID_RE.test(id) || !title || !sourceUrl) return null;

  /* Compact on the wire: `permission` may be a bare status string with a
     `reason` beside it, because 1500 identical objects are mostly repetition.
     An object is still accepted, so an admin-edited file keeps working. */
  const permissionRaw = (typeof r.permission === 'string'
    ? { status: r.permission, reason: r.reason }
    : (r.permission ?? {})) as Record<string, unknown>;
  const status = permissionRaw.status;
  const permission: DosPermissionState = {
    status: status === 'approved' || status === 'blocked' ? status : 'pending',
    reason: str(permissionRaw.reason, 60) ?? 'unrecorded',
    evidence: str(permissionRaw.evidence, 300),
    checkedAt: str(permissionRaw.checkedAt, 40),
  };
  const hasBundle = r.hasBundle === true;
  const stageRaw = str(r.stage, 40) as DosStage | null;
  const stage = stageRaw && STAGES.has(stageRaw)
    ? stageRaw
    : stageFor({ hasBundle, permission });

  const bytes = typeof r.bundleBytes === 'number' && r.bundleBytes > 0 && r.bundleBytes <= MAX_BUNDLE_BYTES
    ? Math.round(r.bundleBytes)
    : null;

  return {
    id,
    title,
    year: typeof r.year === 'number' && r.year >= 1980 && r.year <= 2100 ? Math.round(r.year) : null,
    genre: str(r.genre, 40) ?? 'Unknown',
    sourceLicense: str(r.sourceLicense, 40) ?? 'Unknown',
    sourceUrl,
    hasBundle,
    bundleBytes: bytes,
    stage,
    permission,
  };
}

const STAGES = new Set<DosStage>([
  'discovered', 'metadata-only', 'pending-rights-review', 'permission-approved',
  'download-pending', 'downloading', 'validating', 'ready-for-testing',
  'playable', 'failed', 'disabled',
]);

export function parseDosCatalog(raw: unknown): DosCatalog {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const list = Array.isArray(r.entries) ? r.entries : [];
  const seen = new Set<string>();
  const entries: DosCandidate[] = [];
  for (const item of list) {
    const entry = validateDosCandidate(item);
    if (!entry || seen.has(entry.id)) continue;
    seen.add(entry.id);
    entries.push(entry);
  }
  const source = (r.source && typeof r.source === 'object' ? r.source : null) as DosCatalog['source'];
  return {
    entries,
    source: source && typeof source.repo === 'string' ? source : null,
    stats: (r.stats && typeof r.stats === 'object' ? r.stats : {}) as Record<string, number>,
    generatedAt: str(r.generatedAt, 40),
  };
}

/* ------------------------------------------------------------- playability */

/**
 * The one question the UI asks before showing a Play button.
 *
 * Not "does it have a URL": a candidate can have a bundle and still not be
 * playable, because the bundle belongs to somebody else. This is the boundary the
 * whole module exists to keep.
 */
export const isPlayable = (candidate: DosCandidate): boolean => candidate.stage === 'playable';

/** Human-readable label for a stage, for a badge. */
export const STAGE_LABEL: Record<DosStage, string> = {
  discovered: 'Discovered',
  'metadata-only': 'Metadata only',
  'pending-rights-review': 'Awaiting permission',
  'permission-approved': 'Permission on file',
  'download-pending': 'Bundle pending',
  downloading: 'Downloading',
  validating: 'Validating',
  'ready-for-testing': 'Ready to test',
  playable: 'Playable',
  failed: 'Failed',
  disabled: 'Unavailable',
};

/** Why a record is not playable, in a sentence a visitor can act on. */
export function explainStage(candidate: DosCandidate): string {
  switch (candidate.stage) {
    case 'playable':
      return 'Hosted here, from a build this project is allowed to redistribute.';
    case 'metadata-only':
      return 'The catalogue has a description but no game file, so there is nothing to host.';
    case 'pending-rights-review':
      return `Listed as “${candidate.sourceLicense}” by the source catalogue. That label is not a redistribution grant, so this title is not hosted until the rights are confirmed.`;
    case 'disabled':
      return 'This title was withdrawn from the shelf.';
    case 'failed':
      return 'The file was rejected when it was checked, so it is not offered.';
    default:
      return 'Being prepared — not ready to play yet.';
  }
}

/* ---------------------------------------------------------------- bundles */

export type BundleProblem =
  | 'not-a-zip'
  | 'no-conf'
  | 'too-many-entries'
  | 'path-traversal'
  | 'absurd-size'
  | 'empty'
  | 'too-big';

export const BUNDLE_MESSAGE: Record<BundleProblem, string> = {
  'not-a-zip': 'That file is not a .jsdos bundle — a bundle is a ZIP archive.',
  'no-conf': 'That bundle has no .jsdos/dosbox.conf, which is the file js-dos reads to know how to boot it.',
  'too-many-entries': 'That archive has an implausible number of entries for a DOS game.',
  'path-traversal': 'That archive contains a path such as “../”, which is never legitimate in a bundle.',
  'absurd-size': 'An entry in that archive claims a size larger than the whole archive — a decompression bomb, or corruption.',
  empty: 'That file is empty.',
  'too-big': 'That bundle is larger than 48 MB, which is well past anything this shelf hosts.',
};

export interface BundleReport {
  ok: boolean;
  problems: BundleProblem[];
  entries: number;
  hasConf: boolean;
  /** The `[autoexec]` section, if there is one — shown to an admin, never run here. */
  autoexec: string | null;
}

/**
 * Check a `.jsdos` bundle from its directory listing plus the config file.
 *
 * Structural checks only: is it a ZIP, does it contain the config js-dos
 * requires, does any path escape the archive, are the announced sizes plausible.
 * It does not decompress, execute or emulate anything — that is js-dos's job in
 * the browser, behind its own sandbox.
 */
export function inspectBundle(input: {
  bytes: Uint8Array;
  entries: { name: string; size: number; compressedSize: number }[] | null;
  conf?: string | null;
}): BundleReport {
  const problems: BundleProblem[] = [];
  if (input.bytes.length === 0) problems.push('empty');
  if (input.bytes.length > MAX_BUNDLE_BYTES) problems.push('too-big');
  if (!input.entries) {
    problems.push('not-a-zip');
    return { ok: false, problems, entries: 0, hasConf: false, autoexec: null };
  }
  if (input.entries.length > MAX_BUNDLE_ENTRIES) problems.push('too-many-entries');
  for (const entry of input.entries) {
    const name = entry.name;
    if (name.startsWith('/') || name.includes('../') || /^[a-z]:/i.test(name)) problems.push('path-traversal');
    /* A stored entry can never be larger than the archive; a deflated one can be
       100× larger, so only flag what no compression ratio explains. */
    if (entry.size > input.bytes.length * 200) problems.push('absurd-size');
  }
  const hasConf = input.entries.some((e) => e.name.replace(/^\.\//, '') === '.jsdos/dosbox.conf');
  if (!hasConf) problems.push('no-conf');

  const autoexec = input.conf ? extractAutoexec(input.conf) : null;
  return {
    ok: problems.length === 0,
    problems: [...new Set(problems)],
    entries: input.entries.length,
    hasConf,
    autoexec,
  };
}

/** The `[autoexec]` block of a dosbox.conf, tidy and bounded. */
export function extractAutoexec(conf: string): string | null {
  const lines = conf.split(/\r?\n/);
  const start = lines.findIndex((l) => /^\s*\[autoexec\]\s*$/i.test(l));
  if (start < 0) return null;
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\s*\[.+\]\s*$/.test(line)) break;
    if (line.trim()) out.push(line.trim().slice(0, 120));
    if (out.length >= 20) break;
  }
  return out.length ? out.join('\n') : null;
}

/* ---------------------------------------------------------------- loading */

let shelfCache: Promise<DosShelf> | null = null;
let indexCache: Promise<DosCatalog> | null = null;

/** Drops the cached shelf, so a screen mounts with the admin's latest change. */
export function resetDosShelf() {
  shelfCache = null;
}

/**
 * The playable shelf: the committed manifest, plus anything an admin published.
 *
 * Same shape of failure as the GBA shelf: a broken remote half (no cloud project,
 * RLS refusing, migration missing) must never take the committed shelf with it,
 * so the upload half resolves to nothing rather than rejecting.
 */
export function loadDosShelf(): Promise<DosShelf> {
  if (!shelfCache) {
    shelfCache = fetch(DOS_SHELF_URL, { headers: { accept: 'application/json' } })
      .then((res) => {
        if (!res.ok) throw new Error(`DOS shelf request failed (${res.status})`);
        return res.json() as Promise<unknown>;
      })
      .then(parseDosShelf)
      .then(async (base) => {
        const { listPublishedDosGames } = await import('./admin');
        const extra = await listPublishedDosGames().catch(() => []);
        const seen = new Set(base.games.map((g) => g.id));
        const games = [...base.games];
        for (const game of extra) {
          const valid = validateDosGame(game, { remote: true });
          if (!valid || seen.has(valid.id)) continue;
          seen.add(valid.id);
          games.push(valid);
        }
        games.sort((a, b) => a.title.localeCompare(b.title));
        return { ...base, games };
      })
      .catch((error) => {
        shelfCache = null;
        throw error;
      });
  }
  return shelfCache;
}

/** The discovery index — 1500 rows, only fetched when somebody asks for DOS. */
export function loadDosIndex(): Promise<DosCatalog> {
  if (!indexCache) {
    indexCache = fetch(DOS_INDEX_URL, { headers: { accept: 'application/json' } })
      .then((res) => {
        if (!res.ok) throw new Error(`DOS index request failed (${res.status})`);
        return res.json() as Promise<unknown>;
      })
      .then(parseDosCatalog)
      .catch((error) => {
        indexCache = null;
        throw error;
      });
  }
  return indexCache;
}

export const dosGameById = (games: DosGame[] | null, id: string | undefined): DosGame | null =>
  games && id ? games.find((g) => g.id === id) ?? null : null;

/** Bundle URL the player may load: our own folder, or an https storage object. */
export const bundleUrlFor = (game: DosGame): string =>
  /^https:\/\//i.test(game.bundle) ? game.bundle : `/retro/dos/${game.bundle}`;

export const coverUrlForDos = (game: DosGame): string | null =>
  game.cover ? `/retro/dos/${game.cover}` : null;

/* ---------------------------------------------------------------- catalog */

/** Genres as the source spells them, for the filter row — most common first. */
export function genresOf(entries: DosCandidate[]): { genre: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const entry of entries) counts.set(entry.genre, (counts.get(entry.genre) ?? 0) + 1);
  return [...counts.entries()]
    .map(([genre, count]) => ({ genre, count }))
    .sort((a, b) => b.count - a.count || a.genre.localeCompare(b.genre));
}

/** Search across the discovery index. Title and genre only: no invisible fields. */
export function searchIndex(entries: DosCandidate[], query: string, genre: string | null): DosCandidate[] {
  const q = query.trim().toLowerCase();
  return entries.filter((entry) => {
    if (genre && entry.genre !== genre) return false;
    if (!q) return true;
    return (
      entry.title.toLowerCase().includes(q) ||
      entry.genre.toLowerCase().includes(q) ||
      String(entry.year ?? '').includes(q)
    );
  });
}

/**
 * The keys js-dos gives a DOS game, which are the ones DOS games were designed
 * around. Surfaced in the player because a hidden control scheme is the fastest
 * way to make a working emulator feel broken.
 */
export const DOS_KEYBOARD = [
  { keys: ['↑', '↓', '←', '→'], action: 'Movement' },
  { keys: ['Ctrl'], action: 'Fire / action' },
  { keys: ['Alt'], action: 'Strafe / second action' },
  { keys: ['Space'], action: 'Jump / confirm' },
  { keys: ['Enter'], action: 'Menu select' },
  { keys: ['Esc'], action: 'Menu back' },
  { keys: ['F1', 'F2', 'F3'], action: 'Game-specific' },
] as const;

/** How many records are in each stage — the numbers the admin report quotes. */
export function countStages(entries: DosCandidate[]): Record<DosStage, number> {
  const out = {} as Record<DosStage, number>;
  for (const stage of STAGES) out[stage] = 0;
  for (const entry of entries) out[entry.stage] = (out[entry.stage] ?? 0) + 1;
  return out;
}
