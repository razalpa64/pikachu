/**
 * The real materials.
 *
 * The board is painted in a flat print style — cream stock, one ink, four seat
 * colours — so nothing on it is photographic any more. The one thing that *is*
 * an image is the creature that owns each corner: a printed board puts a
 * character in each yard and that character cannot be drawn with gradients.
 *
 * Loading goes through the shared art cache (`lib/artCache`), so a file that never
 * arrives costs one failed request and the painter falls back to a drawn emblem
 * in exactly the same place. Nothing here can throw.
 */
import { art, artReady, loadArt, onArtLoad } from '../../lib/artCache';

export type MaterialId = 'yard-fire' | 'yard-leaf' | 'yard-water' | 'yard-spark';

const URLS: Record<MaterialId, string> = {
  'yard-fire': '/art/ludo/yard-fire.webp',
  'yard-leaf': '/art/ludo/yard-leaf.webp',
  'yard-water': '/art/ludo/yard-water.webp',
  'yard-spark': '/art/ludo/yard-spark.webp',
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
