import { useMemo, useState, useEffect } from 'react';
import { checkersRules as R, isDark, type CKState } from '../../games/checkers/rules';
import type { BoardProps } from './types';
import { BoardGrid, BoardStage } from './BoardStage';
import { useStore } from '../../lib/store';

export default function CheckersBoard({ state, youSlot, onMove, interactive, hint = true }: BoardProps<CKState>) {
  const { sfx } = useStore();
  const [sel, setSel] = useState<number | null>(null);
  const legal = useMemo(() => (interactive ? R.legalMoves(state, youSlot) : []), [state, youSlot, interactive]);

  useEffect(() => {
    if (state.mustContinueFrom !== null) setSel(state.mustContinueFrom);
    else setSel(null);
  }, [state.mustContinueFrom, state.board]);

  const froms = useMemo(() => new Set(legal.map((m) => m.from)), [legal]);
  const targets = useMemo(() => legal.filter((m) => m.from === sel).map((m) => m.to), [legal, sel]);
  const flipped = youSlot === 1;

  const cells = Array.from({ length: 64 }, (_, i) => i);
  const ordered = flipped ? [...cells].reverse() : cells;

  const tap = (i: number) => {
    if (!interactive) return;
    if (sel !== null && targets.includes(i)) {
      const jump = Math.abs(i - sel) > 9;
      sfx(jump ? 'capture' : 'move');
      onMove({ from: sel, to: i });
      if (!jump) setSel(null);
      return;
    }
    if (froms.has(i)) { setSel(i === sel ? null : i); sfx('hover'); return; }
    if (state.mustContinueFrom === null) setSel(null);
  };

  return (
    /* same stage as chess: the two 8x8 boards now share one geometry, so they
       line up with each other and neither overflows a phone */
    <BoardStage ratio={1} max={600} min={288} reserve={148} chrome={26} label="Checkers board">
      <div className="relative p-[clamp(5px,1.6%,14px)] rounded-[clamp(14px,4%,22px)]"
        style={{ background: 'linear-gradient(170deg,#f6e0c0,#e8c9a0)', border: '3px solid #c99b78', boxShadow: '0 26px 54px -28px rgba(140,94,70,.65), inset 0 2px 0 rgba(255,255,255,.7)' }}>
        <BoardGrid cols={8} gap="0" role="grid" aria-label="Checkers board" className="board-shadow overflow-hidden"
          style={{ borderRadius: 'clamp(3px, 1.2%, 9px)' }}>
          {ordered.map((i) => {
            const dark = isDark(i);
            const pc = state.board[i];
            const isSel = sel === i;
            const isTarget = targets.includes(i);
            const isLast = state.lastMove?.includes(i);
            return (
              <button key={i} role="gridcell" onClick={() => tap(i)} disabled={!dark}
                aria-label={`Square ${i}${pc ? `, ${pc.p === 0 ? 'gold' : 'charcoal'}${pc.king ? ' king' : ''}` : ', empty'}`}
                className="board-cell no-tap"
                style={{
                  background: !dark ? '#fff6e6' : isSel ? '#ffd24d' : isTarget ? '#b7e6cf' : isLast ? '#f0bfa0' : '#dcb38a',
                  cursor: interactive && dark && (froms.has(i) || isTarget) ? 'pointer' : 'default',
                }}>
                {pc && (
                  <span className="relative grid place-items-center rounded-full transition-transform"
                    style={{
                      width: '84%', height: '84%',
                      boxShadow: isSel ? '0 0 0 3px rgba(217,69,111,.6)' : undefined,
                      borderRadius: 999,
                      transform: isSel ? 'translateY(-2px) scale(1.04)' : undefined,
                    }}>
                    <img
                      src={pc.p === 0 ? '/art/piece/checker-gold.webp' : '/art/piece/checker-blush.webp'}
                      alt="" aria-hidden draggable={false} decoding="async"
                      className="absolute inset-0 w-full h-full select-none"
                      style={{ filter: isSel
                        ? 'drop-shadow(0 5px 6px rgba(120,80,55,.45))'
                        : 'drop-shadow(0 3px 4px rgba(120,80,55,.38))' }}
                    />
                    {pc.king && (
                      /* a crown that reads at 30px: three points, a band under them, and a
                         cocoa outline heavy enough to hold on both coin colours */
                      <svg className="absolute" viewBox="0 0 24 21" aria-hidden
                        style={{ width: '52%', height: '45.5%', filter: 'drop-shadow(0 1px 1px rgba(120,80,55,.35))' }}>
                        <g fill={pc.p === 0 ? '#fffdf2' : '#fff2f6'}
                          stroke={pc.p === 0 ? '#9a6408' : '#a8425f'} strokeWidth="1.7"
                          strokeLinejoin="round" strokeLinecap="round">
                          <path d="M3.2 14.6 4.4 4.6l4.6 3.6L12 2.9l3 5.3 4.6-3.6 1.2 10z" />
                          <rect x="3.2" y="15.2" width="17.6" height="3.1" rx="1.3" />
                        </g>
                      </svg>
                    )}
                  </span>
                )}
                {hint && isTarget && !pc && <span className="absolute w-[30%] h-[30%] rounded-full bg-volt-300/80" />}
                {hint && isTarget && pc && <span className="absolute inset-[8%] rounded-full border-[3px] border-volt-300/85" />}
              </button>
            );
          })}
        </BoardGrid>
      </div>
      {/* was `-bottom-7`, which sat on top of the rulebook toggle below the board;
          inside the stage it stacks under the plinth like a printed note */}
      {state.mustContinueFrom !== null && (
        <p className="mt-2 text-center text-[11.5px] font-extrabold uppercase tracking-wider text-volt-700">
          Chain jump — keep capturing
        </p>
      )}
    </BoardStage>
  );
}
