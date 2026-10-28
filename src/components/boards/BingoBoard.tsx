import { memo, useMemo } from 'react';
import type { BingoState } from '../../games/bingo/rules';
import { CARD_COLS, FREE_INDEX, LINES, ballLabel, offer } from '../../games/bingo/rules';
import type { BoardProps } from './types';
import { BoardStage } from './BoardStage';
import { Icon } from '../ui';
import { PikachuMascot } from '../../mascot';
import { useStore } from '../../lib/store';

/**
 * The bingo table.
 *
 * Two cards, always both visible: the tension in this game is watching somebody
 * else's row fill up one number ahead of your own, and a card you have to open a
 * tab to see is not a game. The caller's choice sits *between* the two cards —
 * the two balls on offer are the only buttons on the screen, and each one is
 * stamped with the truth about whether it helps you.
 *
 * Every marked square is gold and every unmarked one is paper. That is the one
 * distinction that has to survive a phone in daylight, so nothing else competes
 * with it: no gradients on the numbers, no emoji, no animation on the card except
 * the winning line.
 */

const LETTER_TINT = ['#bd2756', '#c98a16', '#17795a', '#2b7fae', '#7b4fa8'];
const LETTERS = ['B', 'I', 'N', 'G', 'O'];

const countUnmarked = (card: { numbers: number[] }, marks: boolean[]) =>
  marks.filter((m, i) => card.numbers[i] !== 0 && !m).length;

function Cell({
  number, marked, winning, free,
}: { number: number; marked: boolean; winning: boolean; free: boolean }) {
  const label = free
    ? 'Free centre, marked'
    : `${ballLabel(number)}, ${marked ? 'marked' : 'not marked'}`;
  return (
    <div
      role="gridcell"
      aria-label={label}
      className="board-cell relative w-full h-full rounded-[14%] border-2 transition-colors duration-200"
      style={{
        background: marked
          ? 'linear-gradient(170deg,#ffe27a,#ffcf3f)'
          : 'linear-gradient(170deg,#fffdf7,#fff4e2)',
        borderColor: marked ? '#e8a21c' : 'var(--color-ink-500)',
        boxShadow: marked
          ? 'inset 0 1.5px 0 rgba(255,255,255,.75), inset 0 -2px 0 rgba(180,120,10,.22)'
          : 'inset 0 1px 0 rgba(255,255,255,.9)',
        outline: winning ? '3px solid #17795a' : undefined,
        outlineOffset: winning ? '-1px' : undefined,
      }}
    >
      {free ? (
        <span className={`w-[46%] h-[46%] grid place-items-center ${marked ? 'text-[#7a4a00]' : 'text-cream-400'}`}>
          <Icon name="bolt" size={22} className="w-full h-full" />
        </span>
      ) : (
        <span
          className={`font-display font-extrabold tabnum leading-none ${marked ? 'text-[#5a3a12]' : 'text-cream-300'}`}
          style={{ fontSize: '40cqw' }}
        >
          {number}
        </span>
      )}
      {/* the stamp: a hollow ring that reads as ink pressed onto the card */}
      {marked && !free && (
        <span className="absolute inset-[10%] rounded-full pointer-events-none"
          style={{ border: '1.5px solid rgba(140,90,10,.35)' }} aria-hidden />
      )}
    </div>
  );
}

const Card = memo(function Card({
  card, marks, name, you, winner, drawn, mini,
}: {
  card: { numbers: number[] };
  marks: boolean[];
  name: string;
  you: boolean;
  winner: boolean;
  drawn: number[];
  /** the rival's card on a phone: the same 25 squares at thumbnail size, so
      both cards stay on screen. Watching their row fill up one number ahead of
      yours is the entire tension of bingo; making a player scroll for it would
      be designing the tension out. */
  mini?: boolean;
}) {
  const lines = LINES.filter((line) => line.every((i) => marks[i]));
  const winningIdx = new Set(lines.flat());
  const remaining = marks.filter((m, i) => card.numbers[i] !== 0 && !m).length;

  return (
    <div
      className={`relative panel notch-sm p-2 sm:p-2.5 ${you ? 'ring-2 ring-volt-500' : ''}`}
      style={winner ? { boxShadow: '0 0 0 3px #17795a, 0 18px 34px -24px rgba(23,121,90,.8)' } : undefined}
    >
      {!mini && (
      <div className="flex items-center gap-1.5 mb-1.5 min-w-0">
        <span className={`text-[11.5px] font-extrabold truncate ${you ? 'text-cream-100' : 'text-cream-300'}`}>{name}</span>
        {you && (
          <span className="shrink-0 px-1.5 py-[1px] rounded-full bg-volt-400 border border-volt-600 text-[9px] font-extrabold uppercase tracking-wider text-[#4a2e18]">
            you
          </span>
        )}
        <span className="flex-1" />
        <span className="shrink-0 text-[10px] font-bold text-cream-500 tabnum" title="numbers left to mark">
          {remaining} to go
        </span>
      </div>
      )}

      {!mini && (
        <div className="grid grid-cols-5 gap-[3px] mb-[3px]" aria-hidden>
          {LETTERS.map((L, i) => (
            <span key={L} className="text-center display font-extrabold leading-none text-[12px] sm:text-[13px]"
              style={{ color: LETTER_TINT[i] }}>{L}</span>
          ))}
        </div>
      )}

      {mini ? (
        <div className="grid grid-cols-5 gap-[2px]" role="grid" aria-label={`${name}'s card`}>
          {card.numbers.map((n, i) => (
            <div key={i}
              role="gridcell"
              aria-label={n === 0 ? 'free centre' : `${ballLabel(n)} ${marks[i] ? 'marked' : 'not marked'}`}
              className="aspect-square rounded-[3px] border"
              style={{
                background: marks[i] ? '#ffcf3f' : '#fffdf7',
                borderColor: marks[i] ? '#e8a21c' : 'var(--color-ink-500)',
              }} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-5 gap-[3px]" role="grid" aria-label={`${name}'s card`}>
          {card.numbers.map((n, i) => (
            <div key={i} className="aspect-square min-w-0">
              <div className="w-full h-full">
                <Cell number={n} free={n === 0} marked={!!marks[i]} winning={winner && winningIdx.has(i)} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* the last ball that landed on this card, for the eye that just looked up */}
      {!mini && drawn.length > 0 && (
        <p className="mt-1.5 text-[10px] font-bold text-cream-500 truncate">
          last call <span className="text-cream-100">{ballLabel(drawn[drawn.length - 1])}</span>
        </p>
      )}
    </div>
  );
});

export default function BingoBoard({ state, youSlot, onMove, interactive, names }: BoardProps<BingoState>) {
  const { sfx } = useStore();
  const balls = useMemo(() => offer(state), [state]);
  const myCard = state.cards[youSlot];
  const opponent = youSlot === 0 ? 1 : 0;
  const myTurn = interactive && !state.over;
  const has = (ball: number) => myCard.numbers.includes(ball);

  const call = (index: number) => {
    if (!myTurn) return;
    sfx('select');
    onMove({ type: 'pick', index });
  };

  return (
    <BoardStage ratio={2.05} max={740} min={300} reserve={150} chrome={10} label="Bingo cards">
      <div className="w-full flex flex-col gap-2.5" style={{ maxWidth: 'var(--stage-w, 100%)' }}>
        {/* ---------------- caller's table ---------------- */}
        <div className="panel notch-sm p-2 flex items-center gap-2 sm:gap-3">
          <PikachuMascot state={state.over ? 'victory' : myTurn ? 'excited' : 'waiting'} size={44} />
          <div className="min-w-0 flex-1">
            <p className="text-[9.5px] font-extrabold uppercase tracking-wider text-cream-500 leading-none mb-1">
              {state.over ? 'Game over' : myTurn ? 'Your call — pick one ball' : `${names[opponent] || 'Your rival'} is calling`}
            </p>
            <div className="flex items-center gap-1.5">
              {balls.length === 0 && <span className="text-[12px] font-bold text-cream-400">Drum is empty</span>}
              {balls.map((ball, i) => {
                const helps = has(ball);
                return (
                  <button
                    key={`${ball}-${i}`}
                    type="button"
                    disabled={!myTurn}
                    onClick={() => call(i)}
                    aria-label={`Call ${ballLabel(ball)}${helps ? ', it is on your card' : ''}${myTurn ? '' : ', not your turn'}`}
                    className={`relative flex-1 min-w-0 h-11 rounded-xl border-2 font-display font-extrabold tabnum
                      text-[17px] leading-none grid place-items-center transition-transform no-tap
                      ${myTurn
                        ? 'bg-gradient-to-b from-white to-volt-100 border-volt-500 text-cream-100 cursor-pointer hover:-translate-y-0.5 active:translate-y-0.5'
                        : 'bg-ink-800 border-ink-600 text-cream-400'}`}
                    style={myTurn ? { boxShadow: 'inset 0 1px 0 rgba(255,255,255,.9), 0 3px 0 0 #e8a21c' } : undefined}
                  >
                    {ballLabel(ball)}
                    {helps && myTurn && (
                      <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-leaf-400 border-2 border-white grid place-items-center"
                        aria-hidden>
                        <Icon name="check" size={8} className="text-[#14523c]" />
                      </span>
                    )}
                  </button>
                );
              })}
              {balls.length > 0 && !myTurn && (
                <span className="text-[11px] font-bold text-cream-400 shrink-0">{balls.length} on the table</span>
              )}
            </div>
          </div>
        </div>

        {/* On a phone the room's chat bar floats over the bottom of the page, so
            the ticker lives directly under the caller where nothing can cover it. */}
        <CalledRow drawn={state.drawn} className="flex sm:hidden" />

        {/* ---------------- the two cards ---------------- */}
        {/* Phone: your card takes the width, the rival's is a thumbnail beside
            it. From `sm` up both are full size, side by side. */}
        <div className="sm:hidden panel notch-sm p-2 flex items-center gap-2.5">
          <div className="w-[74px] shrink-0">
            <Card
              card={state.cards[opponent]}
              marks={state.marks[opponent]}
              name={names[opponent] || 'Rival'}
              you={false}
              winner={state.over && state.winner === opponent}
              drawn={[]}
              mini
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11.5px] font-extrabold text-cream-100 truncate">{names[opponent] || 'Rival'}&rsquo;s card</p>
            <p className="text-[11px] text-cream-500 leading-snug">
              <strong className="text-cream-100 tabnum">{countUnmarked(state.cards[opponent], state.marks[opponent])}</strong> numbers left to mark.
            </p>
            <p className="text-[10px] text-cream-400 mt-0.5">{myTurn ? 'Tap a ball above to call it.' : 'Their turn to call.'}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <Card
            card={state.cards[youSlot]}
            marks={state.marks[youSlot]}
            name={names[youSlot] || 'You'}
            you
            winner={state.over && state.winner === youSlot}
            drawn={state.drawn}
          />
          <div className="hidden sm:block">
            <Card
              card={state.cards[opponent]}
              marks={state.marks[opponent]}
              name={names[opponent] || 'Rival'}
              you={false}
              winner={state.over && state.winner === opponent}
              drawn={state.drawn}
            />
          </div>
        </div>

        <CalledRow drawn={state.drawn} className="hidden sm:flex" />
      </div>
    </BoardStage>
  );
}

function CalledRow({ drawn, className = '' }: { drawn: number[]; className?: string }) {
  if (drawn.length === 0) return <div className={className} aria-hidden />;
  return (
    <div className={`${className} items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5`} aria-label="Balls called so far">
      <span className="text-[9.5px] font-extrabold uppercase tracking-wider text-cream-500 shrink-0">Called</span>
      {drawn.slice().reverse().slice(0, 16).map((ball, i) => (
        <span key={`${ball}-${i}`}
          className={`shrink-0 min-w-[30px] h-6 px-1.5 rounded-full border-2 grid place-items-center text-[10.5px] font-extrabold tabnum
            ${i === 0 ? 'bg-volt-400 border-volt-600 text-[#4a2e18]' : 'bg-white border-ink-500 text-cream-300'}`}>
          {ballLabel(ball)}
        </span>
      ))}
    </div>
  );
}

/** Kept for the result overlay: how many lines a seat finished with. */
export const bingoLines = (marks: boolean[]) => LINES.reduce((n, l) => n + (l.every((i) => marks[i]) ? 1 : 0), 0);
export const bingoFree = FREE_INDEX;
export const bingoCols = CARD_COLS;
