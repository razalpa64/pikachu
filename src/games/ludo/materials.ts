/**
 * The real materials.
 *
 * The board used to be painted entirely with gradients — convincing for a while
 * and then, next to a real board, obviously synthetic. Everything that reads as a
 * *material* now comes from a generated image: walnut veneer for the frame, warm
 * marble for the bed, and photographed-then-keyed pawns for the pieces.
 *
 * Loading goes through the shared art cache (`lib/artCache`), so a file that
 * never arrives costs one failed request and the painter falls back to the
 * procedural version it used before. Nothing here can throw.
 */
import { art, artReady, loadArt, onArtLoad } from '../../lib/artCache';

export type MaterialId = 'wood' | 'ivory' | 'velvet' | 'pawn-blue' | 'pawn-red';

const URLS: Record<MaterialId, string> = {
  wood: '/art/ludo/wood.webp',
  ivory: '/art/ludo/ivory.webp',
  velvet: '/art/ludo/velvet.webp',
  'pawn-blue': '/art/ludo/pawn-blue.webp',
  'pawn-red': '/art/ludo/pawn-red.webp',
};

/** Everything that has arrived so far. */
export function materialsReady(): MaterialId[] {
  const here = new Set(artReady(Object.values(URLS)));
  return (Object.keys(URLS) as MaterialId[]).filter((id) => here.has(URLS[id]));
}

/** Called once per board, when any new material lands. */
export const onMaterialLoad = onArtLoad;

/** Kick off loading. Safe to call from every mount; it only ever fetches once. */
export function loadMaterials(): void {
  loadArt(Object.values(URLS));
}

export function material(id: MaterialId): HTMLImageElement | null {
  return art(URLS[id]);
}
