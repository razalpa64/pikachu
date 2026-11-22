import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The env file is where a typo silently disables the whole account layer.
 *
 * Reading `src/lib/supabase.ts` as text rather than importing it: the module
 * reads `import.meta.env` at load, which Vite replaces at build time and vitest
 * leaves undefined — so the only honest thing to test here is that the cleaning
 * is present and wired to every consumer, not what it returns at runtime.
 */
const source = readFileSync(resolve(process.cwd(), 'src/lib/supabase.ts'), 'utf8');

describe('the Supabase env is cleaned before use', () => {
  it('strips the trailing bracket a key pasted out of a chat message carries', () => {
    /* The exact shape that arrives from a markdown code span: sb_publishable_…] */
    const clean = (k: string) => k.trim().replace(/[\]\s]+$/, '');
    expect(clean('sb_publishable_abc-123_XYZ]')).toBe('sb_publishable_abc-123_XYZ');
    expect(clean('  sb_publishable_abc-123_XYZ  ')).toBe('sb_publishable_abc-123_XYZ');
    expect(clean('sb_publishable_abc-123_XYZ')).toBe('sb_publishable_abc-123_XYZ');
    /* A key is only ever stripped at the end — an inner hyphen must survive. */
    const real = 'sb_publishable_huTZRWuAl-H6RStUqyMi5A_yyzxWVVt';
    expect(clean(`${real}]`)).toBe(real);
  });

  it('trailing slashes on the project URL do not become a double slash', () => {
    const clean = (u: string) => u.trim().replace(/\/+$/, '');
    expect(clean('https://wtbjsthpxopzwbcnnfmu.supabase.co/')).toBe('https://wtbjsthpxopzwbcnnfmu.supabase.co');
    expect(clean('https://wtbjsthpxopzwbcnnfmu.supabase.co///')).toBe('https://wtbjsthpxopzwbcnnfmu.supabase.co');
    expect(clean('https://wtbjsthpxopzwbcnnfmu.supabase.co')).toBe('https://wtbjsthpxopzwbcnnfmu.supabase.co');
  });

  it('every consumer reads the cleaned values, not the raw ones', () => {
    /* createClient(URL!, ANON!) would have carried the bracket straight through. */
    expect(source).toContain('createClient(URL_CLEAN!, ANON!');
    expect(source).toMatch(/const URL_CLEAN = URL\?\.trim\(\)/);
    expect(source).toMatch(/const RAW_KEY = cleanKey\(/);
    /* And the raw URL must not be dereferenced anywhere it matters. */
    expect(source).not.toMatch(/new globalThis\.URL\(URL\)/);
    expect(source).not.toMatch(/Boolean\(URL && ANON/);
  });

  it('still refuses a secret key', () => {
    /* The guard that matters most must survive any edit to this file. */
    expect(source).toContain("k.startsWith('sb_secret_')");
    expect(source).toContain("body?.role === 'service_role'");
  });
});
