import { describe, expect, it } from 'vitest';

import { addressFor, isEmailLike, usernameToEmail } from '../authAddress';
import { canSendLink, describeAccount, findAccount, generatePassword, nearMisses, type AccountRow } from '../adminAccounts';

/**
 * "Invalid login credentials" has three causes and only the project's own user
 * list can separate them. These are the rules that read that list, so they are
 * worth pinning: a wrong "closest match" sends somebody hunting for an account
 * that was never theirs.
 */

const account = (email: string, overrides: Partial<AccountRow> = {}): AccountRow => ({
  id: `id-${email}`,
  email,
  confirmed: true,
  ...overrides,
});

const PROJECT = [
  account('razalpa64@gmail.com', { admin: true }),
  account('razal@pikachu.arcade'),
  account('coach@example.com', { confirmed: false }),
  account('someone.else@example.com'),
];

describe('addresses', () => {
  it('mints the username domain the app actually uses', () => {
    expect(usernameToEmail('Razal')).toBe('razal@pikachu.arcade');
    expect(usernameToEmail('  ')).toBe('trainer@pikachu.arcade');
    expect(addressFor('razalpa64@gmail.com')).toBe('razalpa64@gmail.com');
    expect(addressFor('Razal')).toBe('razal@pikachu.arcade');
    expect(addressFor('   ')).toBeNull();
  });

  it('knows what can receive a link', () => {
    expect(isEmailLike('a@b.co')).toBe(true);
    expect(isEmailLike('razal')).toBe(false);
    expect(canSendLink('razal')).toBe(false);
    expect(canSendLink(' razalpa64@gmail.com ')).toBe(true);
  });
});

describe('findAccount', () => {
  it('matches an address exactly, case-insensitively', () => {
    expect(findAccount(PROJECT, ' RAZALPA64@gmail.com ')?.id).toBe('id-razalpa64@gmail.com');
  });

  it('resolves a bare username through the synthetic domain', () => {
    expect(findAccount(PROJECT, 'razal')?.id).toBe('id-razal@pikachu.arcade');
  });

  it('does not treat a lookalike as the account', () => {
    expect(findAccount(PROJECT, 'razalpa64@googlemail.com')).toBeNull();
    expect(findAccount(PROJECT, 'razalpa6')).toBeNull();
  });

  it('has nothing to find in an empty answer', () => {
    expect(findAccount([], 'a@b.co')).toBeNull();
    expect(findAccount(PROJECT, '')).toBeNull();
  });
});

describe('nearMisses', () => {
  it('offers the Gmail account when a username-domain address was typed', () => {
    const near = nearMisses(PROJECT, 'razal');
    expect(near.map((u) => u.email)).toContain('razalpa64@gmail.com');
  });

  it('offers the username-domain account when a Gmail address was typed', () => {
    const near = nearMisses(PROJECT, 'razalpa64@gmail.com');
    expect(near.map((u) => u.email)).toContain('razal@pikachu.arcade');
  });

  it('never proposes the exact address, nor an unrelated one', () => {
    const near = nearMisses(PROJECT, 'razalpa64@gmail.com').map((u) => u.email);
    expect(near).not.toContain('razalpa64@gmail.com');
    expect(near).not.toContain('someone.else@example.com');
  });

  it('is empty for a name nothing resembles', () => {
    expect(nearMisses(PROJECT, 'zzzzzz@example.com')).toEqual([]);
  });

  it('respects the limit', () => {
    const many = Array.from({ length: 9 }, (_, i) => account(`razalpa64x${i}@example.com`));
    expect(nearMisses(many, 'razalpa64@gmail.com', 3)).toHaveLength(3);
  });
});

describe('generatePassword', () => {
  it('is long, mixed and never contains an ambiguous glyph', () => {
    for (let i = 0; i < 20; i += 1) {
      const pw = generatePassword(20);
      expect(pw).toHaveLength(20);
      expect(pw).toMatch(/[A-Z]/);
      expect(pw).toMatch(/[a-z]/);
      expect(pw).toMatch(/[0-9]/);
      expect(pw).toMatch(/[!@#$%^&*\-_=+]/);
      expect(pw).not.toMatch(/[lI1O0]/);
    }
  });

  it('does not repeat itself', () => {
    const seen = new Set(Array.from({ length: 50 }, () => generatePassword()));
    expect(seen.size).toBe(50);
  });
});

describe('describeAccount', () => {
  it('says the two things that matter, and the roster when known', () => {
    expect(describeAccount(account('a@b.co', { confirmed: false }))).toContain('EMAIL NOT CONFIRMED');
    const line = describeAccount(account('a@b.co', { admin: true }));
    expect(line).toContain('confirmed');
    expect(line).toContain('on the roster');
    expect(line).toContain('id id-a@b.co');
  });
});
