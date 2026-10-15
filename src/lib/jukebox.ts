/**
 * Jukebox — the player's own music.
 *
 * Songs are stored as Blobs in IndexedDB (localStorage tops out around 5 MB and
 * cannot hold binary, so it is not an option for real audio files). Playback
 * uses a single long-lived <audio> element routed through the app's music gain
 * node, which means the Music slider and the mute button control uploaded songs
 * exactly like they control the built-in pads — one volume system, not two.
 *
 * Everything here is local to the device. No file is ever uploaded anywhere.
 */
import { musicDestination, setExternalMusic, audioUnlocked } from './audio';

export interface TrackMeta {
  id: string;
  name: string;
  type: string;
  size: number;
  addedAt: number;
}
interface TrackRow extends TrackMeta {
  blob: Blob;
}

const DB_NAME = 'pikachu-music';
const STORE = 'tracks';
const DB_VERSION = 1;

/** Reject anything the browser cannot actually play, before it reaches storage. */
export const ACCEPT = 'audio/*,.mp3,.m4a,.aac,.ogg,.oga,.opus,.wav,.flac,.webm';
const MAX_BYTES = 40 * 1024 * 1024; // 40 MB per file — a generous lossless album track

/* ------------------------------------------------------------------- store */

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then((d) => new Promise<T>((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const req = run(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  }));
}

const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto
  ? crypto.randomUUID()
  : `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);

/** Strip the extension and tidy common separators so the list reads like titles. */
function prettyName(filename: string): string {
  const base = filename.replace(/\.[a-z0-9]{1,5}$/i, '');
  return base.replace(/[_]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 90) || 'Untitled';
}

export interface AddResult {
  added: TrackMeta[];
  rejected: { name: string; reason: string }[];
}

/** Probe whether this browser will actually decode the file before storing it. */
function canPlay(file: File): boolean {
  if (!file.type) return true; // no MIME from the OS — let the element try
  const el = document.createElement('audio');
  return el.canPlayType(file.type) !== '';
}

export async function addFiles(files: FileList | File[]): Promise<AddResult> {
  const out: AddResult = { added: [], rejected: [] };
  for (const file of Array.from(files)) {
    if (file.size > MAX_BYTES) {
      out.rejected.push({ name: file.name, reason: `too large (${(file.size / 1048576).toFixed(0)} MB, limit 40 MB)` });
      continue;
    }
    if (!canPlay(file)) {
      out.rejected.push({ name: file.name, reason: 'this browser cannot play that format' });
      continue;
    }
    const row: TrackRow = {
      id: newId(),
      name: prettyName(file.name),
      type: file.type || 'audio/mpeg',
      size: file.size,
      addedAt: Date.now(),
      blob: file,
    };
    try {
      await tx('readwrite', (s) => s.put(row) as IDBRequest<IDBValidKey>);
      const { blob: _blob, ...meta } = row;
      out.added.push(meta);
    } catch {
      out.rejected.push({ name: file.name, reason: 'could not be saved on this device' });
    }
  }
  if (out.added.length) await refreshLibrary();
  return out;
}

export async function removeTrack(id: string) {
  await tx('readwrite', (s) => s.delete(id) as unknown as IDBRequest<undefined>);
  if (state.currentId === id) await stop();
  await refreshLibrary();
}

export async function clearAll() {
  await tx('readwrite', (s) => s.clear() as unknown as IDBRequest<undefined>);
  await stop();
  await refreshLibrary();
}

async function readAll(): Promise<TrackRow[]> {
  try {
    const rows = await tx<TrackRow[]>('readonly', (s) => s.getAll() as IDBRequest<TrackRow[]>);
    return rows.sort((a, b) => a.addedAt - b.addedAt);
  } catch {
    return [];
  }
}

async function readOne(id: string): Promise<TrackRow | undefined> {
  try { return await tx<TrackRow>('readonly', (s) => s.get(id) as IDBRequest<TrackRow>); }
  catch { return undefined; }
}

/* ------------------------------------------------------------------ player */

export interface JukeboxState {
  tracks: TrackMeta[];
  currentId: string | null;
  playing: boolean;
  /** Set when playback fails, so the UI can say why instead of silently doing nothing. */
  error: string | null;
  ready: boolean;
  /** seconds into the current track, and its length — 0 when unknown */
  position: number;
  duration: number;
}

let state: JukeboxState = { tracks: [], currentId: null, playing: false, error: null, ready: false, position: 0, duration: 0 };
const listeners = new Set<(s: JukeboxState) => void>();

function emit(patch: Partial<JukeboxState>) {
  state = { ...state, ...patch };
  for (const fn of listeners) fn(state);
}

export function subscribe(fn: (s: JukeboxState) => void): () => void {
  listeners.add(fn);
  fn(state);
  return () => { listeners.delete(fn); };
}
export function getState() { return state; }

let el: HTMLAudioElement | null = null;
let wired = false;
let objectUrl: string | null = null;
let shuffle = true;

export function setShuffle(on: boolean) { shuffle = on; }

/**
 * One element for the whole session: createMediaElementSource may only be called
 * once per element, so the src is swapped rather than the element replaced.
 */
function element(): HTMLAudioElement {
  if (el) return el;
  el = document.createElement('audio');
  el.preload = 'metadata';
  el.crossOrigin = 'anonymous';
  /* Attached (hidden) rather than a detached `new Audio()`: an element in the
     document can be inspected in devtools, picked up by OS media controls, and
     asserted on by the browser tests. It is inert and silent on its own — the
     sound travels through the Web Audio graph. */
  el.setAttribute('aria-hidden', 'true');
  el.setAttribute('data-jukebox', '');
  el.style.display = 'none';
  document.body.appendChild(el);
  el.addEventListener('ended', () => { void next(); });
  el.addEventListener('error', () => {
    emit({ playing: false, error: 'That file could not be played. It may be corrupt or an unsupported codec.' });
  });
  el.addEventListener('play', () => emit({ playing: true, error: null }));
  el.addEventListener('pause', () => emit({ playing: false }));
  // position + length, so the player can show a real scrubber instead of a
  // decorative bar. `timeupdate` fires ~4x a second, which is plenty.
  el.addEventListener('timeupdate', () => {
    emit({ position: el?.currentTime ?? 0, duration: Number.isFinite(el?.duration) ? (el?.duration ?? 0) : 0 });
  });
  el.addEventListener('loadedmetadata', () => {
    emit({ position: 0, duration: Number.isFinite(el?.duration) ? (el?.duration ?? 0) : 0 });
  });
  return el;
}

/** Route the element through the shared music gain node (once). */
function wire() {
  if (wired) return;
  const dest = musicDestination();
  if (!dest) return;            // context not unlocked yet — retry on the next play
  try {
    const src = dest.ctx.createMediaElementSource(element());
    src.connect(dest.bus);
    wired = true;
  } catch {
    /* Already wired by a previous call, or the browser refused. Falling through
       leaves the element on its own output, which still plays — just outside the
       Music slider. Better than silence. */
    wired = true;
  }
}

export async function refreshLibrary() {
  const rows = await readAll();
  emit({ tracks: rows.map(({ blob: _b, ...m }) => m), ready: true });
}

export async function playTrack(id: string): Promise<void> {
  const row = await readOne(id);
  if (!row) { emit({ error: 'That track is no longer saved on this device.' }); return; }

  wire();
  const a = element();
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(row.blob);
  a.src = objectUrl;
  emit({ currentId: id, error: null });
  setExternalMusic(true);
  try {
    await a.play();
  } catch {
    emit({ playing: false, error: audioUnlocked() ? 'Playback was blocked by the browser.' : 'Tap anywhere once to allow audio, then press play.' });
  }
}

export async function toggle(): Promise<void> {
  const a = element();
  if (!state.currentId) { await playFirst(); return; }
  if (a.paused) {
    wire();
    setExternalMusic(true);
    try { await a.play(); } catch { emit({ error: 'Playback was blocked by the browser.' }); }
  } else {
    a.pause();
  }
}

async function playFirst() {
  if (!state.tracks.length) return;
  const pick = shuffle ? state.tracks[Math.floor(Math.random() * state.tracks.length)] : state.tracks[0];
  await playTrack(pick.id);
}

export async function next(): Promise<void> {
  const list = state.tracks;
  if (!list.length) return;
  if (list.length === 1) { await playTrack(list[0].id); return; }
  const i = list.findIndex((t) => t.id === state.currentId);
  let j: number;
  if (shuffle) { do { j = Math.floor(Math.random() * list.length); } while (j === i); }
  else j = (i + 1) % list.length;
  await playTrack(list[j].id);
}

export async function prev(): Promise<void> {
  const list = state.tracks;
  if (!list.length) return;
  const a = element();
  if (a.currentTime > 3) { a.currentTime = 0; return; }   // standard "restart first" behaviour
  const i = list.findIndex((t) => t.id === state.currentId);
  const j = (i - 1 + list.length) % list.length;
  await playTrack(list[j].id);
}

export async function stop(): Promise<void> {
  const a = element();
  a.pause();
  a.removeAttribute('src');
  a.load();
  if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
  setExternalMusic(false);
  emit({ playing: false, currentId: null });
}

/** Called by the store when the music mode changes. */
export async function applyMode(mode: 'pads' | 'uploads' | 'off') {
  if (mode === 'uploads') {
    if (!state.ready) await refreshLibrary();
    if (!state.playing && state.tracks.length) await playFirst();
  } else if (state.playing || state.currentId) {
    await stop();
  }
}

export const humanSize = (b: number) =>
  b <= 0 ? '0 B'
    : b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB`
    : `${Math.max(1, Math.round(b / 1024))} KB`;


/** Jump to a point in the current track. No-op when nothing is loaded. */
export function seek(seconds: number) {
  const a = el;
  if (!a || !Number.isFinite(a.duration) || a.duration <= 0) return;
  a.currentTime = Math.max(0, Math.min(a.duration, seconds));
  emit({ position: a.currentTime });
}

/** mm:ss for a duration in seconds; em dash when it is not known yet */
export const clock = (s: number) =>
  !Number.isFinite(s) || s <= 0 ? '—:—'
    : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
