import { useEffect, useState } from 'react';
import type { BoardProps } from './types';
import type { OnlineQuizState } from '../../games/trivia/online';

const LETTERS = ['A', 'B', 'C', 'D'];

/**
 * Online Spark Quiz.
 *
 * The state arrives redacted: while a question is open, the opponent's pick is
 * null and a separate `answered` flag says only *that* they are in. That flag
 * is what drives the "locked in" pip — never the pick itself.
 */
type Redacted = OnlineQuizState & { answered?: [boolean, boolean]; total?: number };

export default function SparkQuizBoard({ state, youSlot, onMove, interactive, names }: BoardProps<Redacted>) {
  const them = (youSlot === 0 ? 1 : 0) as 0 | 1;
  const q = state.queue[state.index];
  const open = state.phase === 'question';
  const revealing = state.phase === 'reveal';
  const myPick = state.picked[youSlot];
  const answered = state.answered ?? [state.picked[0] !== null, state.picked[1] !== null];

  // the server owns the clock; this only renders the countdown it already set
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (state.over) return;
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [state.over]);

  const limit = state.config.perQuestion;
  const left = Math.max(0, state.phaseEndsAt - now);
  const frac = limit > 0 && open ? Math.max(0, Math.min(1, left / (limit * 1000))) : 1;
  const last = state.history[state.history.length - 1];
  // the queue arrives truncated by redaction, so the real count comes from the server
  const total = state.total ?? state.queue.length;

  if (!q) return null;

  return (
    <div className="w-full max-w-[760px] mx-auto">
      {/* scores */}
      <div className="flex items-stretch gap-2 mb-4">
        {([youSlot, them] as const).map((seat, i) => (
          <div
            key={seat}
            className={`flex-1 px-3.5 py-2 border-2 rounded-2xl text-center ${
              answered[seat] && open ? 'border-[#2f9c71] bg-[#eafaf2]' : 'border-ink-500 bg-white/80'
            }`}
          >
            <p className="eyebrow">{i === 0 ? `${names[seat]} (you)` : names[seat]}</p>
            <p className="font-display text-[22px] font-extrabold leading-tight text-cream-100">{state.score[seat]}</p>
            {open && (
              <p className={`text-[10.5px] font-extrabold uppercase tracking-wide ${answered[seat] ? 'text-[#2f9c71]' : 'text-cream-500'}`}>
                {answered[seat] ? 'locked in' : 'thinking…'}
              </p>
            )}
            {state.streak[seat] > 1 && !open && (
              <p className="text-[10.5px] font-bold text-blush-600">{state.streak[seat]} in a row</p>
            )}
          </div>
        ))}
      </div>

      <div className="panel panel-notch p-5">
        <div className="flex items-center justify-between gap-3 mb-1.5 flex-wrap">
          <p className="eyebrow">
            {q.cat === 'maths' ? 'Mental maths' : q.cat} · question {state.index + 1} of {total}
          </p>
          {open && limit > 0 && (
            <p className="text-[12px] font-extrabold text-cream-300 tabular-nums">{Math.ceil(left / 1000)}s</p>
          )}
        </div>

        {open && limit > 0 && (
          <div className="h-1.5 rounded-full bg-ink-600 overflow-hidden mb-3.5" aria-hidden>
            <div
              className="h-full rounded-full transition-[width] duration-200 ease-linear"
              style={{ width: `${frac * 100}%`, background: frac < 0.25 ? '#e05a74' : '#ffd95a' }}
            />
          </div>
        )}

        <h2 className="font-display text-[20px] sm:text-[23px] font-extrabold leading-snug text-cream-100 mb-4">
          {q.q}
        </h2>

        <div className="grid sm:grid-cols-2 gap-2">
          {state.order.map((answerIdx, slot) => {
            const correct = answerIdx === 0;
            const iPicked = myPick === slot;
            const theyPicked = revealing && state.picked[them] === slot;
            const show = revealing || state.over;

            let cls = 'border-ink-500 bg-ink-800 hover:bg-volt-100';
            if (show && correct) cls = 'border-[#2f9c71] bg-[#eafaf2]';
            else if (show && iPicked) cls = 'border-[#e05a74] bg-[#ffe7ec]';
            else if (iPicked) cls = 'border-volt-600 bg-volt-200';

            return (
              <button
                key={slot}
                onClick={() => onMove({ type: 'answer', option: slot })}
                disabled={!interactive || !open || myPick !== null}
                aria-label={`Answer ${LETTERS[slot]}: ${q.a[answerIdx]}`}
                className={`flex items-center gap-2.5 px-3 py-2.5 border-2 notch-sm text-left transition-colors
                  disabled:cursor-default ${cls}`}
              >
                <span
                  className={`shrink-0 w-6 h-6 grid place-items-center rounded-full border-2 border-ink-400 text-[11px] font-extrabold ${
                    iPicked ? 'bg-volt-400 text-[#5a3a12]' : 'bg-cream-100 text-ink-800'
                  }`}
                >
                  {LETTERS[slot]}
                </span>
                <span className="text-[14px] font-semibold text-cream-100 leading-snug">{q.a[answerIdx]}</span>
                {show && correct && <span className="ml-auto text-[11px] font-extrabold uppercase text-[#2f9c71]">correct</span>}
                {theyPicked && !correct && (
                  <span className="ml-auto text-[10.5px] font-bold text-cream-500">{names[them]}</span>
                )}
              </button>
            );
          })}
        </div>

        {revealing && last && (
          <div className="mt-4 pt-3 border-t-2 border-dashed border-ink-500 flex gap-4 justify-center flex-wrap text-[12.5px]">
            {([youSlot, them] as const).map((seat, i) => (
              <span key={seat} className="font-semibold text-cream-300">
                {i === 0 ? 'You' : names[seat]}:{' '}
                <span className={last.points[seat] > 0 ? 'text-[#2f9c71] font-extrabold' : 'text-cream-500'}>
                  {last.points[seat] > 0 ? `+${last.points[seat]}` : 'no points'}
                </span>
                {last.picked[seat] === null && <span className="text-cream-500"> (ran out of time)</span>}
              </span>
            ))}
          </div>
        )}
      </div>

      <p className="mt-3 text-center text-[12px] text-cream-500">
        {state.over
          ? state.reason
          : revealing
            ? 'Next question in a moment…'
            : myPick !== null
              ? `Locked in. Waiting for ${names[them]}.`
              : 'Both of you are answering this one at the same time.'}
      </p>
    </div>
  );
}
