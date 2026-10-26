/**
 * Mute, which is local on purpose.
 *
 * A mute is a decision about *your* screen: it hides one player's chat and typing
 * indicator in this browser and nowhere else. It belongs next to the volume
 * slider, not in the database — nobody needs to know you muted them, and a mute
 * that needs the server is a mute that fails when the network does.
 *
 * Blocks are the opposite: they are durable, enforced, and shared with the relay
 * (see `src/lib/friends.ts`).
 */
import { useSyncExternalStore } from 'react';

const KEY = 'pikachu.muted.v1';
let ids = new Set<string>();
let loaded = false;
const subscribers = new Set<() => void>();

function emit() { for (const fn of subscribers) fn(); }

function load() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    ids = new Set(Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string').slice(0, 200) : []);
  } catch { ids = new Set(); }
}

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify([...ids])); } catch { /* storage disabled */ }
}

export function isMuted(playerId: string | null | undefined): boolean {
  load();
  return Boolean(playerId && ids.has(playerId));
}

export function mute(playerId: string) {
  load();
  ids.add(playerId);
  persist();
  emit();
}

export function unmute(playerId: string) {
  load();
  if (ids.delete(playerId)) { persist(); emit(); }
}

export function mutedIds(): string[] {
  load();
  return [...ids];
}

function subscribe(fn: () => void) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

function snapshot(): string {
  return mutedIds().join(',');
}

/** Re-renders the caller whenever the mute list changes. */
export function useMuted(): (playerId: string | null | undefined) => boolean {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  return isMuted;
}
