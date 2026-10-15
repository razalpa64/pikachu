import { memo } from 'react';

/** Original vector chess set — "Volt Regalia". Gold for White, charcoal-steel for Black. */
const PATHS: Record<string, string> = {
  p: 'M50,18 a9,9 0 1,1 -0.1,0 M41,32 h18 l4,10 h-26 z M37,44 c0,-2 2,-4 5,-5 h16 c3,1 5,3 5,5 c0,12 -6,16 -6,26 h-14 c0,-10 -6,-14 -6,-26 z M30,72 h40 l4,10 h-48 z',
  r: 'M28,20 h8 v7 h8 v-7 h12 v7 h8 v-7 h8 v16 l-5,6 v26 l5,6 v4 h-44 v-4 l5,-6 v-26 l-5,-6 z M24,80 h52 l4,10 h-60 z',
  n: 'M36,86 c0,-14 2,-22 8,-30 c-4,2 -9,4 -13,3 c-3,-1 -4,-5 -2,-9 l8,-13 c3,-5 7,-9 12,-12 l4,-7 l3,6 c10,2 18,9 22,19 c4,10 5,22 5,43 z M40,34 a3,3 0 1,0 0.1,0 M26,86 h54 l4,10 h-62 z',
  b: 'M50,14 a6,6 0 1,1 -0.1,0 M50,24 c10,6 16,16 16,26 c0,9 -7,16 -16,16 c-9,0 -16,-7 -16,-16 c0,-10 6,-20 16,-26 z M44,40 h12 M50,34 v12 M38,70 h24 l3,8 h-30 z M28,82 h44 l4,10 h-52 z',
  q: 'M24,26 a5,5 0 1,1 -0.1,0 M50,18 a5,5 0 1,1 -0.1,0 M76,26 a5,5 0 1,1 -0.1,0 M26,32 l8,34 h32 l8,-34 l-13,17 l-11,-21 l-11,21 z M32,70 h36 l3,8 h-42 z M26,82 h48 l4,10 h-56 z',
  k: 'M50,8 v16 M43,15 h14 M50,26 c-12,0 -20,8 -20,18 c0,10 10,16 20,28 c10,-12 20,-18 20,-28 c0,-10 -8,-18 -20,-18 z M32,74 h36 l3,8 h-42 z M26,86 h48 l4,10 h-56 z',
};

export const ChessPiece = memo(function ChessPiece({
  type, colour, size = 44, lifted,
}: { type: string; colour: 'w' | 'b'; size?: number | string; lifted?: boolean }) {
  const light = colour === 'w';
  const id = `${colour}${type}`;
  return (
    <svg width={size} height={size} viewBox="0 0 100 104" aria-hidden
      style={{
        filter: lifted ? 'drop-shadow(0 7px 7px rgba(120,80,60,.45))' : 'drop-shadow(0 2px 3px rgba(120,80,60,.35))',
        transition: 'transform .12s',
      }}>
      <defs>
        <linearGradient id={`g-${id}`} x1="0" y1="0" x2="0" y2="1">
          {/* cream "butter" set vs. deep cocoa set — both carry a heavy cocoa outline so
              they stay legible on the warm board at any size */}
          {light ? (<><stop offset="0%" stopColor="#FFFDF6" /><stop offset="52%" stopColor="#FFF2D2" /><stop offset="100%" stopColor="#F2D79C" /></>)
                 : (<><stop offset="0%" stopColor="#8A6150" /><stop offset="46%" stopColor="#6B4537" /><stop offset="100%" stopColor="#4A2C21" /></>)}
        </linearGradient>
      </defs>
      <path d={PATHS[type] ?? PATHS.p} fill={`url(#g-${id})`} stroke={light ? '#9A6B45' : '#3A2017'} strokeWidth="3.8" strokeLinejoin="round" />
    </svg>
  );
});

export default ChessPiece;
