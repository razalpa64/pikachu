import { useEffect, useRef } from 'react';
import { VOLT_CARDS, type MemState, type CardId } from '../../games/memory/rules';
import type { BoardProps } from './types';
import { useStore } from '../../lib/store';
import { BoardGrid, BoardStage } from './BoardStage';

const BY_ID = new Map(VOLT_CARDS.map((c) => [c.id, c]));

/**
 * Card ids that have a painted face in /art/mem. Anything not in here falls
 * back to the vector glyph at the bottom of this file, so the board is always
 * complete even while the set is still being illustrated.
 */
export const PAINTED_CARDS = new Set<CardId>([
  'bolt', 'cheek', 'tail', 'berry', 'coil', 'star', 'orb', 'leaf', 'cloud',
  'gear', 'feather', 'ember', 'moon', 'shell', 'crown', 'ball', 'rune', 'prism',
]);

export default function MemoryBoard({ state, onMove, interactive }: BoardProps<MemState>) {
  const { sfx } = useStore();
  const resolveTimer = useRef<number | null>(null);

  // two cards up -> the owner of the turn asks the referee to resolve after a readable pause
  useEffect(() => {
    if (state.revealed.length < 2) return;
    if (!interactive) return;
    resolveTimer.current = window.setTimeout(() => onMove({ resolve: true }), 820);
    return () => { if (resolveTimer.current) clearTimeout(resolveTimer.current); };
  }, [state.revealed.length, interactive, onMove]);

  useEffect(() => {
    if (state.lastResult === 'hit') sfx('coin');
    else if (state.lastResult === 'miss') sfx('miss');
  }, [state.lastResult, state.matched.length]);

  const cols = state.cols;
  const rows = Math.max(1, Math.ceil(state.deck.length / cols));
  /* Cards are 3:4 and there are up to 24 of them. This board used to carry its
     own height model — `calc((75vh - 225px) / rows)` — guesswork against a
     magical 225 px, which is why it looked right on one laptop and squashed on
     the next. The stage measures the real space under the board and the cards
     are fractions of it. */
  return (
    <BoardStage ratio={(cols * 3) / (rows * 4)} max={840} min={250} reserve={150} chrome={20}>
      <div className="relative panel notch-sm p-[clamp(4px,1.4%,10px)]">
      <BoardGrid cellRatio={3 / 4} cols={cols} rows={rows} gap="clamp(4px,1.6%,10px)" role="grid" aria-label="Memory board">
        {state.deck.map((card, i) => {
          const faceUp = state.revealed.includes(i) || state.matched.includes(i);
          const matched = state.matched.includes(i);
          const owner = state.owner[i];
          const canFlip = interactive && !faceUp && state.revealed.length < 2;
          return (
            <button key={i} role="gridcell" disabled={!canFlip} onClick={() => { sfx('flip'); onMove({ flip: i }); }}
              aria-label={faceUp ? `Card ${i + 1}: ${card ? BY_ID.get(card as CardId)?.name : 'hidden'}` : `Card ${i + 1}, face down`}
              className="board-cell no-tap" style={{ perspective: '700px' }}>
              <span className="absolute inset-0 transition-transform duration-[420ms]"
                style={{ transformStyle: 'preserve-3d', transform: faceUp ? 'rotateY(180deg)' : 'none' }}>
                {/* back */}
                <span className="absolute inset-0 grid place-items-center border-2 border-ink-500 rounded-[clamp(8px,12cqw,16px)] overflow-hidden"
                  style={{ backfaceVisibility: 'hidden', background: 'linear-gradient(150deg,#ffe3ec,#ffd0de)' }}>
                  <svg width="40%" viewBox="0 0 24 34" aria-hidden>
                    <path d="M14,1 L2,19 H10 L8,33 L22,13 H13 Z" fill="#fff4f7" stroke="#e58aa8" strokeWidth="2.2" strokeLinejoin="round" />
                  </svg>
                  {canFlip && <span className="absolute inset-0 rounded-[clamp(8px,12cqw,16px)] border-[3px] border-blush-400/0 hover:border-blush-400/90 transition-colors" />}
                </span>
                {/* face */}
                <span className="absolute inset-0 grid place-items-center border-2 rounded-[clamp(8px,12cqw,16px)] overflow-hidden"
                  style={{
                    backfaceVisibility: 'hidden', transform: 'rotateY(180deg)',
                    background: card
                      ? `linear-gradient(160deg, hsl(${BY_ID.get(card as CardId)?.hue ?? 48} 82% 93%), hsl(${BY_ID.get(card as CardId)?.hue ?? 48} 64% 84%))`
                      : '#fff6e8',
                    borderColor: matched ? (owner === 0 ? '#e8a21c' : owner === 1 ? '#4a9fd8' : '#3fae82') : '#e2c6a6',
                    opacity: matched ? 0.96 : 1,
                  }}
                  /* The face is painted on the back of a 3D card, so it is in the DOM even
                     while the card is down. The button's own label already says either
                     "face down" or the card name — leaving this readable as well told a
                     screen reader the name of every unflipped card. */
                  aria-hidden>
                  {card && (PAINTED_CARDS.has(card as CardId)
                    ? <img src={`/art/mem/${card}.webp`} alt="" draggable={false} loading="lazy" decoding="async"
                        className="w-[72%] select-none pointer-events-none"
                        style={{ transform: 'translateY(-5%)', filter: 'drop-shadow(0 3px 4px rgba(140,94,70,.28))' }} />
                    : <Glyph id={card as CardId} />)}
                  {card && <span className="absolute bottom-0 inset-x-0 font-extrabold uppercase tracking-wider text-center py-[3px] bg-white/90 text-cream-100 truncate px-1 rounded-b-[clamp(7px,10cqw,14px)]" style={{ fontSize: 'clamp(6px, 11cqw, 9px)' }}>{BY_ID.get(card as CardId)?.name}</span>}
                  {matched && <span className="absolute top-1 right-1 w-3.5 h-3.5 rounded-full" style={{ background: owner === 0 ? '#f0b429' : '#4a9fd8' }} />}
                </span>
              </span>
            </button>
          );
        })}
      </BoardGrid>
      </div>
    </BoardStage>
  );
}

/** Each card id maps to one stable, hand-drawn glyph — never a random image. */
function Glyph({ id }: { id: CardId }) {
  const card = BY_ID.get(id)!;
  const c = `hsl(${card.hue} 62% 58%)`;
  const g = card.glyph;
  const P: Record<string, React.ReactNode> = {
    bolt: <path d="M30,4 L10,30 H22 L18,52 L42,22 H28 Z" />,
    circle: <><circle cx="26" cy="28" r="16" /><circle cx="26" cy="28" r="7" fill="#000" opacity=".3" /></>,
    tail: <path d="M8,46 L22,40 L16,28 L32,20 L26,8 L44,6 L40,20 L28,26 L34,38 L14,50 Z" />,
    berry: <><circle cx="26" cy="33" r="14" /><path d="M26,19 q4,-10 12,-12 q-2,9 -12,12" /></>,
    coil: <><ellipse cx="26" cy="20" rx="15" ry="6" /><ellipse cx="26" cy="32" rx="15" ry="6" /><ellipse cx="26" cy="44" rx="15" ry="6" /></>,
    star: <path d="M26,4 L32,21 L50,22 L36,33 L41,50 L26,40 L11,50 L16,33 L2,22 L20,21 Z" />,
    orb: <><circle cx="26" cy="28" r="17" /><circle cx="20" cy="21" r="5" fill="#fff" opacity=".55" /></>,
    leaf: <path d="M10,48 C10,22 26,8 46,6 C44,30 30,46 10,48 Z" />,
    cloud: <path d="M14,40 a10,10 0 0,1 2,-20 a14,14 0 0,1 26,4 a9,9 0 0,1 -2,16 z" />,
    gear: <><circle cx="26" cy="28" r="12" /><g>{[0, 45, 90, 135, 180, 225, 270, 315].map((a) => <rect key={a} x="23" y="4" width="6" height="10" transform={`rotate(${a} 26 28)`} />)}</g></>,
    feather: <path d="M44,6 C22,10 8,28 8,48 L16,44 C32,38 44,24 44,6 Z" />,
    ember: <path d="M26,4 C34,18 44,22 40,36 C37,47 30,52 26,52 C22,52 15,47 12,36 C8,22 18,18 26,4 Z" />,
    moon: <path d="M44,34 A18,18 0 1,1 22,10 A14,14 0 0,0 44,34 Z" />,
    shell: <><path d="M26,50 C10,50 4,34 10,18 L42,18 C48,34 42,50 26,50 Z" /><path d="M26,50 V18 M16,48 L20,18 M36,48 L32,18" stroke="#000" strokeOpacity=".3" strokeWidth="2" fill="none" /></>,
    crown: <path d="M6,44 L10,16 L20,28 L26,10 L32,28 L42,16 L46,44 Z" />,
    ball: <><circle cx="26" cy="28" r="17" /><path d="M9,28 h34" stroke="#000" strokeOpacity=".4" strokeWidth="4" /><circle cx="26" cy="28" r="6" fill="#fff" /></>,
    rune: <><rect x="10" y="10" width="32" height="36" rx="4" /><path d="M26,16 L18,30 h7 l-2,12 l12,-16 h-8 z" fill="#000" fillOpacity=".4" /></>,
    prism: <path d="M26,4 L46,40 L6,40 Z" />,
  };
  return (
    <svg width="54%" viewBox="0 0 52 56" fill={c} stroke="#5a3f34" strokeWidth="2.4" strokeLinejoin="round" aria-hidden
      style={{ filter: 'drop-shadow(0 3px 4px rgba(140,94,70,.3))' }}>
      {P[g] ?? P.bolt}
    </svg>
  );
}
