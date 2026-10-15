import { useEffect, useState } from 'react';

/**
 * Is this a touch-first device?
 *
 * Used to pick instruction copy. Telling someone to "press space" on a phone is
 * not a cosmetic problem — Snake's start card said "Press an arrow key to start
 * the run" above a board that cannot be started that way, which reads as a
 * broken game rather than a wrong label.
 *
 * `(pointer: coarse)` is the right query: it asks what the *primary* input is,
 * so a laptop with a touchscreen still gets keyboard copy, and it updates live
 * if the user plugs in a mouse or rotates into a different mode.
 */
export function useTouch(): boolean {
  const [touch, setTouch] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true);

  useEffect(() => {
    const mq = window.matchMedia('(pointer: coarse)');
    const on = () => setTouch(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  return touch;
}
