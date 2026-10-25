import { describe, expect, it } from 'vitest';

import {
  cartridgeName,
  describeCartridge,
  validateRecord,
  type RememberedCartridge,
} from '../localCartridge';

const meta = (overrides: Partial<RememberedCartridge> = {}): RememberedCartridge => ({
  id: 'mine',
  name: 'Pokemon Red',
  kind: 'gb',
  size: 1024 * 1024,
  savedAt: 1_700_000_000_000,
  ...overrides,
});

describe('your own cartridge', () => {
  it('names a cartridge the way a label would', () => {
    expect(cartridgeName('Pokemon Red.gb')).toBe('Pokemon Red');
    expect(cartridgeName('Super_Mario_Advance.GBA')).toBe('Super Mario Advance');
    expect(cartridgeName('  contra   advance  .gba')).toBe('Contra Advance');
    // ROM-set naming gets the capitals a title would have…
    expect(cartridgeName('simple-frogger.gba')).toBe('Simple Frogger');
    expect(cartridgeName('pokemon_red.gb')).toBe('Pokemon Red');
    // …while regions, versions and digits are left exactly as they were.
    expect(cartridgeName('contra-advance-usa.gba')).toBe('Contra Advance usa');
    expect(cartridgeName('mario-v1.1.gba')).toBe('Mario v1.1');
    expect(cartridgeName('.gb')).toBe('Your cartridge');
    expect(cartridgeName('a'.repeat(120) + '.gba')).toHaveLength(60);
  });

  it('describes it in one line, with the console it belongs to', () => {
    expect(describeCartridge(meta())).toBe('Pokemon Red · 1.0 MB · Game Boy');
    expect(describeCartridge(meta({ kind: 'gba', size: 47_744, name: 'Simple Frogger' }))).toBe(
      'Simple Frogger · 47 KB · Game Boy Advance',
    );
    expect(describeCartridge(meta({ size: 900 }))).toBe('Pokemon Red · 900 B · Game Boy');
  });

  it('refuses a stored record it cannot trust', () => {
    expect(validateRecord(meta())).toMatchObject({ id: 'mine', name: 'Pokemon Red', kind: 'gb' });
    expect(validateRecord(null)).toBeNull();
    expect(validateRecord('nope')).toBeNull();
    expect(validateRecord({ ...meta(), name: '  ' })).toBeNull();
    expect(validateRecord({ ...meta(), kind: 'nes' })).toBeNull();
    expect(validateRecord({ ...meta(), size: 0 })).toBeNull();
    expect(validateRecord({ ...meta(), size: 33 * 1024 * 1024 })).toBeNull();
    expect(validateRecord({ ...meta(), savedAt: 0 })).toBeNull();
    // A record always belongs to the one slot, whatever the row says.
    expect(validateRecord({ ...meta(), id: 'someone-elses' })?.id).toBe('mine');
  });
});
