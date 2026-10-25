import { useCallback, useEffect, useMemo, useState } from 'react';
import type { GameMeta } from '../types';
import SoloShell from '../../components/SoloShell';
import { Button, Icon, Panel, Segmented, Stat, Toggle } from '../../components/ui';
import { useStore } from '../../lib/store';
import {
  createImposter, cardFor, isImposter, nameOf, acknowledge, nextClue, clueSeat, clueRound,
  castVote, closeVote, submitGuess, concede, tally, allVoted, defaultNames,
  MIN_PLAYERS, MAX_PLAYERS, type ImposterState,
} from './rules';

export default function ImposterSolo({ game }: { game: GameMeta }) {
  const { sfx, identity, finishMatch } = useStore();
  const [count, setCount] = useState(4);
  const [decoy, setDecoy] = useState(false);
  const [clueRounds, setClueRounds] = useState(1);
  const [names, setNames] = useState<string[]>(() => defaultNames(MAX_PLAYERS));
  const [started, setStarted] = useState(false);
  const [held, setHeld] = useState(false);   // is the current player looking at their card?

  /* The press target is replaced by the card while it is held, so its own
     release handler can never fire. Listen at the window instead: whatever
     happens — mouse up, touch end, key up, tab away — the card hides again. */
  useEffect(() => {
    if (!held) return;
    const hide = () => setHeld(false);
    const opts = { passive: true } as AddEventListenerOptions;
    window.addEventListener('mouseup', hide, opts);
    window.addEventListener('touchend', hide, opts);
    window.addEventListener('touchcancel', hide, opts);
    window.addEventListener('keyup', hide, opts);
    window.addEventListener('blur', hide, opts);
    document.addEventListener('visibilitychange', hide, opts);
    return () => {
      window.removeEventListener('mouseup', hide);
      window.removeEventListener('touchend', hide);
      window.removeEventListener('touchcancel', hide);
      window.removeEventListener('keyup', hide);
      window.removeEventListener('blur', hide);
      document.removeEventListener('visibilitychange', hide);
    };
  }, [held]);
  const [voter, setVoter] = useState(0);
  const [guess, setGuess] = useState('');
  const [logged, setLogged] = useState(false);

  // seat 1 takes the player's own name, so the table feels like theirs
  useEffect(() => {
    if (identity.name?.trim()) setNames((n) => (n[0] === 'Player 1' ? [identity.name.trim(), ...n.slice(1)] : n));
  }, [identity.name]);

  const config = useMemo(
    () => ({ playerCount: count, names: names.slice(0, count), imposters: count >= 6 ? 2 : 1, decoy, clueRounds }),
    [count, names, decoy, clueRounds],
  );
  const [state, setState] = useState<ImposterState>(() => createImposter(config, Date.now() >>> 0));

  const begin = useCallback(() => {
    setState(createImposter(config, (Date.now() ^ 0x45d9f3b) >>> 0));
    setStarted(true); setHeld(false); setVoter(0); setGuess(''); setLogged(false);
    sfx('go');
  }, [config, sfx]);

  const reset = useCallback(() => { setStarted(false); setHeld(false); setVoter(0); setGuess(''); setLogged(false); }, []);

  useEffect(() => {
    if (state.phase !== 'result' || logged) return;
    setLogged(true);
    sfx(state.winner === 'crew' ? 'win' : 'lose');
    finishMatch({
      gameId: 'imposter', mode: 'local',
      result: state.winner === 'crew' ? 'win' : 'loss',
      score: state.config.playerCount * 10,
      meta: { players: state.config.playerCount, decoy, winner: state.winner ?? 'none' },
    });
  }, [state.phase, state.winner, logged, state.config.playerCount, decoy, sfx, finishMatch]);

  /* ───────────────────────── setup ───────────────────────── */
  if (!started) {
    return (
      <SoloShell
        game={game}
        mascot="waiting"
        mascotLine="One phone, one table. Everyone sees the word except one of you."
        hud={<Panel className="p-2 sm:p-3 flex items-center gap-2 sm:gap-3 flex-wrap justify-center"><Stat label="Players" value={count} /><Stat label="Imposters" value={count >= 6 ? 2 : 1} /></Panel>}
      >
        <div className="w-full max-w-[640px] mx-auto space-y-3">
          <Panel className="p-5">
            <p className="eyebrow mb-2">How many are playing?</p>
            <Segmented
              value={count} onChange={setCount} label="Player count"
              options={Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }, (_, i) => ({
                value: MIN_PLAYERS + i, label: String(MIN_PLAYERS + i),
              }))}
            />
            <p className="mt-2 text-[12.5px] text-cream-300">
              Six or more and there are two imposters. Pass the phone round — each person looks at their own card in private.
            </p>
          </Panel>

          <Panel className="p-5">
            <p className="eyebrow mb-2">Names</p>
            <div className="grid sm:grid-cols-2 gap-2">
              {Array.from({ length: count }, (_, i) => (
                <input
                  key={i}
                  value={names[i] ?? ''}
                  onChange={(e) => setNames((n) => { const c = n.slice(); c[i] = e.target.value.slice(0, 16); return c; })}
                  aria-label={`Name for player ${i + 1}`}
                  placeholder={`Player ${i + 1}`}
                  className="px-3 py-2 text-[13.5px] font-semibold notch-sm border-2 border-ink-500 bg-ink-800 text-cream-100 focus:border-ink-400 outline-none"
                />
              ))}
            </div>
          </Panel>

          <Panel className="p-5 space-y-3">
            <div className="flex items-start gap-3 flex-wrap">
              <div className="flex-1 min-w-[230px]">
                <p className="font-display text-[14px] font-extrabold text-cream-100">Decoy mode</p>
                <p className="text-[12.5px] text-cream-300 mt-0.5">
                  The imposter gets a different word from the same topic instead of nothing. Much harder to catch.
                </p>
              </div>
              <Toggle checked={decoy} onChange={setDecoy} label="Decoy word" />
            </div>
            <div className="flex items-center gap-2 flex-wrap pt-2 border-t-2 border-dashed border-ink-500">
              <span className="eyebrow">Clue rounds</span>
              <Segmented value={clueRounds} onChange={setClueRounds} size="sm" label="Clue rounds"
                options={[{ value: 1, label: 'One' }, { value: 2, label: 'Two' }, { value: 3, label: 'Three' }]} />
            </div>
          </Panel>

          <Button size="lg" onClick={begin} icon={<Icon name="play" size={16} />} className="w-full justify-center">
            Deal the cards
          </Button>
        </div>
      </SoloShell>
    );
  }

  const seat = state.revealed;
  const card = state.phase === 'reveal' ? cardFor(state, seat) : null;
  const counts = tally(state).counts;

  return (
    <SoloShell
      game={game}
      mascot={state.phase === 'result' ? (state.winner === 'crew' ? 'victory' : 'defeated')
        : state.phase === 'reveal' ? (held ? 'thinking' : 'waiting')
        : state.phase === 'clues' ? 'competitive'
        : state.phase === 'defence' ? 'error' : 'idle'}
      mascotLine={
        state.phase === 'reveal' ? `Pass to ${nameOf(state, seat)}. Nobody else looks.`
        : state.phase === 'clues' ? `${nameOf(state, clueSeat(state))} — one word about the secret. Out loud.`
        : state.phase === 'vote' ? `${nameOf(state, voter)}, who was it?`
        : state.phase === 'defence' ? 'Caught. One guess to steal it back.'
        : state.reason}
      onRestart={reset}
      hud={
        <Panel className="p-2 sm:p-3 flex items-center gap-2 sm:gap-3 flex-wrap justify-center">
            <Stat label="Topic" value={state.topic} />
            <Stat label="Players" value={state.config.playerCount} />
            {state.phase === 'clues' && <Stat label="Clue round" value={`${clueRound(state)}/${state.config.clueRounds}`} />}
            {state.phase === 'reveal' && <Stat label="Cards seen" value={`${state.revealed}/${state.config.playerCount}`} />}
        </Panel>
      }
    >
      <div className="w-full max-w-[680px] mx-auto space-y-3">
        {/* ─────────── private reveal ─────────── */}
        {state.phase === 'reveal' && card && (
          <Panel className="p-0 overflow-hidden">
            <div className="px-5 py-2.5 bg-volt-400 border-b-[3px] border-ink-400">
              <span className="font-display text-[13px] font-extrabold uppercase tracking-wider text-[#5a3a12]">
                {nameOf(state, seat)}&rsquo;s card
              </span>
            </div>
            <div className="p-7 min-h-[220px] grid place-items-center text-center">
              {!held ? (
                <div>
                  <p className="text-[13px] text-cream-300 mb-1">Hand the phone to {nameOf(state, seat)}.</p>
                  <p className="text-[12px] text-cream-500 mb-4">Hold the button to see your card — let go and it hides.</p>
                  <button
                    onMouseDown={() => setHeld(true)} onMouseUp={() => setHeld(false)} onMouseLeave={() => setHeld(false)}
                    onTouchStart={(e) => { e.preventDefault(); setHeld(true); }} onTouchEnd={() => setHeld(false)}
                    onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') setHeld(true); }}
                    onKeyUp={() => setHeld(false)}
                    aria-label={`Hold to reveal the card for ${nameOf(state, seat)}`}
                    className="px-7 py-4 bg-cream-100 text-ink-800 font-display font-extrabold text-[16px] notch-sm border-2 border-ink-400 active:bg-cream-300"
                  >
                    Hold to look
                  </button>
                </div>
              ) : (
                <div
                  onMouseUp={() => setHeld(false)}
                  onTouchEnd={() => setHeld(false)}
                  className="w-full"
                >
                {card.role === 'imposter' ? (
                <div>
                  <p className="font-display text-[clamp(22px,4.5vw,34px)] font-extrabold text-[#b0301d]">You are the imposter</p>
                  <p className="mt-2 text-[13.5px] text-cream-300">
                    The topic is <strong className="text-cream-100">{card.topic}</strong>.
                  </p>
                  {card.word
                    ? <p className="mt-3 text-[14px] text-cream-100">Your decoy word is <strong className="text-cream-100">{card.word}</strong>. Bluff with it.</p>
                    : <p className="mt-3 text-[14px] text-cream-100">You do not know the word. Listen, blend in, and guess.</p>}
                </div>
              ) : (
                <div>
                  <p className="eyebrow mb-1">{card.topic}</p>
                  <p className="font-display text-[clamp(26px,6vw,46px)] font-extrabold text-cream-100">{card.word}</p>
                  <p className="mt-3 text-[13px] text-cream-300">Describe it in one word without giving it away.</p>
                </div>
              )}
                </div>
              )}
            </div>
            <div className="px-5 py-4 border-t-2 border-dashed border-ink-500 flex justify-center">
              <Button onClick={() => { setState(acknowledge(state)); setHeld(false); sfx('flip'); }} icon={<Icon name="check" size={15} />}>
                Got it — pass it on
              </Button>
            </div>
          </Panel>
        )}

        {/* ─────────── clue round ─────────── */}
        {state.phase === 'clues' && (
          <Panel className="p-7 text-center">
            <p className="eyebrow mb-1">Clue round {clueRound(state)} of {state.config.clueRounds}</p>
            <p className="font-display text-[clamp(24px,5vw,38px)] font-extrabold text-cream-100">
              {nameOf(state, clueSeat(state))}
            </p>
            <p className="mt-2 text-[13.5px] text-cream-300">
              Say one word that fits the secret. Not the word itself — and do not be so vague that you sound like the imposter.
            </p>
            <div className="mt-5 flex justify-center">
              <Button onClick={() => { setState(nextClue(state)); sfx('notify'); }} icon={<Icon name="chevron-right" size={15} />}>
                Said it — next
              </Button>
            </div>
            <div className="mt-5 flex flex-wrap justify-center gap-1.5">
              {state.order.map((s, i) => (
                <span key={i}
                  className={`px-2.5 py-1 text-[11px] font-extrabold notch-sm border-2 ${
                    i === state.clueAt % state.config.playerCount
                      ? 'bg-volt-400 border-ink-400 text-[#5a3a12]'
                      : 'bg-ink-800 border-ink-500 text-cream-500'
                  }`}>
                  {nameOf(state, s)}
                </span>
              ))}
            </div>
          </Panel>
        )}

        {/* ─────────── vote ─────────── */}
        {state.phase === 'vote' && (
          <Panel className="p-6">
            <p className="eyebrow mb-1">Vote · {nameOf(state, voter)}</p>
            <h2 className="font-display text-[20px] font-extrabold text-cream-100 mb-4">Who is the imposter?</h2>
            <div className="grid sm:grid-cols-2 gap-2">
              {Array.from({ length: state.config.playerCount }, (_, i) => i).filter((i) => i !== voter).map((i) => (
                <button
                  key={i}
                  onClick={() => {
                    const next = castVote(state, voter, i);
                    setState(next); sfx('flip');
                    const remaining = next.votes.findIndex((v) => v === null);
                    if (remaining >= 0) setVoter(remaining);
                    else { setState(closeVote(next)); sfx('go'); }
                  }}
                  aria-label={`${nameOf(state, voter)} votes for ${nameOf(state, i)}`}
                  className="px-4 py-3 border-2 border-ink-500 bg-ink-800 hover:border-ink-400 hover:bg-volt-100 notch-sm font-bold text-[14px] text-cream-100 text-left transition-colors"
                >
                  {nameOf(state, i)}
                </button>
              ))}
            </div>
            <p className="mt-3 text-[12px] text-cream-500">
              {state.votes.filter((v) => v !== null).length} of {state.config.playerCount} have voted. Pass the phone along.
            </p>
          </Panel>
        )}

        {/* ─────────── the steal ─────────── */}
        {state.phase === 'defence' && (
          <Panel className="p-6 text-center">
            <p className="eyebrow mb-1">Caught</p>
            <h2 className="font-display text-[clamp(20px,4vw,30px)] font-extrabold text-cream-100">
              {nameOf(state, state.accused ?? 0)} was the imposter
            </h2>
            <p className="mt-2 text-[13.5px] text-cream-300">
              One guess at the secret word. Get it and you steal the round.
            </p>
            <form
              onSubmit={(e) => { e.preventDefault(); setState(submitGuess(state, guess)); sfx('go'); }}
              className="mt-5 flex gap-2 justify-center flex-wrap"
            >
              <input
                value={guess} onChange={(e) => setGuess(e.target.value.slice(0, 40))}
                aria-label="The imposter's guess at the secret word"
                placeholder="The word was…"
                className="px-3.5 py-2.5 text-[14px] font-semibold notch-sm border-2 border-ink-500 bg-ink-800 text-cream-100 focus:border-ink-400 outline-none w-[220px]"
              />
              <Button type="submit" disabled={!guess.trim()} icon={<Icon name="target" size={15} />}>Guess</Button>
              <Button type="button" variant="ghost" onClick={() => { setState(concede(state)); sfx('lose'); }}>Pass</Button>
            </form>
          </Panel>
        )}

        {/* ─────────── result ─────────── */}
        {state.phase === 'result' && (
          <Panel className="p-7 text-center">
            <p className="eyebrow mb-1">{state.winner === 'crew' ? 'The crew holds' : 'The imposter wins'}</p>
            <h2 className="font-display text-[clamp(24px,5vw,38px)] font-extrabold"
              style={{ color: state.winner === 'crew' ? '#17795a' : '#b0301d' }}>
              {state.winner === 'crew' ? 'Caught them' : 'Got away with it'}
            </h2>
            <p className="mt-2 text-[13.5px] text-cream-100">{state.reason}</p>

            <div className="mt-5 grid sm:grid-cols-2 gap-2.5 text-left">
              <div className="p-3.5 border-2 border-ink-500 notch-sm bg-ink-800">
                <p className="eyebrow mb-1">The word</p>
                <p className="font-display text-[20px] font-extrabold text-cream-100">{state.word}</p>
                <p className="text-[12px] text-cream-500 mt-0.5">{state.topic}</p>
              </div>
              <div className="p-3.5 border-2 border-ink-500 notch-sm bg-ink-800">
                <p className="eyebrow mb-1">{state.imposterSeats.length > 1 ? 'The imposters' : 'The imposter'}</p>
                <p className="font-display text-[20px] font-extrabold text-[#b0301d]">
                  {state.imposterSeats.map((s) => nameOf(state, s)).join(', ')}
                </p>
                {state.decoyWord && <p className="text-[12px] text-cream-500 mt-0.5">decoy: {state.decoyWord}</p>}
              </div>
            </div>

            <div className="mt-3 p-3.5 border-2 border-ink-500 notch-sm bg-ink-850 text-left">
              <p className="eyebrow mb-1.5">Votes</p>
              <div className="flex flex-wrap gap-1.5">
                {counts.map((c, i) => (
                  <span key={i} className={`px-2.5 py-1 text-[11.5px] font-bold notch-sm border-2 ${
                    isImposter(state, i) ? 'border-[#e05a74] text-[#b63553] bg-[#ffe9ee]' : 'border-ink-500 text-cream-300 bg-ink-800'
                  }`}>
                    {nameOf(state, i)} · {c}
                  </span>
                ))}
              </div>
            </div>

            <div className="mt-5 flex gap-2.5 justify-center flex-wrap">
              <Button onClick={begin} icon={<Icon name="rotate" size={15} />}>Another round</Button>
              <Button variant="ghost" onClick={reset} icon={<Icon name="gear" size={15} />}>Change setup</Button>
            </div>
          </Panel>
        )}

        {state.phase !== 'result' && (
          <p className="text-center text-[12px] text-cream-500">
            Topic: <strong className="text-cream-100">{state.topic}</strong> · everyone can see this much
          </p>
        )}
      </div>
    </SoloShell>
  );
}
