import { useEffect, useState } from 'react';
import type { BoardProps } from './types';
import { MAX_LIE, type BluffState } from '../../games/bluff/rules';
import { Button } from '../ui';

/**
 * Online Bluff Trivia.
 *
 * Three phases, three different screens, one rule that matters: while the vote is
 * open nothing on this page says which option is true — the server withholds the
 * question's answer key and the option owners until the reveal, so there is
 * nothing here to peek at even with the console open.
 */
type Redacted = BluffState & {
  submitted?: [boolean, boolean];
  inVote?: [boolean, boolean];
  total?: number;
};

export default function BluffTriviaBoard({ state, youSlot, onMove, interactive, names }: BoardProps<Redacted>) {
  const them = (youSlot === 0 ? 1 : 0) as 0 | 1;
  const q = state.queue[state.index];
  const [draft, setDraft] = useState('');

  // the countdown is local display only; the server owns the deadline
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (state.over) return;
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [state.over]);

  useEffect(() => { setDraft(''); }, [state.index, state.phase]);

  if (!q) return null;

  const left = Math.max(0, state.phaseEndsAt - now);
  const writing = state.phase === 'write';
  const voting = state.phase === 'vote';
  const revealing = state.phase === 'reveal' || state.phase === 'done';
  const submitted = state.submitted ?? [state.lies[0] !== null, state.lies[1] !== null];
  const inVote = state.inVote ?? [state.votes[0] !== null, state.votes[1] !== null];
  const myLie = state.lies[youSlot];
  const myVote = state.votes[youSlot];
  const last = state.history[state.history.length - 1];
  const total = state.total ?? state.queue.length;
  const canAct = interactive && !state.over;

  const submitLie = (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!canAct || !writing || myLie !== null || !text) return;
    onMove({ type: 'lie', text });
  };

  return (
    <div className="w-full max-w-[760px] mx-auto flex flex-col gap-3">
      {/* scores */}
      <div className="flex items-stretch gap-2">
        {([youSlot, them] as const).map((seat, i) => {
          const ready = writing ? submitted[seat] : voting ? inVote[seat] : null;
          return (
            <div key={seat}
              className={`flex-1 px-3.5 py-2 border-2 rounded-2xl text-center ${
                ready ? 'border-leaf-400 bg-[#eafaf2]' : 'border-ink-500 bg-ink-800'}`}>
              <p className="eyebrow">{i === 0 ? `${names[seat]} (you)` : names[seat]}</p>
              <p className="display text-[22px] leading-tight text-cream-100 tabnum">{state.score[seat]}</p>
              {ready !== null && !revealing && (
                <p className={`text-[10px] font-extrabold uppercase tracking-wider ${ready ? 'text-leaf-700' : 'text-cream-500'}`}>
                  {ready ? (writing ? 'lie in' : 'voted') : (writing ? 'writing…' : 'deciding…')}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="panel panel-notch p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-1.5">
          <p className="eyebrow">Question {state.index + 1} of {total} · {q.cat}</p>
          {!revealing && (
            <p className="text-[12px] font-extrabold text-cream-300 tabnum">{Math.ceil(left / 1000)}s</p>
          )}
        </div>
        <p className="display text-[19px] sm:text-[22px] leading-snug text-cream-100">{q.q}</p>

        {/* ---------------------------------------------------------- write */}
        {writing && (
          <form onSubmit={submitLie} className="mt-4">
            {myLie === null ? (
              <>
                <label htmlFor="bluff-lie" className="eyebrow block mb-1.5">Your lie</label>
                <div className="flex gap-2">
                  <input
                    id="bluff-lie"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value.slice(0, MAX_LIE))}
                    maxLength={MAX_LIE}
                    autoComplete="off"
                    placeholder="Something believable but wrong…"
                    className="flex-1 min-w-0 bg-ink-800 border-2 border-ink-500 rounded-xl px-3 h-11 text-[14px] text-cream-100 placeholder:text-cream-400 outline-none focus:border-volt-500"
                    disabled={!canAct}
                  />
                  <Button type="submit" variant="primary" className="h-11 shrink-0"
                    disabled={!canAct || !draft.trim()}>Write it</Button>
                </div>
                <p className="text-[10.5px] text-cream-400 mt-1.5">
                  {MAX_LIE - draft.length} characters left · the real answer is not a valid lie.
                </p>
              </>
            ) : (
              <div className="mt-3 rounded-xl border-2 border-ink-500 bg-white/70 px-3 py-2.5">
                <p className="eyebrow">Your lie is in</p>
                <p className="text-[14px] text-cream-100 font-semibold">{myLie}</p>
                <p className="text-[11px] text-cream-400 mt-1">
                  Waiting for {names[them]} to write one…
                </p>
              </div>
            )}
          </form>
        )}

        {/* ----------------------------------------------------------- vote */}
        {voting && (
          <div className="mt-4">
            <p className="eyebrow mb-1.5">Which one is true?</p>
            <div className="flex flex-col gap-2">
              {state.options.map((option, i) => {
                const mine = (state.lies?.[youSlot] ?? '').trim().toLowerCase();
                const isMine = mine !== '' && option.trim().toLowerCase() === mine;
                const picked = myVote === i;
                return (
                  <button
                    key={`${i}-${option}`}
                    data-option={i}
                    disabled={!canAct || myVote !== null || isMine}
                    onClick={() => onMove({ type: 'vote', option: i })}
                    className={`text-left px-3.5 py-2.5 rounded-xl border-2 transition-colors
                      ${picked ? 'border-volt-600 bg-volt-100' : 'border-ink-500 bg-ink-800 hover:border-volt-500'}
                      ${isMine ? 'opacity-55 cursor-not-allowed' : ''}`}
                  >
                    <span className="text-[14px] font-semibold text-cream-100">{option}</span>
                    {isMine && <span className="ml-2 text-[10px] font-extrabold uppercase tracking-wider text-blush-600">your lie</span>}
                  </button>
                );
              })}
            </div>
            {myVote !== null && (
              <p className="text-[11px] text-cream-400 mt-2">Vote locked in. Waiting for {names[them]}.</p>
            )}
          </div>
        )}

        {/* --------------------------------------------------------- reveal */}
        {revealing && last && (
          <div className="mt-4">
            <div className="rounded-xl border-2 border-leaf-400 bg-[#eafaf2] px-3 py-2.5">
              <p className="eyebrow text-leaf-700">The truth</p>
              <p className="text-[15px] font-extrabold text-cream-100">{last.truth}</p>
            </div>
            <ul className="mt-2.5 flex flex-col gap-1.5">
              {last.options.map((option, i) => {
                const owner = last.owner[i];
                const votes = (last.votes[0] === i ? 1 : 0) + (last.votes[1] === i ? 1 : 0);
                return (
                  <li key={`${i}-${option}`} className="flex items-center gap-2 text-[12.5px]">
                    <span className={`flex-1 ${owner === 'truth' ? 'font-extrabold text-leaf-700' : 'text-cream-300'}`}>
                      {option}
                    </span>
                    <span className="text-[10.5px] uppercase tracking-wider font-extrabold text-cream-400">
                      {owner === 'truth' ? 'true' : `${names[owner]}’s lie`}
                    </span>
                    {votes > 0 && (
                      <span className="text-[10.5px] font-extrabold text-blush-600">+{votes}</span>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="text-[11px] text-cream-400 mt-2">
              +2 for the truth, +1 for every vote a lie stole.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
