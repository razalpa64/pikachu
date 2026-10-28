import { useEffect, useState } from 'react';

/**
 * How much of the screen the on-screen keyboard is covering.
 *
 * Why this exists
 * ---------------
 * A phone chat composer is a *fixed* element pinned to the bottom of the
 * layout viewport. The on-screen keyboard is not part of that viewport:
 *
 *  • Chrome on Android honours `interactive-widget=resizes-content` (see
 *    index.html), so `window.innerHeight` shrinks when the keyboard opens and a
 *    bottom-anchored `position: fixed` element is lifted for us. Inset is 0.
 *  • iOS Safari and in-app browsers do NOT resize the layout viewport — the
 *    keyboard is painted on top of it. A `bottom: 8px` sheet then sits *under*
 *    the keyboard: you can see the chat, you cannot see the box you type into.
 *
 * The only cross-browser signal is `window.visualViewport`, whose `height` and
 * `offsetTop` describe the part of the page that is actually visible. The
 * difference between the layout viewport and that rectangle is the keyboard.
 *
 * The maths is kept pure so it can be unit-tested without a browser.
 */

export interface ViewportBox {
  /** layout viewport height — `window.innerHeight` */
  innerHeight: number;
  /** visible viewport height — `visualViewport.height` */
  viewportHeight: number;
  /** visible viewport top offset — `visualViewport.offsetTop` */
  viewportTop?: number;
}

/** Keyboard height in CSS pixels, clamped to something sane.
 *
 *  Clamped at 60% of the layout viewport: Safari reports a full-height visible
 *  viewport during the keyboard's open animation, and a stale pair of numbers
 *  must never move the composer most of the way up the screen. Sub-24px values
 *  are rounding noise from a URL bar collapsing, not a keyboard. */
export function keyboardInset({ innerHeight, viewportHeight, viewportTop = 0 }: ViewportBox): number {
  if (!Number.isFinite(innerHeight) || !Number.isFinite(viewportHeight)) return 0;
  if (innerHeight <= 0 || viewportHeight <= 0) return 0;
  const raw = innerHeight - viewportHeight - (Number.isFinite(viewportTop) ? viewportTop : 0);
  if (raw < 24) return 0;
  return Math.round(Math.min(raw, Math.floor(innerHeight * 0.6)));
}

/** The inset for the current window, or 0 where `visualViewport` is missing.
 *
 *  Small helper so callers do not each re-derive `visualViewport ? ... : 0`. */
export function readKeyboardInset(win: Window = window): number {
  const vv = win.visualViewport;
  if (!vv) return 0;
  return keyboardInset({ innerHeight: win.innerHeight, viewportHeight: vv.height, viewportTop: vv.offsetTop });
}

/* ------------------------------------------------------------------ hook */

/**
 * Live keyboard inset for the current page, in CSS pixels.
 *
 * Subscribed to `visualViewport` rather than `window`: on iOS the layout
 * viewport does not change when the keyboard slides up, so a `resize` listener
 * on `window` never fires. rAF-coalesced because Safari emits several events
 * per frame during the open animation.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setInset(readKeyboardInset()));
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  return inset;
}
