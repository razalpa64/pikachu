/**
 * Haptics.
 *
 * A native app confirms a tap with a short vibration; a web app that does the
 * same stops feeling like a page you are poking and starts feeling like a thing
 * that answers you. The API is `navigator.vibrate`, which exists on Android
 * Chrome and nowhere else — iOS Safari ignores it — so every call here is a
 * no-op where it is not supported, and nothing depends on it having happened.
 *
 * Kept deliberately tiny and quiet:
 *   • only short pulses (a 900 ms buzz is an error signal, not feedback);
 *   • nothing on scroll or hover — overshooting haptics is worse than none;
 *   • silenced when the OS asks for reduced motion, because that preference is
 *     about not being startled, and a buzz startles.
 */
/**
 * Does the OS ask for less movement?
 *
 * Reduced motion is also the right proxy for "do not startle me", which is why
 * the vibration respects it. Guarded for jsdom, where `matchMedia` is absent.
 */
function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

type Pattern = 'tap' | 'select' | 'success' | 'warn';

const PATTERN_MS: Record<Pattern, number | number[]> = {
  tap: 8,
  select: 12,
  success: [10, 40, 16],
  warn: [18, 50, 18],
};

export function haptic(kind: Pattern = 'tap'): void {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  if (prefersReducedMotion()) return;
  try {
    navigator.vibrate(PATTERN_MS[kind]);
  } catch {
    /* A browser that refuses the call is not an error worth reporting. */
  }
}
