export type Quality = 'performance' | 'balanced' | 'high';
/** Where background music comes from: the built-in synth pads, the player's own
    uploaded files, or nothing at all. */
export type MusicMode = 'pads' | 'uploads' | 'off';
export interface Settings {
  music: number; sfx: number; muted: boolean;
  quality: Quality; motion: 'auto' | 'off';
  showHints: boolean; boardTheme: string;
  musicMode: MusicMode; shuffle: boolean;
  /** Emulator audio, separate from menu music and interface sounds. */
  gameAudio: number;
}
const KEY = 'pikachu.settings.v1';

/**
 * Music is **off by default**.
 *
 * It used to ship at 0.35 with the synth pads running, which meant the first
 * thing a visitor heard was a drone they never asked for — and the first thing
 * they had to do was find the one control that turned it off. Sound effects stay
 * on (they are feedback for your own action, and silent buttons feel broken),
 * but the bed music is opt-in.
 *
 * Kept as `music: 0` rather than `musicMode: 'off'` on purpose: the slider is
 * what a returning player will reach for, and a mode of 'off' with a non-zero
 * volume is a contradiction waiting to confuse someone. The mode still decides
 * *what* would play if they raise the slider.
 */
export const DEFAULT_SETTINGS: Settings = {
  music: 0, sfx: 0.7, muted: false, quality: 'high', motion: 'auto', showHints: true, boardTheme: 'storm',
  musicMode: 'pads', shuffle: true, gameAudio: 0.8,
};

/**
 * Stored settings, with the defaults filled in.
 *
 * `saved` is false when this device has never chosen anything, which is the only
 * case where the new "music off" default is allowed to win. A player who set
 * their music earlier keeps their number, so the change of default does not
 * silently mute someone mid-habit.
 */
export function readSettings(raw: string | null): { settings: Settings; saved: boolean } {
  if (!raw) return { settings: { ...DEFAULT_SETTINGS }, saved: false };
  try {
    const parsed = JSON.parse(raw) as Partial<Settings> | null;
    if (!parsed || typeof parsed !== 'object') return { settings: { ...DEFAULT_SETTINGS }, saved: false };
    const merged = { ...DEFAULT_SETTINGS, ...parsed };
    /* `gameAudio` arrived after the first release; a save from before it gets the
       default rather than `undefined`, which would make the mixer divide by NaN. */
    if (typeof merged.gameAudio !== 'number' || !Number.isFinite(merged.gameAudio)) {
      merged.gameAudio = DEFAULT_SETTINGS.gameAudio;
    }
    return { settings: merged, saved: true };
  } catch {
    return { settings: { ...DEFAULT_SETTINGS }, saved: false };
  }
}

export function loadSettings(): Settings {
  try {
    return readSettings(localStorage.getItem(KEY)).settings;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
export function saveSettings(s: Settings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}
export function applySettingsToDocument(s: Settings) {
  const el = document.documentElement;
  el.dataset.quality = s.quality;
  el.dataset.motion = s.motion;
  /* One attribute for the stylesheet, so "music is off" and "music is quiet"
     look the same to CSS: no equaliser, no marquee, nothing pretending to play. */
  el.dataset.music = s.muted || s.music <= 0 || s.musicMode === 'off' ? 'off' : 'on';
}
/** Cheap device probe so weak laptops default to Balanced instead of melting. */
export function suggestQuality(): Quality {
  const cores = navigator.hardwareConcurrency ?? 4;
  const mem = (navigator as any).deviceMemory ?? 8;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  // These thresholds used to be `cores <= 4 || mem <= 4`, which put most
  // ordinary laptops and nearly every phone into Performance — and Performance
  // stripped the scenery out entirely, so the games looked bare for no reason.
  // Only genuinely weak devices get the reduced tier now.
  if (cores <= 2 || mem <= 2) return 'performance';
  if (coarse || cores <= 4 || mem <= 4) return 'balanced';
  return 'high';
}
