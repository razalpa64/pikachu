/**
 * The bottle.
 *
 * A real spin: the painted bottle is rotated by a CSS transform on a long
 * ease-out, so it decelerates the way a bottle actually does on a table. The
 * landing slot is decided *before* the spin starts and the transform is built
 * to finish there — nothing is faked afterwards and the result can't disagree
 * with where the neck is pointing.
 *
 * The artwork points right at 0deg, so slot 1 (right-hand player) sits at 0deg
 * and slot 0 (left-hand player) at 180deg.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../../components/ui';

const SPIN_MS = 3400;
/** How far off dead-centre the neck may stop. Stays well inside each 180° wedge. */
const JITTER = 26;

function prefersReduced() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
    || document.documentElement.dataset.motion === 'off';
}

export default function Bottle({
  names, turn, disabled, onLanded, onSpinStart,
}: {
  names: [string, string];
  turn: 0 | 1;
  /** a card is on the table — spinning now would be meaningless */
  disabled?: boolean;
  onLanded: (slot: 0 | 1) => void;
  onSpinStart?: () => void;
}) {
  const [angle, setAngle] = useState(180); // start pointing at player one
  const [spinning, setSpinning] = useState(false);
  const [dur, setDur] = useState(SPIN_MS);
  const landed = useRef<0 | 1>(0);
  const guard = useRef<number | null>(null);

  useEffect(() => () => { if (guard.current) clearTimeout(guard.current); }, []);

  const settle = useCallback(() => {
    if (guard.current) { clearTimeout(guard.current); guard.current = null; }
    setSpinning((was) => {
      if (was) onLanded(landed.current);
      return false;
    });
  }, [onLanded]);

  const spin = useCallback(() => {
    if (spinning || disabled) return;
    const reduce = prefersReduced();
    const slot: 0 | 1 = Math.random() < 0.5 ? 0 : 1;
    const base = slot === 1 ? 0 : 180;
    const jitter = (Math.random() * 2 - 1) * JITTER;
    const turns = reduce ? 0 : 4 + Math.floor(Math.random() * 3);
    const delta = (((base + jitter) - (angle % 360)) + 720) % 360;
    const ms = reduce ? 420 : SPIN_MS;

    landed.current = slot;
    setDur(ms);
    setSpinning(true);
    onSpinStart?.();
    setAngle(angle + turns * 360 + delta);
    // transitionend is the source of truth; this only covers a dropped event
    guard.current = window.setTimeout(settle, ms + 320);
  }, [angle, spinning, disabled, onSpinStart, settle]);

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative w-full max-w-[330px] aspect-square mx-auto select-none">
        {/* table */}
        <div className="absolute inset-0 rounded-full border-[3px] border-ink-500"
          style={{ background: 'radial-gradient(circle at 42% 34%, #fffdf7 0%, #fff2dd 55%, #ffe4c9 100%)' }} />
        <div className="absolute inset-[9%] rounded-full border-2 border-dashed border-ink-500/55" />

        {/* name plates — the two things the neck can point at */}
        {([0, 1] as const).map((slot) => (
          <div
            key={slot}
            className={`absolute top-1/2 -translate-y-1/2 ${slot === 0 ? 'left-0 -translate-x-1' : 'right-0 translate-x-1'}`}
          >
            <div
              className={`px-2.5 py-1.5 notch-sm border-2 font-display text-[12.5px] font-extrabold max-w-[104px] truncate transition-colors ${
                turn === slot && !spinning
                  ? 'bg-volt-400 border-ink-400 text-[#5a3a12]'
                  : 'bg-ink-800 border-ink-500 text-cream-500'
              }`}
            >
              {names[slot]}
            </div>
          </div>
        ))}

        {/* pivot sits dead centre; the image is nudged onto it by its own transform.
            NB Tailwind v4 emits the standalone `translate` property, which would
            stack with this `transform` — so the centring lives here, not in a class. */}
        <img
          src="/art/dare/bottle.webp"
          alt=""
          draggable={false}
          className="absolute left-1/2 top-1/2 w-[68%] pointer-events-none"
          style={{
            transform: `translate(-50%,-50%) rotate(${angle}deg)`,
            transition: `transform ${dur}ms cubic-bezier(.16,.84,.22,1)`,
            filter: 'drop-shadow(0 6px 10px rgba(140,94,70,.3))',
          }}
          onTransitionEnd={settle}
        />
      </div>

      <button
        onClick={spin}
        disabled={spinning || disabled}
        className="px-5 py-2.5 notch-sm border-2 border-ink-400 bg-blush-300 text-[#6d2038] font-display text-[14px] font-extrabold inline-flex items-center gap-2 disabled:opacity-55 disabled:cursor-not-allowed hover:bg-blush-400 transition-colors no-tap"
      >
        <Icon name="rotate" size={15} />
        {spinning ? 'Spinning…' : disabled ? 'Finish the card first' : 'Spin the bottle'}
      </button>

      {/* the result is announced, not just coloured in */}
      <p className="sr-only" role="status" aria-live="polite">
        {spinning ? 'The bottle is spinning.' : `The bottle points at ${names[turn]}.`}
      </p>
    </div>
  );
}
