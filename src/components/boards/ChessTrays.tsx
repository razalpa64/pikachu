import { memo, useMemo } from 'react';
import { balanceLabel, materialFromFen, type Colour } from '../../games/chess/material';
import ChessPiece from './ChessPiece';

/**
 * The captured-pieces tray for a two-player board.
 *
 * Layout is one row per player, which is what every chess client settles on for
 * a reason: it survives a 360px phone, it puts your own row nearest your own
 * clock, and both players read the same two rows in the same order (top row =
 * the trainer in seat 0) so "they took my knight" and "I took their knight" can
 * never be confused for each other.
 *
 * Each row says three things, left to right:
 *   • whose tray it is (their seat colour + name)
 *   • the pieces they have taken, in the opponent's colours — an empty tray is
 *     drawn as a hairline placeholder so the row does not jump when the first
 *     capture lands
 *   • their material balance, `+3` in the leader's row and `−3` in the other,
 *     because a lone "+3" makes the reader work out whose advantage it is.
 */

const SEAT = [
  { dot: '#f0b429', name: 'Trainer' },
  { dot: '#4a9fd8', name: 'Trainer' },
];

function Tray({
  colour, name, pieces, balance, ahead, you, clock,
}: {
  colour: Colour;
  name: string;
  /** pieces this player has taken — always drawn in the *opponent's* colour */
  pieces: string[];
  balance: number;
  ahead: boolean;
  you: boolean;
  clock?: string;
}) {
  const enemy: Colour = colour === 'w' ? 'b' : 'w';
  return (
    /* Fixed columns, not a free flex row: the two trays have to line up so the
       eye can compare them, and a name that grows pushes one row's clock out of
       step with the other's. The pieces column takes the slack. */
    <div className={`grid grid-cols-[minmax(64px,0.85fr)_minmax(0,1.6fr)_auto_auto] items-center gap-x-2 sm:gap-x-3 min-w-0 rounded-lg px-1.5 py-1
      ${you ? 'bg-volt-200/45' : ''}`}>
      <span className="flex items-center gap-1.5 min-w-0">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: SEAT[colour === 'w' ? 0 : 1].dot }} aria-hidden />
        <span className={`text-[11.5px] font-extrabold truncate ${you ? 'text-cream-100' : 'text-cream-300'}`}>
          {name}
        </span>
        {/* no "you" chip: at 390px it pushed the name into an ellipsis. The row
            is tinted instead, which reads at a glance and costs no width. */}
        {you && <span className="sr-only">(you)</span>}
      </span>

      {/* the pieces themselves */}
      <span className="flex items-center gap-[1px] min-w-0 overflow-hidden" aria-hidden={pieces.length === 0}>
        {pieces.length === 0
          ? <span className="text-[11px] text-cream-400" aria-hidden>—</span>
          : pieces.map((t, i) => (
            <span key={`${t}${i}`} className="shrink-0" style={{ marginLeft: i === 0 ? 0 : -3 }}>
              <ChessPiece type={t} colour={enemy} size={16} />
            </span>
          ))}
      </span>

      <span
        className={`justify-self-end text-[11px] font-extrabold tabnum px-1.5 py-0.5 rounded-md border
          ${ahead
            ? 'text-leaf-700 border-leaf-400/70 bg-leaf-400/15'
            : balance === 0 ? 'text-cream-400 border-transparent' : 'text-ember-600 border-ember-400/40 bg-ember-400/10'}`}
        title={balance === 0 ? 'Material is level' : `${ahead ? 'Ahead' : 'Behind'} by ${Math.abs(balance)} in material`}
      >
        {balanceLabel(balance)}
      </span>

      {clock
        ? <span className="justify-self-end text-[11.5px] font-mono font-bold text-cream-300 tabnum">{clock}</span>
        : <span />}
      <span className="sr-only">
        {`${name}${you ? ' (you)' : ''} `}
        {pieces.length
          ? `has taken ${pieces.map((p) => NAME[p] ?? 'piece').join(', ')}`
          : 'has taken nothing yet'}
        {balance === 0 ? ', material is level' : `, ${ahead ? 'ahead' : 'behind'} by ${Math.abs(balance)}`}
      </span>
    </div>
  );
}

const NAME: Record<string, string> = { p: 'a pawn', n: 'a knight', b: 'a bishop', r: 'a rook', q: 'a queen' };

export const ChessTrays = memo(function ChessTrays({
  fen, youSlot, names, clock,
}: {
  fen: string;
  /** 0 or 1 — which seat the viewer holds, so "you" is on the right row */
  youSlot: number;
  names: string[];
  clock?: [number, number];
}) {
  const m = useMemo(() => materialFromFen(fen), [fen]);
  const fmt = (ms?: number) => {
    if (ms == null) return undefined;
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  return (
    <div className="w-full flex flex-col gap-1" aria-label="Captured pieces">
      {(['w', 'b'] as const).map((colour, seat) => (
        <Tray
          key={colour}
          colour={colour}
          name={names[seat] || SEAT[seat].name}
          pieces={m[colour].captured}
          balance={m[colour].balance}
          ahead={m.edge.side === colour && m.edge.points > 0}
          you={youSlot === seat}
          clock={fmt(clock?.[seat])}
        />
      ))}
    </div>
  );
});

export default ChessTrays;
