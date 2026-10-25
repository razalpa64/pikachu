import { useMemo, useState } from 'react';
import { gomokuRules as R, type GomokuState } from '../../games/gomoku/rules';
import type { BoardProps } from './types';
import { BoardPlate, ScoreChip } from './BoardPlate';

const GOLD = '#e8a21c';
const ROSE = '#d9456f';

/**
 * Gomoku board.
 *
 * Fifteen lines each way on a warm wooden board, pebbles laid on the crossings.
 * The lattice is drawn with two gradients rather than 450 little divs, so the
 * whole board is one composited layer and stays smooth on a phone. The five star
 * points and the last stone get their own marks because, on a board this busy,
 * "where did they just play" is the one thing you should never have to hunt for.
 */
export default function GomokuBoard({ state, youSlot, onMove, interactive, hint, names }: BoardProps<GomokuState>) {
  const [hover, setHover] = useState<number | null>(null);
  const size = state.size;
  const cell = size <= 11 ? 'min(7.4vw,34px)' : size <= 15 ? 'min(5.6vw,29px)' : 'min(4.4vw,24px)';
  const legal = useMemo(() => interactive && !state.over, [interactive, state.over]);
  const stars = useMemo(() => {
    const mid = Math.floor(size / 2);
    const edge = size >= 13 ? 3 : 2;
    const pts = [edge, mid, size - 1 - edge];
    return pts.flatMap((r) => pts.map((c) => r * size + c));
  }, [size]);

  return (
    <BoardPlate
      label="River Stones"
      right={
        <div className="flex gap-1.5">
          <ScoreChip label={names[0]} value={state.board.filter((v) => v === 0).length} accent={GOLD} active={state.turn === 0 && !state.over} />
          <ScoreChip label={names[1]} value={state.board.filter((v) => v === 1).length} accent={ROSE} active={state.turn === 1 && !state.over} />
        </div>
      }
    >
      <div className="rounded-[14px] p-[7px]" style={{ background: 'linear-gradient(160deg,#fff3dd,#ffe4c6)', border: '3px solid #d3ab86' }}>
        <div
          role="grid"
          aria-label={`${size} by ${size} Gomoku board, five in a row wins`}
          className="grid"
          style={{
            gridTemplateColumns: `repeat(${size}, ${cell})`,
            ['--c' as string]: cell,
            backgroundImage:
              'linear-gradient(90deg, rgba(201,168,136,.55) 1.5px, transparent 1.5px), linear-gradient(180deg, rgba(201,168,136,.55) 1.5px, transparent 1.5px)',
            backgroundSize: 'var(--c) var(--c), var(--c) var(--c)',
            backgroundPosition: 'calc(var(--c) / 2) calc(var(--c) / 2), calc(var(--c) / 2) calc(var(--c) / 2)',
          } as React.CSSProperties}
        >
        {state.board.map((v, i) => {
          const win = state.winLine?.includes(i);
          const last = state.last === i;
          const star = stars.includes(i);
          const canPlay = legal && v === null;
          return (
            <button
              key={i}
              role="gridcell"
              disabled={!canPlay}
              onClick={() => onMove({ cell: i })}
              onPointerEnter={() => setHover(i)}
              onPointerLeave={() => setHover((h) => (h === i ? null : h))}
              aria-label={
                `Row ${Math.floor(i / size) + 1}, column ${(i % size) + 1}, ` +
                (v === null ? 'empty' : v === 0 ? 'gold stone' : 'rose stone')
              }
              className={`relative grid place-items-center no-tap ${canPlay ? 'cursor-pointer' : 'cursor-default'}`}
              style={{ width: cell, height: cell }}
            >
              {star && v === null && <span aria-hidden className="absolute w-[5px] h-[5px] rounded-full bg-[#c9a888]" />}
              {v !== null && <Stone who={v} win={win} last={last} />}
              {v === null && canPlay && hover === i && (
                <span aria-hidden className="w-[74%] h-[74%] rounded-full" style={{ background: youSlot === 0 ? 'rgba(232,162,28,.38)' : 'rgba(217,69,111,.34)' }} />
              )}
              {v === null && !canPlay && hint && hover === i && (
                <span aria-hidden className="w-[60%] h-[60%] rounded-full border-2 border-dashed border-ink-400/50" />
              )}
            </button>
          );
        })}
        </div>
      </div>
      <div className="flex items-center justify-between px-1 pt-2 min-h-[18px]">
        <p className="text-[10.5px] text-cream-500 font-bold">
          {state.over ? (state.winner === null ? 'Board full — a draw.' : `${names[state.winner]} got five.`) : 'Five in a row, any direction.'}
        </p>
        <p className="text-[10.5px] text-cream-500 tabnum">{state.history.length} stones</p>
      </div>
    </BoardPlate>
  );
}

function Stone({ who, win, last }: { who: 0 | 1; win?: boolean; last?: boolean }) {
  const gold = who === 0;
  return (
    <span
      aria-hidden
      className="block rounded-full"
      style={{
        width: '82%',
        height: '82%',
        background: gold
          ? 'radial-gradient(circle at 34% 26%, #fff7d6 2%, #ffd24d 42%, #e8a21c 78%, #b97c0d 100%)'
          : 'radial-gradient(circle at 34% 26%, #ffe9ef 2%, #f2779a 44%, #d9456f 80%, #a62b4d 100%)',
        border: '1.5px solid rgba(92,64,53,.35)',
        boxShadow: win
          ? '0 0 0 2.5px #ffd24d, 0 3px 6px rgba(120,80,55,.4)'
          : '0 1px 1px rgba(120,80,55,.3), 0 3px 5px rgba(120,80,55,.3), inset 0 1px 2px rgba(255,255,255,.55)',
        animation: last ? 'pkland .26s cubic-bezier(.3,1.6,.5,1)' : undefined,
      }}
    >
      <style>{`@keyframes pkland { 0% { transform: scale(.35); opacity: .2 } 70% { transform: scale(1.12) } 100% { transform: scale(1) } }`}</style>
    </span>
  );
}
