export type Quality = 'performance' | 'balanced' | 'high';
/** Where background music comes from: the built-in synth pads, the player's own
    uploaded files, or nothing at all. */
export type MusicMode = 'pads' | 'uploads' | 'off';
export interface Settings {
  music: number; sfx: number; muted: boolean;
  quality: Quality; motion: 'auto' | 'off';
  showHints: boolean; boardTheme: string;
  musicMode: MusicMode; shuffle: boolean;
}
const KEY = 'pikachu.settings.v1';
export const DEFAULT_SETTINGS: Settings = {
  music: 0.35, sfx: 0.7, muted: false, quality: 'high', motion: 'auto', showHints: true, boardTheme: 'storm',
  musicMode: 'pads', shuffle: true,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULT_SETTINGS };
}
export function saveSettings(s: Settings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}
export function applySettingsToDocument(s: Settings) {
  const el = document.documentElement;
  el.dataset.quality = s.quality;
  el.dataset.motion = s.motion;
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
