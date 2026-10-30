import { BoardStage } from './BoardStage';
import type { BoardProps } from './types';
import CarromBoardCanvas from '../../games/carrom/Board';
import type { CarromState } from '../../games/carrom/rules';

/**
 * The room's view of the carrom table.
 *
 * Thin on purpose: the table itself, its aiming and its animation live in
 * `games/carrom/Board` and are shared with the solo game. The only thing this
 * adds is knowing which colour the local player is.
 */
export default function CarromBoard({ state, youSlot, onMove, interactive, names }: BoardProps<CarromState>) {
  const colour = youSlot === 0 ? 'cream' : 'ebony';
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-center justify-center gap-3 text-[11.5px] text-cream-300">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className={`w-2.5 h-2.5 rounded-full ${youSlot === 0 ? 'bg-[#f6e6c6] ring-2 ring-[#c39a63]' : 'bg-[#3b3029] ring-2 ring-[#120c09]'}`} />
          You play {colour}
        </span>
        <span className="text-cream-500" aria-hidden>·</span>
        <span>{names[0]} vs {names[1]}</span>
      </div>
      <BoardStage ratio={1} max={620} min={260} reserve={92} chrome={6} label="Carrom board">
        <CarromBoardCanvas state={state} youSlot={youSlot} interactive={interactive} onShoot={(shot) => onMove(shot)} />
      </BoardStage>
      <p className="text-[11px] text-cream-400 text-center max-w-[46ch]">
        {interactive
          ? 'Press your half to place the striker, pull back and let go.'
          : 'Waiting for the other player to shoot.'}
      </p>
    </div>
  );
}
