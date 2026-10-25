import { useMemo } from 'react';
import { reversiRules as R, flipsFor, legalCells, type ReversiState } from '../../games/reversi/rules';
import type { BoardProps } from './types';
import { BoardPlate, ScoreChip } from './BoardPlate';

const GOLD = '#e8a21c';
const ROSE = '#d9456f';

/**
 * Reversi board.
 *
 * A mint lawn with cocoa lines, coins that turn over rather than blink into place,
 * and a dashed ghost coin on every square that would actually flip something —
 * "what do I click" should never be a question in a hidden-strategy game.
 */
export default function ReversiBoard({ state, youSlot, onMove, interactive, hint, names }: BoardProps<ReversiState>) {
  const size = state.size;
  const legal = useMemo(
    () => new Set(interactive ? legalCells(state, youSlot) : []),
    [state, youSlot, interactive],
  );
  /* every disc that changed owner this turn, so it can animate */
  const flipped = useMemo(() => new Set(state.last?.flipped ?? []), [state.last]);
  const cell = size <= 6 ? 'min(15vw,72px)' : size <= 8 ? 'min(11.2vw,60px)' : 'min(9vw,48px)';

  return (
    <BoardPlate
      label="Lantern Flip"
      right={
        <div className="flex gap-1.5">
          <ScoreChip label={names[0]} value={state.counts[0]} accent={GOLD} active={state.turn === 0 && !state.over} />
          <ScoreChip label={names[1]} value={state.counts[1]} accent={ROSE} active={state.turn === 1 && !state.over} />
        </div>
      }
    >
      <div
        role="grid"
        aria-label={`${size} by ${size} Reversi board`}
        className="grid gap-[3px] p-[7px] rounded-[16px]"
        style={{ gridTemplateColumns: `repeat(${size}, ${cell})`, background: 'linear-gradient(180deg,#d8f3e7,#bfe8d6)', border: '3px solid #8fcbb2' }}
      >
        {state.board.map((v, i) => {
          const playable = legal.has(i);
          const wouldFlip = playable ? flipsFor(state.board, size, i, youSlot).length : 0;
          const isLast = state.last?.cell === i;
          const toggle = flipped.has(i);
          return (
            <button
              key={i}
              role="gridcell"
              disabled={!playable}
              onClick={() => onMove({ cell: i })}
              aria-label={
                `Row ${Math.floor(i / size) + 1}, column ${(i % size) + 1}, ` +
                (v === null ? (playable ? `flips ${wouldFlip}` : 'empty') : v === 0 ? 'gold coin' : 'rose coin')
              }
              className={`relative grid place-items-center rounded-[9px] transition-colors duration-150 no-tap
                ${playable ? 'cursor-pointer hover:bg-white/55' : 'cursor-default'}
                ${isLast ? 'ring-2 ring-[#7a4a12] ring-inset' : ''}`}
              style={{ width: cell, height: cell, border: '2px solid rgba(143,163,150,.35)', background: 'rgba(255,255,255,.32)' }}
            >
              {v !== null && <Coin who={v} toggle={toggle} pop={isLast} />}
              {/* Only squares that would actually flip something get a ghost.
                  Painting every empty square (at 25% opacity) made legal moves
                  indistinguishable from decorative dots. */}
              {v === null && playable && (
                <span
                  aria-hidden
                  className="w-[46%] h-[46%] rounded-full border-2 border-dashed opacity-90 grid place-items-center tabnum"
                  style={{ borderColor: youSlot === 0 ? GOLD : ROSE }}
                >
                  {/* the count is the loudest hint a beginner can get: "this one
                      turns four of theirs" beats a bare circle */}
                  {hint && wouldFlip > 1 && (
                    <span className="text-[9px] font-extrabold leading-none" style={{ color: youSlot === 0 ? '#8d5a05' : '#a83350' }}>{wouldFlip}</span>
                  )}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="flex items-center justify-between px-1 pt-2 min-h-[18px]">
        <p className="text-[10.5px] text-cream-500 font-bold">
          {state.over ? 'No moves left — counted up.' : state.passed !== null ? `${names[state.passed]} had no move and passed.` : 'Corners can never be retaken.'}
        </p>
        <p className="text-[10.5px] text-cream-500 tabnum">{size * size - state.counts[0] - state.counts[1]} empty</p>
      </div>
      <style>{`
        @keyframes pkflip { 0% { transform: rotateY(0) scale(.9) } 55% { transform: rotateY(90deg) scale(1.06) } 100% { transform: rotateY(0) scale(1) } }
        @keyframes pkdrop { 0% { transform: scale(.4); opacity: 0 } 70% { transform: scale(1.1); opacity: 1 } 100% { transform: scale(1) } }
      `}</style>
    </BoardPlate>
  );
}

function Coin({ who, toggle, pop }: { who: 0 | 1; toggle?: boolean; pop?: boolean }) {
  const gold = who === 0;
  return (
    <img
      src={gold ? '/art/piece/checker-gold.webp' : '/art/piece/checker-blush.webp'}
      alt=""
      aria-hidden
      draggable={false}
      decoding="async"
      className="block w-[86%] h-[86%] pointer-events-none"
      style={{
        filter: 'drop-shadow(0 1px 1px rgba(120,80,55,.32)) drop-shadow(0 3px 5px rgba(120,80,55,.24))',
        animation: toggle ? 'pkflip .42s cubic-bezier(.3,1.4,.5,1)' : pop ? 'pkdrop .3s cubic-bezier(.3,1.6,.5,1)' : undefined,
      }}
    />
  );
}
