import { useMemo, useState } from 'react';
import { connect4Rules as R, dropRow, type C4State } from '../../games/connect4/rules';
import type { BoardProps } from './types';

export default function ConnectFourBoard({ state, youSlot, onMove, interactive }: BoardProps<C4State>) {
  const [hover, setHover] = useState<number | null>(null);
  const legal = useMemo(() => new Set(interactive ? R.legalMoves(state, youSlot).map((m) => m.col) : []), [state, youSlot, interactive]);
  const { cols, rows } = state;
  const size = `min(${Math.floor(78 / cols)}vw, 56px)`;

  return (
    <div className="relative inline-block select-none">
      {/* cabinet shell */}
      <div className="relative p-3 sm:p-4 rounded-[26px]"
        style={{ background: 'linear-gradient(176deg,#ffe9c8,#f3cfa4)', boxShadow: '0 26px 54px -28px rgba(140,94,70,.7), inset 0 2px 0 rgba(255,255,255,.75)', border: '3px solid #c99b78' }}>
        {/* marquee */}
        <div className="flex items-center justify-between px-1 pb-2">
          <span className="text-[9.5px] font-extrabold uppercase tracking-[.22em] text-cream-300">Four in a Row</span>
          {/* Three bulbs, unlit. These used to pulse on an infinite loop beside the
              board, which is exactly the permanent background motion that makes a
              hand-made game feel like a slot machine — and it competed with the
              one thing on this screen that should move, the disc. */}
          <span className="flex gap-1" aria-hidden>{[0, 1, 2].map((i) => <span key={i} className="w-1.5 h-1.5 rounded-full bg-blush-300" />)}</span>
        </div>

        {/* drop slots */}
        {/* px-[13px] matches the inner board's p-2.5 + 3px border, so the drop
            slots sit exactly over their columns instead of 13px to the left. */}
        <div className="grid gap-[5px] mb-1.5 px-[13px]" style={{ gridTemplateColumns: `repeat(${cols}, ${size})` }}>
          {Array.from({ length: cols }).map((_, c) => {
            const ok = legal.has(c);
            return (
              <button key={c} disabled={!ok} onClick={() => onMove({ col: c })}
                onPointerEnter={() => setHover(c)} onPointerLeave={() => setHover(null)}
                aria-label={`Drop in column ${c + 1}${ok ? '' : ' (full)'}`}
                className={`h-9 sm:h-6 grid place-items-center border-b-2 transition-colors no-tap
                  ${ok ? 'border-blush-300 hover:border-blush-600 cursor-pointer' : 'border-ink-500 cursor-not-allowed opacity-40'}`}>
                {ok && hover === c && <Disc who={youSlot} size={18} />}
              </button>
            );
          })}
        </div>

        {/* grid */}
        <div className="relative p-2.5 rounded-[20px]" style={{ background: 'linear-gradient(180deg,#fff1f5,#ffdfe9)', border: '3px solid #e9a7bd' }}>
          <div className="grid gap-[5px]" style={{ gridTemplateColumns: `repeat(${cols}, ${size})` }} role="grid" aria-label="Four in a Row grid">
            {Array.from({ length: rows }).map((_, rIdx) => {
              const r = rows - 1 - rIdx;
              return Array.from({ length: cols }).map((__, c) => {
                const v = state.board[r * cols + c];
                const win = state.winLine?.includes(r * cols + c);
                const isLast = state.lastDrop?.col === c && state.lastDrop?.row === r;
                const colHover = hover === c && legal.has(c) && dropRow(state, c) === r;
                return (
                  <div key={`${r}-${c}`} role="gridcell" className="relative grid place-items-center rounded-full"
                    style={{ width: size, height: size, background: '#fffaf2', boxShadow: 'inset 0 3px 6px rgba(176,124,96,.3)' }}>
                    {v !== null && <Disc who={v} size="86%" win={win} drop={isLast} />}
                    {v === null && colHover && <span className="w-[72%] h-[72%] rounded-full border-2 border-dashed border-blush-400/70" />}
                  </div>
                );
              });
            })}
          </div>
        </div>
        <div className="mt-2.5 h-2.5 rounded-full bg-[#f3cfa4] border-2 border-[#c99b78]" aria-hidden />
      </div>
    </div>
  );
}

function Disc({ who, size, win, drop }: { who: 0 | 1; size: number | string; win?: boolean; drop?: boolean }) {
  const gold = who === 0;
  return (
    <span className="rounded-full grid place-items-center"
      style={{
        width: size, height: size,
        /* the win ring stays CSS so it can sit outside the artwork */
        boxShadow: win ? `0 0 0 3px ${gold ? '#e8a21c' : '#d9456f'}` : undefined,
        borderRadius: 999,
        animation: drop ? 'c4drop .33s cubic-bezier(.4,1.5,.5,1)' : undefined,
      }}>
      <img
        src={gold ? '/art/piece/volt.webp' : '/art/piece/spark.webp'}
        alt="" aria-hidden draggable={false} decoding="async"
        className="block w-full h-full select-none"
        /* two shadows: a tight one that seats the disc in its hole and a wider
           one that lifts it — a single soft shadow just looks like grey haze */
        style={{ filter: 'drop-shadow(0 1px 1px rgba(120,80,55,.35)) drop-shadow(0 3px 4px rgba(120,80,55,.26))' }}
      />
      <style>{`@keyframes c4drop { 0% { transform: translateY(-340%) scaleY(1.18) } 72% { transform: translateY(6%) scaleY(.92) } 100% { transform: none } }`}</style>
    </span>
  );
}
