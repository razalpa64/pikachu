import { useCallback, useEffect, useMemo, useState } from 'react';
import type { GameMeta } from '../types';
import SoloShell from '../../components/SoloShell';
import { Button, Icon, Panel, Stat, Toggle } from '../../components/ui';
import { useStore } from '../../lib/store';
import { HEAT_BLURB, HEAT_LABEL, type Heat } from './deck';
import { cardAt, createDare, draw, remaining, rename, resolve, reheat, setTurn, type DareState } from './rules';
import Bottle from './Bottle';

const HEATS: Heat[] = ['sweet', 'flirty', 'spicy'];

export default function DareSolo({ game }: { game: GameMeta }) {
  const { sfx, identity, finishMatch } = useStore();
  const [p2, setP2] = useState('Them');
  const names = useMemo<[string, string]>(
    () => [identity.name?.trim() || 'You', p2.trim() || 'Them'],
    [identity, p2],
  );

  const [heats, setHeats] = useState<Heat[]>(['sweet', 'flirty']);
  const [spicyUnlocked, setSpicyUnlocked] = useState(false);
  const [state, setState] = useState<DareState>(() => createDare(['sweet', 'flirty'], names, Date.now() >>> 0));
  const [peeked, setPeeked] = useState(false);

  // keep the deck in step with the heat switches
  useEffect(() => { setState((s) => reheat(s, heats)); setPeeked(false); }, [heats]);
  // ...and the scoreboard in step with the name fields
  useEffect(() => { setState((s) => rename(s, names)); }, [names]);

  const reset = useCallback(() => {
    setState(createDare(heats, names, (Date.now() ^ 0x27d4eb2f) >>> 0));
    setPeeked(false);
  }, [heats, names]);

  const toggleHeat = (h: Heat) => {
    if (h === 'spicy' && !spicyUnlocked) return;
    setHeats((cur) => (cur.includes(h) ? (cur.length > 1 ? cur.filter((x) => x !== h) : cur) : [...cur, h]));
  };

  const pull = (kind: 'truth' | 'dare') => {
    setState((s) => draw(s, kind));
    setPeeked(false);
    sfx('flip');
  };

  const finish = (outcome: 'done' | 'skipped') => {
    setState((s) => resolve(s, outcome));
    setPeeked(false);
    sfx(outcome === 'done' ? 'win' : 'notify');
  };

  const card = state.current ? cardAt(state.current.index) : null;
  const who = state.players[state.turn];
  const other = state.players[state.turn === 0 ? 1 : 0];

  // a session has no win condition — record it as a shared activity, not a contest
  const [logged, setLogged] = useState(false);
  useEffect(() => {
    if (state.history.length < 10 || logged) return;
    setLogged(true);
    finishMatch({
      gameId: 'dare', mode: 'local', result: 'draw', score: state.history.filter((h) => h.outcome === 'done').length,
      meta: { rounds: state.round, heats: heats.join('+') },
    });
  }, [state.history.length, logged, state.round, heats, finishMatch]);

  return (
    <SoloShell
      game={game}
      mascot={card ? (card.heat === 'spicy' ? 'excited' : 'competitive') : state.history.length ? 'idle' : 'waiting'}
      mascotLine={card
        ? `${who.name}, this one is yours. No penalty for passing.`
        : `${who.name}'s turn. Truth or dare?`}
      onRestart={reset}
      hud={
        <Panel className="p-2 sm:p-3 flex items-center gap-2 sm:gap-3 flex-wrap justify-center">
            <Stat label="Round" value={state.round} />
            <Stat label={names[0]} value={state.players[0].done} />
            <Stat label={names[1]} value={state.players[1].done} />
            <Stat label="Played" value={state.history.length} />
        </Panel>
      }
      controls={
        <>
          <span className="eyebrow">Heat</span>
          {HEATS.map((h) => {
            const on = heats.includes(h);
            const locked = h === 'spicy' && !spicyUnlocked;
            return (
              <button
                key={h}
                onClick={() => toggleHeat(h)}
                disabled={locked}
                aria-pressed={on}
                title={locked ? 'Switch on the spicy deck below first' : HEAT_BLURB[h]}
                className={`px-3 py-1.5 text-[12px] font-extrabold notch-sm border-2 transition-colors ${
                  locked ? 'bg-ink-850 text-cream-500 border-ink-500 cursor-not-allowed'
                    : on ? 'bg-blush-300 text-[#6d2038] border-ink-400'
                    : 'bg-ink-800 text-cream-300 border-ink-500 hover:border-ink-400'
                }`}
              >
                {HEAT_LABEL[h]}
              </button>
            );
          })}
        </>
      }
    >
      <div className="w-full max-w-[760px] mx-auto space-y-3">
        {/* the bottle decides, then the card appears below it */}
        <Bottle
          names={names}
          turn={state.turn}
          disabled={!!card}
          onSpinStart={() => sfx('flip')}
          onLanded={(slot) => { setState((s) => setTurn(s, slot)); sfx('join'); }}
        />

        {/* running tally for each player */}
        <div className="flex items-center justify-center gap-2.5 flex-wrap">
          {state.players.map((p, i) => (
            <div
              key={i}
              className={`px-4 py-2 notch-sm border-2 font-display font-extrabold text-[15px] transition-colors ${
                state.turn === i ? 'bg-volt-400 border-ink-400 text-[#5a3a12]' : 'bg-ink-800 border-ink-500 text-cream-500'
              }`}
              aria-current={state.turn === i ? 'true' : undefined}
            >
              {p.name}
              <span className="ml-2 text-[11px] font-bold opacity-70">{p.done}✓ {p.skipped}↷</span>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-center gap-2">
          <label htmlFor="dare-p2" className="eyebrow">Who are you playing with?</label>
          <input
            id="dare-p2" value={p2} onChange={(e) => setP2(e.target.value.slice(0, 18))}
            placeholder="Their name"
            className="px-3 py-1.5 text-[13px] font-bold notch-sm border-2 border-ink-500 bg-ink-800 text-cream-100 focus:border-ink-400 outline-none w-[150px]"
          />
        </div>

        {/* the card */}
        {!card ? (
          <Panel className="p-7 text-center">
            <p className="eyebrow mb-1">{who.name}, choose</p>
            <h2 className="font-display text-[clamp(21px,3.6vw,30px)] font-extrabold text-cream-100">
              Truth or dare?
            </h2>
            <p className="mt-1.5 text-[13px] text-cream-300">
              {other.name} reads it out. You can always pass — it costs nothing.
            </p>
            <div className="mt-5 flex gap-3 justify-center flex-wrap">
              <Button size="lg" onClick={() => pull('truth')} icon={<Icon name="brain" size={16} />}>
                Truth
                <span className="ml-2 text-[11px] opacity-70">{remaining(state, 'truth')} left</span>
              </Button>
              <Button size="lg" variant="ghost" onClick={() => pull('dare')} icon={<Icon name="bolt" size={16} />}>
                Dare
                <span className="ml-2 text-[11px] opacity-70">{remaining(state, 'dare')} left</span>
              </Button>
            </div>
          </Panel>
        ) : (
          <Panel className="p-0 overflow-hidden">
            <div
              className="px-5 py-2.5 flex items-center justify-between border-b-[3px] border-ink-400"
              style={{ background: card.heat === 'spicy' ? '#f2779a' : card.heat === 'flirty' ? '#ffadc6' : '#ffd95a' }}
            >
              <span className="font-display text-[13px] font-extrabold uppercase tracking-wider text-[#5a2a38]">
                {card.kind === 'truth' ? 'Truth' : 'Dare'} · {HEAT_LABEL[card.heat]}
              </span>
              <span className="text-[11px] font-bold text-[#5a2a38]/70">for {who.name}</span>
            </div>

            <div className="p-6 sm:p-9 min-h-[180px] grid place-items-center text-center">
              {card.heat === 'spicy' && !peeked ? (
                <div>
                  <p className="text-[13px] text-cream-300 mb-3">This one is spicy. Make sure the room is yours.</p>
                  <Button onClick={() => setPeeked(true)} icon={<Icon name="sparkle" size={15} />}>Reveal it</Button>
                </div>
              ) : (
                <p className="font-display text-[clamp(18px,3.4vw,26px)] font-extrabold leading-snug text-cream-100">
                  {card.text}
                </p>
              )}
            </div>

            {(card.heat !== 'spicy' || peeked) && (
              <div className="px-5 py-4 border-t-2 border-dashed border-ink-500 flex gap-2.5 justify-center flex-wrap">
                <Button onClick={() => finish('done')} icon={<Icon name="check" size={15} />}>Did it</Button>
                <Button variant="ghost" onClick={() => finish('skipped')} icon={<Icon name="x" size={15} />}>Pass</Button>
              </div>
            )}
          </Panel>
        )}

        {/* spicy gate — an explicit opt-in, not a hidden setting */}
        <Panel className="p-4">
          <div className="flex items-start gap-3 flex-wrap">
            <div className="flex-1 min-w-[240px]">
              <p className="font-display text-[14px] font-extrabold text-cream-100">Spicy deck</p>
              <p className="text-[12.5px] text-cream-300 mt-0.5">
                Suggestive, private prompts for the two of you. Nothing graphic, and every card is still skippable.
              </p>
            </div>
            <Toggle checked={spicyUnlocked} onChange={(v) => { setSpicyUnlocked(v); if (!v) setHeats((c) => c.filter((h) => h !== 'spicy')); }} label="Unlock spicy" />
          </div>
        </Panel>

        {/* history */}
        {state.history.length > 0 && (
          <Panel className="p-4">
            <p className="eyebrow mb-2">This session</p>
            <ul className="space-y-1.5 max-h-[150px] overflow-y-auto">
              {state.history.slice().reverse().slice(0, 12).map((h, i) => (
                <li key={state.history.length - i} className="text-[12.5px] flex gap-2">
                  <span className={`shrink-0 font-extrabold ${h.outcome === 'done' ? 'text-[#2f9c71]' : 'text-cream-500'}`}>
                    {h.outcome === 'done' ? '✓' : '↷'}
                  </span>
                  <span className="shrink-0 font-bold text-cream-100">{state.players[h.player].name}</span>
                  <span className="text-cream-500 truncate">{h.card.text}</span>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>
    </SoloShell>
  );
}
