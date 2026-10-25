import { useMemo, useState } from 'react';
import { mancalaRules as R, myPits, storeOf, type MancalaState } from '../../games/mancala/rules';
import type { BoardProps } from './types';
import { BoardPlate, ScoreChip } from './BoardPlate';
import { BoardStage } from './BoardStage';

const GOLD = '#e8a21c';
const ROSE = '#d9456f';

/**
 * Mancala board.
 *
 * A carved wooden tray: two rows of six pits and a store at each end. The board is
 * drawn from *your* side — your row along the bottom, flowing left to right into
 * your own store — so "counter-clockwise" is something you can see rather than
 * something you have to remember. Each pit shows its count as a number as well as
 * a heap, because counting pebbles at a glance is exactly the skill the game is
 * about and the interface should not do it for you twice.
 */
export default function MancalaBoard({ state, youSlot, onMove, interactive, names }: BoardProps<MancalaState>) {
  const [hover, setHover] = useState<number | null>(null);
  const them = (youSlot === 0 ? 1 : 0) as 0 | 1;
  const legal = useMemo(
    () => new Set(interactive && !state.over && state.turn === youSlot ? R.legalMoves(state, youSlot).map((m) => m.pit) : []),
    [state, youSlot, interactive],
  );
  const sown = useMemo(() => new Set(state.sown), [state.sown]);

  /* my row reads left→right toward my store; theirs reads right→left toward theirs */
  const myRow = myPits(state, youSlot);
  const theirRow = myPits(state, them).slice().reverse();

  return (
    <BoardPlate
      label="Mancala"
      right={
        <div className="flex gap-1.5">
          <ScoreChip label={names[youSlot]} value={state.board[storeOf(state, youSlot)]} accent={GOLD} active={state.turn === youSlot && !state.over} />
          <ScoreChip label={names[them]} value={state.board[storeOf(state, them)]} accent={ROSE} active={state.turn === them && !state.over} />
        </div>
      }
    >
      {/* The tray is one grid: a store, six pits, six pits, a store. Every track is
          a fraction of the stage, so the twelve pits stay round and equal from a
          360 px phone to a 1440 px desktop — before, each pit was
          `clamp(34px,11.4vw,52px)`, which totalled 394 px on a 360 px phone (the
          right-hand store fell off the screen) and 460 px on a desktop. */}
      <BoardStage ratio={7.56 / 2} max={700} min={286} reserve={150} chrome={22}>
      <div
        className="grid gap-[clamp(4px,1.6%,12px)] p-[clamp(5px,1.9%,12px)] rounded-[clamp(12px,2.4%,20px)]"
        style={{
          gridTemplateColumns: '0.78fr repeat(6, minmax(0, 1fr)) 0.78fr',
          gridTemplateRows: 'repeat(2, minmax(0, 1fr))',
          aspectRatio: '7.56 / 2',
          background: 'linear-gradient(165deg,#f6d3a8,#e3b482)',
          border: '3px solid #c99b78',
          boxShadow: 'inset 0 2px 0 rgba(255,255,255,.6), inset 0 -6px 14px rgba(150,100,70,.22)',
        }}
      >
        <div className="row-span-2 min-h-0 min-w-0">
          <Store
            count={state.board[storeOf(state, them)]}
            label={names[them]}
            tone="rose"
            active={state.turn === them && !state.over}
          />
        </div>

        {/* `display: contents` so the pits stay direct grid children (and keep their
            exact tracks) while the two rows still carry a name for a screen
            reader: "Your pits", "Zoe's pits". */}
        <div role="group" aria-label={`${names[them]}'s pits`} className="contents">
          {theirRow.map((i, idx) => (
            <Pit
              key={i}
              count={state.board[i]}
              label={`${names[them]}'s pit, ${state.board[i]} seeds`}
              tone="rose"
              justSown={sown.has(i)}
              /* you can't play these, but hover still reads them as a set */
              onHover={() => setHover(i)}
              onLeave={() => setHover((h) => (h === i ? null : h))}
              style={{ gridColumn: idx + 2, gridRow: 1 }}
            />
          ))}
        </div>

        <div role="group" aria-label="Your pits" className="contents">
          {myRow.map((i, pit) => {
            const can = legal.has(pit);
            return (
              <Pit
                key={i}
                count={state.board[i]}
                label={`Pit ${pit + 1}, ${state.board[i]} seeds${can ? ', playable' : ''}`}
                tone="gold"
                playable={can}
                hovered={hover === i}
                justSown={sown.has(i)}
                onClick={() => can && onMove({ pit })}
                onHover={() => setHover(i)}
                onLeave={() => setHover((h) => (h === i ? null : h))}
                style={{ gridColumn: pit + 2, gridRow: 2 }}
              />
            );
          })}
        </div>

        <div className="row-span-2 min-h-0 min-w-0" style={{ gridColumn: 8 }}>
          <Store
            count={state.board[storeOf(state, youSlot)]}
            label={names[youSlot]}
            tone="gold"
            active={state.turn === youSlot && !state.over}
          />
        </div>
      </div>
      </BoardStage>

      <div className="flex items-center justify-between px-1 pt-2 min-h-[18px]">
        <p className="text-[10.5px] text-cream-500 font-bold">
          {state.over
            ? state.winner === null ? 'Stores level — a draw.' : `${names[state.winner]} has the most seeds.`
            : state.lastCapture > 0 ? `Captured ${state.lastCapture} seeds!` : 'Land in your own store to go again.'}
        </p>
        <p className="text-[10.5px] text-cream-500 tabnum">{state.history.length} turns</p>
      </div>
      <style>{`
        @keyframes pksow { 0% { transform: scale(1) } 40% { transform: scale(1.14) } 100% { transform: scale(1) } }
      `}</style>
    </BoardPlate>
  );
}

function Pit({
  count, label, tone, playable, hovered, justSown, onClick, onHover, onLeave, style,
}: {
  count: number; label: string; tone: 'gold' | 'rose';
  playable?: boolean; hovered?: boolean; justSown?: boolean;
  onClick?: () => void; onHover?: () => void; onLeave?: () => void;
  style?: React.CSSProperties;
}) {
  const seedTone = tone === 'gold' ? GOLD : ROSE;
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      {...(onClick ? { onClick, disabled: !playable, type: 'button' as const } : {})}
      onPointerEnter={onHover}
      onPointerLeave={onLeave}
      aria-label={label}
      className={`board-cell rounded-full transition-all duration-150 no-tap w-full h-full
        ${playable ? 'cursor-pointer' : 'cursor-default'}`}
      style={{
        ...style,
        background: 'radial-gradient(circle at 50% 22%, #fff6e6, #f0d3b0 62%, #dcb68c 100%)',
        border: `2.5px solid ${playable && hovered ? seedTone : '#b98a63'}`,
        boxShadow: playable && hovered
          ? `0 6px 0 -2px ${seedTone}55, inset 0 3px 7px rgba(150,100,70,.34)`
          : 'inset 0 3px 7px rgba(150,100,70,.34)',
        transform: playable && hovered ? 'translateY(-1px)' : undefined,
        animation: justSown ? 'pksow .34s ease-out' : undefined,
      }}
    >
      <span className="display tabnum leading-none text-cream-100 relative z-10" style={{ fontSize: 'clamp(10px, 32cqw, 19px)' }}>{count}</span>
      {count > 0 && (
        <span aria-hidden className="absolute inset-0 grid place-items-center overflow-hidden rounded-full">
          <span className="grid grid-cols-3 gap-[2px] opacity-70 translate-y-[24%]">
            {Array.from({ length: Math.min(9, Math.max(1, count)) }).map((_, i) => (
              <span
                key={i}
                className="rounded-full"
                style={{ width: 3, height: 3, background: seedTone, boxShadow: '0 1px 1px rgba(92,64,53,.35)' }}
              />
            ))}
          </span>
        </span>
      )}
    </Tag>
  );
}

function Store({ count, label, tone, active }: { count: number; label: string; tone: 'gold' | 'rose'; active?: boolean }) {
  const seedTone = tone === 'gold' ? GOLD : ROSE;
  return (
    <div
      className="relative flex flex-col items-center justify-end gap-0.5 rounded-full px-1 py-2 w-full h-full"
      style={{
        /* the store is its own size container (not `.board-cell`, which would
           force `display: grid` over the flex column the pile needs) */
        containerType: 'size',
        background: 'linear-gradient(180deg,#efd0ac,#d9b083)',
        border: `2.5px solid ${active ? seedTone : '#b98a63'}`,
        boxShadow: 'inset 0 4px 10px rgba(150,100,70,.3)',
      }}
      aria-label={`${label}: ${count} seeds`}
      role="img"
    >
      <span className="flex-1 w-full grid place-items-center" aria-hidden>
        <span className="grid grid-cols-2 gap-[2px]">
          {Array.from({ length: Math.min(12, Math.max(0, count)) }).map((_, i) => (
            <span key={i} className="rounded-full" style={{ width: 4, height: 4, background: seedTone }} />
          ))}
        </span>
      </span>
      <span className="display tabnum leading-none text-cream-100" style={{ fontSize: 'clamp(10px, 30cqw, 18px)' }}>{count}</span>
    </div>
  );
}
