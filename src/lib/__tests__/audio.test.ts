import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Audio wiring guards.
 *
 * A cry that fails to load does not throw — by design, `playCry` caches the
 * failure and falls back to the synth beep forever. That is the right runtime
 * behaviour and a terrible failure mode for a typo: the game just quietly gets
 * less voiced and nothing anywhere says so. These tests read the real source
 * and the real directory so a rename cannot slip through.
 */
const ROOT = resolve(__dirname, '../../..');
const SRC = readFileSync(resolve(ROOT, 'src/lib/audio.ts'), 'utf8');
const AUDIO_DIR = resolve(ROOT, 'public/audio');

/** Every '/audio/...' path mentioned in audio.ts. */
const referenced = [...new Set([...SRC.matchAll(/'(\/audio\/[A-Za-z0-9._-]+)'/g)].map((m) => m[1]))];

describe('audio assets', () => {
  it('references at least twenty distinct voice files', () => {
    expect(referenced.length).toBeGreaterThanOrEqual(20);
  });

  it('every referenced file exists and is a real audio file', () => {
    for (const r of referenced) {
      const p = resolve(ROOT, 'public' + r);
      expect(existsSync(p), `${r} is referenced by audio.ts but missing from public/audio`).toBe(true);
      const buf = readFileSync(p);
      expect(buf.length, `${r} is suspiciously small`).toBeGreaterThan(1500);
      const head = buf.subarray(0, 4).toString('binary');
      const isOgg = head === 'OggS';
      const isMp3 = head.startsWith('ID3') || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0);
      expect(isOgg || isMp3, `${r} is neither Ogg nor MP3`).toBe(true);
    }
  });

  it('ships no unused audio file', () => {
    const onDisk = readdirSync(AUDIO_DIR).filter((f) => /\.(ogg|mp3)$/.test(f));
    const unused = onDisk.filter((f) => !referenced.includes('/audio/' + f));
    expect(unused, `unused audio shipped to the client: ${unused.join(', ')}`).toEqual([]);
  });

  it('voices the cues that carry a game, not just the menus', () => {
    // these are the moment-to-moment cues; if they lose their cry the games go quiet
    for (const cue of ['move', 'place', 'drop', 'flip', 'jump', 'hit', 'miss', 'capture', 'pickup', 'win', 'lose']) {
      const re = new RegExp(`^\\s*${cue}:\\s*\\{[^}]*src:`, 'm');
      expect(re.test(SRC), `cue "${cue}" has no voice — it would be a synth beep only`).toBe(true);
    }
  });

  it('keeps the high-frequency UI cues synth-only', () => {
    // a character voice on every hover/click is unbearable inside a minute
    for (const cue of ['hover', 'click', 'select', 'toggle', 'swipe']) {
      const re = new RegExp(`^\\s*${cue}:\\s*\\{[^}]*src:`, 'm');
      expect(re.test(SRC), `cue "${cue}" should NOT have a voice`).toBe(false);
    }
  });

  it('every sliced cry stays inside a plausible file length', () => {
    // offset+dur must be small; the real bound is checked against decoded audio
    // in scripts/e2e/audio.mjs, this just catches a nonsense literal
    for (const m of SRC.matchAll(/offset:\s*([\d.]+)[^}]*?dur:\s*([\d.]+)/g)) {
      expect(Number(m[1]) + Number(m[2])).toBeLessThan(3);
    }
  });
});
