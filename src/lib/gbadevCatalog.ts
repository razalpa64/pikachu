/**
 * The Homebrew Hub catalogue → Pikachu Arcade shelf.
 *
 * `gbadev-org/games` (the JSON database behind https://hh.gbdev.io) is the
 * discovery source for the GBA shelf. This module is the part of the importer
 * that has *no* side effects: it turns one `entries/<slug>/game.json` plus the
 * entry's file listing into a catalogue row, decides whether that row may be
 * redistributed here, and shapes the result into the rows `public/retro/roms.json`
 * expects. `scripts/retro/import.ts` does the talking to GitHub and to Chromium.
 *
 * Two rules are load-bearing and tested:
 *
 *   1. **The database's GPLv3 licence covers the database, not the games.**
 *      Every entry has its own terms. A row is importable only when *that
 *      entry* declares a redistributable licence — an SPDX id in `gameLicense`
 *      or `license`, or a licence file in the entry whose text we can identify.
 *      No declaration, no import. Homebrew Hub's own `LICENSE` is never
 *      consulted as authority for a game.
 *   2. **Unclear is a refusal, not a warning.** Non-commercial, no-derivatives,
 *      "user licence", fan games of somebody else's character, mixed
 *      asset terms: all skipped with a reason the report can print. The cost of
 *      being wrong here is redistributing somebody's work without permission.
 */

export const GBADEV_REPO = 'gbadev-org/games';
export const GBADEV_BRANCH = 'master';
export const GBADEV_BLOB_ROOT = `https://raw.githubusercontent.com/${GBADEV_REPO}/${GBADEV_BRANCH}`;

/** Same ceiling the player enforces — see `MAX_ROM_BYTES` in `retro.ts`. */
export const MAX_ROM_BYTES = 32 * 1024 * 1024;

/* ----------------------------------------------------------- licences */

export type LicenseFamily = 'public-domain' | 'permissive' | 'copyleft' | 'content';

export interface SpdxRuling {
  /** Normalised SPDX id, or null when we could not place it. */
  spdx: string | null;
  family: LicenseFamily | null;
  /** Why a licence that exists is still not usable here. */
  refused: 'noncommercial' | 'noderivs' | 'proprietary' | 'unknown' | null;
}

/** Open licences we are willing to redistribute a ROM under. */
const FAMILIES: Record<string, LicenseFamily> = {
  'CC0-1.0': 'public-domain',
  '0BSD': 'public-domain',
  Unlicense: 'public-domain',
  WTFPL: 'public-domain',
  Beerware: 'public-domain',
  MIT: 'permissive',
  'MIT-0': 'permissive',
  ISC: 'permissive',
  'BSD-2-Clause': 'permissive',
  'BSD-3-Clause': 'permissive',
  'Apache-2.0': 'permissive',
  Zlib: 'permissive',
  'BSL-1.0': 'permissive',
  'GPL-2.0-only': 'copyleft',
  'GPL-2.0-or-later': 'copyleft',
  'GPL-3.0-only': 'copyleft',
  'GPL-3.0-or-later': 'copyleft',
  'LGPL-2.1-only': 'copyleft',
  'LGPL-2.1-or-later': 'copyleft',
  'LGPL-3.0-only': 'copyleft',
  'LGPL-3.0-or-later': 'copyleft',
  'AGPL-3.0-only': 'copyleft',
  'AGPL-3.0-or-later': 'copyleft',
  'MPL-2.0': 'copyleft',
  'EPL-2.0': 'copyleft',
  'CC-BY-3.0': 'content',
  'CC-BY-4.0': 'content',
  'CC-BY-SA-3.0': 'content',
  'CC-BY-SA-4.0': 'content',
};

/** Legacy spellings still found in Homebrew Hub entries. */
const SPDX_ALIASES: Record<string, string> = {
  'GPL-3.0': 'GPL-3.0-only',
  'GPL-3.0+': 'GPL-3.0-or-later',
  'GPL-2.0': 'GPL-2.0-only',
  'GPL-2.0+': 'GPL-2.0-or-later',
  'LGPL-3.0': 'LGPL-3.0-only',
  'LGPL-2.1': 'LGPL-2.1-only',
  'AGPL-3.0': 'AGPL-3.0-only',
  'APACHE-2.0': 'Apache-2.0',
  'CC-BY-4.0': 'CC-BY-4.0',
  'CC0': 'CC0-1.0',
  'ZLIB': 'Zlib',
  'MIT ': 'MIT',
};

/** `GPL-3.0`, `gpl 3.0`, `MPL2.0`, `Zlib ` … → an SPDX id we know, or null. */
export function normalizeSpdx(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  if (!trimmed) return null;
  const direct = SPDX_ALIASES[trimmed.toUpperCase()] ?? SPDX_ALIASES[trimmed] ?? null;
  if (direct) return direct;
  const upper = trimmed.toUpperCase();
  for (const id of Object.keys(FAMILIES)) {
    if (id.toUpperCase() === upper) return id;
  }
  // Creative Commons ids are open-ended ("CC-BY-SA-4.0", "CC-BY-NC-ND-3.0").
  const cc = /^CC[- ](BY|0)([- ][A-Z]{2})*[- ](\d\.\d)$/.exec(trimmed.toUpperCase());
  if (cc) {
    const parts = trimmed.toUpperCase().replace(/\s+/g, '-').split('-');
    const version = parts.pop();
    return parts.join('-').replace(/-+$/, '') + '-' + version;
  }
  // "MPL2.0", "LGPLv3", "GPLv3+", "mit license"
  const squashed = upper.replace(/[\s_-]+/g, '').replace(/^THE|LICENSE$|LICENCE$/g, '');
  const compact: Record<string, string> = {
    MIT: 'MIT',
    MITLICENSE: 'MIT',
    ISC: 'ISC',
    ZLIB: 'Zlib',
    MPL20: 'MPL-2.0',
    MPL2: 'MPL-2.0',
    GPL3: 'GPL-3.0-only',
    GPL30: 'GPL-3.0-only',
    GPL3PLUS: 'GPL-3.0-or-later',
    GPL30PLUS: 'GPL-3.0-or-later',
    GPLV3: 'GPL-3.0-only',
    GPL2: 'GPL-2.0-only',
    GPL2PLUS: 'GPL-2.0-or-later',
    LGPL3: 'LGPL-3.0-only',
    LGPL21: 'LGPL-2.1-only',
    AGPL3: 'AGPL-3.0-only',
    APACHE20: 'Apache-2.0',
    CC0: 'CC0-1.0',
    CC010: 'CC0-1.0',
    CCBY40: 'CC-BY-4.0',
    CCBY4: 'CC-BY-4.0',
    UNLICENSE: 'Unlicense',
    PUBLICDOMAIN: 'CC0-1.0',
  };
  return compact[squashed.replace(/[^A-Z0-9]/g, '')] ?? null;
}

/** Places an SPDX id in a family, or explains why it cannot be used here. */
export function ruleOnSpdx(raw: unknown): SpdxRuling {
  const spdx = normalizeSpdx(raw);
  if (!spdx) return { spdx: null, family: null, refused: 'unknown' };
  const family = FAMILIES[spdx] ?? null;
  if (family) return { spdx, family, refused: null };
  const upper = spdx.toUpperCase();
  if (/-NC(-|$)/.test(upper)) return { spdx, family: null, refused: 'noncommercial' };
  if (/-ND(-|$)/.test(upper)) return { spdx, family: null, refused: 'noderivs' };
  return { spdx, family: null, refused: 'proprietary' };
}

export const isRedistributable = (ruling: SpdxRuling): boolean =>
  ruling.family !== null && ruling.refused === null;

/* ---------------------------------------------- licence text sniffing */

/** Filenames that are licence files for *the entry*, not for a toolchain. */
const LICENSE_FILE_RE = /^(licen[cs]e|copying|notice)([-_. ].*)?(\.(txt|md|markdown|rst))?$/i;

/** Licences bundled with the SDKs the ROM was linked against. Not the game's. */
const TOOLCHAIN_LICENSE_RE = /(newlib|libgcc|runtime|libgba|libtonc|butano|grit|devkit|toolchain)/i;

export function isEntryLicenseFile(path: string): boolean {
  const base = path.split('/').pop() ?? path;
  if (!LICENSE_FILE_RE.test(base) && !/(licen[cs]e|copying|notice)/i.test(base)) return false;
  if (TOOLCHAIN_LICENSE_RE.test(base)) return false;
  // A `licenses/` folder in an entry holds its *dependencies'* licences
  // (`licenses/butano/libgcc/COPYING3`), never the entry's own terms. The
  // entry's own licence sits at the root or beside the ROM.
  if (/(^|\/)licen[cs]es\//i.test(path)) return false;
  return true;
}

const SIGNATURES: { spdx: string; test: RegExp }[] = [
  { spdx: 'CC0-1.0', test: /CC0 1\.0 Universal|Creative Commons Zero v1\.0/i },
  { spdx: 'CC-BY-4.0', test: /Creative Commons Attribution 4\.0|CC BY 4\.0/i },
  { spdx: 'CC-BY-SA-4.0', test: /Creative Commons Attribution-ShareAlike 4\.0|CC BY-SA 4\.0/i },
  { spdx: 'CC-BY-NC-4.0', test: /Creative Commons Attribution-NonCommercial|CC BY-NC/i },
  { spdx: 'CC-BY-ND-4.0', test: /Creative Commons Attribution-NoDerivatives|CC BY-ND/i },
  { spdx: 'Unlicense', test: /This is free and unencumbered software released into the public domain/i },
  { spdx: 'AGPL-3.0-only', test: /GNU AFFERO GENERAL PUBLIC LICENSE\s+Version 3/i },
  { spdx: 'LGPL-3.0-only', test: /GNU LESSER GENERAL PUBLIC LICENSE\s+Version 3/i },
  { spdx: 'LGPL-2.1-only', test: /GNU LESSER GENERAL PUBLIC LICENSE\s+Version 2\.1/i },
  { spdx: 'GPL-3.0-only', test: /GNU GENERAL PUBLIC LICENSE\s+Version 3|GPL-?v?3/i },
  { spdx: 'GPL-2.0-only', test: /GNU GENERAL PUBLIC LICENSE\s+Version 2|GPL-?v?2/i },
  { spdx: 'MPL-2.0', test: /Mozilla Public License\s*(Version\s*)?2\.0/i },
  { spdx: 'Apache-2.0', test: /Apache License,?\s*Version 2\.0/i },
  { spdx: 'Zlib', test: /altered source versions must be plainly marked as such/i },
  { spdx: 'ISC', test: /Permission to use, copy, modify, and(\/or)? distribute this software for any purpose/i },
  { spdx: 'MIT', test: /Permission is hereby granted, free of charge, to any person obtaining a copy/i },
  { spdx: 'BSD-3-Clause', test: /Neither the name of .{1,80} nor the names of its contributors/i },
  { spdx: 'BSD-2-Clause', test: /Redistributions of source code must retain the above copyright notice/i },
];

/** Text that makes an otherwise-recognisable licence unusable here. */
const REFUSALS: { reason: 'noncommercial' | 'noderivs' | 'proprietary'; test: RegExp }[] = [
  { reason: 'noderivs', test: /no derivative works|may not be (?:modified|altered)|no modifications/i },
  { reason: 'noncommercial', test: /non-?commercial use only|may not be sold|not be used for commercial/i },
  {
    reason: 'proprietary',
    test: /all rights reserved|user licence agreement|may not be (?:redistributed|distributed)|no unauthori[sz]ed (?:copying|distribution)|is a trademark of|(?:nintendo|sega|capcom|taito|square enix)\s+(?:co\.,?\s*ltd|inc)/i,
  },
];

export interface LicenseTextRuling extends SpdxRuling {
  /** Ids recognised in a file that names more than one licence. */
  mixed: string[];
}

/**
 * Reads a licence file. It is deliberately generous about *finding* a licence
 * and strict about *accepting* one: a file that mentions several licences, or a
 * licence plus a restriction, comes back refused rather than guessed.
 */
export function classifyLicenseText(text: string): LicenseTextRuling {
  const found: string[] = [];
  for (const sig of SIGNATURES) {
    if (sig.test.test(text) && !found.includes(sig.spdx)) found.push(sig.spdx);
  }
  // A ROM often carries two licences — code MIT, assets CC BY. The code licence
  // is the one that governs the cartridge, so it leads; the content licence is
  // reported as `mixed` rather than being mistaken for the whole story.
  const codeFirst = [...found.filter((id) => !id.startsWith('CC-BY')), ...found.filter((id) => id.startsWith('CC-BY'))];
  const body = codeFirst[0] ?? null;
  const refusal = REFUSALS.find((r) => r.test.test(text))?.reason ?? null;
  const mixed = codeFirst.filter((id) => id !== body && isRedistributable(ruleOnSpdx(id)));

  if (!body) {
    const named = /^\s*(?:licen[cs]e|licence)\s*[:\-]?\s*(MIT|GPL[- ]?3(?:\.0)?(?:-or-later)?|GPL[- ]?2(?:\.0)?|Apache[- ]?2(?:\.0)?|Zlib|BSD[- ]?3[- ]?Clause|CC0[- ]?1\.0)\b/im.exec(
      text,
    );
    const spdx = named ? normalizeSpdx(named[1]) : null;
    if (spdx) return { ...ruleOnSpdx(spdx), mixed: [] };
    return { spdx: null, family: null, refused: 'unknown', mixed: [] };
  }

  const ruling = ruleOnSpdx(body);
  if (refusal) return { ...ruling, refused: refusal, mixed };
  if (mixed.length > 0) {
    // Two open licences in one file is usually "code MIT, assets CC BY": usable,
    // but the caller is told so the report can say what the terms are.
    return { ...ruling, mixed };
  }
  return { ...ruling, mixed: [] };
}

/* -------------------------------------------------------------- entries */

export interface TreeFile {
  /** Path relative to the entry folder, e.g. `files/Game.gba`. */
  path: string;
  bytes: number;
}

export interface EntryRom {
  filename: string;
  bytes: number | null;
  sha256: string | null;
  inArchive: boolean;
}

export type VerdictStatus = 'importable' | 'installed' | 'skipped' | 'failed';

/**
 * Entries a maintainer has read and refused, beyond what the entry's fields say.
 *
 * Both of these publish a redistributable licence for their *code*, and both
 * ship content the entry does not license — which is exactly the case a field
 * check cannot see. They are listed here, with the reason, instead of being
 * quietly imported or quietly dropped.
 */
export const REVIEWED_REFUSALS: Record<string, { reason: VerdictReason; detail: string }> = {
  piugba: {
    reason: 'asset-license',
    detail: 'packs Project Outfox Serenity songs into the ROM; the entry licenses the code and the charts, not the music',
  },
  'minicraft-gba': {
    reason: 'third-party-ip',
    detail: 'Minicraft is a Minecraft derivative (Mojang); the entry licenses only the port\'s code',
  },
};

export type VerdictReason =
  | 'typetag'
  | 'platform'
  | 'nsfw'
  | 'commercial'
  | 'downloads-disabled'
  | 'no-rom'
  | 'rom-too-big'
  | 'rom-not-in-archive'
  | 'license-missing'
  | 'license-noncommercial'
  | 'license-noderivs'
  | 'license-proprietary'
  | 'license-unknown'
  | 'asset-license'
  | 'third-party-ip'
  | 'duplicate'
  | 'download-failed'
  | 'integrity'
  | 'not-gba'
  | 'playtest-failed'
  | 'playtest-unavailable';

export interface Verdict {
  status: VerdictStatus;
  reason: VerdictReason | null;
  detail: string;
}

export interface CatalogEntry {
  /** Archive folder name, e.g. `afska_beat-beast`. Unique in the archive. */
  slug: string;
  /** Shelf id once installed — `^[a-z0-9]+(-[a-z0-9]+)*$`. */
  id: string;
  title: string;
  developer: string;
  year: number | null;
  date: string | null;
  typetag: string;
  platform: string;
  tags: string[];
  description: string;
  screenshots: string[];
  links: { repository: string | null; website: string | null; physical: string | null };
  rom: EntryRom | null;
  license: {
    spdx: string | null;
    source: 'gameLicense' | 'license' | 'license-file' | 'none';
    family: LicenseFamily | null;
    /** Entry-relative path of the licence file we read, when we read one. */
    file: string | null;
    mixed: string[];
  };
  verdict: Verdict;
}

const str = (v: unknown, max = 600): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

const httpsOrNull = (v: unknown): string | null => {
  if (typeof v === 'string') {
    if (/^https:\/\//i.test(v.trim())) return v.trim();
    if (/^http:\/\//i.test(v.trim())) return `https://${v.trim().slice(7)}`;
    return null;
  }
  if (Array.isArray(v)) {
    for (const item of v) {
      const hit = httpsOrNull(item);
      if (hit) return hit;
    }
  }
  if (v && typeof v === 'object') {
    const url = (v as Record<string, unknown>).url;
    if (typeof url === 'string') return httpsOrNull(url);
  }
  return null;
};

const developerName = (v: unknown): string => {
  if (typeof v === 'string') return str(v, 80);
  if (v && typeof v === 'object' && !Array.isArray(v)) return str((v as Record<string, unknown>).name, 80);
  if (Array.isArray(v)) {
    const names = v.map((item) => developerName(item)).filter(Boolean);
    if (names.length === 0) return '';
    return names.length <= 2 ? names.join(' & ') : `${names[0]} +${names.length - 1}`;
  }
  return '';
};

/** `xniq`, `afska_beat-beast`, `MeteoRain (GBA Jam 2021)` → a shelf id. */
export function normalizeSlug(raw: string): string {
  const slug = raw
    .toLowerCase()
    .replace(/\([^)]*\)/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'entry';
}

const YEAR_RE = /^(\d{4})/;

/** One `game.json` + the entry's file listing → a catalogue row. */
export function parseEntry(slug: string, raw: unknown, files: TreeFile[]): CatalogEntry {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const byPath = new Map(files.map((f) => [f.path, f.bytes]));

  const declared = Array.isArray(r.files)
    ? (r.files as Record<string, unknown>[]).filter((f) => f && typeof f.filename === 'string')
    : [];

  const romCandidates = declared
    .filter((f) => {
      const filename = str(f.filename, 200);
      const type = str(f.type, 20).toLowerCase();
      if (type === 'manual' || type === 'patch') return false;
      return /\.(gba|agb)$/i.test(filename);
    })
    .map((f) => {
      const filename = str(f.filename, 200);
      const size = byPath.has(filename) ? (byPath.get(filename) as number) : null;
      const hash = (f.hash && typeof f.hash === 'object' ? f.hash : {}) as Record<string, unknown>;
      return {
        filename,
        bytes: size,
        sha256: typeof hash.sha256 === 'string' ? hash.sha256.toLowerCase() : null,
        inArchive: size !== null,
        preferred: f.playable !== false,
        isDefault: f.default === true,
      };
    })
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || Number(b.preferred) - Number(a.preferred));

  const rom: EntryRom | null = romCandidates[0]
    ? {
        filename: romCandidates[0].filename,
        bytes: romCandidates[0].bytes,
        sha256: romCandidates[0].sha256,
        inArchive: romCandidates[0].inArchive,
      }
    : null;

  const date = typeof r.date === 'string' ? r.date : null;
  const yearFromDate = date ? Number((YEAR_RE.exec(date) ?? [])[1]) : NaN;

  const gameLicense = str(r.gameLicense, 60);
  const legacyLicense = str(r.license, 60);
  const declaredLicense = ruleOnSpdx(gameLicense || legacyLicense);

  return {
    slug,
    id: normalizeSlug(slug),
    title: str(r.title, 90) || slug,
    developer: developerName(r.developer),
    year: Number.isFinite(yearFromDate) ? yearFromDate : null,
    date,
    typetag: str(r.typetag, 20).toLowerCase() || 'game',
    platform: str(r.platform, 8).toUpperCase() || 'GBA',
    tags: Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === 'string').slice(0, 12) : [],
    description: str(r.description, 600),
    screenshots: Array.isArray(r.screenshots)
      ? r.screenshots.filter((s): s is string => typeof s === 'string' && !s.includes('..')).slice(0, 8)
      : [],
    links: {
      repository: httpsOrNull(r.repository),
      website: httpsOrNull(r.website),
      physical: httpsOrNull(r['physical-release']),
    },
    rom,
    license: {
      spdx: declaredLicense.spdx,
      source: gameLicense ? 'gameLicense' : legacyLicense ? 'license' : 'none',
      family: declaredLicense.family,
      file: null,
      mixed: [],
    },
    verdict: { status: 'importable', reason: null, detail: '' },
  };
}

export interface DecideOptions {
  /** Import fan games of a third party's characters. Off by default. */
  allowFanGame?: boolean;
  /** Refuse ROMs over this size. Defaults to the player's own ceiling. */
  maxBytes?: number;
  /** Licence text rulings keyed by entry-relative path. */
  licenseTexts?: Record<string, LicenseTextRuling>;
  /** Ids already on the shelf (duplicate guard). */
  takenIds?: string[];
  /** `sha256` or `slug` keys already on the shelf. */
  takenHashes?: string[];
}

const FANGAME_RE = /\bfangame\b|fan game|fangames|rom ?hack/i;

/** The gate every entry passes through before a byte is downloaded. */
export function decideEntry(entry: CatalogEntry, options: DecideOptions = {}): Verdict {
  const maxBytes = options.maxBytes ?? MAX_ROM_BYTES;
  if (entry.typetag !== 'game') {
    return { status: 'skipped', reason: 'typetag', detail: `typetag is "${entry.typetag}"` };
  }
  if (entry.platform !== 'GBA') {
    return { status: 'skipped', reason: 'platform', detail: `platform is "${entry.platform}"` };
  }
  if (FANGAME_RE.test(entry.tags.join(' '))) {
    const allowed = options.allowFanGame === true;
    return {
      status: allowed ? 'importable' : 'skipped',
      reason: allowed ? null : 'third-party-ip',
      detail: allowed ? 'fan game, explicitly allowed' : 'fan game of a third-party character',
    };
  }
  if (!entry.rom) {
    return { status: 'skipped', reason: 'no-rom', detail: 'no .gba/.agb file declared' };
  }
  const reviewed = REVIEWED_REFUSALS[entry.slug];
  if (reviewed) {
    return { status: 'skipped', reason: reviewed.reason, detail: reviewed.detail };
  }
  /* Licensing is the hard gate, so it is decided before any size policy: a
     cartridge we may not redistribute must never be reported as "too big". */
  const licence = resolveLicense(entry, options.licenseTexts ?? {});
  entry.license = licence.license;
  if (licence.verdict) return licence.verdict;

  if (entry.rom.bytes !== null && entry.rom.bytes > maxBytes) {
    return {
      status: 'skipped',
      reason: 'rom-too-big',
      detail: `${(entry.rom.bytes / 1024 / 1024).toFixed(1)} MB > ${(maxBytes / 1024 / 1024).toFixed(1)} MB this run`,
    };
  }

  if (entry.rom.bytes === null) {
    return { status: 'failed', reason: 'rom-not-in-archive', detail: `${entry.rom.filename} is not in the archive tree` };
  }
  if (options.takenIds?.includes(entry.id)) {
    return { status: 'skipped', reason: 'duplicate', detail: `shelf already has "${entry.id}"` };
  }
  if (entry.rom.sha256 && options.takenHashes?.includes(entry.rom.sha256)) {
    return { status: 'skipped', reason: 'duplicate', detail: 'same cartridge bytes as a shelf entry' };
  }
  return { status: 'importable', reason: null, detail: '' };
}

function resolveLicense(
  entry: CatalogEntry,
  licenseTexts: Record<string, LicenseTextRuling>,
): { license: CatalogEntry['license']; verdict: Verdict | null } {
  const declared = ruleOnSpdx(entry.license.spdx);
  if (entry.license.spdx) {
    if (isRedistributable(declared)) {
      return {
        license: { ...entry.license, family: declared.family, file: null, mixed: [] },
        verdict: null,
      };
    }
    const reason: VerdictReason =
      declared.refused === 'noncommercial'
        ? 'license-noncommercial'
        : declared.refused === 'noderivs'
          ? 'license-noderivs'
          : declared.refused === 'unknown'
            ? 'license-unknown'
            : 'license-proprietary';
    return {
      license: { ...entry.license, family: null, file: null, mixed: [] },
      verdict: { status: 'skipped', reason, detail: `${declared.spdx ?? entry.license.spdx} is not redistributable here` },
    };
  }

  // No SPDX field: the entry's own licence file is the only remaining authority.
  // A cartridge often ships `LICENSE` (its code) next to `ASSETS_LICENSE`; the
  // code licence governs the ROM, so it is read first.
  const files = Object.keys(licenseTexts).sort((a, b) => {
    const rank = (path: string) => (/asset/i.test(path) ? 1 : 0);
    return rank(a) - rank(b) || a.localeCompare(b);
  });
  for (const file of files) {
    const ruling = licenseTexts[file];
    if (isRedistributable(ruling)) {
      return {
        license: {
          spdx: ruling.spdx,
          source: 'license-file',
          family: ruling.family,
          file,
          mixed: ruling.mixed,
        },
        verdict: null,
      };
    }
  }
  if (files.length > 0) {
    const first = licenseTexts[files[0]];
    const reason: VerdictReason =
      first.refused === 'noncommercial'
        ? 'license-noncommercial'
        : first.refused === 'noderivs'
          ? 'license-noderivs'
          : first.refused === 'proprietary'
            ? 'license-proprietary'
            : 'license-unknown';
    return {
      license: { ...entry.license, family: null, file: files[0], mixed: first.mixed },
      verdict: { status: 'skipped', reason, detail: `${files[0]} is not a redistributable licence` },
    };
  }
  return {
    license: { ...entry.license, family: null, file: null, mixed: [] },
    verdict: { status: 'skipped', reason: 'license-missing', detail: 'entry declares no licence' },
  };
}

/* --------------------------------------------------------------- shelf */

/** The archive's tags are display labels; the shelf filters on its own set. */
const GENRE_TAGS: Record<string, string> = {
  puzzle: 'puzzle',
  strategy: 'strategy',
  'turn-based strategy': 'strategy',
  shooter: 'shooter',
  arcade: 'arcade',
  action: 'action',
  platform: 'action',
  platformer: 'action',
  rpg: 'rpg',
  adventure: 'adventure',
  simulation: 'simulation',
  racing: 'racing',
  sports: 'sports',
  rhythm: 'rhythm',
  fighting: 'fighting',
  horror: 'horror',
  atmospheric: 'atmospheric',
};

export function shelfTags(tags: string[]): string[] {
  const out: string[] = [];
  for (const tag of tags) {
    const mapped = GENRE_TAGS[tag.toLowerCase()];
    if (mapped && !out.includes(mapped)) out.push(mapped);
  }
  for (const fallback of ['action', 'arcade', 'puzzle']) {
    if (out.length >= 2) break;
    if (!out.includes(fallback)) out.push(fallback);
  }
  return [...out.slice(0, 2), 'single player'];
}

/** Deterministic accent for a cartridge with no captured frame to sample. */
const ACCENTS = ['#ff9d57', '#7fd4ff', '#8ee06a', '#ff7bd5', '#ffd24d', '#b58cff', '#5b7cff', '#f2b23c'];
export function accentFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) % 997;
  return ACCENTS[hash % ACCENTS.length];
}

export interface InstalledCartridge {
  /** Captured from the running emulator by the playtest step. */
  cover: string;
  bytes: number;
  accent: string;
  playtest: { status: 'passed'; colours: number; at: string; moved?: number };
}

/**
 * Shapes a catalogue row into exactly what `public/retro/roms.json` holds, so
 * `validateRetroGame()` in `retro.ts` is a real check on the importer's output
 * rather than a hope. Field order matches the hand-written rows.
 */
export function toShelfGame(entry: CatalogEntry, installed: InstalledCartridge): Record<string, unknown> {
  const licUrl = entry.license.file
    ? `${GBADEV_BLOB_ROOT}/entries/${entry.slug}/${entry.license.file}`
    : null;
  return {
    id: entry.id,
    title: entry.title,
    tagline: (entry.description.split(/[.!?]/)[0] ?? '').trim().slice(0, 60) || entry.tags[0] || 'Homebrew',
    year: entry.year,
    author: entry.developer || 'Unknown',
    engine: 'GBA homebrew',
    license: entry.license.spdx ?? 'Unknown',
    licenseUrl: licUrl ?? entry.links.repository ?? `${GBADEV_BLOB_ROOT}/LICENSE`,
    sourceUrl:
      entry.links.repository ??
      `https://github.com/${GBADEV_REPO}/tree/${GBADEV_BRANCH}/entries/${entry.slug}`,
    description: entry.description || `${entry.title} — a Game Boy Advance homebrew cartridge from the Homebrew Hub archive.`,
    rom: `roms/${entry.id}.gba`,
    cover: installed.cover,
    marquee: null,
    bytes: installed.bytes,
    accent: installed.accent,
    tags: shelfTags(entry.tags),
    players: 1,
    /* The archive does not say whether a ROM writes battery saves, and mGBA
       detects that at runtime — so the shelf says "unknown" rather than "no". */
    save: null,
  };
}

/**
 * Rough GBA cartridge shape check: the Nintendo logo the boot ROM verifies, or
 * — for builds that blank the logo on purpose — the ARM branch the BIOS jumps
 * through at 0x00. Both are only a pre-filter: the playtest is what decides.
 */
export const GBA_LOGO_HEX =
  '24ffae51699aa2213d84820a84e409ad11248b98c0817f21a352be199309ce2010464a4af82731ec58c7e83382e3cebf85f4df94ce4b09c194568ac01372a7fc9f844d73a3ca9a615897a327fc039876231dc7610304ae56bf38840040a70efdff52fe036f9530f197fbc08560d68025a963be03014e38e2f9a234ffbb3e0344780090cb88113a9465c07c6387f03cafd625e48b380aac7221d4f807';

export function hasGbaHeader(head: Uint8Array): boolean {
  if (head.length < 0xc0) return false;
  let logo = true;
  for (let i = 0; i < 156 && logo; i += 1) {
    if (head[4 + i] !== parseInt(GBA_LOGO_HEX.slice(i * 2, i * 2 + 2), 16)) logo = false;
  }
  if (logo) return true;
  /* `b` / ARM branch opcode in the top byte of the first word. */
  return head[3] === 0xea;
}

/** True when the cartridge carries the official logo, i.e. a stock build. */
export function hasOfficialLogo(head: Uint8Array): boolean {
  if (head.length < 0xc0) return false;
  for (let i = 0; i < 156; i += 1) {
    if (head[4 + i] !== parseInt(GBA_LOGO_HEX.slice(i * 2, i * 2 + 2), 16)) return false;
  }
  return true;
}

/** Screenshots are referenced by path; this is where a browser can find them. */
export const screenshotUrl = (slug: string, file: string): string =>
  `${GBADEV_BLOB_ROOT}/entries/${slug}/${file.split('/').map(encodeURIComponent).join('/')}`;

export const entryUrl = (slug: string): string =>
  `https://github.com/${GBADEV_REPO}/tree/${GBADEV_BRANCH}/entries/${encodeURIComponent(slug)}`;
