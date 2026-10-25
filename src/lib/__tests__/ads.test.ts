// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  isValidClient, adsConfigured, adUnitFor, adConsent, setAdConsent, adsAllowed, loadAdScript,
} from '../ads';
import { extractCode, isPartialCode, CODE_RE } from '../roomCode';

/**
 * The advertising module is deliberately inert without configuration, and these
 * tests are the contract for that: nothing may render, nothing may be fetched,
 * and no consent may be implied. They also pin the publisher-id shape, because a
 * `ca-pub-` typo would otherwise ship a broken unit to production.
 */
describe('advertising stays off unless it is set up and permitted', () => {
  beforeEach(() => {
    localStorage.clear();
    document.head.innerHTML = '';
  });

  it('accepts a real publisher id and nothing else', () => {
    expect(isValidClient('ca-pub-1234567890123456')).toBe(true);
    expect(isValidClient('ca-pub-123456789012345')).toBe(false);   // 15 digits
    expect(isValidClient('ca-pub-12345678901234567')).toBe(false); // 17 digits
    expect(isValidClient('pub-1234567890123456')).toBe(false);
    expect(isValidClient('ca-pub-12345678901234ab')).toBe(false);
    expect(isValidClient('')).toBe(false);
    expect(isValidClient('ca-pub-<your-id>')).toBe(false);
  });

  it('is unconfigured in a build with no environment variables', () => {
    // the default deployment: no VITE_ADSENSE_* at all
    expect(adsConfigured()).toBe(false);
    expect(adUnitFor('home-foot')).toBeNull();
    expect(adUnitFor('library-foot')).toBeNull();
    expect(adUnitFor('feedback-foot')).toBeNull();
    expect(adsAllowed()).toBe(false);
  });

  it('starts with no decision at all, and remembers either answer', () => {
    expect(adConsent()).toBeNull();
    const seen: string[] = [];
    const onChange = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener('pikachu:consent', onChange);

    setAdConsent('denied');
    expect(adConsent()).toBe('denied');
    expect(adsAllowed()).toBe(false); // still false: nothing is configured

    setAdConsent('granted');
    expect(adConsent()).toBe('granted');
    window.removeEventListener('pikachu:consent', onChange);
    expect(seen).toEqual(['denied', 'granted']);
  });

  it('treats unreadable storage as "no decision", never as consent', () => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = () => { throw new Error('blocked'); };
    try {
      expect(adConsent()).toBeNull();
      expect(adsAllowed()).toBe(false);
    } finally {
      Storage.prototype.getItem = original;
    }
  });

  it('injects the ad script once, and settles even if the network never answers', async () => {
    vi.useFakeTimers();
    try {
      const first = loadAdScript('ca-pub-1234567890123456');
      await vi.advanceTimersByTimeAsync(9000);   // the deadline, not a load event
      await expect(first).resolves.toBeUndefined();

      const scripts = document.querySelectorAll('script[data-adsense]');
      expect(scripts).toHaveLength(1);
      expect((scripts[0] as HTMLScriptElement).src).toContain('pagead2.googlesyndication.com');
      expect((scripts[0] as HTMLScriptElement).src).toContain('client=ca-pub-1234567890123456');

      // a second slot on the same page reuses the loader rather than the network
      const second = loadAdScript('ca-pub-1234567890123456');
      await vi.advanceTimersByTimeAsync(0);
      await expect(second).resolves.toBeUndefined();
      expect(document.querySelectorAll('script[data-adsense]')).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * The join field is the only place a visitor types a code, and it lives on the
 * front page, so it has to accept the three shapes people actually paste.
 */
describe('room codes survive being copied out of a chat', () => {
  const CODE = 'QK4TA';

  beforeEach(() => { expect(CODE).toMatch(CODE_RE); });

  it('accepts a bare code', () => {
    expect(extractCode('QK4TA')).toBe(CODE);
    expect(extractCode('  qk4ta  ')).toBe(CODE);
    expect(extractCode('qk4ta')).toBe(CODE);
  });

  it('accepts a whole invite link, which is what the copy button gives you', () => {
    expect(extractCode('https://pikachu.invytra.in/room/QK4TA')).toBe(CODE);
    expect(extractCode('https://pikachu.invytra.in/room/qk4ta?join=1')).toBe(CODE);
    expect(extractCode('http://localhost:5173/room/QK4TA/')).toBe(CODE);
  });

  it('accepts a code padded with spaces, and five digits', () => {
    expect(extractCode('   QK4TA   ')).toBe(CODE);
    expect(extractCode('12345')).toBe('12345');
    expect(extractCode('QK4TA\n')).toBe(CODE);
  });

  it('refuses to guess a code out of a sentence — the server gives the real answer', () => {
    // Deliberate: pulling "QK4TA" out of prose would also pull "THERE" out of
    // "hello there", and a wrong guess is a worse experience than being asked to
    // paste the invite link (which the field accepts in full).
    expect(extractCode('join me: QK4TA!')).toBeNull();
    expect(extractCode('room number QK4TA please')).toBeNull();
  });

  it('refuses anything that is not five characters', () => {
    expect(extractCode('')).toBeNull();
    expect(extractCode('   ')).toBeNull();
    expect(extractCode('QK4T')).toBeNull();      // four
    expect(extractCode('QK4TAB')).toBeNull();    // six
    expect(extractCode('hello there')).toBeNull();
  });

  it('does not redden the field while someone is still typing', () => {
    expect(isPartialCode('')).toBe(true);
    expect(isPartialCode('QK')).toBe(true);
    expect(isPartialCode('QK4TA')).toBe(true);
    expect(isPartialCode('QK4TA!')).toBe(false);
  });
});
