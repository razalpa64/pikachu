import { BoardStage } from './BoardStage';
import type { BoardProps } from './types';
import { LudoBoard as LudoCanvas } from '../../games/ludo/Board';
import Die from '../../games/ludo/Die';
import { Button, Icon } from '../ui';
import { homeCount, ludoRules, movableTokens, type LudoMove, type LudoState } from '../../games/ludo/rules';
import { SEAT_PAINT } from '../../games/ludo/paint';

/**
 * The room's view of the Ludo table.
 *
 * Thin, like the carrom one: the board, its animation and its hit-testing live in
 * `games/ludo` and are shared with the solo game. What this adds is the die and
 * the two buttons that spend a turn — roll, or accept that nothing can move.
 */
export default function LudoBoard({ state, youSlot, onMove, interactive, names }: BoardProps<LudoState>) {
  const canRoll = interactive && state.dice === null;
  /* `[].every(...)` is true, so an empty legal list must never be read as
     "nothing to move" — that is how the local game locked itself up. */
  const legal = interactive && state.dice !== null ? ludoRules.legalMoves(state, youSlot) : [];
  const mustPass = legal.length > 0 && legal.every((m) => m.t === 'pass');
  const movable = interactive && state.dice !== null ? movableTokens(state, youSlot, state.dice) : [];
  const canMove = movable.length > 0;
  const you = homeCount(state, youSlot);
  const seatPaint = SEAT_PAINT[youSlot === 0 ? 0 : 2];

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-center justify-center gap-2 text-[11.5px] text-cream-300">
        <span className="flex items-center gap-1">
          <span aria-hidden className="w-2 h-2 rounded-full" style={{ background: SEAT_PAINT[0].mid }} />
          {names[0]}
        </span>
        <span className="text-cream-500" aria-hidden>·</span>
        <span className="flex items-center gap-1">
          <span aria-hidden className="w-2 h-2 rounded-full" style={{ background: SEAT_PAINT[2].mid }} />
          {names[1]}
        </span>
        <span className="text-cream-500" aria-hidden>·</span>
        <span>{you}/4 home</span>
      </div>

      <BoardStage ratio={1} max={620} min={270} reserve={150} chrome={6} label="Ludo board">
        <LudoCanvas state={state} youSlot={youSlot} interactive={interactive} onMove={(m: LudoMove) => onMove(m)} />
      </BoardStage>

      <div className="flex items-center justify-center gap-3">
        <Die value={state.dice} size={46} />
        {canRoll && (
          <Button size="sm" variant="primary" onClick={() => onMove({ t: 'roll' })} icon={<Icon name="spark" size={13} />}>
            Roll
          </Button>
        )}
        {mustPass && (
          <Button size="sm" variant="primary" onClick={() => onMove({ t: 'pass' })} icon={<Icon name="chevron-right" size={13} />}>
            Nothing to move — pass
          </Button>
        )}
        {canMove && !mustPass && <span className="text-[11.5px] text-cream-300">Tap a glowing token</span>}
        {!interactive && <span className="text-[11.5px] text-cream-400">Waiting for the other player…</span>}
      </div>

      {/* the same moves as buttons, for keyboards and screen readers */}
      {canMove && (
        <div className="flex flex-wrap items-center justify-center gap-1.5" role="group" aria-label={`Move a token ${state.dice}`}>
          {movable.map((token) => {
            const at = state.tokens[youSlot][token];
            const where = at < 0 ? 'yard' : at >= 56 ? 'home' : `${56 - at} to home`;
            return (
              <button
                key={token}
                type="button"
                onClick={() => onMove({ t: 'move', token })}
                aria-label={`Move token ${token + 1} — ${where}`}
                className="flex items-center gap-1.5 rounded-full border border-volt-600 bg-volt-100/50 px-2.5 py-1 text-[11.5px] font-semibold text-ink-900 hover:bg-volt-200"
              >
                <span aria-hidden className="w-2.5 h-2.5 rounded-full" style={{ background: seatPaint.mid }} />
                Token {token + 1}
                <span className="text-[10px] font-normal opacity-75 tabnum">{where}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
