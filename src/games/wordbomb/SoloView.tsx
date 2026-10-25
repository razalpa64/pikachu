import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Difficulty, GameMeta, Slot } from '../types';
import SoloShell, { ModeRail } from '../../components/SoloShell';
import { Button, Panel, Segmented, Stat } from '../../components/ui';
import { ResultOverlay } from '../../components/Overlays';
import { PikachuMascot } from '../../mascot';
import { useStore } from '../../lib/store';
import { DEFAULT_WB, checkWord, wordBombRules, type WbState } from './rules';
import { pickWord, thinkMs, TUNING } from './ai';

/**
 * Word Bomb, alone with the arcade.
 *
 * The same referee the relay uses runs locally, so the solo game cannot drift
 * from the online one: same shape check, same strike rule, same ending. Only the
 * clock display and Pikachu's thinking time are local concerns.
 */
const YOU: Slot = 0;
const AI: Slot = 1;

export default function WordBombSolo({ game }: { game: GameMeta }) {
  const { sfx, finishMatch } = useStore();
  const [difficulty, setDifficulty] = useState<Difficulty>('intermediate');
  const [turnMs, setTurnMs] = useState(20_000);
  const [seed, setSeed] = useState(() => (Date.now() ^ 0x2545f491) >>> 0);

  const config = useMemo(() => ({ ...DEFAULT_WB, turnMs, strikes: 2, rounds: 12 }), [turnMs]);
  const [state, setState] = useState<WbState>(() => wordBombRules.createInitialState(config, seed) as WbState);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [logged, setLogged] = useState(false);
  const aiTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    clearTimeout(aiTimer.current);
    const nextSeed = (Date.now() ^ 0x9e3779b9) >>> 0;
    setSeed(nextSeed);
    setState(wordBombRules.createInitialState(config, nextSeed) as WbState);
    setDraft(''); setError(null); setLogged(false); setNow(Date.now());
  }, [config]);

  useEffect(() => { reset(); /* new config means a new match */ }, [turnMs]); // eslint-disable-line react-hooks/exhaustive-deps

  /* One clock for the whole screen; the referee decides when a turn has expired. */
  useEffect(() => {
    if (state.over) return;
    const t = setInterval(() => {
      const t0 = Date.now();
      setNow(t0);
      setState((s) => (s.over ? s : wordBombRules.tick!(s, t0) as WbState));
    }, 250);
    return () => clearInterval(t);
  }, [state.over]);

  /* Pikachu's turn: think for a beat, then either play a word or take the strike. */
  useEffect(() => {
    if (state.over || state.turn !== AI) return;
    clearTimeout(aiTimer.current);
    const delay = Math.min(thinkMs(difficulty, seed, state.history.length), Math.max(600, state.turnEndsAt - Date.now() - 400));
    aiTimer.current = setTimeout(() => {
      const word = pickWord(state.letter, state.used, difficulty, seed, state.history.length);
      if (word) {
        sfx('coin');
        setState((s) => (s.over || s.turn !== AI ? s : wordBombRules.applyMove(s, AI, { type: 'word', word }) as WbState));
      } else {
        // a blank costs the arcade a second, exactly as it would cost you
        sfx('miss');
        setState((s) => (s.over || s.turn !== AI ? s : wordBombRules.tick!(s, s.turnEndsAt + 1) as WbState));
      }
    }, delay);
    return () => clearTimeout(aiTimer.current);
  }, [state.turn, state.letter, state.turnEndsAt, state.over, difficulty, seed, sfx]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (state.turn === YOU && !state.over) inputRef.current?.focus();
  }, [state.turn, state.over]);

  useEffect(() => {
    if (!state.over || logged) return;
    setLogged(true);
    const result = state.winner === YOU ? 'win' : state.winner === AI ? 'loss' : 'draw';
    finishMatch({
      gameId: 'wordbomb', mode: 'ai', result, score: state.score[YOU],
      meta: { played: state.history.filter((h) => h.word).length, strikes: state.strikes[YOU] },
    });
    sfx(result === 'win' ? 'win' : result === 'loss' ? 'lose' : 'notify');
  }, [state.over, state.winner, state.score, state.history, state.strikes, logged, finishMatch, sfx]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (state.over || state.turn !== YOU) return;
    const verdict = checkWord(state, draft);
    if (!verdict.ok) { setError(verdict.why); sfx('error'); return; }
    setError(null);
    setDraft('');
    sfx('coin');
    setState((s) => wordBombRules.applyMove(s, YOU, { type: 'word', word: verdict.word }) as WbState);
  };

  const remaining = Math.max(0, state.turnEndsAt - now);
  const pct = Math.max(0, Math.min(1, remaining / state.config.turnMs));
  const urgent = remaining < 5000;
  const verdict = state.winner === YOU ? 'win' : state.winner === AI ? 'loss' : 'draw';

  return (
    <SoloShell
      game={game}
      mascot={state.over ? (verdict === 'win' ? 'victory' : verdict === 'loss' ? 'defeated' : 'thinking')
        : state.turn === AI ? 'thinking' : urgent ? 'competitive' : 'waiting'}
      mascotLine={state.over
        ? `You ${state.score[YOU]} — Pikachu ${state.score[AI]}.`
        : state.turn === AI
          ? 'Pikachu is thinking of a word…'
          : `Your turn. A word starting with ${state.letter.toUpperCase()}.`}
      onRestart={reset}
      controls={
        <ModeRail
          mode="ai" setMode={() => {}} modes={[{ value: 'ai', label: 'Vs Pikachu' }]}
          difficulty={difficulty} setDifficulty={setDifficulty} showDifficulty
          extra={
            <>
              <span className="eyebrow ml-1">Fuse</span>
              <Segmented value={turnMs} onChange={(v) => { setTurnMs(v); }} size="sm" label="Fuse length"
                options={[{ value: 30_000, label: '30s' }, { value: 20_000, label: '20s' }, { value: 12_000, label: '12s' }]} />
            </>
          }
        />
      }
      hud={
        <Panel className="p-2 sm:p-3 flex items-center gap-2 sm:gap-3 flex-wrap justify-center">
          <Stat label="Turns" value={`${Math.min(state.history.length + 1, state.config.rounds)}/${state.config.rounds}`} />
          <Stat label="You" value={state.score[YOU]} accent="var(--color-leaf-700)" />
          <Stat label="Pikachu" value={state.score[AI]} accent="var(--color-blush-600)" />
          <Stat label="Strikes" value={`${state.strikes[YOU]}–${state.strikes[AI]}`} accent={state.strikes[YOU] >= 2 ? '#b0301d' : undefined} />
        </Panel>
      }
    >
      <div className="w-full max-w-[680px] mx-auto flex flex-col gap-3">
        <Panel className={`p-4 sm:p-6 relative overflow-hidden ${state.turn === YOU && !state.over ? 'border-volt-600/60' : ''}`}>
          {/* the fuse */}
          <div className="absolute inset-x-0 top-0 h-[5px] bg-blush-100" aria-hidden>
            <div className="h-full transition-[width] duration-200 ease-linear"
              style={{ width: `${pct * 100}%`, background: urgent ? '#b0301d' : 'linear-gradient(90deg,#ffd24d,#e8a21c)' }} />
          </div>

          <div className="flex items-center gap-4">
            <div className={`shrink-0 grid place-items-center w-[68px] h-[76px] rounded-2xl border-[2.5px] ${state.turn === YOU ? 'border-volt-600' : 'border-ink-500'}`}
              style={{ background: 'linear-gradient(165deg,#fffdf7,#fff3d8)' }}>
              <span className="display text-[34px] leading-none text-cream-100">{state.letter.toUpperCase()}</span>
              <span className="text-[8.5px] font-extrabold uppercase tracking-[.14em] text-cream-400 mt-1">starts with</span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="eyebrow">{state.over ? 'Bomb out' : state.turn === YOU ? 'Your turn' : 'Pikachu’s turn'}</p>
              <p className="text-[12.5px] text-cream-500 leading-snug mt-0.5">
                {state.over
                  ? 'See the damage below.'
                  : state.turn === YOU
                    ? 'Type any word that starts with that letter. Miss the clock and you take a strike.'
                    : 'Pikachu is looking for one.'}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="display text-[20px] tabnum" style={{ color: urgent ? '#b0301d' : 'var(--color-cream-100)' }}>
                {state.over ? '—' : `${(remaining / 1000).toFixed(1)}s`}
              </p>
              <p className="text-[9px] font-extrabold uppercase tracking-wider text-cream-400">left</p>
            </div>
          </div>

          <form onSubmit={submit} className="mt-4">
            <label className="sr-only" htmlFor="wb-word">Your word</label>
            <div className="flex gap-2">
              <input
                id="wb-word"
                ref={inputRef}
                value={draft}
                onChange={(e) => { setDraft(e.target.value); setError(null); }}
                disabled={state.over || state.turn !== YOU}
                autoComplete="off" autoCapitalize="none" spellCheck={false}
                placeholder={state.turn === YOU ? `A word starting with ${state.letter.toUpperCase()}…` : 'Pikachu is playing…'}
                aria-invalid={!!error}
                aria-describedby={error ? 'wb-error' : undefined}
                className="flex-1 min-w-0 bg-ink-800 border-2 border-ink-500 px-3 h-11 notch-sm text-[14px] text-cream-100 placeholder:text-cream-400 outline-none focus:border-volt-500 disabled:opacity-60"
              />
              <Button type="submit" variant="primary" className="h-11 shrink-0" disabled={state.over || state.turn !== YOU}>
                Play
              </Button>
            </div>
            {error && <p id="wb-error" role="alert" className="mt-1.5 text-[11.5px] font-bold text-[#a83350]">{error}</p>}
          </form>
        </Panel>

        <Panel className="p-3">
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <p className="eyebrow">The chain</p>
            <span className="text-[10.5px] text-cream-400 font-bold">{state.used.length} played</span>
          </div>
          {state.history.length === 0 ? (
            <div className="flex items-center gap-2.5">
              <PikachuMascot state="waiting" size={54} />
              <p className="text-[12px] text-cream-500 leading-relaxed">
                Nothing played yet. Every word you type hands Pikachu the last letter of it to work from.
              </p>
            </div>
          ) : (
            <ol className="flex flex-wrap gap-1.5">
              {state.history.slice(-14).map((h, i) => (
                <li key={state.history.length - i}
                  className={`px-2 py-1 rounded-full border text-[11.5px] font-bold ${h.word ? 'bg-ink-800 border-ink-500 text-cream-300' : 'bg-[#ffe9ee] border-[#bd2756] text-[#8d2740]'}`}>
                  {h.word ?? `${h.seat === YOU ? 'You' : 'Pikachu'} ran out of time`}
                  <span className="ml-1 text-[9px] uppercase tracking-wider text-cream-400">{h.letter.toUpperCase()}</span>
                </li>
              ))}
            </ol>
          )}
          <p className="mt-2 text-[10.5px] text-cream-400 leading-snug">
            The bomb checks the shape of a word — letters, length, first letter, not already played — not a dictionary.
            {TUNING[difficulty].blank > 0.1 ? ' Pikachu misses fairly often at this level.' : ''}
          </p>
        </Panel>
      </div>

      {state.over && (
        <ResultOverlay
          verdict={verdict}
          reason={state.reason}
          playerA={{ name: 'You', score: state.score[YOU], you: true }}
          playerB={{ name: 'Pikachu', score: state.score[AI] }}
          onRematch={reset}
          rematchLabel="New bomb"
          onExit={reset}
        />
      )}
    </SoloShell>
  );
}
