import { useMemo, useState } from 'react';
import { dotsRules as R, isDrawn, sidesOf, type DotsEdge, type DotsState } from '../../games/dots/rules';
import type { BoardProps } from './types';
import { BoardPlate, ScoreChip } from './BoardPlate';

const GOLD = '#e8a21c';
const ROSE = '#d9456f';

/**
 * Dots & Boxes board.
 *
 * Laid out as a true lattice: dots on the odd rows and columns, a tappable line
 * between every neighbouring pair, and a square in the middle of each box that
 * fills with the owner's colour (and a small mark, so ownership never depends on
 * hue alone). The whole board is one CSS grid, which means it scales to any phone
 * without a single absolute coordinate.
 */
export default function DotsBoard({ state, youSlot, onMove, interactive, names }: BoardProps<DotsState>) {
  const [hover, setHover] = useState<string | null>(null);
  const { cols, rows } = state;
  const legal = useMemo(
    () => new Set(interactive && !state.over ? R.legalMoves(state, youSlot).map((e) => `${e.o}${e.i}`) : []),
    [state, youSlot, interactive],
  );
  /* one size drives the whole lattice, so an 8x8-dot board shrinks to fit a phone */
  const span = cols * 2 - 1;
  const unit = `min(${(92 / span).toFixed(2)}vw, ${Math.max(15, Math.floor(320 / span))}px)`;
  const line = unit;
  const dot = `calc(${unit} * 0.55)`;
  const box = unit;
  const hot = (e: DotsEdge) => legal.has(`${e.o}${e.i}`);

  return (
    <BoardPlate
      label="Dots & Boxes"
      right={
        <div className="flex gap-1.5">
          <ScoreChip label={names[0]} value={state.scores[0]} accent={GOLD} active={state.turn === 0 && !state.over} />
          <ScoreChip label={names[1]} value={state.scores[1]} accent={ROSE} active={state.turn === 1 && !state.over} />
        </div>
      }
    >
      <div
        className="rounded-[16px] p-2.5 sm:p-3"
        style={{ background: 'linear-gradient(170deg,#fffaf0,#fff0e0)', border: '2.5px solid #e2c6a6' }}
      >
        <div
          role="grid"
          aria-label={`Dots and boxes, ${cols - 1} by ${rows - 1} boxes`}
          className="grid gap-0"
          style={{
            gridTemplateColumns: `repeat(${cols * 2 - 1}, auto)`,
          }}
        >
          {Array.from({ length: rows * 2 - 1 }).map((_, gr) =>
            Array.from({ length: cols * 2 - 1 }).map((__, gc) => {
              const evenR = gr % 2 === 0, evenC = gc % 2 === 0;
              const key = `${gr}-${gc}`;
              if (evenR && evenC) {
                return (
                  <span key={key} className="grid place-items-center" style={{ width: line, height: dot }} aria-hidden>
                    <span className="rounded-full bg-[#c9a888]" style={{ width: Math.max(5, 6), height: Math.max(5, 6) }} />
                  </span>
                );
              }
              if (evenR && !evenC) {
                const c = (gc - 1) / 2;
                const r = gr / 2;
                const e: DotsEdge = { o: 'h', i: r * (cols - 1) + c };
                const drawn = isDrawn(state, e);
                const owner = drawn ? edgeOwner(state, e) : null;
                const can = hot(e);
                const id = `h${e.i}`;
                return (
                  <button
                    key={key}
                    onClick={() => can && onMove(e)}
                    disabled={!can}
                    onPointerEnter={() => setHover(id)}
                    onPointerLeave={() => setHover((h) => (h === id ? null : h))}
                    aria-label={`Horizontal line, row ${r + 1}, column ${c + 1}${drawn ? ', drawn' : ''}`}
                    className={`group grid place-items-center no-tap ${can ? 'cursor-pointer' : 'cursor-default'}`}
                    style={{ width: line, height: dot }}
                  >
                    <span
                      aria-hidden
                      className="rounded-full transition-all"
                      style={{
                        width: drawn ? '100%' : hover === id && can ? '84%' : '0%',
                        height: 5,
                        background: drawn ? (owner === 0 ? GOLD : owner === 1 ? ROSE : '#c9a888') : 'rgba(217,69,111,.45)',
                      }}
                    />
                  </button>
                );
              }
              if (!evenR && evenC) {
                const r = (gr - 1) / 2;
                const c = gc / 2;
                const e: DotsEdge = { o: 'v', i: r * cols + c };
                const drawn = isDrawn(state, e);
                const owner = drawn ? edgeOwner(state, e) : null;
                const can = hot(e);
                const id = `v${e.i}`;
                return (
                  <button
                    key={key}
                    onClick={() => can && onMove(e)}
                    disabled={!can}
                    onPointerEnter={() => setHover(id)}
                    onPointerLeave={() => setHover((h) => (h === id ? null : h))}
                    aria-label={`Vertical line, row ${r + 1}, column ${c + 1}${drawn ? ', drawn' : ''}`}
                    className={`grid place-items-center no-tap ${can ? 'cursor-pointer' : 'cursor-default'}`}
                    style={{ width: dot, height: line }}
                  >
                    <span
                      aria-hidden
                      className="rounded-full transition-all"
                      style={{
                        height: drawn ? '100%' : hover === id && can ? '84%' : '0%',
                        width: 5,
                        background: drawn ? (owner === 0 ? GOLD : owner === 1 ? ROSE : '#c9a888') : 'rgba(217,69,111,.45)',
                      }}
                    />
                  </button>
                );
              }
              // a box
              const br = (gr - 1) / 2, bc = (gc - 1) / 2;
              const b = br * (cols - 1) + bc;
              const owner = state.boxes[b];
              const close = sidesOf(state, b) === 3;
              return (
                <div
                  key={key}
                  role="gridcell"
                  aria-label={`Box row ${br + 1}, column ${bc + 1}${owner === null ? ', unclaimed' : owner === 0 ? `, ${names[0]}` : `, ${names[1]}`}`}
                  className="grid place-items-center rounded-[3px] transition-colors"
                  style={{
                    width: box,
                    height: box,
                    background: owner === 0 ? 'rgba(255,210,77,.34)' : owner === 1 ? 'rgba(242,119,154,.26)' : 'transparent',
                  }}
                >
                  {owner !== null && (
                    <span aria-hidden className="text-[10px] leading-none" style={{ color: owner === 0 ? GOLD : ROSE }}>{owner === 0 ? '★' : '♥'}</span>
                  )}
                  {owner === null && close && <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-blush-400/50" />}
                </div>
              );
            }),
          )}
        </div>
      </div>
      <div className="flex items-center justify-between px-1 pt-2 min-h-[18px]">
        <p className="text-[10.5px] text-cream-500 font-bold">
          {state.over
            ? state.winner === null ? 'All boxes split — a draw.' : `${names[state.winner]} takes the grid.`
            : state.lastGain > 0 ? `${state.lastGain} box${state.lastGain === 1 ? '' : 'es'} — go again!` : 'Close the fourth side to claim a box.'}
        </p>
        <p className="text-[10.5px] text-cream-500 tabnum">{state.history.length} lines</p>
      </div>
    </BoardPlate>
  );
}

/** Which player drew an edge. Edges don't store an owner, so we infer from the boxes
    they touch; an edge that touches no claimed box is drawn in a neutral tone. */
function edgeOwner(s: DotsState, e: DotsEdge): 0 | 1 | null {
  const bw = s.cols - 1;
  const r = e.o === 'h' ? Math.floor(e.i / bw) : Math.floor(e.i / s.cols);
  const c = e.o === 'h' ? e.i % bw : e.i % s.cols;
  const near: number[] = [];
  if (e.o === 'h') {
    if (r > 0) near.push((r - 1) * bw + c);
    if (r < s.rows - 1) near.push(r * bw + c);
  } else {
    if (c > 0) near.push(r * bw + c - 1);
    if (c < bw) near.push(r * bw + c);
  }
  for (const b of near) if (s.boxes[b] !== null) return s.boxes[b] as 0 | 1;
  return null;
}
