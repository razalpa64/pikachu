import { useMemo } from 'react';
import { tictactoeRules as R, type TTTState } from '../../games/tictactoe/rules';
import type { BoardProps } from './types';


export default function TicTacToeBoard({ state, youSlot, onMove, interactive, hint }: BoardProps<TTTState>) {
  const legal = useMemo(() => new Set(interactive ? R.legalMoves(state, youSlot).map((m) => m.cell) : []), [state, youSlot, interactive]);
  const n = state.size;
  const cell = n <= 3 ? 'min(26vw,112px)' : n === 4 ? 'min(20vw,88px)' : 'min(16vw,72px)';

  return (
    <div className="relative inline-block">
      {/* chamber plate */}
      <div className="absolute -inset-5 rounded-[28px] opacity-95" aria-hidden
        style={{ background: 'linear-gradient(170deg,#fff6e6,#ffe9d6)', border: '3px solid #e9c7a6', boxShadow: '0 24px 50px -28px rgba(140,94,70,.6), inset 0 2px 0 rgba(255,255,255,.8)' }} />
      <div className="relative grid gap-[7px] p-1" role="grid" aria-label={`${n} by ${n} board`}
        style={{ gridTemplateColumns: `repeat(${n}, ${cell})` }}>
        {state.cells.map((v, i) => {
          const win = state.winLine?.includes(i);
          const playable = legal.has(i);
          const last = state.moves[state.moves.length - 1] === i;
          return (
            <button key={i} role="gridcell" disabled={!playable} onClick={() => onMove({ cell: i })}
              aria-label={`Row ${Math.floor(i / n) + 1}, column ${(i % n) + 1}${v === null ? ', empty' : v === 0 ? ', Volt' : ', Spark'}`}
              className={`relative grid place-items-center rounded-2xl border-[2.5px] transition-all duration-150 no-tap
                ${win ? 'border-blush-600 bg-blush-200' : last ? 'border-blush-300 bg-blush-100' : 'border-ink-500 bg-white'}
                ${playable ? 'hover:border-blush-300 hover:bg-blush-100 hover:-translate-y-[2px] cursor-pointer' : 'cursor-default'}`}
              style={{ width: cell, height: cell }}>
              {v === null ? (
                playable && hint ? <span className="opacity-0 hover:opacity-35 transition-opacity">{youSlot === 0 ? <VoltMark size={n <= 3 ? 52 : 38} /> : <SparkMark size={n <= 3 ? 52 : 38} />}</span> : null
              ) : v === 0 ? <VoltMark size={n <= 3 ? 58 : n === 4 ? 44 : 36} glow={win} /> : <SparkMark size={n <= 3 ? 58 : n === 4 ? 44 : 36} glow={win} />}
              {win && <span className="absolute inset-0 rounded-2xl border-[3px] border-blush-600 animate-pulse pointer-events-none" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Slot 0 plays a butter star, slot 1 plays a blush heart — the same pair that
    appears on the painted Tic-Tac-Toe cover. Shape, not just colour, carries the
    distinction, so the board never signals state by hue alone. */
/**
 * The two marks. These were hand-written SVG paths; they are painted tokens
 * now. Same props, same sizes, so every call site is untouched.
 */
function Token({ src, alt, size, glow, tint }: { src: string; alt: string; size: number; glow?: boolean; tint: string }) {
  return (
    <img
      src={src} alt="" aria-hidden width={size} height={size} draggable={false}
      className="a-pop block select-none"
      style={{
        width: size, height: size,
        filter: glow ? `drop-shadow(0 4px 7px ${tint})` : 'drop-shadow(0 2px 3px rgba(140,94,70,.28))',
      }}
      data-mark={alt}
    />
  );
}

export function VoltMark({ size = 54, glow }: { size?: number; glow?: boolean }) {
  return <Token src="/art/piece/volt.webp" alt="volt" size={size} glow={glow} tint="rgba(232,162,28,.6)" />;
}
export function SparkMark({ size = 54, glow }: { size?: number; glow?: boolean }) {
  return <Token src="/art/piece/spark.webp" alt="spark" size={size} glow={glow} tint="rgba(217,69,111,.55)" />;
}
