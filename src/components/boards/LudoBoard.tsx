import { BoardStage } from './BoardStage';
import type { BoardProps } from './types';
import { LudoBoard as LudoCanvas } from '../../games/ludo/Board';
import Die from '../../games/ludo/Die';
import { Button, Icon } from '../ui';
import { homeCount, ludoRules, type LudoMove, type LudoState } from '../../games/ludo/rules';

/**
 * The room's view of the Ludo table.
 *
 * Thin, like the carrom one: the board, its animation and its hit-testing live in
 * `games/ludo` and are shared with the solo game. What this adds is the die and
 * the two buttons that spend a turn — roll, or accept that nothing can move.
 */
export default function LudoBoard({ state, youSlot, onMove, interactive, names }: BoardProps<LudoState>) {
  const canRoll = interactive && state.dice === null;
  const mustPass = interactive && state.dice !== null && ludoRules.legalMoves(state, youSlot).every((m) => m.t === 'pass');
  const canMove = interactive && state.dice !== null && !mustPass;
  const you = homeCount(state, youSlot);

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-center justify-center gap-3 text-[11.5px] text-cream-300">
        <span>{names[0]} <span className="text-cream-500">gold</span></span>
        <span className="text-cream-500" aria-hidden>·</span>
        <span>{names[1]} <span className="text-cream-500">rose</span></span>
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
        {canMove && <span className="text-[11.5px] text-cream-300">Tap a glowing token</span>}
        {!interactive && <span className="text-[11.5px] text-cream-400">Waiting for the other player…</span>}
      </div>
    </div>
  );
}
