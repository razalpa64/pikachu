/**
 * Your own cartridge — remembered.
 *
 * `/retro` has always let a visitor drop a ROM they own into the tab, and the
 * file was gone the moment the page reloaded. That is fine for a demo and
 * useless for a save file: a commercial cartridge someone legitimately dumped
 * has hours of progress in it, and losing the cartridge on refresh loses the
 * progress too.
 *
 * So the cartridge is kept in IndexedDB, next to the save states EmulatorJS
 * already writes. Same rule as the jukebox: binary Blobs go in IndexedDB
 * (localStorage cannot hold them), and **nothing is ever uploaded** — the store
 * lives in this browser, this origin, this profile. There is one slot, because
 * the UI is "the cartridge in your handheld", not a library, and a single slot
 * makes "which file is in there?" a question with one answer.
 *
 * The ROM itself is capped at the same 32 MB the emulator and the shelf use.
 */
import { MAX_ROM_BYTES, type CartridgeKind } from './retro';

const DB_NAME = 'pikachu-retro';
const STORE = 'cartridge';
const DB_VERSION = 1;
/** One slot, so the key is a constant rather than a generated id. */
const SLOT = 'mine';

export interface CartridgeRecord {
  /** Always `SLOT`; kept as a field so the object store has a keyPath. */
  id: string;
  /** Title as the shelf would show it — the file name without its extension. */
  name: string;
  kind: CartridgeKind;
  /** Byte length, checked against the ROM cap before and after a reload. */
  size: number;
  /** When it was dropped in, so the card can say how long it has been there. */
  savedAt: number;
  blob: Blob;
}

/** Everything about the remembered cartridge except the bytes themselves. */
export type RememberedCartridge = Omit<CartridgeRecord, 'blob'>;

/* --------------------------------------------------------------- pure bits */

/** Tokens that are labels rather than words: `(USA)`, `v1.1`, `rev1`, digits. */
const NOT_A_WORD = /^(?:usa|eur|jpn|jp|us|eu|rev\d*|v\d+(?:\.\d+)*|\d+)$/i;

/**
 * `Pokemon Red.gb` → `Pokemon Red`. Extensions are stripped and runs of
 * whitespace collapsed. A dump named the way ROM sets name them
 * (`simple_frogger`, `pokemon-red`) is all lower case and separated, so it gets
 * the capitals a title would have — while region and version tags, digits and
 * anything already capitalised are left exactly as the file had them.
 */
export function cartridgeName(filename: string): string {
  const base = filename.replace(/\.[a-z0-9]{1,5}$/i, '');
  const tidy = base.replace(/[_]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  const lowerCase = tidy === tidy.toLowerCase();
  const multiWord = /[-_.\s]/.test(tidy);
  const titled =
    lowerCase && multiWord
      ? tidy
          /* Split on dashes, underscores and spaces, not on dots: a dot inside a
             name is almost always a version (`mario-v1.1`). */
          .split(/[-_\s]+/)
          .filter(Boolean)
          .map((word) => (word.length > 1 && /^[a-z]+$/.test(word) && !NOT_A_WORD.test(word)
            ? word[0].toUpperCase() + word.slice(1)
            : word))
          .join(' ')
      : tidy;
  return titled.slice(0, 60) || 'Your cartridge';
}

/**
 * A row from the store, checked before the UI trusts it. A record written by an
 * older build, or half-written by a crash, must not put a broken file into the
 * emulator — it is dropped instead.
 */
export function validateRecord(raw: unknown): RememberedCartridge | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const name = typeof r.name === 'string' ? r.name.trim().slice(0, 60) : '';
  const size = typeof r.size === 'number' && Number.isFinite(r.size) ? Math.round(r.size) : 0;
  const savedAt = typeof r.savedAt === 'number' && Number.isFinite(r.savedAt) ? Math.round(r.savedAt) : 0;
  const kind = r.kind === 'gb' || r.kind === 'gba' ? r.kind : null;
  if (!name || !kind || size <= 0 || size > MAX_ROM_BYTES || savedAt <= 0) return null;
  return { id: SLOT, name, kind, size, savedAt };
}

/** Format a byte count the way the rest of the arcade does. */
function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** `Pokemon Red · 1.0 MB · Game Boy` — one line for the shelf card. */
export function describeCartridge(meta: RememberedCartridge): string {
  const system = meta.kind === 'gb' ? 'Game Boy' : 'Game Boy Advance';
  return `${meta.name} · ${sizeLabel(meta.size)} · ${system}`;
}

/* -------------------------------------------------------------------- store */

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this browser'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('could not open the local cartridge store'));
  });
  // A failed open must not poison the promise for the rest of the session.
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const t = d.transaction(STORE, mode);
        const req = run(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('local cartridge store request failed'));
      }),
  );
}

export type RememberOutcome =
  | { ok: true; cartridge: RememberedCartridge }
  | { ok: false; reason: 'too-big' | 'empty' | 'storage' };

/**
 * Writes the cartridge into this browser. Called on the way to the player, so a
 * cartridge that plays is the same cartridge that survives a reload.
 *
 * A failure here is never fatal: the play session goes ahead, the card just
 * cannot offer "Continue" afterwards.
 */
export async function rememberCartridge(file: File, kind: CartridgeKind): Promise<RememberOutcome> {
  if (file.size === 0) return { ok: false, reason: 'empty' };
  if (file.size > MAX_ROM_BYTES) return { ok: false, reason: 'too-big' };
  const meta: RememberedCartridge = {
    id: SLOT,
    name: cartridgeName(file.name),
    kind,
    size: file.size,
    savedAt: Date.now(),
  };
  try {
    await tx('readwrite', (s) => s.put({ ...meta, blob: file } as CartridgeRecord) as IDBRequest<IDBValidKey>);
    return { ok: true, cartridge: meta };
  } catch {
    return { ok: false, reason: 'storage' };
  }
}

/** The remembered cartridge's details, or null when there is not one. */
export async function rememberedCartridge(): Promise<RememberedCartridge | null> {
  try {
    const row = await tx<CartridgeRecord | undefined>('readonly', (s) => s.get(SLOT) as IDBRequest<CartridgeRecord | undefined>);
    if (!row || !(row.blob instanceof Blob)) return null;
    const meta = validateRecord({ ...row, size: row.size || row.blob.size });
    return meta;
  } catch {
    return null;
  }
}

/**
 * The remembered cartridge as a `File`, ready to hand to the player. A record
 * whose bytes no longer match its own size is treated as gone rather than
 * booted: a truncated ROM is a crash, not a pleasant surprise.
 */
export async function openRememberedCartridge(): Promise<{ file: File; kind: CartridgeKind } | null> {
  try {
    const row = await tx<CartridgeRecord | undefined>('readonly', (s) => s.get(SLOT) as IDBRequest<CartridgeRecord | undefined>);
    if (!row || !(row.blob instanceof Blob)) return null;
    const meta = validateRecord(row);
    if (!meta || row.blob.size !== meta.size) return null;
    return { file: new File([row.blob], `${meta.name}${meta.kind === 'gb' ? '.gb' : '.gba'}`, { type: 'application/octet-stream' }), kind: meta.kind };
  } catch {
    return null;
  }
}

/** Ejects the cartridge: the bytes and the record both go. */
export async function forgetCartridge(): Promise<boolean> {
  try {
    await tx('readwrite', (s) => s.delete(SLOT) as unknown as IDBRequest<undefined>);
    return true;
  } catch {
    return false;
  }
}
