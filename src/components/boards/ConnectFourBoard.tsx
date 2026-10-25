import { useMemo, useState } from 'react';
import { connect4Rules as R, dropRow, type C4State } from '../../games/connect4/rules';
import type { BoardProps } from './types';
import { BoardGrid, BoardStage } from './BoardStage';

/**
 * Four in a Row.
 *
 * The cabinet used to be sized with `min(78/cols vw, 56px)` per hole, and the
 * drop-slot row was nudged into alignment with a hand-measured `px-[13px]` that
 * matched the inner panel's padding and border. That worked at exactly one cell
 * size: the moment the cell was anything but 56 px the slots drifted off their
 * columns, and on a phone the 7×56 = 392 px grid ran past the screen.
 *
 * Both rows are now fractions of the stage inside the same padded body, so the
 * slots sit over their columns at every width by construction, and the holes are
 * square at any size instead of only at 56 px.
 */
export default function ConnectFourBoard({ state, youSlot, onMove, interactive }: BoardProps<C4State>) {
  const [hover, setHover] = useState<number | null>(null);
  const legal = useMemo(() => new Set(interactive ? R.legalMoves(state, youSlot).map((m) => m.col) : []), [state, youSlot, interactive]);
  const { cols, rows } = state;

  return (
    <BoardStage ratio={cols / rows} max={560} min={268} reserve={136} chrome={104}>
      {/* cabinet shell */}
      <div className="relative p-[clamp(8px,2.2%,18px)] rounded-[clamp(18px,4.4%,26px)]"
        style={{
          background: 'linear-gradient(176deg,#ffe9c8,#f3cfa4)',
          boxShadow: '0 26px 54px -28px rgba(140,94,70,.7), inset 0 2px 0 rgba(255,255,255,.75)',
          border: '3px solid #c99b78',
          ['--c4-gap' as string]: 'clamp(3px,1.1%,6px)',
          ['--c4-inset' as string]: 'calc(clamp(4px,1.4%,10px) + 3px)',
        }}>
        {/* marquee */}
        <div className="flex items-center justify-between px-1 pb-[clamp(4px,1.2%,8px)]">
          <span className="text-[9.5px] font-extrabold uppercase tracking-[.22em] text-cream-300">Four in a Row</span>
          {/* Three bulbs, unlit. These used to pulse on an infinite loop beside the
              board, which is exactly the permanent background motion that makes a
              hand-made game feel like a slot machine — and it competed with the
              one thing on this screen that should move, the disc. */}
          <span className="flex gap-1" aria-hidden>{[0, 1, 2].map((i) => <span key={i} className="w-1.5 h-1.5 rounded-full bg-blush-300" />)}</span>
        </div>

        {/* drop slots — same track list and gap as the hole grid below, so the
            alignment is arithmetic rather than a magic padding */}
        {/* the slot row is inset by exactly the hole panel's padding + border, so a
            slot sits over its column at every size — no measured `px-[13px]` */}
        <div className="grid mb-[clamp(3px,1%,6px)] px-[var(--c4-inset)]"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: 'var(--c4-gap)' }}>
          {Array.from({ length: cols }).map((_, c) => {
            const ok = legal.has(c);
            return (
              <button key={c} disabled={!ok} onClick={() => onMove({ col: c })}
                onPointerEnter={() => setHover(c)} onPointerLeave={() => setHover(null)}
                aria-label={`Drop in column ${c + 1}${ok ? '' : ' (full)'}`}
                className={`h-[28px] grid place-items-center border-b-2 transition-colors no-tap
                  ${ok ? 'border-blush-300 hover:border-blush-600 cursor-pointer' : 'border-ink-500 cursor-not-allowed opacity-40'}`}>
                {ok && hover === c && <Disc who={youSlot} size="86%" />}
              </button>
            );
          })}
        </div>

        {/* holes */}
        <div className="relative p-[clamp(4px,1.4%,10px)] rounded-[clamp(12px,3.4%,20px)]"
          style={{ background: 'linear-gradient(180deg,#fff1f5,#ffdfe9)', border: '3px solid #e9a7bd' }}>
          <BoardGrid cols={cols} rows={rows} gap="var(--c4-gap)" role="grid" aria-label="Four in a Row grid">
            {Array.from({ length: rows }).map((_, rIdx) => {
              const r = rows - 1 - rIdx;
              return Array.from({ length: cols }).map((__, c) => {
                const v = state.board[r * cols + c];
                const win = state.winLine?.includes(r * cols + c);
                const isLast = state.lastDrop?.col === c && state.lastDrop?.row === r;
                const colHover = hover === c && legal.has(c) && dropRow(state, c) === r;
                return (
                  <div key={`${r}-${c}`} role="gridcell" className="relative grid place-items-center rounded-full"
                    style={{ background: '#fffaf2', boxShadow: 'inset 0 3px 6px rgba(176,124,96,.3)' }}>
                    {v !== null && <Disc who={v} size="86%" win={win} drop={isLast} />}
                    {v === null && colHover && <span className="w-[72%] h-[72%] rounded-full border-2 border-dashed border-blush-400/70" />}
                  </div>
                );
              });
            })}
          </BoardGrid>
        </div>
        <div className="mt-[clamp(4px,1.4%,10px)] h-2.5 rounded-full bg-[#f3cfa4] border-2 border-[#c99b78]" aria-hidden />
      </div>
    </BoardStage>
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
