import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Difficulty, GameMeta, Slot } from '../types';
import SoloShell, { ModeRail } from '../../components/SoloShell';
import { Button, Icon, Panel, Stat, Toggle, Segmented } from '../../components/ui';
import { ResultOverlay } from '../../components/Overlays';
import { useStore } from '../../lib/store';
import { PikachuMascot } from '../../mascot';
import {
  createEights, canPlay, playCard, drawCard, pass, chooseSuit, takePenalty,
  playable, topCard, suitOf, rankLabel, cardName, sortHand, handValue, humanise,
  SUITS, SUIT_SYMBOL, SUIT_RED, DEFAULT_EIGHTS, type EightsState, type Suit,
} from './rules';
import { decide, THINK_MS } from './ai';
import { CardFace, CardBack } from './CardFace';

const MODES = [
  { value: 'ai', label: 'Vs AI' },
  { value: 'local', label: 'Pass & play' },
];

/* ──────────────────────────────── view ──────────────────────────────── */

export default function CardsSolo({ game }: { game: GameMeta }) {
  const { sfx, finishMatch } = useStore();
  const [mode, setMode] = useState<'ai' | 'local'>('ai');
  const [difficulty, setDifficulty] = useState<Difficulty>('intermediate');
  const [actionCards, setActionCards] = useState(true);
  const [handSize, setHandSize] = useState(7);
  const [shown, setShown] = useState(false);
  const [thinking, setThinking] = useState(false);

  const config = useMemo(() => ({ ...DEFAULT_EIGHTS, actionCards, handSize }), [actionCards, handSize]);
  const [state, setState] = useState<EightsState>(() => createEights(config, Date.now() >>> 0));
  const stateRef = useRef(state);
  stateRef.current = state;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const reset = useCallback(() => {
    clearTimeout(timer.current);
    setState(createEights(config, (Date.now() ^ 0x9e3779b9) >>> 0));
    setShown(false); setThinking(false);
  }, [config]);

  useEffect(() => { reset(); }, [actionCards, handSize, mode, reset]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const seatNames = useMemo<[string, string]>(
    () => (mode === 'local' ? ['Player 1', 'Player 2'] : ['You', 'They']),
    [mode],
  );
  const say = useCallback((line: string) => humanise(line, seatNames), [seatNames]);

  const you: Slot = 0;
  const rival: Slot = 1;
  const aiTurn = mode === 'ai' && state.turn === rival && !state.over;
  const myTurn = state.turn === you || (mode === 'local' && !state.over);

  /* ── the opponent plays one action at a time, so you can follow it ── */
  useEffect(() => {
    clearTimeout(timer.current);
    if (!aiTurn) { setThinking(false); return; }
    setThinking(true);
    const [lo, hi] = THINK_MS[difficulty];
    const wait = lo + Math.random() * (hi - lo);
    timer.current = setTimeout(() => {
      const s = stateRef.current;
      if (s.over || s.turn !== rival) { setThinking(false); return; }
      const move = decide(s, rival, difficulty);
      if (move.type === 'play') { setState(playCard(s, rival, move.card)); sfx('flip'); }
      else if (move.type === 'suit') { setState(chooseSuit(s, rival, move.suit)); sfx('notify'); }
      else if (move.type === 'take') { setState(takePenalty(s, rival)); sfx('error'); }
      else if (move.type === 'draw') { setState(drawCard(s, rival)); sfx('pickup'); }
      else { setState(pass(s, rival)); sfx('notify'); }
    }, wait);
    return () => clearTimeout(timer.current);
  }, [aiTurn, state, difficulty, sfx]);

  useEffect(() => {
    if (!state.over || shown) return;
    setShown(true);
    sfx(state.winner === you ? 'win' : 'lose');
    finishMatch({
      gameId: 'cards', mode,
      result: state.winner === you ? 'win' : 'loss',
      score: handValue(state.hands[state.winner === you ? rival : you]),
      meta: { difficulty, actionCards, cardsLeft: state.hands[you].length },
    });
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [state.over]);

  const act = {
    play: (card: number) => { setState((s) => playCard(s, s.turn, card)); sfx('flip'); },
    draw: () => { setState((s) => drawCard(s, s.turn)); sfx('pickup'); },
    pass: () => { setState((s) => pass(s, s.turn)); sfx('notify'); },
    take: () => { setState((s) => takePenalty(s, s.turn)); sfx('error'); },
    suit: (suit: Suit) => { setState((s) => chooseSuit(s, s.turn, suit)); sfx('notify'); },
  };

  const seat = mode === 'local' ? state.turn : you;

  /* Pass and play used to hand the device over with the next player's hand already
     face up. The curtain is deliberately opaque and covers the table too, because a
     five-second glance at somebody else's cards is exactly how these games go wrong. */
  const [curtain, setCurtain] = useState(false);
  const prevSeat = useRef(seat);
  useEffect(() => {
    if (mode !== 'local' || state.over) { setCurtain(false); prevSeat.current = seat; return; }
    if (seat !== prevSeat.current) {
      setCurtain(true);
      prevSeat.current = seat;
    }
  }, [seat, mode, state.over]);
  const myHand = sortHand(state.hands[seat]);
  const canAct = !state.over && (mode === 'local' || state.turn === you);
  const myPlayable = canAct ? playable(state, state.turn) : [];
  const stuck = canAct && !state.awaitingSuit && state.pendingDraw === 0 && myPlayable.length === 0;
  const outOfDraws = stuck && state.drawnThisTurn >= state.config.drawLimit;
  const top = topCard(state);
  const suitChanged = state.suit !== suitOf(top);

  return (
    <SoloShell
      game={game}
      wide
      mascot={state.over ? (state.winner === you ? 'victory' : 'defeated')
        : thinking ? 'thinking'
        : state.awaitingSuit && canAct ? 'excited'
        : state.pendingDraw > 0 ? 'error'
        : myHand.length <= 2 ? 'competitive' : 'idle'}
      mascotLine={state.over ? say(state.reason)
        : thinking ? 'They are deciding.'
        : state.awaitingSuit && canAct ? 'Eight played — call the suit.'
        : state.pendingDraw > 0 && state.turn === seat ? `Pick up ${state.pendingDraw}, or answer with another two.`
        : stuck ? (outOfDraws ? 'Nothing playable and no draws left. Pass.' : 'Nothing playable — draw a card.')
        : canAct ? `Follow ${state.suit} or match the ${rankLabel(top)}.`
        : 'Waiting on the other side.'}
      onRestart={reset}
      controls={
        <ModeRail
          mode={mode} setMode={setMode} modes={MODES}
          difficulty={difficulty} setDifficulty={setDifficulty}
          showDifficulty={mode === 'ai'}
          extra={
            <>
              <span className="eyebrow ml-1">Deal</span>
              <Segmented value={handSize} onChange={setHandSize} size="sm" label="Cards dealt"
                options={[{ value: 5, label: '5' }, { value: 7, label: '7' }, { value: 9, label: '9' }]} />
              <Toggle checked={actionCards} onChange={setActionCards} label="Action cards" />
            </>
          }
        />
      }
      hud={
        <Panel className="p-2 sm:p-3 flex items-center gap-2 sm:gap-3 flex-wrap justify-center">
            <Stat label="Your cards" value={state.hands[you].length} />
            <Stat label={mode === 'ai' ? 'Theirs' : 'Player 2'} value={state.hands[rival].length} />
            <Stat label="Stock" value={state.stock.length} />
            <Stat label="In play" value={<span className={SUIT_RED[state.suit] ? 'text-ember-600' : 'text-cream-100'}>{SUIT_SYMBOL[state.suit]}</span>} />
        </Panel>
      }
    >
      <div className="relative w-full max-w-[940px] mx-auto">
        {curtain && !state.over && (
          <div className="absolute inset-0 z-30 grid place-items-center rounded-[22px]"
            style={{ background: 'linear-gradient(180deg,#fff8ec,#fff2df)' }}>
            <div className="panel panel-notch p-6 max-w-[360px] text-center a-pop">
              <PikachuMascot state="waiting" size={124} />
              <p className="eyebrow text-volt-700 mt-1 mb-1">Pass and play</p>
              <h2 className="display text-[22px] text-cream-100 leading-tight">Hand it to {mode === 'local' ? `Player ${seat + 1}` : 'your rival'}</h2>
              <p className="text-[12.5px] text-cream-500 mt-1.5 leading-relaxed">
                Their hand stays covered until they say they are ready.
              </p>
              <Button variant="primary" className="mt-4 w-full" onClick={() => { sfx('select'); setCurtain(false); }}>
                I am Player {seat + 1} — deal me in
              </Button>
            </div>
          </div>
        )}
        {/* opponent */}
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <span className="eyebrow">{mode === 'ai' ? `Rival · ${difficulty}` : 'Player 2'}</span>
          <div className="flex shrink-0" aria-label={`Opponent holds ${state.hands[rival].length} cards`}>
            {state.hands[rival].slice(0, 12).map((_, i) => (
              <div key={i} style={{ marginLeft: i ? -26 : 0 }}><CardBack small /></div>
            ))}
            {state.hands[rival].length > 12 && (
              <span className="self-center ml-2 text-[12px] font-bold text-cream-300">+{state.hands[rival].length - 12}</span>
            )}
          </div>
          {thinking && <span className="text-[11px] font-extrabold uppercase tracking-wider text-blush-600 animate-pulse">thinking…</span>}
        </div>

        {/* table */}
        <Panel className="p-5 sm:p-7" >
          <div className="flex items-center justify-center gap-7 sm:gap-12 flex-wrap">
            <div className="text-center">
              <p className="eyebrow mb-1.5">Stock</p>
              <button
                onClick={act.draw}
                disabled={!canAct || state.awaitingSuit || state.pendingDraw > 0 || outOfDraws || !stuck}
                aria-label="Draw a card from the stock"
                className="disabled:opacity-55 disabled:cursor-default enabled:hover:-translate-y-1 transition-transform"
              >
                <CardBack count={state.stock.length} />
              </button>
              {canAct && stuck && !outOfDraws && (
                <p className="mt-1 text-[10.5px] font-bold text-cream-500">{state.config.drawLimit - state.drawnThisTurn} draws left</p>
              )}
            </div>

            <div className="text-center">
              <p className="eyebrow mb-1.5">In play</p>
              <CardFace card={top} label={`Top card: ${cardName(top)}`} />
              {suitChanged && (
                <p className="mt-1.5 text-[11px] font-extrabold uppercase tracking-wide">
                  <span className="text-cream-500">called </span>
                  <span className={SUIT_RED[state.suit] ? 'text-ember-600' : 'text-cream-100'}>
                    {SUIT_SYMBOL[state.suit]} {state.suit}
                  </span>
                </p>
              )}
            </div>

            {state.pendingDraw > 0 && (
              <div className="text-center">
                <p className="eyebrow mb-1.5">Penalty</p>
                <div className="w-[64px] h-[92px] grid place-items-center rounded-[10px] border-[2.5px] border-[#e05a74] bg-[#ffe0e6]">
                  <span className="font-display text-[26px] font-extrabold text-[#b63553]">+{state.pendingDraw}</span>
                </div>
              </div>
            )}
          </div>

          {/* suit chooser */}
          {state.awaitingSuit && canAct && (
            <div className="mt-5 pt-4 border-t-2 border-dashed border-ink-500">
              <p className="eyebrow mb-2">Call a suit</p>
              <div className="flex gap-2 flex-wrap">
                {SUITS.map((s) => (
                  <button
                    key={s}
                    onClick={() => act.suit(s)}
                    aria-label={`Call ${s}`}
                    className={`px-4 py-2.5 border-2 border-ink-400 notch-sm bg-ink-800 hover:bg-volt-200 font-extrabold text-[15px] transition-colors ${
                      SUIT_RED[s] ? 'text-ember-600' : 'text-cream-100'
                    }`}
                  >
                    <span className="text-[20px] mr-1.5">{SUIT_SYMBOL[s]}</span>{s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* the only two recovery actions, shown only when they are legal */}
          {canAct && !state.awaitingSuit && (state.pendingDraw > 0 || outOfDraws) && (
            <div className="mt-5 pt-4 border-t-2 border-dashed border-ink-500 flex gap-2 flex-wrap">
              {state.pendingDraw > 0 && (
                <Button variant="ghost" onClick={act.take} icon={<Icon name="plus" size={14} />}>
                  Pick up {state.pendingDraw}
                </Button>
              )}
              {outOfDraws && state.pendingDraw === 0 && (
                <Button variant="ghost" onClick={act.pass} icon={<Icon name="x" size={14} />}>Pass the turn</Button>
              )}
            </div>
          )}
        </Panel>

        {/* your hand */}
        <div className="mt-4">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className="eyebrow">{mode === 'local' ? `Player ${seat + 1}` : 'Your hand'}</span>
            <span className="text-[11px] font-bold text-cream-500">{myHand.length} cards · {handValue(myHand)} pts</span>
            {canAct && myPlayable.length > 0 && !state.awaitingSuit && (
              <span className="text-[11px] font-extrabold uppercase tracking-wide text-leaf-700">{myPlayable.length} playable</span>
            )}
          </div>
          <div className="flex gap-1.5 flex-wrap" role="group" aria-label="Your hand">
            {myHand.map((card) => {
              const ok = canAct && canPlay(state, card);
              return (
                <CardFace
                  key={card}
                  card={card}
                  onClick={ok ? () => act.play(card) : undefined}
                  disabled={!ok}
                  dim={canAct && !ok}
                  label={`${cardName(card)}${ok ? '' : ' — not playable'}`}
                />
              );
            })}
          </div>
        </div>

        {/* table feed */}
        <div className="mt-4 max-h-[88px] overflow-y-auto text-[12px] text-cream-500 space-y-0.5" aria-live="polite" aria-label="Table log">
          {state.log.slice(-5).reverse().map((line, i) => (
            <p key={state.log.length - i} className={i === 0 ? 'text-cream-100 font-semibold' : ''}>{say(line)}</p>
          ))}
        </div>

        {state.over && shown && (
          <ResultOverlay
            verdict={state.winner === you ? 'win' : 'loss'}
            reason={say(state.reason)}
            playerA={{ name: 'You', score: handValue(state.hands[you]), you: true }}
            playerB={{ name: mode === 'ai' ? `Rival (${difficulty})` : 'Player 2', score: handValue(state.hands[rival]) }}
            rows={[
              { label: 'Cards left', a: state.hands[you].length, b: state.hands[rival].length },
              { label: 'Penalty points', a: handValue(state.hands[you]), b: handValue(state.hands[rival]) },
            ]}
            onRematch={reset} rematchLabel="Deal again" onExit={reset}
          />
        )}
      </div>
    </SoloShell>
  );
}
