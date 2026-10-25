import { useMemo } from 'react';
import { tictactoeRules as R, type TTTState } from '../../games/tictactoe/rules';
import type { BoardProps } from './types';
import { BoardGrid, BoardStage } from './BoardStage';

/**
 * Tic-Tac-Toe / Nine Grids.
 *
 * The old board hard-coded a px cell per size — `min(26vw,112px)` at 3×3,
 * `min(16vw,72px)` at 5×5 — and hung a `-inset-5` cream plate *outside* that
 * width. On a 360 px phone the 5×5 grid was 5×72 + gaps = 388 px before the
 * plate's own 20 px lips, so the plate bled off both edges of the screen. On a
 * desktop the same rules capped a 3×3 board at 336 px in a 1120 px column.
 *
 * Now the stage owns the size (see BoardStage) and the cells are fractions of
 * it, so the grid is square, the plate is inside the stage, and the marks scale
 * with their square instead of being pinned to 58 px whatever the cell is.
 */
export default function TicTacToeBoard({ state, youSlot, onMove, interactive, hint }: BoardProps<TTTState>) {
  const legal = useMemo(() => new Set(interactive ? R.legalMoves(state, youSlot).map((m) => m.cell) : []), [state, youSlot, interactive]);
  const n = state.size;
  const max = n <= 3 ? 430 : n === 4 ? 500 : 540;

  return (
    <BoardStage ratio={1} max={max} min={n <= 3 ? 236 : 280} reserve={132} label={`${n} by ${n} board`}>
      {/* the chamber plate now *contains* the grid instead of sitting behind it */}
      <div
        className="relative rounded-[clamp(16px,3.4%,28px)] p-[clamp(6px,2.4%,16px)]"
        style={{
          background: 'linear-gradient(170deg,#fff6e6,#ffe9d6)',
          border: '3px solid #e9c7a6',
          boxShadow: '0 24px 50px -28px rgba(140,94,70,.6), inset 0 2px 0 rgba(255,255,255,.8)',
        }}
      >
        <BoardGrid cols={n} gap="clamp(5px,1.9%,11px)" role="grid" aria-label={`${n} by ${n} board`}>
          {state.cells.map((v, i) => {
            const win = state.winLine?.includes(i);
            const playable = legal.has(i);
            const last = state.moves[state.moves.length - 1] === i;
            return (
              <button key={i} role="gridcell" disabled={!playable} onClick={() => onMove({ cell: i })}
                aria-label={`Row ${Math.floor(i / n) + 1}, column ${(i % n) + 1}${v === null ? ', empty' : v === 0 ? ', Volt' : ', Spark'}`}
                className={`group board-cell rounded-[clamp(9px,13%,20px)] border-[2.5px] transition-all duration-150 no-tap
                  ${win ? 'border-blush-600 bg-blush-200' : last ? 'border-blush-300 bg-blush-100' : 'border-ink-500 bg-white'}
                  ${playable ? 'hover:border-blush-300 hover:bg-blush-100 hover:-translate-y-[2px] cursor-pointer' : 'cursor-default'}`}>
                {v === null ? (
                  /* A ghost of your mark on a legal square. It used to appear on hover
                     only, which meant a phone — where there is no hover — never saw the
                     hint at all despite the setting being on. Now it is faintly there
                     from the start and darkens on hover or keyboard focus. */
                  playable && hint ? (
                    <span className="block w-[70%] aspect-square opacity-[.14] group-hover:opacity-35 group-focus-visible:opacity-40 transition-opacity">
                      {youSlot === 0 ? <VoltMark size="100%" /> : <SparkMark size="100%" />}
                    </span>
                  ) : null
                ) : v === 0 ? <VoltMark size="76%" glow={win} /> : <SparkMark size="76%" glow={win} />}
                {win && <span className="absolute inset-0 rounded-[clamp(9px,13%,20px)] border-[3px] border-blush-600 animate-pulse pointer-events-none" />}
              </button>
            );
          })}
        </BoardGrid>
      </div>
    </BoardStage>
  );
}

/** Slot 0 plays a butter star, slot 1 plays a blush heart — the same pair that
    appears on the painted Tic-Tac-Toe cover. Shape, not just colour, carries the
    distinction, so the board never signals state by hue alone. */
/**
 * The two marks. These were hand-written SVG paths; they are painted tokens
 * now. `size` takes a number where a fixed mark is wanted (the scoreboard) and a
 * CSS length where the mark should follow its square.
 */
function Token({ src, alt, size, glow, tint, className }: { src: string; alt: string; size: number | string; glow?: boolean; tint: string; className?: string }) {
  return (
    <img
      src={src} alt="" aria-hidden draggable={false}
      width={typeof size === 'number' ? size : undefined}
      height={typeof size === 'number' ? size : undefined}
      className={`a-pop block select-none mx-auto ${className ?? ''}`}
      style={{
        width: size, height: size,
        filter: glow ? `drop-shadow(0 4px 7px ${tint})` : 'drop-shadow(0 2px 3px rgba(140,94,70,.28))',
      }}
      data-mark={alt}
    />
  );
}

export function VoltMark({ size = 54, glow }: { size?: number | string; glow?: boolean }) {
  return <Token src="/art/piece/volt.webp" alt="volt" size={size} glow={glow} tint="rgba(232,162,28,.6)" />;
}
export function SparkMark({ size = 54, glow }: { size?: number | string; glow?: boolean }) {
  return <Token src="/art/piece/spark.webp" alt="spark" size={size} glow={glow} tint="rgba(217,69,111,.55)" />;
}
