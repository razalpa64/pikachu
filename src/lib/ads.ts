/**
 * Advertising — configuration, one consent decision, and nothing else.
 *
 * There is no ad on this site today and this file ships no placeholder, no
 * "sponsored" card, and no invented publisher id. It exists so that the day a
 * real AdSense account exists, adding two environment variables is the whole
 * integration — and so that the decision about *where* an ad may appear is
 * made here, in one readable list, rather than by dropping <ins> tags into
 * screens that are in the middle of a game.
 *
 * Rules encoded below:
 *   • an ad only renders when a valid-looking publisher id AND slot id are set,
 *     and the visitor has explicitly allowed ads (consent), so a misconfigured
 *     deploy shows nothing rather than a broken rectangle;
 *   • placements are named by location, and only non-gameplay locations exist;
 *   • every slot reserves its height before the network answers, because an ad
 *     that pushes the page down as it loads is worse than no ad;
 *   • the browser never sees a secret: a publisher id is public by design, so
 *     `VITE_` is correct here.
 */

const rawClient = ((import.meta.env.VITE_ADSENSE_CLIENT as string | undefined) ?? '').trim();
const rawSlots = {
  'home-foot': ((import.meta.env.VITE_ADSENSE_SLOT_HOME ?? '') as string).trim(),
  'library-foot': ((import.meta.env.VITE_ADSENSE_SLOT_LIBRARY ?? '') as string).trim(),
  'feedback-foot': ((import.meta.env.VITE_ADSENSE_SLOT_FEEDBACK ?? '') as string).trim(),
};

/** Placements that exist. Each one is below the fold of real content, never in a
 *  match, never between the board and its controls, never beside an answer
 *  button. Adding a name here is a design decision, not a code change. */
export type AdPlacement = keyof typeof rawSlots;

const CONSENT_KEY = 'pikachu.ads.consent';

/** AdSense publisher ids are `ca-pub-` followed by exactly 16 digits. Anything
 *  else is a typo, and a typo must render nothing. */
export const isValidClient = (id: string) => /^ca-pub-\d{16}$/.test(id);

export const adsConfigured = (): boolean =>
  isValidClient(rawClient) && Object.values(rawSlots).some((s) => /^\d{6,}$/.test(s));

export function adUnitFor(placement: AdPlacement): { client: string; slot: string } | null {
  if (!adsConfigured()) return null;
  const slot = rawSlots[placement];
  if (!/^\d{6,}$/.test(slot)) return null;
  return { client: rawClient, slot };
}

export type Consent = 'granted' | 'denied' | null;

export function adConsent(): Consent {
  try {
    const v = localStorage.getItem(CONSENT_KEY);
    return v === 'granted' || v === 'denied' ? v : null;
  } catch {
    return null;
  }
}

export function setAdConsent(value: Exclude<Consent, null>) {
  try { localStorage.setItem(CONSENT_KEY, value); } catch { /* storage blocked */ }
  window.dispatchEvent(new CustomEvent('pikachu:consent', { detail: value }));
}

/** Only true when there is something to show AND the visitor said yes. */
export const adsAllowed = (): boolean => adsConfigured() && adConsent() === 'granted';

/**
 * Loads the AdSense script exactly once. Called from the slot itself so the
 * script is never fetched by a visitor who has not consented — which is both the
 * privacy-respecting order of operations and the one that keeps the homepage
 * free of a third-party request it did not need.
 */
let loader: Promise<void> | null = null;
export function loadAdScript(client: string): Promise<void> {
  if (typeof document === 'undefined') return Promise.resolve();
  if (loader) return loader;
  loader = new Promise<void>((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-adsense]');
    if (existing) { resolve(); return; }
    const s = document.createElement('script');
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`;
    s.dataset.adsense = 'true';
    // A blocked or slow ad network must never hold the page hostage: the promise
    // settles on error too — and on a deadline, because a script that is neither
    // blocked nor loaded (offline, an extension swallowing the request) would
    // otherwise leave the slot saying "Loading…" for the whole session.
    const settle = () => { clearTimeout(timer); resolve(); };
    const timer = setTimeout(settle, 8000);
    s.onload = settle;
    s.onerror = settle;
    document.head.appendChild(s);
  });
  return loader;
}
