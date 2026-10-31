import { useEffect, useState } from 'react';

/**
 * The die.
 *
 * A real one, drawn as pips on a rounded cube face: ivory body, carved dots, a
 * soft shadow underneath, and a tumble while it is in the air. The number itself
 * always comes from the referee — this only shows it, and turns the wait into
 * something worth watching.
 */
const PIPS: Record<number, [number, number][]> = {
  1: [[0.5, 0.5]],
  2: [[0.29, 0.29], [0.71, 0.71]],
  3: [[0.26, 0.26], [0.5, 0.5], [0.74, 0.74]],
  4: [[0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7]],
  5: [[0.28, 0.28], [0.72, 0.28], [0.5, 0.5], [0.28, 0.72], [0.72, 0.72]],
  6: [[0.3, 0.24], [0.7, 0.24], [0.3, 0.5], [0.7, 0.5], [0.3, 0.76], [0.7, 0.76]],
};

export default function Die({
  value, rolling = false, size = 64, tint = '#fffaf0',
}: {
  value: number | null;
  rolling?: boolean;
  size?: number;
  tint?: string;
}) {
  /* The die shows a random face while it tumbles, then settles on the truth. */
  const [face, setFace] = useState(value ?? 1);
  useEffect(() => {
    if (!rolling) { setFace(value ?? 1); return; }
    const t = setInterval(() => setFace(1 + Math.floor(Math.random() * 6)), 70);
    const done = setTimeout(() => { clearInterval(t); setFace(value ?? 1); }, 520);
    return () => { clearInterval(t); clearTimeout(done); };
  }, [rolling, value]);

  /* Before the first roll the die is not blank — a blank ivory tile reads as a
     broken image. It shows the last face at low contrast, as if it is resting
     on the table waiting to be picked up. */
  const idle = value === null && !rolling;
  const shown = face;
  const pips = PIPS[shown] ?? PIPS[1];

  return (
    <span
      aria-hidden
      className={`relative inline-grid place-items-center ${rolling ? 'ludo-die-roll' : ''}`}
      style={{ width: size, height: size }}
    >
      <span
        className="absolute inset-0 rounded-[26%]"
        style={{
          background: `linear-gradient(155deg, ${tint}, #f3e3c6 55%, #d9c39c)`,
          boxShadow: '0 3px 0 #b9995f, 0 10px 18px -8px rgba(40,22,4,.75), inset 0 1px 0 rgba(255,255,255,.95)',
          border: '1px solid rgba(150,112,58,.55)',
        }}
      />
      <span className="absolute inset-0 grid" style={{ gridTemplateColumns: 'repeat(3,1fr)', gridTemplateRows: 'repeat(3,1fr)' }}>
        {Array.from({ length: 9 }, (_, i) => {
          const cx = (i % 3 + 0.5) / 3;
          const cy = ((i / 3) | 0) + 0.5;
          const cyc = cy / 3;
          const on = pips.some(([x, y]) => Math.abs(x - cx) < 0.02 && Math.abs(y - cyc) < 0.02);
          return (
            <span key={i} className="grid place-items-center">
              <span
                className="rounded-full transition-opacity"
                style={{
                  width: size * 0.17,
                  height: size * 0.17,
                  background: on ? 'radial-gradient(circle at 35% 30%, #6d4a24, #2a1709)' : 'transparent',
                  boxShadow: on ? 'inset 0 1px 1px rgba(255,255,255,.25)' : 'none',
                  opacity: idle ? 0.32 : 1,
                }}
              />
            </span>
          );
        })}
      </span>
    </span>
  );
}
