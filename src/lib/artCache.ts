/**
 * One small cache for picture assets that several boards share.
 *
 * Boards here are painted on a canvas, not built from CSS, so every image they
 * want has to be loaded by hand: no lazy `loading="lazy"`, no browser cache hit
 * on the first frame, no layout to tell you when it arrived. This keeps that to
 * one place: ask for a URL, get `null` until it is decoded, and be called once
 * when it is.
 *
 * Nothing here throws. An asset that 404s is remembered as missing, and the
 * painter falls back to whatever it drew before the picture existed.
 */
const images = new Map<string, HTMLImageElement>();
const missing = new Set<string>();
const started = new Set<string>();
const listeners = new Set<() => void>();

export function art(url: string): HTMLImageElement | null {
  const img = images.get(url);
  return img && img.complete && img.naturalWidth > 0 ? img : null;
}

export function onArtLoad(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Which of these have arrived. Used as part of a texture cache key. */
export function artReady(urls: string[]): string[] {
  return urls.filter((u) => art(u) !== null);
}

export function loadArt(urls: string[]): void {
  if (typeof window === 'undefined' || !('Image' in window)) return;
  const waiting: Promise<void>[] = [];
  for (const url of urls) {
    if (started.has(url)) continue;
    started.add(url);
    const img = new Image();
    img.decoding = 'async';
    const done = new Promise<void>((resolve) => {
      img.onload = () => { images.set(url, img); resolve(); };
      img.onerror = () => { missing.add(url); resolve(); };
    });
    img.src = url;
    waiting.push(done);
  }
  if (!waiting.length) return;
  // announce once per batch, not once per file, so a board repaints once
  void Promise.all(waiting).then(() => listeners.forEach((fn) => fn()));
}
