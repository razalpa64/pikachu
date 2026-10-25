import { useEffect, useRef, useState } from 'react';
import type { BoardProps } from './types';
import { checkWord, type WbState } from '../../games/wordbomb/rules';
import { useStore } from '../../lib/store';
import { Button } from '../ui';

/**
 * The online board for Word Bomb.
 *
 * The lit letter, the fuse, and one line of input — everything else is the chain
 * behind you, because in this game the previous word *is* the current rule. The
 * countdown is drawn from the server's `turnEndsAt`, so both players are looking
 * at the same deadline (within ordinary clock skew); the referee still decides
 * when the turn is actually gone.
 */
export default function WordBombBoard({ state, youSlot, onMove, interactive, names }: BoardProps<WbState>) {
  const { sfx } = useStore();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const input = useRef<HTMLInputElement>(null);

  const myTurn = state.turn === youSlot && !state.over && state.phase === 'play';
  const active = interactive && myTurn;

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (active) input.current?.focus();
    if (!active) setDraft('');
  }, [active, state.letter]);

  const remaining = Math.max(0, state.turnEndsAt - now);
  const total = Math.max(1, state.config.turnMs);
  const pct = Math.max(0, Math.min(1, remaining / total));
  const urgent = remaining < 5000 && myTurn;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!active) return;
    const verdict = checkWord(state, draft);
    if (!verdict.ok) { setError(verdict.why); sfx('error'); return; }
    setError(null);
    setDraft('');
    sfx('coin');
    onMove({ type: 'word', word: verdict.word });
  };

  return (
    <div className="w-full max-w-[600px] mx-auto flex flex-col gap-3">
      <div className="panel panel-notch p-4 sm:p-5 relative overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-[5px] bg-blush-100" aria-hidden>
          <div className="h-full transition-[width] duration-200 ease-linear"
            style={{ width: `${pct * 100}%`, background: urgent ? '#b0301d' : 'linear-gradient(90deg,#ffd24d,#e8a21c)' }} />
        </div>

        <div className="flex items-center gap-4">
          <div className="shrink-0 grid place-items-center w-[64px] h-[72px] rounded-2xl border-[2.5px] border-ink-500"
            style={{ background: 'linear-gradient(165deg,#fffdf7,#fff3d8)' }}>
            <span className="display text-[32px] leading-none text-cream-100">{state.letter.toUpperCase()}</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="eyebrow">{state.over ? 'Bomb out' : myTurn ? 'Your turn' : `${names[state.turn]}’s turn`}</p>
            <p className="text-[12px] text-cream-500 leading-snug mt-0.5">
              {state.over ? 'The round is over.' : myTurn ? 'A word starting with that letter. Quick.' : 'Waiting for their word…'}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="display text-[19px] tabnum" style={{ color: urgent ? '#b0301d' : 'var(--color-cream-100)' }}>
              {state.over ? '—' : `${(remaining / 1000).toFixed(1)}s`}
            </p>
          </div>
        </div>

        <form onSubmit={submit} className="mt-3.5">
          <label className="sr-only" htmlFor="wb-online-word">Your word</label>
          <div className="flex gap-2">
            <input
              id="wb-online-word"
              ref={input}
              value={draft}
              onChange={(e) => { setDraft(e.target.value); setError(null); }}
              disabled={!active}
              autoComplete="off" autoCapitalize="none" spellCheck={false}
              placeholder={active ? `A word starting with ${state.letter.toUpperCase()}…` : `${names[state.turn]} is playing…`}
              aria-invalid={!!error}
              aria-describedby={error ? 'wb-online-error' : undefined}
              className="flex-1 min-w-0 bg-ink-800 border-2 border-ink-500 px-3 h-11 notch-sm text-[14px] text-cream-100 placeholder:text-cream-400 outline-none focus:border-volt-500 disabled:opacity-60"
            />
            <Button type="submit" variant="primary" className="h-11 shrink-0" disabled={!active}>Play</Button>
          </div>
          {error && <p id="wb-online-error" role="alert" className="mt-1.5 text-[11.5px] font-bold text-[#a83350]">{error}</p>}
        </form>
      </div>

      <div className="panel notch-sm p-3">
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <p className="eyebrow">The chain</p>
          <span className="text-[10.5px] text-cream-400 font-bold">
            turn {Math.min(state.history.length + 1, state.config.rounds)} / {state.config.rounds}
          </span>
        </div>
        {state.history.length === 0 ? (
          <p className="text-[12px] text-cream-500">Nothing played yet — the first word sets the letter for the next.</p>
        ) : (
          <ol className="flex flex-wrap gap-1.5">
            {state.history.slice(-16).map((h, i) => (
              <li key={state.history.length - i}
                className={`px-2 py-1 rounded-full border text-[11.5px] font-bold ${h.word ? 'bg-ink-800 border-ink-500 text-cream-300' : 'bg-[#ffe9ee] border-[#bd2756] text-[#8d2740]'}`}>
                {h.word ?? `${names[h.seat]} timed out`}
                <span className="ml-1 text-[9px] uppercase tracking-wider text-cream-400">{h.letter.toUpperCase()}</span>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="flex items-center justify-center gap-4 text-[11.5px] font-extrabold uppercase tracking-wider">
        <span className="text-cream-500">{names[youSlot]} <span className="text-leaf-700 tabnum">{state.score[youSlot]}</span></span>
        <span className="text-cream-400">·</span>
        <span className="text-cream-500">{names[1 - youSlot]} <span className="text-blush-600 tabnum">{state.score[1 - youSlot]}</span></span>
      </div>
    </div>
  );
}
