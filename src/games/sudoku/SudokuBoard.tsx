import { useEffect, useRef } from 'react';
import { CELLS, SIZE, cellLabel } from './engine';

/**
 * The 9×9 grid, and nothing else.
 *
 * Kept separate from the screen so the screen can own the rules and this can own
 * the pixels — and so the same board can be reused by whatever comes next
 * (a head-to-head sudoku race, for one) without dragging the daily task system
 * along with it.
 *
 * Three things are deliberate:
 *   • the grid is a real `role="grid"` of buttons, so it is reachable and
 *     readable by a screen reader and by the keyboard, not just by a finger;
 *   • every visual state is a border, a background or a shadow — no layout shift
 *     when a digit arrives or a mistake appears;
 *   • the phone size is driven by the viewport with `clamp`, because nine cells
 *     across 360 px is the tightest this game ever gets and it must still be
 *     tappable there.
 */
export interface BoardCell { v: number; notes: number[] }

export default function SudokuBoard({
  cells, given, bad, selected, onSelect,
}: {
  cells: BoardCell[];
  given: boolean[];
  /** cells that are wrong or break a rule right now */
  bad: Set<number>;
  selected: number | null;
  onSelect: (i: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const selectedDigit = selected != null ? cells[selected]?.v ?? 0 : 0;

  /* Focus follows the selection so arrow keys keep working after a tap. */
  useEffect(() => {
    if (selected == null) return;
    const el = ref.current?.querySelector<HTMLButtonElement>(`[data-cell="${selected}"]`);
    if (el && document.activeElement !== el && el.contains(document.activeElement) === false) el.focus({ preventScroll: true });
  }, [selected]);

  return (
    <div
      className="w-full mx-auto rounded-[16px] p-[5px] sm:p-[7px] select-none"
      style={{
        /* as large as the page can afford, never so large that the number pad
           drops below the fold — the board and its pad are one control */
        width: 'min(100%, 520px, max(300px, calc(100dvh - 430px)))',
        background: 'linear-gradient(155deg,#f8ead4,#ecd2ac 55%,#e2c093)',
        boxShadow: '0 18px 38px -22px rgba(60,36,12,.55), inset 0 1px 0 #fff8ec, inset 0 -2px 0 rgba(120,84,40,.18)',
      }}
    >
      <div
        ref={ref}
        role="grid"
        aria-label="Sudoku grid"
        aria-rowcount={SIZE}
        aria-colcount={SIZE}
        className="grid grid-cols-9 rounded-[11px] overflow-hidden bg-[#fffdf8]"
        style={{ boxShadow: 'inset 0 0 0 1.5px #7a5628' }}
      >
        {Array.from({ length: CELLS }, (_, i) => {
          const r = (i / SIZE) | 0;
          const c = i % SIZE;
          const cell = cells[i];
          const isGiven = given[i];
          const isBad = bad.has(i);
          const isSel = selected === i;
          const isPeer = selected != null && !isSel && (
            ((selected / SIZE) | 0) === r || selected % SIZE === c ||
            ((((selected / SIZE) | 0) / 3 | 0) === ((r / 3) | 0) && (((selected % SIZE) / 3 | 0) === ((c / 3) | 0)))
          );
          const sameDigit = selectedDigit > 0 && cell.v === selectedDigit && !isSel;

          const bg = isSel ? '#ffe6a8'
            : isBad ? '#ffe1e1'
            : sameDigit ? '#fff0c9'
            : isPeer ? '#fbf2e2'
            : '#fffdf8';

          return (
            <button
              key={i}
              data-cell={i}
              role="gridcell"
              aria-selected={isSel}
              aria-label={cellLabel(cells.map((x) => x.v), given, cells.map((x) => x.notes), i)}
              aria-readonly={isGiven}
              tabIndex={isSel || (selected == null && i === 0) ? 0 : -1}
              onClick={() => onSelect(i)}
              className="sudoku-cell relative aspect-square grid place-items-center outline-none"
              style={{
                background: bg,
                borderRight: c === SIZE - 1 ? undefined : c % 3 === 2 ? '1.5px solid #7a5628' : '1px solid #e7d3b6',
                borderBottom: r === SIZE - 1 ? undefined : r % 3 === 2 ? '1.5px solid #7a5628' : '1px solid #e7d3b6',
                /* the amber ring is the selection *and* the focus indicator:
                   the global blush outline drew outside the hand-drawn grid */
                boxShadow: isSel ? 'inset 0 0 0 2.5px #8a5406' : undefined,
                transition: 'background-color 90ms linear',
              }}
            >
              {cell.v > 0 ? (
                <span
                  className="tabnum leading-none font-semibold"
                  style={{
                    fontSize: 'clamp(16px,4.7vw,27px)',
                    color: isBad ? '#b3261e' : isGiven ? '#33241a' : '#1d6fa5',
                    fontWeight: isGiven ? 700 : 600,
                    textShadow: isGiven ? '0 0.5px 0 rgba(255,255,255,.7)' : undefined,
                  }}
                >{cell.v}</span>
              ) : cell.notes.length > 0 ? (
                <span className="grid grid-cols-3 gap-0 w-full h-full p-[1px]" aria-hidden>
                  {Array.from({ length: 9 }, (_, k) => (
                    <span
                      key={k}
                      className="grid place-items-center leading-none tabnum"
                      style={{ fontSize: 'clamp(6.5px,1.95vw,10.5px)', color: cell.notes.includes(k + 1) ? '#8a7256' : 'transparent' }}
                    >{k + 1}</span>
                  ))}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
