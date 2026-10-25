/**
 * Editable copy, with the shipped words as the fallback.
 *
 * The defaults live in the components (so the site reads correctly with no
 * backend at all); an admin can override a handful of keys in `site_content`.
 * A missing, blank or unreachable override is not an error — it is simply the
 * default, which is what keeps this feature from being able to break a page.
 */
import { useEffect, useState } from 'react';
import { loadSiteContent } from './admin';
import { supabaseEnabled } from './supabase';

let cache: Promise<Record<string, string>> | null = null;

/** One fetch per tab, shared by every screen that asks. */
export function siteContent(): Promise<Record<string, string>> {
  if (!supabaseEnabled()) return Promise.resolve({});
  if (!cache) {
    cache = loadSiteContent().catch(() => ({}));
  }
  return cache;
}

/** Drop the cache after an admin saves, so the next screen sees the edit. */
export function resetSiteContent() {
  cache = null;
}

/**
 * `const copy = useSiteContent()` — call `copy('retro.lede', 'default…')`.
 * Returns defaults until the fetch lands, so nothing flickers to empty.
 */
export function useSiteContent(): (key: string, fallback: string) => string {
  const [rows, setRows] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    void siteContent().then((value) => { if (alive) setRows(value); });
    return () => { alive = false; };
  }, []);
  return (key, fallback) => {
    const value = rows[key];
    return typeof value === 'string' && value.trim() ? value : fallback;
  };
}
