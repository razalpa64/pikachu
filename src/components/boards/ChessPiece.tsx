import { memo } from 'react';

/**
 * Chess pieces — real artwork, not vector paths written by hand.
 *
 * The twelve pieces live in /public/art/chess as transparent SVGs (the
 * "Staunty" set, the same one lichess uses — see CREDITS.md in that folder).
 * They are transparent, so they sit on any board colour without a halo, and
 * being SVG they stay razor sharp at every size: 16px in the captured row,
 * 40px in the promotion chooser, and whatever the squares end up being.
 *
 * The `type` prop is the chess.js letter (p r n b q k), `colour` is 'w' | 'b'.
 */
const SRC: Record<string, (colour: 'w' | 'b') => string> = {
  k: (c) => `/art/chess/${c}K.svg`,
  q: (c) => `/art/chess/${c}Q.svg`,
  r: (c) => `/art/chess/${c}R.svg`,
  b: (c) => `/art/chess/${c}B.svg`,
  n: (c) => `/art/chess/${c}N.svg`,
  p: (c) => `/art/chess/${c}P.svg`,
};

export const ChessPiece = memo(function ChessPiece({
  type, colour, size = 44, lifted,
}: { type: string; colour: 'w' | 'b'; size?: number | string; lifted?: boolean }) {
  const src = (SRC[type] ?? SRC.p)(colour);
  return (
    <img
      src={src}
      alt=""
      aria-hidden
      draggable={false}
      width={typeof size === 'number' ? size : undefined}
      height={typeof size === 'number' ? size : undefined}
      decoding="async"
      className="block select-none pointer-events-none"
      style={{
        width: size,
        height: size,
        objectFit: 'contain',
        // the drop shadow is what lifts a piece off the square, exactly like a
        // physical set; the selected piece casts a deeper one so it reads as picked up
        filter: lifted
          ? 'drop-shadow(0 6px 6px rgba(90,58,18,.45))'
          : 'drop-shadow(0 2px 2px rgba(90,58,18,.28))',
        transform: lifted ? 'translateY(-2px) scale(1.04)' : undefined,
        transition: 'transform .12s ease, filter .12s ease',
      }}
    />
  );
});

export default ChessPiece;
