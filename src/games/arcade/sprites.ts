/**
 * Volt Runner sprite sheet loader.
 *
 * The runner used to be a stack of rounded rectangles with two triangles for
 * ears. It is now the actual four-frame running cycle from the supplied GIF 44,
 * and the obstacles and scenery are painted sprites rather than canvas paths.
 *
 * Images are decoded once, module-side, and shared by every mount. Nothing
 * blocks: the renderer checks `ready` and falls back to the old primitive for
 * that frame, so a slow decode never shows an empty road.
 */

export const RUNNER_FRAMES = 4;

type Key = 'runner' | 'charge' | 'drone' | 'tree' | 'wall';

const SRC: Record<Key, string> = {
  runner: '/art/run/runner.png',
  charge: '/art/run/charge.webp',
  drone: '/art/run/drone.webp',
  tree: '/art/run/tree.webp',
  wall: '/art/run/wall.webp',
};

export interface Sprites {
  ready: boolean;
  img: Partial<Record<Key, HTMLImageElement>>;
  /** width of a single runner frame, once the sheet has decoded */
  runnerFrameW: number;
}

const state: Sprites = { ready: false, img: {}, runnerFrameW: 0 };
let started = false;
const waiters = new Set<() => void>();

export function loadSprites(): Sprites {
  if (started) return state;
  started = true;
  let left = Object.keys(SRC).length;
  (Object.keys(SRC) as Key[]).forEach((k) => {
    const im = new Image();
    im.decoding = 'async';
    im.onload = () => {
      state.img[k] = im;
      if (k === 'runner') state.runnerFrameW = im.naturalWidth / RUNNER_FRAMES;
      if (--left === 0) {
        state.ready = true;
        waiters.forEach((f) => f());
        waiters.clear();
      }
    };
    // a missing file must not wedge the loader — just leave that sprite undefined
    im.onerror = () => {
      if (--left === 0) {
        state.ready = true;
        waiters.forEach((f) => f());
        waiters.clear();
      }
    };
    im.src = SRC[k];
  });
  return state;
}

/** resolves when every sprite has settled, so the view can repaint once */
export function onSpritesReady(fn: () => void): () => void {
  if (state.ready) { fn(); return () => {}; }
  waiters.add(fn);
  return () => waiters.delete(fn);
}

/**
 * Draw an image centred on (x, groundY) sitting ON the ground line, scaled so
 * its height is `h`. Returns nothing if the sprite has not decoded yet.
 */
export function drawGrounded(
  ctx: CanvasRenderingContext2D,
  im: HTMLImageElement | undefined,
  x: number,
  groundY: number,
  h: number,
) {
  if (!im || !im.naturalWidth) return false;
  const w = (im.naturalWidth / im.naturalHeight) * h;
  ctx.drawImage(im, x - w / 2, groundY - h, w, h);
  return true;
}
