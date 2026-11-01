/**
 * The carrom table's materials.
 *
 * One photograph: the grain of the rail, recoloured to the board's walnut with a
 * `color` blend. That is the only place a photograph earns its keep — the bed is
 * a flat printed tan with a drawn figure, because a photographed surface brought
 * its own lighting and banded under the board's lamp.
 *
 * Falls back silently: if the file is missing, the painter draws short grain
 * strokes instead.
 */
import { art, loadArt, onArtLoad, artReady } from '../../lib/artCache';

const RAIL = '/art/carrom/rail.webp';

export const carromArt = {
  rail: () => art(RAIL),
  ready: () => artReady([RAIL]).join(','),
  load: () => loadArt([RAIL]),
  onChange: onArtLoad,
};
