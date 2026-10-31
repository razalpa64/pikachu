/**
 * The real materials.
 *
 * The board used to be painted entirely with gradients — convincing for a while
 * and then, next to a real board, obviously synthetic. Everything that reads as a
 * *material* now comes from a generated image: walnut veneer for the frame, warm
 * marble for the bed, and photographed-then-keyed pawns for the pieces.
 *
 * Loading is deliberately tolerant. The board is drawn with whatever has arrived
 * and repainted when the rest lands, so a slow connection shows a plain board for
 * a moment rather than nothing at all; and if an asset never arrives the painter
 * falls back to the procedural version it used before. Nothing here can throw.
 */
export type MaterialId = 'wood' | 'ivory' | 'velvet' | 'pawn-blue' | 'pawn-red';

const URLS: Record<MaterialId, string> = {
  wood: '/art/ludo/wood.webp',
  ivory: '/art/ludo/ivory.webp',
  velvet: '/art/ludo/velvet.webp',
  'pawn-blue': '/art/ludo/pawn-blue.webp',
  'pawn-red': '/art/ludo/pawn-red.webp',
};

const cache = new Map<MaterialId, HTMLImageElement>();
let listeners = new Set<() => void>();
let started = false;

const ready = (id: MaterialId) => {
  const img = cache.get(id);
  return !!img && img.complete && img.naturalWidth > 0;
};

/** Everything that has arrived so far. */
export function materialsReady(): MaterialId[] {
  return (Object.keys(URLS) as MaterialId[]).filter(ready);
}

/** Called once per board, when any new material lands. */
export function onMaterialLoad(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Kick off loading. Safe to call from every mount; it only ever fetches once. */
export function loadMaterials(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  if (!('Image' in window)) return;
  for (const id of Object.keys(URLS) as MaterialId[]) {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => { cache.set(id, img); listeners.forEach((fn) => fn()); };
    img.onerror = () => { listeners.forEach((fn) => fn()); };
    img.src = URLS[id];
    cache.set(id, img);
  }
}

export function material(id: MaterialId): HTMLImageElement | null {
  return ready(id) ? cache.get(id)! : null;
}
