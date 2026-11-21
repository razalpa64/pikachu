// @vitest-environment node
/**
 * Audio defaults and the shape of a stored save.
 *
 * The complaint was "that annoying background music", and the fix has two halves
 * that can regress independently: the default must be silent, and a device that
 * already chose a volume must not be silently muted by the new default.
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS, readSettings } from '../../lib/settings';

describe('the first thing a new visitor hears', () => {
  it('is nothing', () => {
    expect(DEFAULT_SETTINGS.music).toBe(0);
  });

  it('still has interface sounds, because silent buttons feel broken', () => {
    expect(DEFAULT_SETTINGS.sfx).toBeGreaterThan(0);
    expect(DEFAULT_SETTINGS.muted).toBe(false);
  });

  it('gives game audio its own fader', () => {
    expect(DEFAULT_SETTINGS.gameAudio).toBeGreaterThan(0);
    expect(DEFAULT_SETTINGS.gameAudio).not.toBe(DEFAULT_SETTINGS.music);
  });
});

describe('reading what a device saved', () => {
  it('reports "never chosen" for a first visit, which is the only case the new default wins', () => {
    const { settings, saved } = readSettings(null);
    expect(saved).toBe(false);
    expect(settings.music).toBe(0);
  });

  it('keeps a returning player at the volume they chose', () => {
    const { settings, saved } = readSettings(JSON.stringify({ music: 0.45, sfx: 0.5 }));
    expect(saved).toBe(true);
    expect(settings.music).toBe(0.45);
  });

  it('fills in fields that did not exist when the save was written', () => {
    const { settings } = readSettings(JSON.stringify({ music: 0.2 }));
    expect(settings.gameAudio).toBe(DEFAULT_SETTINGS.gameAudio);
    expect(settings.musicMode).toBe(DEFAULT_SETTINGS.musicMode);
  });

  it('repairs a corrupt save rather than crashing the app', () => {
    expect(readSettings('{not json').settings).toEqual(DEFAULT_SETTINGS);
    expect(readSettings('null').settings).toEqual(DEFAULT_SETTINGS);
    expect(readSettings('"a string"').settings).toEqual(DEFAULT_SETTINGS);
  });

  it('repairs a gameAudio that is not a number', () => {
    const { settings } = readSettings(JSON.stringify({ gameAudio: 'loud' }));
    expect(settings.gameAudio).toBe(DEFAULT_SETTINGS.gameAudio);
  });
});
