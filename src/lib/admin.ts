/**
 * The admin layer — the client half.
 *
 * What this file is allowed to decide: nothing. It calls `public.is_admin()` and
 * lets Postgres answer; every write it performs is checked again by row-level
 * security on the table and on the storage bucket (see
 * `supabase/migrations/0004_admin.sql`). If this file were deleted, the database
 * would still refuse an ordinary account a single uploaded byte.
 *
 * What this file must never contain: a password. This repository is public, so
 * the admin credential is an ordinary Supabase auth user whose authority comes
 * from a row in `public.admin_users`. The Settings form signs in with it like any
 * other account, then asks the server whether it is an admin — and only then
 * does `/admin` exist for that session.
 */
import { LIBRARY_HEADING, RETRO_HEADING, RETRO_LEDE } from './copy';
import { ruleOnSpdx } from './gbadevCatalog';
import { MAX_ROM_BYTES, type RetroGame } from './retro';
import {
  BUNDLE_MESSAGE, MAX_BUNDLE_BYTES, extractAutoexec, inspectBundle, resetDosShelf,
  validateDosGame, type DosGame,
} from './dos';
import { readZipDirectory, readZipEntry } from './zip';
import { supabase, supabaseConfigState, supabaseEnabled } from './supabase';
import {
  accountCandidates, describeAdminProbeError, describeAuthError, missingEnvNames, notOnRosterProblem,
  type AdminAuthProblem, type RawAuthError,
} from './adminAuth';

/* ------------------------------------------------------------------ types */

export interface RetroRow {
  id: string;
  title: string;
  tagline: string;
  description: string;
  author: string;
  year: number | null;
  license: string;
  license_url: string;
  source_url: string;
  accent: string;
  tags: string[];
  bytes: number;
  rom_path: string;
  cover_path: string;
  status: 'draft' | 'published';
  /** `gba` for cartridges, `dos` for `.jsdos` bundles. Migration 0006 adds it. */
  platform?: 'gba' | 'dos';
  rights_note: string;
  created_at: string;
  updated_at: string;
}

export interface UploadDraft {
  title: string;
  accent?: string;
  tagline: string;
  description: string;
  author: string;
  year: number | null;
  license: string;
  licenseUrl: string;
  sourceUrl: string;
  tags: string[];
  bytes: number;
  rightsNote: string;
}

export interface SiteContentRow {
  key: string;
  value: string;
}

/* ------------------------------------------------------------ pure helpers */

const HTTPS = /^https:\/\/[^\s]+$/i;

/** `Pokémon Mystery Dungeon` → `pokemon-mystery-dungeon`, max 48 chars. */
export function slugify(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  return slug || 'cartridge';
}

/**
 * What the upload form must be told before a cartridge can be written.
 *
 * The licence rule is the same one the importer applies: a build is only
 * accepted when its declared licence is on the redistributable list. That is the
 * one policy this project has never bent, so an upload cannot become a loophole
 * around it — `ruleOnSpdx` refuses NC/ND/unknown ids here exactly as it does when
 * the importer reads an archive entry.
 */
export function validateUpload(
  draft: UploadDraft,
  options: { takenIds?: string[]; platform?: 'gba' | 'dos' } = {},
): string[] {
  const problems: string[] = [];
  const title = draft.title.trim();
  if (title.length < 1 || title.length > 60) problems.push('Give it a title of 1–60 characters.');
  if (draft.tagline.length > 80) problems.push('The tagline has to be 80 characters or fewer.');
  if (draft.description.length > 600) problems.push('The description has to be 600 characters or fewer.');
  if (draft.author.trim().length < 1 || draft.author.length > 60) problems.push('Name the author or studio (1–60 characters).');
  if (draft.year !== null && (!Number.isFinite(draft.year) || draft.year < 1990 || draft.year > 2100)) {
    problems.push('The year has to be between 1990 and 2100, or left blank.');
  }
  const maxBytes = options.platform === 'dos' ? MAX_BUNDLE_BYTES : MAX_ROM_BYTES;
  if (draft.bytes <= 0 || draft.bytes > maxBytes) {
    problems.push(`The ${options.platform === 'dos' ? 'bundle' : 'ROM'} has to be between 1 byte and ${maxBytes / (1024 * 1024)} MB.`);
  }
  if (options.platform === 'dos' && draft.rightsNote.trim().length < 12) {
    problems.push('Say what the right to host this build rests on — at least 12 characters.');
  }

  const ruling = ruleOnSpdx(draft.license);
  if (!ruling.spdx) {
    problems.push('Pick a licence the importer recognises (MIT, GPL-3.0-only, MPL-2.0, Zlib, CC-BY-4.0 …).');
  } else if (ruling.refused) {
    problems.push(`That licence (${ruling.spdx}) does not allow redistribution here.`);
  }

  if (!HTTPS.test(draft.licenseUrl)) problems.push('The licence link has to be an https URL.');
  if (!HTTPS.test(draft.sourceUrl)) problems.push('The source link has to be an https URL.');

  const id = slugify(title);
  if (options.takenIds?.includes(id)) problems.push(`“${id}” already exists on the shelf — pick another title, or edit that one.`);

  return problems;
}

/** A DB row → the exact shape `public/retro/roms.json` holds. */
export function retroRowToGame(row: RetroRow, publicUrl: (path: string) => string): RetroGame {
  return {
    id: row.id,
    title: row.title,
    tagline: row.tagline,
    year: row.year,
    author: row.author,
    license: row.license,
    licenseUrl: row.license_url,
    sourceUrl: row.source_url,
    description: row.description,
    rom: publicUrl(row.rom_path),
    cover: publicUrl(row.cover_path),
    marquee: null,
    bytes: row.bytes,
    accent: row.accent,
    tags: row.tags.slice(0, 6),
    players: 1,
    // Uploaded builds are not checked for battery saves, so no claim is made.
    save: null,
  };
}

/** Keys the admin may edit, with the fallback the site ships with. */
export const SITE_CONTENT_KEYS = [
  { key: 'retro.title', label: 'Retro Arcade — heading', fallback: RETRO_HEADING },
  { key: 'retro.lede', label: 'Retro Arcade — intro paragraph', fallback: RETRO_LEDE },
  { key: 'library.title', label: 'Library — heading', fallback: LIBRARY_HEADING },
] as const;

export type SiteContentKey = (typeof SITE_CONTENT_KEYS)[number]['key'];

/* ------------------------------------------------------------- admin state */

export const adminConfigured = (): boolean => supabaseEnabled();

/**
 * What the build knows about its own configuration.
 *
 * Names only — no key, no token — because the useful sentence is "add
 * VITE_SUPABASE_PUBLISHABLE_KEY", not "cloud sync is not configured".
 */
export function adminReadiness() {
  const state = supabaseConfigState();
  return { ...state, missing: missingEnvNames(state) };
}

export interface AdminProbe {
  /** `yes` = on the roster, `no` = a real session that is not on it, `error` = could not ask. */
  state: 'yes' | 'no' | 'error';
  problem?: AdminAuthProblem;
}

/**
 * Ask Postgres whether this session is an admin — and listen to *how* it answered.
 *
 * A `false` and a failure are different things, and the desk used to treat them
 * identically: an un-run migration looked exactly like "you are not on the
 * roster", which is a dead end with the wrong instructions.
 */
export async function probeAdmin(): Promise<AdminProbe> {
  if (!supabaseEnabled()) {
    return {
      state: 'error',
      problem: {
        code: 'no_cloud', title: 'This build has no Supabase project',
        body: 'The admin desk needs the cloud project even to ask who you are.',
        hint: 'Copy .env.example to .env, fill in the URL and publishable key, then restart the dev server.',
      },
    };
  }
  const sb = await supabase();
  if (!sb) {
    return {
      state: 'error',
      problem: {
        code: 'no_cloud', title: 'The Supabase SDK did not load',
        body: 'The client could not be created, so nothing can be asked of the database.',
        hint: 'Check the browser console for a [supabase] line, then reload.',
      },
    };
  }
  try {
    const { data, error } = await sb.rpc('is_admin');
    if (error) return { state: 'error', problem: describeAdminProbeError(error as RawAuthError) };
    return { state: data === true ? 'yes' : 'no' };
  } catch (error) {
    return { state: 'error', problem: describeAuthError(error as RawAuthError) };
  }
}

/**
 * Is the signed-in account an admin?
 *
 * One RPC, answered by Postgres. Anything other than a literal `true` — an
 * error, no session, a project without the migration — is `false`, which is what
 * keeps `/admin` dark on a project that has not run it.
 */
export async function amIAdmin(): Promise<boolean> {
  return (await probeAdmin()).state === 'yes';
}

export interface AdminSignInResult {
  ok: boolean;
  admin: boolean;
  name: string;
  userId?: string | null;
  email?: string | null;
  /** Why it failed, or — when `ok` but not `admin` — why the desk stays shut. */
  problem?: AdminAuthProblem;
  /** The addresses that were actually attempted. */
  tried?: string[];
}

/**
 * Sign in with the maintainer's own account.
 *
 * No credential lives in this file: this is the ordinary Supabase password
 * sign-in. A typed address is used exactly as typed; a bare word is a username
 * and is looked up on the app's synthetic domain — and when that fails, the
 * result says which address was tried, because "the password is wrong" and "that
 * account lives at a Gmail address" are different problems with different fixes.
 */
export async function signInAdmin(input: string, password: string): Promise<AdminSignInResult> {
  const sb = await supabase();
  if (!sb) {
    const state = adminReadiness();
    return {
      ok: false, admin: false, name: '',
      problem: {
        code: 'no_cloud',
        title: 'This build has no Supabase project',
        body: state.missing.length
          ? `Missing from the build: ${state.missing.join(', ')}.`
          : 'The client could not be created.',
        hint: 'Copy .env.example to .env, fill in the two values, restart the dev server and reload this page.',
      },
    };
  }
  const who = input.trim();
  if (!who || !password) {
    return {
      ok: false, admin: false, name: '',
      problem: {
        code: 'missing_fields', title: 'Both fields are needed',
        body: 'Enter the account the roster lists, and its password.',
        hint: 'The account is whatever you created in Supabase → Authentication → Users.',
      },
    };
  }

  const tried = accountCandidates(who);
  if (!tried.length) {
    return {
      ok: false, admin: false, name: '',
      problem: {
        code: 'missing_fields', title: 'That does not look like an account',
        body: 'Use the email address the account was created with, or its username.',
      },
    };
  }

  let last: RawAuthError | null = null;
  for (const email of tried) {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (!error && data.user) {
      const user = data.user;
      const name =
        (user.user_metadata?.display_name as string | undefined) ||
        (user.user_metadata?.username as string | undefined) ||
        user.email ||
        'Trainer';
      const probe = await probeAdmin();
      /* Signed in and asked: either the roster says yes, or the roster says no —
         and "no" is not a failure to report vaguely, it is a sentence with a fix
         attached (`notOnRosterProblem`). */
      if (probe.state === 'yes') {
        return { ok: true, admin: true, name, userId: user.id, email: user.email ?? email, tried };
      }
      if (probe.state === 'no') {
        return {
          ok: true, admin: false, name, userId: user.id, email: user.email ?? email, tried,
          problem: notOnRosterProblem(user.id, user.email ?? email),
        };
      }
      return {
        ok: true, admin: false, name, userId: user.id, email: user.email ?? email, tried,
        problem: probe.problem,
      };
    }
    last = {
      message: error?.message,
      code: (error as { code?: string } | null)?.code,
      status: (error as { status?: number } | null)?.status,
      name: (error as { name?: string } | null)?.name,
    };
    /* Only a credentials failure is worth trying another address for; a rate
       limit or an unconfirmed address would fail identically everywhere. */
    if (describeAuthError(last).code !== 'invalid_credentials') break;
  }

  return { ok: false, admin: false, name: '', tried, problem: describeAuthError(last) };
}

/* ------------------------------------------------------------- cartridges */

const BUCKET = 'retro';
/** Where a storage object lives, as a URL the browser can fetch. Exported so the
 *  player page can resolve a draft row an admin is previewing, using the same
 *  builder the shelf itself uses rather than a second guess at the path. */
export const publicUrlFor = (path: string): string => {
  const base = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '';
  return `${base.replace(/\/$/, '')}/storage/v1/object/public/${BUCKET}/${path}`;
};

/**
 * Published cartridges, for the GBA shelf.
 *
 * The platform is filtered *here* rather than in the query, so a project that
 * has not run migration 0006 (no `platform` column yet) still returns its GBA
 * rows instead of failing the whole request.
 */
export async function listPublishedGames(): Promise<RetroGame[]> {
  if (!supabaseEnabled()) return [];
  const sb = await supabase();
  if (!sb) return [];
  try {
    const { data, error } = await sb
      .from('retro_games')
      .select('*')
      .eq('status', 'published')
      .order('created_at', { ascending: false });
    if (error || !Array.isArray(data)) return [];
    return (data as RetroRow[])
      .filter((row) => (row.platform ?? 'gba') === 'gba')
      .map((row) => retroRowToGame(row, publicUrlFor));
  } catch {
    return [];
  }
}

/* --------------------------------------------------------------- DOS shelf */

/** A DB row → the shape `public/retro/dos/shelf.json` holds. */
export function retroRowToDosGame(row: RetroRow, publicUrl: (path: string) => string): DosGame {
  return {
    id: row.id,
    title: row.title,
    tagline: row.tagline,
    year: row.year,
    author: row.author,
    license: row.license,
    licenseUrl: row.license_url,
    sourceUrl: row.source_url,
    description: row.description,
    /* The storage path is `<id>/game.jsdos`, pinned by a check constraint in
       migration 0006 — a row cannot aim the emulator at another game's object. */
    bundle: publicUrl(row.rom_path),
    bytes: row.bytes,
    cover: null,
    accent: row.accent,
    tags: row.tags.slice(0, 6),
    rights: row.rights_note || 'Recorded on the desk.',
  };
}

/** Published DOS bundles. Empty on any failure, like the GBA shelf. */
export async function listPublishedDosGames(): Promise<DosGame[]> {
  if (!supabaseEnabled()) return [];
  const sb = await supabase();
  if (!sb) return [];
  try {
    const { data, error } = await sb
      .from('retro_games')
      .select('*')
      .eq('status', 'published')
      .order('created_at', { ascending: false });
    if (error || !Array.isArray(data)) return [];
    const rows = (data as RetroRow[]).filter((row) => row.platform === 'dos');
    return rows.map((row) => retroRowToDosGame(row, publicUrlFor));
  } catch {
    return [];
  }
}

/**
 * Publish a `.jsdos` bundle an admin is entitled to host.
 *
 * The client-side check is a courtesy, not the gate: it stops an obvious mistake
 * (a photo renamed to `.jsdos`) before 20 MB goes over the wire, and it records
 * the `[autoexec]` it found so the row says what will actually run. The database
 * enforces the id/path pinning, and the licence gate is the same `ruleOnSpdx`
 * the GBA upload uses — a `.jsdos` bundle's format is not a distribution right,
 * and the form makes the uploader state the right they are relying on.
 */
export async function uploadDosGame(input: {
  draft: UploadDraft;
  file: File;
  takenIds: string[];
}): Promise<{ id: string; autoexec: string | null }> {
  const problems = validateUpload(input.draft, { takenIds: input.takenIds, platform: 'dos' });
  if (problems.length) throw new Error(problems[0]);

  const bytes = new Uint8Array(await input.file.arrayBuffer());
  const confBytes = (await readZipEntry(bytes, '.jsdos/dosbox.conf')) ?? new Uint8Array();
  const report = inspectBundle({
    bytes,
    entries: readZipDirectory(bytes),
    conf: new TextDecoder().decode(confBytes),
  });
  const autoexec = extractAutoexec(new TextDecoder().decode(confBytes));
  if (!report.ok) throw new Error(BUNDLE_MESSAGE[report.problems[0]]);

  const sb = await supabase();
  if (!sb) throw new Error('Cloud sync is not configured on this build.');

  const id = slugify(input.draft.title);
  const bundlePath = `${id}/game.jsdos`;
  const coverPath = `${id}/cover.png`;

  /* The shelf validates every record it reads, so validate the one about to be
     written with the same function. Otherwise a draft with a 61-character tagline
     or an `http:` source URL would upload its 20 MB, save, and then quietly fail
     to appear on the shelf that reads it. */
  const entry: DosGame = {
    id,
    title: input.draft.title.trim(),
    tagline: input.draft.tagline.trim(),
    year: input.draft.year,
    author: input.draft.author.trim(),
    license: ruleOnSpdx(input.draft.license).spdx ?? 'Unknown',
    licenseUrl: input.draft.licenseUrl.trim(),
    sourceUrl: input.draft.sourceUrl.trim(),
    description: input.draft.description.trim(),
    bundle: bundlePath,
    bytes: input.file.size,
    cover: coverPath,
    accent: input.draft.accent ?? '#f2c14e',
    tags: input.draft.tags.slice(0, 6),
    rights: input.draft.rightsNote.trim(),
  };
  if (!validateDosGame(entry)) {
    throw new Error('Some field in this entry would be rejected by the shelf itself — check the title length, the tagline, and that the licence and source URLs are https.');
  }

  const { error: uploadError } = await sb.storage.from(BUCKET).upload(bundlePath, input.file, {
    contentType: 'application/octet-stream',
    upsert: true,
  });
  if (uploadError) throw new Error(`The bundle upload failed: ${uploadError.message}`);

  const cover = await coverFromTitle(input.draft.title, input.draft.accent ?? '#f2c14e');
  const { error: coverError } = await sb.storage.from(BUCKET).upload(coverPath, cover, {
    contentType: 'image/png',
    upsert: true,
  });
  if (coverError) {
    await sb.storage.from(BUCKET).remove([bundlePath]);
    throw new Error(`The cover upload failed: ${coverError.message}`);
  }

  const { data: auth } = await sb.auth.getUser();
  const row = {
    id,
    platform: 'dos' as const,
    title: input.draft.title.trim(),
    tagline: input.draft.tagline.trim(),
    description: input.draft.description.trim(),
    author: input.draft.author.trim(),
    year: input.draft.year,
    license: ruleOnSpdx(input.draft.license).spdx,
    license_url: input.draft.licenseUrl.trim(),
    source_url: input.draft.sourceUrl.trim(),
    accent: input.draft.accent ?? '#f2c14e',
    tags: input.draft.tags.slice(0, 6),
    bytes: input.file.size,
    rom_path: bundlePath,
    cover_path: coverPath,
    status: 'published' as const,
    rights_note: input.draft.rightsNote.trim(),
    created_by: auth.user?.id ?? null,
  };

  const { data, error } = await sb.from('retro_games').insert(row).select('*').single();
  if (error || !data) {
    await sb.storage.from(BUCKET).remove([bundlePath, coverPath]);
    throw new Error(`Saving the DOS entry failed: ${error?.message ?? 'unknown error'}`);
  }
  await audit(sb, 'dos.upload', id, `${input.draft.title} (${row.license})`);
  resetDosShelf();
  return { id, autoexec };
}

/**
 * Clear a discovery record for hosting, or refuse it.
 *
 * "Approve" here means *this project may redistribute this file*, and it is the
 * only path from the discovery index to a Play button. It records who decided and
 * what they relied on, in `site_content` — a table that already exists, is public
 * for reading and admin-only for writing, so the evidence is auditable without a
 * migration of its own.
 */
export async function recordDosDecision(input: {
  id: string;
  decision: 'approved' | 'blocked';
  evidence: string;
}): Promise<void> {
  const sb = await supabase();
  if (!sb) throw new Error('Cloud sync is not configured on this build.');
  const evidence = input.evidence.trim();
  if (input.decision === 'approved' && evidence.length < 12) {
    throw new Error('Record what the permission rests on (a URL, a quote, a date) — at least 12 characters.');
  }
  const { error } = await sb.from('site_content').upsert(
    {
      key: `dos.perm.${input.id}`.slice(0, 60),
      value: JSON.stringify({
        decision: input.decision,
        evidence: evidence.slice(0, 300),
        at: new Date().toISOString(),
      }),
    },
    { onConflict: 'key' },
  );
  if (error) throw new Error(error.message);
  await audit(sb, `dos.${input.decision}`, input.id, evidence.slice(0, 200));
}

/** Every row, drafts included. Admin-only, enforced by RLS. */
export async function listAllGames(): Promise<RetroRow[]> {
  const sb = await supabase();
  if (!sb) return [];
  const { data, error } = await sb.from('retro_games').select('*').order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as RetroRow[];
}

export interface UploadInput {
  draft: UploadDraft;
  file: File;
  /** Optional replacement cover; otherwise one is generated from the title. */
  cover?: File | null;
  takenIds: string[];
}

export interface UploadResult {
  row: RetroRow;
  id: string;
}

/**
 * Writes the ROM and its cover to storage, then the row to Postgres.
 *
 * The order matters: a row with no file behind it would render as a broken card
 * on the public shelf, so the bytes go first and the row is removed again if the
 * insert is refused.
 */
export async function uploadGame(input: UploadInput): Promise<UploadResult> {
  const problems = validateUpload(input.draft, { takenIds: input.takenIds });
  if (problems.length) throw new Error(problems[0]);

  const sb = await supabase();
  if (!sb) throw new Error('Cloud sync is not configured on this build.');

  const id = slugify(input.draft.title);
  const romPath = `${id}/rom.gba`;
  const coverPath = `${id}/cover.png`;

  const { error: romError } = await sb.storage.from(BUCKET).upload(romPath, input.file, {
    contentType: 'application/octet-stream',
    upsert: true,
  });
  if (romError) throw new Error(`The ROM upload failed: ${romError.message}`);

  const cover = input.cover ?? (await coverFromTitle(input.draft.title, input.draft.accent ?? '#ffd24d'));
  const { error: coverError } = await sb.storage.from(BUCKET).upload(coverPath, cover, {
    contentType: 'image/png',
    upsert: true,
  });
  if (coverError) throw new Error(`The cover upload failed: ${coverError.message}`);

  const { data: auth } = await sb.auth.getUser();
  const row = {
    id,
    title: input.draft.title.trim(),
    tagline: input.draft.tagline.trim(),
    description: input.draft.description.trim(),
    author: input.draft.author.trim(),
    year: input.draft.year,
    license: ruleOnSpdx(input.draft.license).spdx,
    license_url: input.draft.licenseUrl.trim(),
    source_url: input.draft.sourceUrl.trim(),
    accent: input.draft.accent ?? '#ffd24d',
    tags: input.draft.tags.slice(0, 6),
    bytes: input.file.size,
    rom_path: romPath,
    cover_path: coverPath,
    status: 'published' as const,
    rights_note: input.draft.rightsNote.trim(),
    created_by: auth.user?.id ?? null,
  };

  const { data, error } = await sb.from('retro_games').insert(row).select('*').single();
  if (error || !data) {
    /* Do not leave orphaned bytes behind for a listing nobody will see. */
    await sb.storage.from(BUCKET).remove([romPath, coverPath]);
    throw new Error(`Saving the catalogue entry failed: ${error?.message ?? 'unknown error'}`);
  }
  await audit(sb, 'retro.upload', id, `${input.draft.title} (${row.license})`);
  resetRetroLibrary();
  return { row: data as RetroRow, id };
}

export async function setGameStatus(id: string, status: 'draft' | 'published'): Promise<void> {
  const sb = await supabase();
  if (!sb) throw new Error('Cloud sync is not configured on this build.');
  const { error } = await sb.from('retro_games').update({ status }).eq('id', id);
  if (error) throw new Error(error.message);
  await audit(sb, `retro.${status}`, id, '');
  resetRetroLibrary();
}

export async function updateGame(id: string, patch: Partial<Pick<RetroRow, 'title' | 'tagline' | 'description' | 'author' | 'year' | 'license' | 'accent' | 'tags'>>): Promise<void> {
  const sb = await supabase();
  if (!sb) throw new Error('Cloud sync is not configured on this build.');
  if (patch.license) {
    const ruling = ruleOnSpdx(patch.license);
    if (!ruling.spdx || ruling.refused) throw new Error('That licence is not one this shelf can host.');
    patch = { ...patch, license: ruling.spdx };
  }
  const { error } = await sb.from('retro_games').update(patch).eq('id', id);
  if (error) throw new Error(error.message);
  await audit(sb, 'retro.edit', id, Object.keys(patch).join(', '));
  resetRetroLibrary();
}

export async function deleteGame(id: string): Promise<void> {
  const sb = await supabase();
  if (!sb) throw new Error('Cloud sync is not configured on this build.');
  const { data } = await sb.from('retro_games').select('rom_path, cover_path').eq('id', id).maybeSingle();
  const { error } = await sb.from('retro_games').delete().eq('id', id);
  if (error) throw new Error(error.message);
  const paths = [data?.rom_path, data?.cover_path].filter((p): p is string => typeof p === 'string');
  if (paths.length) await sb.storage.from(BUCKET).remove(paths);
  await audit(sb, 'retro.delete', id, '');
  resetRetroLibrary();
}

/* ----------------------------------------------------------------- content */

export async function loadSiteContent(): Promise<Record<string, string>> {
  if (!supabaseEnabled()) return {};
  const sb = await supabase();
  if (!sb) return {};
  try {
    const { data, error } = await sb.from('site_content').select('key, value');
    if (error || !Array.isArray(data)) return {};
    const out: Record<string, string> = {};
    for (const row of data as SiteContentRow[]) out[row.key] = row.value;
    return out;
  } catch {
    return {};
  }
}

export async function saveSiteContent(key: string, value: string): Promise<void> {
  const sb = await supabase();
  if (!sb) throw new Error('Cloud sync is not configured on this build.');
  const { error } = await sb.from('site_content').upsert({ key, value: value.slice(0, 1200) }, { onConflict: 'key' });
  if (error) throw new Error(error.message);
  await audit(sb, 'content.save', key, value.slice(0, 120));
}

/* ------------------------------------------------------------------ audit */

async function audit(sb: NonNullable<Awaited<ReturnType<typeof supabase>>>, action: string, target: string, detail: string) {
  try {
    await sb.from('admin_audit').insert({ action, target: target.slice(0, 120), detail: detail.slice(0, 600) });
  } catch {
    /* An audit write must never break the action it describes. */
  }
}

/** A generated 240×160 label, used when the admin does not supply a cover. */
export async function coverFromTitle(title: string, accent: string): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = 240;
  canvas.height = 160;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot draw the cover.');
  const gradient = ctx.createLinearGradient(0, 0, 240, 160);
  gradient.addColorStop(0, '#161310');
  gradient.addColorStop(1, accent);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 240, 160);
  ctx.fillStyle = 'rgba(255,255,255,.92)';
  ctx.font = 'bold 20px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  const words = title.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > 200 && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  const shown = lines.slice(0, 4);
  shown.forEach((text, i) => ctx.fillText(text, 120, 70 + (i - (shown.length - 1) / 2) * 26));
  ctx.font = 'bold 10px ui-monospace, monospace';
  ctx.fillStyle = 'rgba(255,255,255,.7)';
  ctx.fillText('GAME BOY ADVANCE', 120, 146);
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not draw the cover.'))), 'image/png'),
  );
}

/** Forget the parsed shelf so the next screen picks up an admin's change. */
export function resetRetroLibrary() {
  void import('./retro').then((m) => m.resetRetroLibrary());
}
