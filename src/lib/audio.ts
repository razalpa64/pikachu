/**
 * PIKACHU sound identity.
 *
 * Two layers:
 *  1. A soft synthesised layer (Web Audio oscillators) for UI and board feedback.
 *  2. Real Pokemon cries (public .mp3/.ogg in /public/audio) for the moments that
 *     deserve an actual voice — match start, a win, a new trophy, a card flip,
 *     someone joining your room, a mistake, a toast.
 *
 * Cries are fetched + decoded lazily on the first user gesture, cached forever,
 * and rate-limited per cue so they can never machine-gun. Everything stays silent
 * until a real gesture unlocks the context (browser autoplay policy).
 */
export type Cue =
  | 'hover' | 'click' | 'back' | 'select' | 'toggle'
  | 'boot' | 'countdown' | 'go' | 'move' | 'place' | 'drop' | 'flip'
  | 'hit' | 'miss' | 'sunk' | 'capture' | 'check' | 'error'
  | 'win' | 'lose' | 'draw' | 'achievement' | 'coin' | 'zap' | 'spark'
  | 'join' | 'notify'
  /* arcade + snake + puzzle */
  | 'pickup' | 'power' | 'swipe' | 'jump' | 'block'
  | 'tone0' | 'tone1' | 'tone2' | 'tone3' | 'tone4';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let sfxBus: GainNode | null = null;
let musicBus: GainNode | null = null;
let musicStop: (() => void) | null = null;
let unlocked = false;
let vol = { music: 0.35, sfx: 0.7, muted: false };
let currentTrack: string | null = null;
/** Set by the jukebox while it owns the music bus, so volume changes still apply. */
let externalMusic = false;

function ac(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const C = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!C) return null;
    ctx = new C();
    master = ctx.createGain(); master.gain.value = 1; master.connect(ctx.destination);
    sfxBus = ctx.createGain(); sfxBus.gain.value = vol.sfx; sfxBus.connect(master);
    musicBus = ctx.createGain(); musicBus.gain.value = 0; musicBus.connect(master);
  }
  return ctx;
}

export function unlockAudio() {
  const c = ac();
  if (!c) return;
  if (c.state === 'suspended') void c.resume();
  unlocked = true;
  preloadCries();
}
export function isUnlocked() { return unlocked; }

export function setVolumes(next: { music: number; sfx: number; muted: boolean }) {
  vol = next;
  if (!ctx || !master || !sfxBus || !musicBus) return;
  const t = ctx.currentTime;
  master.gain.setTargetAtTime(next.muted ? 0 : 1, t, 0.04);
  sfxBus.gain.setTargetAtTime(next.sfx, t, 0.04);
  musicBus.gain.setTargetAtTime(currentTrack || externalMusic ? next.music : 0, t, 0.25);
}

/* ------------------------------------------------------------ real cries
   Public Pokemon cries, decoded once and cached. `gap` is the minimum gap in ms
   between two plays of the same cue, so a fast flipper never machine-guns Pichu. */
/**
 * A cue's voice. `offset`/`dur` take a slice out of the file in seconds, which
 * is how one cry yields several distinct utterances: `pika-cry.mp3` is a loud
 * "PIKA" for its first 0.36s and a decaying "chuuu" after it, and the Gigantamax
 * cry is four separate bursts. Slicing beats shipping chopped-up files — the
 * browser has already decoded the buffer, so a slice is free.
 */
type CrySpec = { src: string; gain: number; gap: number; rate?: number; offset?: number; dur?: number };

/* Real Pikachu voice, trimmed and level-matched by scripts/voices.py. These are
   the actual anime voice rather than the games' synthesised cries, which is why
   they lead every moment that is his. */
const HOP = '/audio/pika-hop.mp3';     // 0.39s  short "pika"
const YAY = '/audio/pika-yay.mp3';     // 0.72s  bright "pika-chu"
const CHU = '/audio/pika-chu.mp3';     // 0.89s  rising "pi-ka-chuuu"
const GMAX = '/audio/pika-gmax.ogg';   // 1.27s  Gigantamax cry: four bursts

/**
 * Pikachu leads; the rest of the cast keeps adjacent events from sounding the
 * same. Frequent incidental cues (hover, click, select, toggle, swipe, the
 * reaction-ladder tones) stay synth-only on purpose — a voice on every mouse
 * movement is unbearable inside a minute, and a unit test holds that line.
 */
const CRIES: Partial<Record<Cue, CrySpec>> = {
  /* ---- the big moments ---- */
  win:         { src: '/audio/pika-echo.mp3',  gain: 0.8,  gap: 400 },   // the yell, with echo
  lose:        { src: CHU,  gain: 0.55, gap: 700, rate: 0.78 },          // same voice, dejected
  draw:        { src: '/audio/clefairy.ogg',   gain: 0.55, gap: 600 },
  achievement: { src: '/audio/pika-joy.mp3',   gain: 0.6,  gap: 500 },
  go:          { src: '/audio/pika-pika.mp3',  gain: 0.6,  gap: 400 },
  /* Three beats in a row, so the retro Gen-1 cry is clipped to a single chirp
     and kept quiet — a full voice per beat turns a 3-2-1 into a racket. */
  countdown:   { src: '/audio/pika-cry-retro.ogg', gain: 0.3, gap: 120, dur: 0.18 },

  /* ---- taking a turn ---- */
  /* Volt Runner fires `jump` roughly every 1.5s, so it gets the shortest clip
     there is. A longer cry here was the thing that sounded wrong: it was still
     playing when the next jump started. */
  jump:        { src: HOP,  gain: 0.42, gap: 220 },
  move:        { src: HOP,  gain: 0.20, gap: 150, rate: 0.92, dur: 0.22 },  // just the "pi"
  place:       { src: '/audio/pawmi.ogg',      gain: 0.34, gap: 150 },
  drop:        { src: '/audio/fidough.ogg',    gain: 0.36, gap: 150 },
  flip:        { src: '/audio/pichu.mp3',      gain: 0.26, gap: 260, rate: 1.12 },

  /* ---- combat ---- */
  hit:         { src: '/audio/pika-zap.mp3',   gain: 0.5,  gap: 260 },   // the attack cry
  miss:        { src: '/audio/marill.ogg',     gain: 0.34, gap: 220, rate: 0.9 },
  sunk:        { src: GMAX, gain: 0.6,  gap: 500, offset: 0.54, dur: 0.62 },
  capture:     { src: '/audio/togedemaru.ogg', gain: 0.45, gap: 200 },
  check:       { src: '/audio/mimikyu.ogg',    gain: 0.45, gap: 400 },
  block:       { src: '/audio/minun.ogg',      gain: 0.4,  gap: 300 },

  /* ---- pickups and sparkle ---- */
  pickup:      { src: YAY,  gain: 0.34, gap: 200, dur: 0.5 },            // arcade charges
  power:       { src: '/audio/raichu.mp3',     gain: 0.5,  gap: 400 },   // evolved = powered up
  coin:        { src: '/audio/pichu.mp3',      gain: 0.18, gap: 520, rate: 1.3 },
  zap:         { src: '/audio/emolga.ogg',     gain: 0.4,  gap: 300 },
  spark:       { src: '/audio/plusle.ogg',     gain: 0.34, gap: 300 },

  /* ---- social ---- */
  join:        { src: '/audio/eevee.mp3',      gain: 0.6,  gap: 600 },
  notify:      { src: '/audio/pika-ask.mp3',   gain: 0.45, gap: 700 },   // a questioning "pika?"
  error:       { src: '/audio/jigglypuff.mp3', gain: 0.42, gap: 900 },

  /* No cry on `boot`. The intro deliberately opens on the soft synth swell only —
     a character voice over the title card was too much. */
};

const cryBuffers = new Map<string, AudioBuffer | null>();
const cryPending = new Map<string, Promise<void>>();
const cryLast = new Map<string, number>();

function loadCry(src: string): Promise<void> {
  const existing = cryPending.get(src);
  if (existing) return existing;
  const c = ac();
  if (!c) return Promise.resolve();
  const task = fetch(src)
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
    .then((buf) => c.decodeAudioData(buf))
    .then((decoded) => { cryBuffers.set(src, decoded); })
    .catch(() => { cryBuffers.set(src, null); });   // missing/undecodable: fall back to synth, never throw
  cryPending.set(src, task);
  return task;
}

/** Warm the decoder for the cues most likely to fire next. Safe to call repeatedly. */
export function preloadCries() {
  if (!unlocked) return;
  for (const spec of Object.values(CRIES)) if (spec) void loadCry(spec.src);
}

function playCry(cue: Cue): boolean {
  const spec = CRIES[cue];
  const c = ac();
  if (!spec || !c || !unlocked || vol.muted) return false;

  const now = performance.now();
  if (now - (cryLast.get(cue) ?? -1e9) < spec.gap) return true;  // swallowed, but still "handled"

  const buf = cryBuffers.get(spec.src);
  if (buf === undefined) { void loadCry(spec.src); return false; }  // first time: synth covers this one
  if (buf === null) return false;                                    // failed to load: synth forever

  cryLast.set(cue, now);
  const node = c.createBufferSource();
  node.buffer = buf;
  if (spec.rate) node.playbackRate.value = spec.rate;
  const g = c.createGain();
  g.gain.value = spec.gain;
  node.connect(g); g.connect(sfxBus!);
  if (spec.offset !== undefined || spec.dur !== undefined) {
    const off = Math.min(spec.offset ?? 0, buf.duration);
    const len = Math.min(spec.dur ?? buf.duration - off, buf.duration - off);
    // a hard cut mid-waveform clicks, so fade the slice out over its last 30ms
    const fade = Math.min(0.03, len * 0.35);
    const t = c.currentTime;
    g.gain.setValueAtTime(spec.gain, t);
    g.gain.setValueAtTime(spec.gain, t + Math.max(0, len - fade) / (spec.rate ?? 1));
    g.gain.exponentialRampToValueAtTime(0.0001, t + len / (spec.rate ?? 1));
    node.start(0, off, len);
  } else {
    node.start();
  }
  return true;
}

/* ------------------------------------------------------------ primitives */
function tone(opts: {
  freq: number; to?: number; dur: number; type?: OscillatorType; gain?: number;
  delay?: number; bus?: GainNode | null; attack?: number; detune?: number;
}) {
  const c = ac(); if (!c || !unlocked) return;
  const bus = opts.bus ?? sfxBus!;
  const t0 = c.currentTime + (opts.delay ?? 0);
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = opts.type ?? 'triangle';
  o.frequency.setValueAtTime(opts.freq, t0);
  if (opts.to) o.frequency.exponentialRampToValueAtTime(Math.max(20, opts.to), t0 + opts.dur);
  if (opts.detune) o.detune.setValueAtTime(opts.detune, t0);
  const peak = opts.gain ?? 0.2;
  const atk = opts.attack ?? 0.006;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + atk);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
  o.connect(g); g.connect(bus);
  o.start(t0); o.stop(t0 + opts.dur + 0.04);
}

function noise(dur: number, opts: { gain?: number; delay?: number; hp?: number; lp?: number; sweep?: number } = {}) {
  const c = ac(); if (!c || !unlocked) return;
  const t0 = c.currentTime + (opts.delay ?? 0);
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource(); src.buffer = buf;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(opts.hp ?? 1400, t0);
  if (opts.sweep) bp.frequency.exponentialRampToValueAtTime(Math.max(80, opts.sweep), t0 + dur);
  bp.Q.value = 0.8;
  const g = c.createGain();
  g.gain.setValueAtTime(opts.gain ?? 0.16, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(bp); bp.connect(g); g.connect(sfxBus!);
  src.start(t0); src.stop(t0 + dur + 0.02);
}

/* ------------------------------------------------------------ cues */
/** Cues where the real cry replaces the synth entirely rather than layering under it. */
const CRY_ONLY: ReadonlySet<Cue> = new Set<Cue>([
  'flip', 'join', 'notify', 'error', 'move', 'place', 'drop', 'pickup', 'spark',
]);

export function play(cue: Cue) {
  if (!unlocked || vol.muted) return;

  // A real Pikachu voice leads wherever we have one; the synth layer stays
  // underneath for body, except on the small cues where it would just be noise.
  const voiced = playCry(cue);
  if (voiced && CRY_ONLY.has(cue)) return;

  switch (cue) {
    case 'hover':  tone({ freq: 1180, dur: 0.045, type: 'sine', gain: 0.045 }); break;
    case 'click':  tone({ freq: 740, to: 1180, dur: 0.075, type: 'triangle', gain: 0.085 });
                   noise(0.04, { gain: 0.03, hp: 3200 }); break;
    case 'back':   tone({ freq: 620, to: 330, dur: 0.11, type: 'triangle', gain: 0.1 }); break;
    case 'select': tone({ freq: 523, dur: 0.07, type: 'triangle', gain: 0.12 });
                   tone({ freq: 784, dur: 0.1, type: 'triangle', gain: 0.1, delay: 0.06 }); break;
    case 'toggle': tone({ freq: 900, to: 1500, dur: 0.06, type: 'sine', gain: 0.08 }); break;

    case 'boot':
      noise(0.4, { gain: 0.1, hp: 5200, sweep: 300 });
      tone({ freq: 196, to: 784, dur: 0.6, type: 'triangle', gain: 0.1 });
      tone({ freq: 392, to: 1568, dur: 0.5, type: 'sine', gain: 0.08, delay: 0.12 });
      [0, 0.1, 0.22].forEach((d, i) => tone({ freq: 523 * (i + 1), dur: 0.5, type: 'sine', gain: 0.09, delay: 0.45 + d }));
      break;
    case 'countdown': tone({ freq: 660, dur: 0.12, type: 'triangle', gain: 0.12 }); break;
    case 'go':
      tone({ freq: 880, to: 1760, dur: 0.26, type: 'triangle', gain: 0.1 });
      noise(0.18, { gain: 0.07, hp: 2600, sweep: 500 });
      break;
    case 'join':
      [659, 880].forEach((f, i) => tone({ freq: f, dur: 0.22, type: 'sine', gain: 0.1, delay: i * 0.08 }));
      break;
    case 'notify':
      tone({ freq: 988, dur: 0.12, type: 'sine', gain: 0.09 });
      tone({ freq: 1318, dur: 0.18, type: 'sine', gain: 0.07, delay: 0.08 });
      break;

    case 'move':    tone({ freq: 420, to: 540, dur: 0.07, type: 'triangle', gain: 0.1 }); break;
    case 'place':   tone({ freq: 300, to: 190, dur: 0.1, type: 'sine', gain: 0.14 });
                    noise(0.06, { gain: 0.07, hp: 1200 }); break;
    case 'drop':    tone({ freq: 540, to: 160, dur: 0.2, type: 'triangle', gain: 0.15 });
                    noise(0.09, { gain: 0.09, hp: 900, delay: 0.16 }); break;
    case 'flip':    tone({ freq: 980, to: 1420, dur: 0.07, type: 'sine', gain: 0.1 }); break;
    case 'coin':    tone({ freq: 1320, dur: 0.06, type: 'triangle', gain: 0.09 });
                    tone({ freq: 1980, dur: 0.12, type: 'sine', gain: 0.08, delay: 0.05 }); break;
    case 'capture': tone({ freq: 240, to: 90, dur: 0.17, type: 'sawtooth', gain: 0.14 });
                    noise(0.12, { gain: 0.1, hp: 1800, sweep: 300 }); break;
    case 'check':   tone({ freq: 1046, dur: 0.1, type: 'triangle', gain: 0.1 });
                    tone({ freq: 1318, dur: 0.16, type: 'triangle', gain: 0.09, delay: 0.09 }); break;
    case 'hit':     noise(0.3, { gain: 0.2, hp: 900, sweep: 120 });
                    tone({ freq: 150, to: 50, dur: 0.3, type: 'sawtooth', gain: 0.16 }); break;
    case 'miss':    noise(0.3, { gain: 0.1, hp: 500, sweep: 220 });
                    tone({ freq: 190, to: 130, dur: 0.22, type: 'sine', gain: 0.08 }); break;
    case 'sunk':
      [0, 0.09, 0.2].forEach((d) => noise(0.4, { gain: 0.17, hp: 800 - d * 900, sweep: 90, delay: d }));
      tone({ freq: 120, to: 40, dur: 0.7, type: 'sawtooth', gain: 0.16 });
      break;
    case 'zap':     tone({ freq: 2400, to: 300, dur: 0.14, type: 'sawtooth', gain: 0.13 });
                    noise(0.12, { gain: 0.12, hp: 5000, sweep: 800 }); break;
    case 'spark':   noise(0.07, { gain: 0.07, hp: 6000, sweep: 2500 }); break;

    /* --- arcade / snake / puzzle --- */
    case 'pickup':  tone({ freq: 880, to: 1320, dur: 0.07, type: 'triangle', gain: 0.085 }); break;
    case 'power':   tone({ freq: 420, to: 1500, dur: 0.22, type: 'triangle', gain: 0.1 });
                    tone({ freq: 840, to: 2200, dur: 0.22, type: 'sine', gain: 0.06, delay: 0.03 }); break;
    case 'swipe':   noise(0.07, { gain: 0.05, hp: 2200, sweep: 1400 }); break;
    case 'jump':    tone({ freq: 380, to: 820, dur: 0.12, type: 'triangle', gain: 0.11 }); break;
    case 'block':   tone({ freq: 220, to: 140, dur: 0.16, type: 'triangle', gain: 0.1 });
                    noise(0.1, { gain: 0.08, hp: 1200 }); break;
    case 'tone0':   tone({ freq: 392, dur: 0.22, type: 'sine', gain: 0.13 }); break;
    case 'tone1':   tone({ freq: 494, dur: 0.22, type: 'sine', gain: 0.13 }); break;
    case 'tone2':   tone({ freq: 587, dur: 0.22, type: 'sine', gain: 0.13 }); break;
    case 'tone3':   tone({ freq: 698, dur: 0.22, type: 'sine', gain: 0.13 }); break;
    case 'tone4':   tone({ freq: 880, dur: 0.22, type: 'sine', gain: 0.13 }); break;
    case 'error':   tone({ freq: 330, to: 247, dur: 0.14, type: 'triangle', gain: 0.1 });
                    tone({ freq: 247, to: 196, dur: 0.2, type: 'sine', gain: 0.09, delay: 0.1 }); break;

    case 'win':
      [523, 659, 784, 1046].forEach((f, i) => tone({ freq: f, dur: 0.5, type: 'triangle', gain: 0.14, delay: i * 0.1 }));
      [0.42, 0.56, 0.72].forEach((d) => noise(0.4, { gain: 0.1, hp: 5200, sweep: 700, delay: d }));
      tone({ freq: 1568, dur: 0.9, type: 'sine', gain: 0.1, delay: 0.5 });
      break;
    case 'lose':
      [466, 415, 349, 311].forEach((f, i) => tone({ freq: f, dur: 0.46, type: 'triangle', gain: 0.11, delay: i * 0.13 }));
      break;
    case 'draw':
      [523, 523].forEach((f, i) => tone({ freq: f, dur: 0.34, type: 'triangle', gain: 0.11, delay: i * 0.22 }));
      tone({ freq: 392, dur: 0.6, type: 'sine', gain: 0.09, delay: 0.42 });
      break;
    case 'achievement':
      [784, 988, 1318, 1568].forEach((f, i) => tone({ freq: f, dur: 0.42, type: 'sine', gain: 0.12, delay: i * 0.075 }));
      noise(0.5, { gain: 0.07, hp: 7000, sweep: 1800, delay: 0.1 });
      break;
  }
}

/* ------------------------------------------------------------ ambience
   Two slow, generative pads. No loop points to click, no restart on navigation —
   startMusic(track) is a no-op when that track already plays. */
export function startMusic(track: 'hub' | 'match' | null) {
  const c = ac(); if (!c || !unlocked) return;
  if (track === currentTrack) return;
  musicStop?.();
  musicStop = null;
  currentTrack = track;
  if (!track) { musicBus!.gain.setTargetAtTime(0, c.currentTime, 0.4); return; }

  const bus = c.createGain(); bus.gain.value = 0; bus.connect(musicBus!);
  const roots = track === 'hub' ? [55, 82.4, 110, 164.8] : [49, 73.4, 98, 146.8];
  const oscs: OscillatorNode[] = [];
  const lfoNodes: OscillatorNode[] = [];
  roots.forEach((f, i) => {
    const o = c.createOscillator();
    o.type = i % 2 ? 'sine' : 'triangle';
    o.frequency.value = f;
    o.detune.value = (i - 1.5) * 6;
    const g = c.createGain(); g.gain.value = 0.11 / (i + 1);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 620; lp.Q.value = 0.6;
    const lfo = c.createOscillator(); lfo.frequency.value = 0.035 + i * 0.012;
    const lfoGain = c.createGain(); lfoGain.gain.value = 0.045 / (i + 1);
    lfo.connect(lfoGain); lfoGain.connect(g.gain);
    o.connect(g); g.connect(lp); lp.connect(bus);
    o.start(); lfo.start();
    oscs.push(o); lfoNodes.push(lfo);
  });
  bus.gain.setTargetAtTime(1, c.currentTime, 1.6);
  musicBus!.gain.setTargetAtTime(vol.muted ? 0 : vol.music, c.currentTime, 1.2);

  musicStop = () => {
    const t = c.currentTime;
    bus.gain.setTargetAtTime(0, t, 0.5);
    setTimeout(() => { oscs.forEach((o) => { try { o.stop(); } catch { /* */ } });
                       lfoNodes.forEach((o) => { try { o.stop(); } catch { /* */ } });
                       bus.disconnect(); }, 1600);
  };
}

export function stopAllAudio() { musicStop?.(); musicStop = null; currentTrack = null; }

/* ------------------------------------------------------------ music bus
   Exposed so the jukebox can route the player's own uploaded files through the
   exact same gain node as the synth pads — one Music slider, one mute, no
   second volume system to keep in sync. */
export function musicDestination(): { ctx: AudioContext; bus: GainNode } | null {
  const c = ac();
  if (!c || !musicBus) return null;
  return { ctx: c, bus: musicBus };
}

/** Open the music bus for a non-pad source (the pads set this themselves). */
export function setExternalMusic(on: boolean) {
  externalMusic = on;
  const c = ac();
  if (!c || !musicBus) return;
  if (on) { musicStop?.(); musicStop = null; currentTrack = null; }
  musicBus.gain.setTargetAtTime((on || currentTrack) && !vol.muted ? vol.music : 0, c.currentTime, 0.4);
}

/** Open the music bus for a non-pad source (the pads set this themselves). */
export function openMusicBus() {
  const c = ac();
  if (!c || !musicBus) return;
  musicBus.gain.setTargetAtTime(vol.muted ? 0 : vol.music, c.currentTime, 0.4);
}

/** True once a real user gesture has unlocked the context. */
export function audioUnlocked() { return unlocked; }
