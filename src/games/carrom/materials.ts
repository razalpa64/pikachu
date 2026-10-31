/**
 * The carrom table's materials.
 *
 * Two generated photographs: the rosewood the rails are made of, and the pale
 * birch ply of the playing surface. Drawn grain in code was the reason the
 * board looked like a diagram — real carrom is a piece of furniture, and code
 * cannot invent the figure of a cut board, but a photograph of one has it.
 *
 * Falls back silently: if either file is missing the painter keeps the
 * procedural wood it used before, in the same place.
 */
import { art, loadArt, onArtLoad, artReady } from '../../lib/artCache';

const RAIL = '/art/carrom/rail.webp';
const SURFACE = '/art/carrom/surface.webp';

export const carromArt = {
  rail: () => art(RAIL),
  surface: () => art(SURFACE),
  ready: () => artReady([RAIL, SURFACE]).join(','),
  load: () => loadArt([RAIL, SURFACE]),
  onChange: onArtLoad,
};
