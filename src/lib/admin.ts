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
import { signInWithPassword, supabase, supabaseEnabled } from './supabase';

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
export function validateUpload(draft: UploadDraft, options: { takenIds?: string[] } = {}): string[] {
  const problems: string[] = [];
  const title = draft.title.trim();
  if (title.length < 1 || title.length > 60) problems.push('Give it a title of 1–60 characters.');
  if (draft.tagline.length > 80) problems.push('The tagline has to be 80 characters or fewer.');
  if (draft.description.length > 600) problems.push('The description has to be 600 characters or fewer.');
  if (draft.author.trim().length < 1 || draft.author.length > 60) problems.push('Name the author or studio (1–60 characters).');
  if (draft.year !== null && (!Number.isFinite(draft.year) || draft.year < 1990 || draft.year > 2100)) {
    problems.push('The year has to be between 1990 and 2100, or left blank.');
  }
  if (draft.bytes <= 0 || draft.bytes > MAX_ROM_BYTES) {
    problems.push(`The ROM has to be between 1 byte and ${MAX_ROM_BYTES / (1024 * 1024)} MB.`);
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
 * Is the signed-in account an admin?
 *
 * One RPC, answered by Postgres. A failure (offline, no session, function not
 * deployed) is `false` — the safe answer, and the one that keeps `/admin` dark on
 * a project that has not run the migration.
 */
export async function amIAdmin(): Promise<boolean> {
  if (!supabaseEnabled()) return false;
  const sb = await supabase();
  if (!sb) return false;
  try {
    const { data, error } = await sb.rpc('is_admin');
    if (error) return false;
    return data === true;
  } catch {
    return false;
  }
}

export interface AdminSignInResult {
  ok: boolean;
  admin: boolean;
  name: string;
  error?: string;
}

/**
 * Sign in with the maintainer's own account.
 *
 * No credential lives in this file: this is the ordinary Supabase password
 * sign-in. Username-or-email is accepted because the Settings form allows both;
 * a bare username is tried on the app's synthetic domain only after the address
 * as typed has been refused.
 */
export async function signInAdmin(input: string, password: string): Promise<AdminSignInResult> {
  const sb = await supabase();
  if (!sb) return { ok: false, admin: false, name: '', error: 'Cloud sync is not configured on this build.' };
  const who = input.trim();
  if (!who || !password) return { ok: false, admin: false, name: '', error: 'Enter your account and password.' };

  try {
    /* Same call the Settings form makes, so a username and an email address both
       work exactly as they do there. */
    const data = await signInWithPassword(who, password);
    const admin = await amIAdmin();
    const name =
      (data.user?.user_metadata?.display_name as string | undefined) ||
      (data.user?.user_metadata?.username as string | undefined) ||
      data.user?.email ||
      'Trainer';
    return { ok: true, admin, name };
  } catch (error) {
    return {
      ok: false,
      admin: false,
      name: '',
      error: error instanceof Error ? error.message : 'Sign-in failed.',
    };
  }
}

/* ------------------------------------------------------------- cartridges */

const BUCKET = 'retro';
const publicUrlFor = (path: string): string => {
  const base = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '';
  return `${base.replace(/\/$/, '')}/storage/v1/object/public/${BUCKET}/${path}`;
};

/** Published cartridges, for the public shelf. Empty on any failure. */
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
    return (data as RetroRow[]).map((row) => retroRowToGame(row, publicUrlFor));
  } catch {
    return [];
  }
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
