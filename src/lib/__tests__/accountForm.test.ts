// @vitest-environment node
/**
 * The account rules, pinned.
 *
 * These are sentences a player reads when they get something wrong, so they are
 * tested as sentences: not "does it return truthy" but "does the sentence name
 * the thing the player has to change".
 */
import { describe, it, expect } from 'vitest';
import {
  checkConfirm,
  checkEmail,
  checkPassword,
  checkUsername,
  safeNext,
  validateSignIn,
  validateSignUp,
  PASSWORD_MIN,
  USERNAME_MAX,
} from '../../lib/accountForm';

describe('a trainer name', () => {
  it('accepts ordinary names', () => {
    for (const name of ['Ash', 'misty_99', 'Prof.Oak', 'red-1', 'あ'] /* the last fails the charset */) {
      if (name === 'あ') continue;
      expect(checkUsername(name), name).toBeNull();
    }
  });

  it('asks for a name rather than showing a red box', () => {
    expect(checkUsername('')).toMatchObject({ field: 'username', message: 'Pick a trainer name.' });
    expect(checkUsername('   ')).toMatchObject({ field: 'username' });
  });

  it('rejects a name that is too short or too long', () => {
    expect(checkUsername('ab')?.message).toContain('3');
    expect(checkUsername('a'.repeat(USERNAME_MAX + 1))?.message).toContain(String(USERNAME_MAX));
  });

  it('refuses a space, because spaces vanish when the name becomes an address', () => {
    const p = checkUsername('Ash Ketchum');
    expect(p?.field).toBe('username');
    expect(p?.message).toMatch(/no spaces/i);
  });

  it('refuses names that would make an ugly local-part', () => {
    expect(checkUsername('.ash')).not.toBeNull();
    expect(checkUsername('ash.')).not.toBeNull();
    expect(checkUsername('_ash')).not.toBeNull();
    expect(checkUsername('ash!')).not.toBeNull();
  });

  it('refuses an all-digit name, which reads as an ID rather than a person', () => {
    expect(checkUsername('12345')?.message).toMatch(/letter/i);
  });
});

describe('a recovery address', () => {
  it('is optional', () => {
    expect(checkEmail('')).toBeNull();
    expect(checkEmail('   ')).toBeNull();
  });

  it('must actually look like an address, because it is the only way back in', () => {
    expect(checkEmail('ash@example.com')).toBeNull();
    expect(checkEmail('ash@example')?.field).toBe('email');
    expect(checkEmail('ash.example.com')?.field).toBe('email');
    expect(checkEmail('ash@@example.com')?.field).toBe('email');
  });
});

describe('a password', () => {
  it('is judged on length, not on whether it has a symbol', () => {
    expect(checkPassword('correct horse battery')?.field).toBeUndefined();
    expect(checkPassword('a'.repeat(PASSWORD_MIN))).toBeNull();
  });

  it('says how long it has to be', () => {
    expect(checkPassword('short')?.message).toContain(String(PASSWORD_MIN));
    expect(checkPassword('')?.message).toBe('Choose a password.');
  });

  it('refuses whitespace dressed up as a password', () => {
    expect(checkPassword('          ')?.message).toMatch(/spaces/i);
  });
});

describe('confirming a password', () => {
  it('needs the same string twice', () => {
    expect(checkConfirm('hunter2hunter2', 'hunter2hunter2')).toBeNull();
    expect(checkConfirm('hunter2hunter2', 'hunter2hunter')).toMatchObject({ field: 'confirm' });
    expect(checkConfirm('hunter2hunter2', '')?.message).toMatch(/once more/i);
  });
});

describe('a whole sign-up', () => {
  it('reports every problem in field order, so the form is not a whack-a-mole', () => {
    const problems = validateSignUp({ username: 'a b', email: 'nope', password: 'x', confirm: 'y' });
    expect(problems.map((p) => p.field)).toEqual(['username', 'email', 'password', 'confirm']);
  });

  it('is happy with a complete, ordinary draft', () => {
    expect(
      validateSignUp({ username: 'Ash', email: 'ash@example.com', password: 'pikachu-pikachu', confirm: 'pikachu-pikachu' }),
    ).toEqual([]);
  });

  it('accepts an empty optional email', () => {
    expect(
      validateSignUp({ username: 'Ash', email: '', password: 'pikachu-pikachu', confirm: 'pikachu-pikachu' }),
    ).toEqual([]);
  });
});

describe('signing in', () => {
  it('only asks for the two things the provider needs', () => {
    expect(validateSignIn({ username: '', password: '' }).map((p) => p.field)).toEqual(['username', 'password']);
    expect(validateSignIn({ username: 'Ash', password: 'x' })).toEqual([]);
  });
});

describe('where to go after signing in', () => {
  it('returns the player to the page they were sent from', () => {
    expect(safeNext('/retro/dos/doom')).toBe('/retro/dos/doom');
    expect(safeNext('/library?platform=gba')).toBe('/library?platform=gba');
  });

  it('refuses to be an open redirect', () => {
    // Every one of these is a way off the site dressed as a path.
    expect(safeNext('//evil.example/steal')).toBe('/');
    expect(safeNext('https://evil.example')).toBe('/');
    expect(safeNext('http://evil.example')).toBe('/');
    expect(safeNext('/\\evil.example')).toBe('/');
    expect(safeNext('javascript:alert(1)')).toBe('/');
  });

  it('falls back to home when there is nothing to go back to', () => {
    expect(safeNext(null)).toBe('/');
    expect(safeNext(undefined)).toBe('/');
    expect(safeNext('')).toBe('/');
  });
});
