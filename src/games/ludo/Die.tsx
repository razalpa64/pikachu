import { useEffect, useState } from 'react';

/**
 * The die.
 *
 * A real one: an ivory body with a bevelled edge, carved pips with their own
 * shadow, and a tumble while it is in the air. The number always comes from the
 * referee — this only shows it, and turns the wait into something worth watching.
 *
 * The pips are placed by fraction of the face, not in a 3×3 grid. The grid was
 * the obvious way to write it and the wrong one: a 3×3 cell centre sits at
 * 0.167, 0.5 and 0.833, which never matches a pip at 0.28 or 0.72, so every face
 * but one collapsed onto the middle dot and a 6 looked like a 1.
 */
const PIPS: Record<number, [number, number][]> = {
  1: [[0.5, 0.5]],
  2: [[0.28, 0.28], [0.72, 0.72]],
  3: [[0.26, 0.26], [0.5, 0.5], [0.74, 0.74]],
  4: [[0.28, 0.28], [0.72, 0.28], [0.28, 0.72], [0.72, 0.72]],
  5: [[0.26, 0.26], [0.74, 0.26], [0.5, 0.5], [0.26, 0.74], [0.74, 0.74]],
  6: [[0.28, 0.24], [0.72, 0.24], [0.28, 0.5], [0.72, 0.5], [0.28, 0.76], [0.72, 0.76]],
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
     broken image. It rests at low contrast, as if it is waiting to be picked up. */
  const idle = value === null && !rolling;
  const shown = face;
  const pips = PIPS[shown] ?? PIPS[1];
  const pip = size * 0.155;

  return (
    <span
      aria-hidden
      data-die=""
      data-die-face={shown}
      data-die-value={value ?? ''}
      className={`relative inline-grid place-items-center ${rolling ? 'ludo-die-roll' : ''}`}
      style={{ width: size, height: size }}
    >
      <span
        className="absolute inset-0"
        style={{
          borderRadius: size * 0.24,
          background: `linear-gradient(158deg, ${tint} 0%, #f7ead2 46%, #e0caa2 100%)`,
          boxShadow: [
            `0 ${size * 0.05}px 0 #b9995f`,
            `0 ${size * 0.16}px ${size * 0.3}px -${size * 0.12}px rgba(40,22,4,.8)`,
            'inset 0 1px 0 rgba(255,255,255,.95)',
            'inset 0 -2px 3px rgba(140,104,52,.35)',
          ].join(', '),
          border: '1px solid rgba(150,112,58,.55)',
        }}
      />
      {/* the polished top-left facet */}
      <span
        className="absolute"
        style={{
          inset: size * 0.07,
          borderRadius: size * 0.19,
          background: 'linear-gradient(150deg, rgba(255,255,255,.75), rgba(255,255,255,0) 62%)',
        }}
      />
      {pips.map(([px, py], i) => (
        <span
          key={i}
          className="absolute rounded-full transition-opacity"
          style={{
            left: size * px - pip / 2,
            top: size * py - pip / 2,
            width: pip,
            height: pip,
            opacity: idle ? 0.42 : 1,
            background: 'radial-gradient(circle at 34% 28%, #5b3c1c 0%, #2a1709 62%, #160b03 100%)',
            boxShadow: 'inset 0 1px 1px rgba(255,255,255,.22), 0 1px 1px rgba(255,255,255,.5)',
          }}
        />
      ))}
    </span>
  );
}
