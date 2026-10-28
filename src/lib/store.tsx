import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from 'react';
import { loadIdentity, saveIdentity, type Identity } from './identity';
import { loadSettings, saveSettings, applySettingsToDocument, suggestQuality, type Settings } from './settings';
import {
  loadProgress, saveProgress, recordMatch, toggleFavourite, noteVisit, unlockAchievement,
  mergeRemoteStats, type ProgressState, type MatchRecord, type Achievement, type GameStat,
} from './progress';
import { play, setVolumes, unlockAudio, startMusic } from './audio';
import * as jukebox from './jukebox';
import { fetchRemoteUserData, pushRemoteMatch, upsertRemoteProfile, supabaseEnabled } from './supabase';
import { flushFeedbackQueue } from './feedback';

export interface Toast { id: string; kind: 'info' | 'success' | 'error' | 'achievement'; title: string; body?: string; achievement?: Achievement }

interface Store {
  identity: Identity;
  setIdentity: (patch: Partial<Identity>) => void;
  settings: Settings;
  setSettings: (patch: Partial<Settings>) => void;
  progress: ProgressState;
  finishMatch: (rec: MatchRecord) => void;
  favourite: (gameId: string) => void;
  visit: (gameId: string, mode: string) => void;
  award: (slug: string) => void;
  toasts: Toast[];
  toast: (t: Omit<Toast, 'id'>) => void;
  dismiss: (id: string) => void;
  sfx: (cue: Parameters<typeof play>[0]) => void;
  audioReady: boolean;
  introSeen: boolean;
  setIntroSeen: (v: boolean) => void;
  cloud: boolean;
  /** pull cloud career stats in and keep the better of each field */
  syncStats: (remote: Record<string, Partial<GameStat>> | null | undefined) => void;
}

const Ctx = createContext<Store | null>(null);
const INTRO_KEY = 'pikachu.intro.v1';

export function StoreProvider({ children }: { children: ReactNode }) {
  const [identity, setIdentityState] = useState<Identity>(() => loadIdentity());
  const [settings, setSettingsState] = useState<Settings>(() => {
    const s = loadSettings();
    if (!localStorage.getItem('pikachu.settings.v1')) s.quality = suggestQuality();
    return s;
  });
  const [progress, setProgress] = useState<ProgressState>(() => loadProgress());
  /* Mirrors `progress` synchronously. Progress mutations have side effects
     (toasts, cloud writes), so they must happen OUTSIDE the state updater —
     React intentionally double-invokes updaters in StrictMode, which would
     otherwise fire every achievement toast twice. */
  const progressRef = useRef(progress);
  progressRef.current = progress;
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [audioReady, setAudioReady] = useState(false);
  const [introSeen, setIntroSeenState] = useState<boolean>(() => sessionStorage.getItem(INTRO_KEY) === '1');
  const timers = useRef<Map<string, number>>(new Map());

  useEffect(() => { applySettingsToDocument(settings); setVolumes({ music: settings.music, sfx: settings.sfx, muted: settings.muted }); }, [settings]);

  /* A note written while cloud sync was off stays in localStorage and says so. This is
     the other half of that promise: the first time the app runs with a working Supabase
     project, anything queued is delivered and the queue line on /feedback clears. */
  useEffect(() => {
    flushFeedbackQueue({ playerId: identity.playerId }).catch(() => { /* offline is normal */ });
  }, [identity.playerId]);

  /* A persisted session means the app can already be signed in on a fresh device. Pull
     the cloud career once on boot so the profile is not empty until you sign in again. */
  useEffect(() => {
    if (!supabaseEnabled()) return;
    fetchRemoteUserData()
      .then((remote) => {
        if (!remote) return;
        setProgress((p) => {
          const next = mergeRemoteStats(p, remote.stats);
          if (next !== p) { progressRef.current = next; saveProgress(next); }
          return next;
        });
      })
      .catch(() => { /* no session, or offline — both normal */ });
  }, []);

  // audio may only start after a genuine user gesture
  useEffect(() => {
    const unlock = () => {
      unlockAudio();
      setAudioReady(true);
      setVolumes({ music: settings.music, sfx: settings.sfx, muted: settings.muted });
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => { window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
  }, []);

  useEffect(() => () => { timers.current.forEach((t) => clearTimeout(t)); }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((t) => t.filter((x) => x.id !== id));
    const h = timers.current.get(id);
    if (h) { clearTimeout(h); timers.current.delete(id); }
  }, []);

  const toast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Math.random().toString(36).slice(2);
    play(t.kind === 'achievement' ? 'achievement' : 'notify');
    setToasts((prev) => {
      /* One message, one bubble. A relay that answers the same failed tap four
         times used to stack four identical cards down the screen, which reads as
         "everything is broken" rather than "that did not work". A repeat of
         something already on screen is dropped — but only within its own
         lifetime, so the same warning may honestly appear again later. */
      if (prev.some((x) => x.kind === t.kind && x.title === t.title && x.body === t.body)) return prev;
      return [...prev.slice(-3), { ...t, id }];
    });
    const handle = window.setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== id));
      timers.current.delete(id);
    }, t.kind === 'achievement' ? 6000 : 4200);
    timers.current.set(id, handle);
  }, []);

  const setIdentity = useCallback((patch: Partial<Identity>) => {
    setIdentityState((prev) => {
      const next = { ...prev, ...patch };
      saveIdentity(next);
      void upsertRemoteProfile(next);
      return next;
    });
  }, []);

  const setSettings = useCallback((patch: Partial<Settings>) => {
    setSettingsState((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  /* Keep the jukebox in step with the music preference. Shuffle is pushed
     straight through; the mode change starts or stops playback. */
  useEffect(() => { jukebox.setShuffle(settings.shuffle); }, [settings.shuffle]);
  useEffect(() => {
    if (!audioReady) return;
    void jukebox.applyMode(settings.muted ? 'off' : settings.musicMode);
  }, [settings.musicMode, settings.muted, audioReady]);

  const sfx = useCallback((cue: Parameters<typeof play>[0]) => { play(cue); }, []);

  const finishMatch = useCallback((rec: MatchRecord) => {
    const { next, unlocked, xpGained } = recordMatch(progressRef.current, rec);
    progressRef.current = next;
    setProgress(next);
    saveProgress(next);
    void pushRemoteMatch(rec, next);
    // toast() already fires the Raichu cry for achievement toasts
    for (const a of unlocked) toast({ kind: 'achievement', title: a.name, body: a.description, achievement: a });
    if (!unlocked.length && xpGained) {
      toast({ kind: 'success', title: `+${xpGained} XP`, body: rec.result === 'win' ? 'Victory recorded.' : rec.result === 'draw' ? 'Draw recorded.' : 'Match recorded.' });
    }
  }, [toast]);

  const favourite = useCallback((gameId: string) => {
    const next = toggleFavourite(progressRef.current, gameId);
    progressRef.current = next;
    setProgress(next);
    saveProgress(next);
    play('toggle');
  }, []);

  const visit = useCallback((gameId: string, mode: string) => {
    const next = noteVisit(progressRef.current, gameId, mode);
    progressRef.current = next;
    setProgress(next);
    saveProgress(next);
  }, []);

  const award = useCallback((slug: string) => {
    const { next, unlocked } = unlockAchievement(progressRef.current, slug);
    if (!unlocked.length) return;
    progressRef.current = next;
    setProgress(next);
    saveProgress(next);
    for (const a of unlocked) toast({ kind: 'achievement', title: a.name, body: a.description, achievement: a });
  }, [toast]);

  const syncStats = useCallback((remote: Record<string, Partial<GameStat>> | null | undefined) => {
    setProgress((p) => {
      const next = mergeRemoteStats(p, remote);
      if (next !== p) { progressRef.current = next; saveProgress(next); }
      return next;
    });
  }, []);

  const setIntroSeen = useCallback((v: boolean) => {
    setIntroSeenState(v);
    try { sessionStorage.setItem(INTRO_KEY, v ? '1' : '0'); } catch { /* ignore */ }
  }, []);

  const value = useMemo<Store>(() => ({
    identity, setIdentity, settings, setSettings, progress, finishMatch, favourite, visit, award,
    toasts, toast, dismiss, sfx, audioReady, introSeen, setIntroSeen, cloud: supabaseEnabled(), syncStats,
  }), [identity, setIdentity, settings, setSettings, progress, finishMatch, favourite, visit, award, toasts, toast, dismiss, sfx, audioReady, introSeen, setIntroSeen, syncStats]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useStore must be used inside <StoreProvider>');
  return ctx;
}

/**
 * Ambience helper: keeps a track playing across navigation without restarting it.
 *
 * When the player has chosen their own uploaded music, the generative pads stay
 * silent and the jukebox owns the music bus instead — the two never overlap.
 */
export function useAmbience(track: 'hub' | 'match' | null) {
  const { audioReady, settings } = useStore();
  useEffect(() => {
    if (!audioReady || settings.muted || settings.music <= 0) return;
    if (settings.musicMode === 'off') { startMusic(null); return; }
    if (settings.musicMode === 'uploads') return;   // jukebox is driving
    startMusic(track);
  }, [track, audioReady, settings.muted, settings.music, settings.musicMode]);
}
