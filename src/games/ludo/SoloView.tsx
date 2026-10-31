import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Difficulty, GameMeta, Slot } from '../types';
import SoloShell, { DIFFS, ModeRail } from '../../components/SoloShell';
import { Button, Icon, Panel, Stat } from '../../components/ui';
import { useStore } from '../../lib/store';
import { BoardStage } from '../../components/boards/BoardStage';
import { LudoBoard } from './Board';
import Die from './Die';
import { chooseToken } from './ai';
import { TOKENS, createWithSeed, homeCount, ludoRules, progressTotal, type LudoMove, type LudoState } from './rules';
import { SEAT_PAINT } from './paint';

/**
 * Ludo, against the machine or two people on one screen.
 *
 * The board is shared with the online room, so what you learn here is what you
 * play against a stranger. The only thing this screen owns is the turn: whose
 * move it is, the die, and the machine's pause before it plays.
 */
export default function LudoSolo({ game }: { game: GameMeta }) {
  const { sfx, finishMatch } = useStore();
  const [mode, setMode] = useState<'ai' | 'local'>('ai');
  const [difficulty, setDifficulty] = useState<Difficulty>('casual');
  const [seed] = useState(() => 1 + Math.floor(Math.random() * 0xfffffff));
  const [state, setState] = useState<LudoState>(() => createWithSeed(seed));
  const [rolling, setRolling] = useState(false);
  const [thinking, setThinking] = useState(false);
  const recorded = useRef(false);

  const isAiTurn = mode === 'ai' && state.turn === 1 && !state.over;

  const reset = useCallback(() => {
    setState(createWithSeed((Date.now() ^ (Math.random() * 0xffffff)) >>> 0));
    recorded.current = false;
    setRolling(false);
    setThinking(false);
    sfx('select');
  }, [sfx]);

  const play = useCallback((move: LudoMove) => {
    setState((s) => {
      if (s.over) return s;
      const next = ludoRules.applyMove(s, s.turn, move) as LudoState;
      if (next === s) return s;
      if (move.t === 'roll') setRolling(true);
      return next;
    });
    sfx('click');
    window.setTimeout(() => setRolling(false), 560);
  }, [sfx]);

  /* The machine rolls and plays, with a pause that reads as thought rather than lag. */
  useEffect(() => {
    if (!isAiTurn) return;
    let cancelled = false;
    setThinking(true);
    const t = window.setTimeout(() => {
      if (cancelled) return;
      setThinking(false);
      setState((s) => {
        if (s.turn !== 1 || s.over) return s;
        if (s.dice === null) {
          setRolling(true);
          window.setTimeout(() => setRolling(false), 560);
          const rolled = ludoRules.applyMove(s, 1, { t: 'roll' }) as LudoState;
          return rolled;
        }
        const token = chooseToken(s, 1, difficulty);
        if (token === null) return ludoRules.applyMove(s, 1, { t: 'pass' }) as LudoState;
        return ludoRules.applyMove(s, 1, { t: 'move', token }) as LudoState;
      });
      sfx('move');
    }, state.dice === null ? 620 : 760);
    return () => { cancelled = true; clearTimeout(t); setThinking(false); };
  }, [isAiTurn, state.turn, state.dice, state.moves, difficulty, sfx]);

  /* Sound for what just happened, and the result card once. */
  useEffect(() => {
    const ev = state.event;
    if (ev?.kind === 'capture') sfx('capture');
    else if (ev?.kind === 'home' || ev?.kind === 'out') sfx('coin');
    else if (ev?.kind === 'burn') sfx('error');
  }, [state.event, sfx]);

  useEffect(() => {
    if (!state.over || recorded.current) return;
    recorded.current = true;
    const won = state.winner === 0;
    finishMatch({
      gameId: 'ludo', mode: mode === 'ai' ? 'ai' : 'local',
      result: state.winner === null ? 'draw' : won ? 'win' : 'loss',
      score: homeCount(state, 0) * 100 + Math.round(progressTotal(state, 0)),
      meta: { rolls: state.moves, home: homeCount(state, 0) },
    });
    sfx(won ? 'win' : state.winner === null ? 'draw' : 'lose');
  }, [state.over, state.winner, state.moves, mode, finishMatch, sfx]);

  const yourTurn = mode === 'local' || state.turn === 0;
  const canRoll = !state.over && yourTurn && state.dice === null;
  const canPass = !state.over && yourTurn && state.dice !== null && ludoRules.legalMoves(state, 0).every((m) => m.t === 'pass');
  const mustMove = !state.over && yourTurn && state.dice !== null && !canPass;

  const gold = SEAT_PAINT[0];
  const rose = SEAT_PAINT[2];

  const status = useMemo(() => {
    if (state.over) return state.winner === 0 ? 'You brought every token home.' : state.winner === 1 ? (mode === 'ai' ? 'The machine got there first.' : 'Rose won.') : 'Level board.';
    if (state.event?.kind === 'burn') return 'Three sixes in a row — the turn is burnt.';
    if (state.event?.kind === 'pass') return `Nothing could move on a ${state.event.dice}.`;
    if (state.event?.kind === 'capture') return 'Captured. That token is back in its yard — and you roll again.';
    if (state.event?.kind === 'home') return 'A token is home.';
    if (state.dice !== null && yourTurn) return `You rolled ${state.dice}. Tap a glowing token.`;
    if (state.dice !== null) return `${mode === 'ai' ? 'The machine' : 'Rose'} rolled ${state.dice}.`;
    if (thinking) return 'The machine is rolling…';
    return yourTurn ? 'Your roll.' : `${mode === 'ai' ? 'The machine' : 'Rose'} to roll.`;
  }, [state, yourTurn, thinking, mode]);

  return (
    <SoloShell
      game={game}
      wide
      mascot={state.over ? (state.winner === 0 ? 'victory' : state.winner === 1 ? 'defeated' : 'thinking') : thinking ? 'thinking' : 'competitive'}
      mascotLine={status}
      onRestart={reset}
      hud={
        <Panel className="p-2 sm:p-3 flex items-center gap-2 sm:gap-3 flex-wrap justify-center sm:w-fit sm:mx-auto">
          {[
            { slot: 0 as Slot, paint: gold, label: mode === 'ai' ? 'You' : 'Gold' },
            { slot: 1 as Slot, paint: rose, label: mode === 'ai' ? 'Machine' : 'Rose' },
          ].map(({ slot, paint, label }) => {
            const home = homeCount(state, slot);
            const out = state.tokens[slot].filter((p) => p >= 0 && p < 56).length;
            const active = !state.over && state.turn === slot;
            return (
              <div
                key={slot}
                className={`flex items-center gap-2 rounded-[10px] px-2.5 py-1.5 border transition-colors ${active ? 'border-volt-600 bg-volt-100/45' : 'border-ink-600 bg-black/10'}`}
              >
                <span
                  aria-hidden
                  className="w-3.5 h-3.5 rounded-full shrink-0"
                  style={{ background: `radial-gradient(circle at 32% 28%, #fff, ${paint.light} 22%, ${paint.mid} 62%, ${paint.deep})`, boxShadow: '0 1px 2px rgba(0,0,0,.5)' }}
                />
                <div className="leading-tight">
                  <p className="text-[10px] uppercase tracking-wider font-bold text-cream-400">{label}</p>
                  <p className="text-[12px] text-cream-100 tabnum">{home}/4 home · {out} out</p>
                </div>
              </div>
            );
          })}
          <Stat label="Rolls" value={state.moves} />
        </Panel>
      }
      controls={
        <ModeRail
          mode={mode}
          setMode={(m: 'ai' | 'local') => { setMode(m); reset(); }}
          modes={[{ value: 'ai', label: 'vs Machine' }, { value: 'local', label: 'Two players' }]}
          difficulty={difficulty}
          setDifficulty={(d) => { setDifficulty(d); reset(); }}
        />
      }
    >
      <div className="w-full flex flex-col items-center gap-3">
        <BoardStage ratio={1} max={660} min={280} reserve={168} chrome={6} label="Ludo board">
          <LudoBoard state={state} youSlot={0} interactive={!state.over && yourTurn} onMove={play} />
        </BoardStage>

        {/* die + action */}
        <div className="w-full max-w-[560px] flex items-center justify-center gap-3 sm:gap-5">
          <div className="flex flex-col items-center gap-1">
            <Die value={state.dice} rolling={rolling} size={60} />
            <span className="text-[10px] uppercase tracking-wider font-bold text-cream-400">
              {state.dice === null ? (thinking ? 'rolling' : 'die') : 'rolled'}
            </span>
          </div>

          <div className="flex-1 min-w-0">
            {state.over ? (
              <Button variant="primary" onClick={reset} icon={<Icon name="rotate" size={13} />}>New game</Button>
            ) : canRoll ? (
              <Button variant="primary" onClick={() => play({ t: 'roll' })} icon={<Icon name="spark" size={14} />}>
                Roll the die
              </Button>
            ) : canPass ? (
              <Button variant="primary" onClick={() => play({ t: 'pass' })} icon={<Icon name="chevron-right" size={14} />}>
                Nothing to move — pass
              </Button>
            ) : mustMove ? (
              <p className="text-[12px] text-cream-300">Tap a glowing token to move it {state.dice}.</p>
            ) : (
              <p className="text-[12px] text-cream-400">{mode === 'ai' ? 'The machine is playing…' : 'Rose is playing…'}</p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[11px] text-cream-400">
          <span className="flex items-center gap-1">
            <span aria-hidden className="w-2 h-2 rounded-full" style={{ background: gold.mid }} /> gold
          </span>
          <span className="flex items-center gap-1">
            <span aria-hidden className="w-2 h-2 rounded-full" style={{ background: rose.mid }} /> rose
          </span>
          <span aria-hidden>·</span>
          <span>{state.tokens[0].filter((p) => p < 0).length + state.tokens[1].filter((p) => p < 0).length} tokens still in the yards</span>
          <span aria-hidden>·</span>
          <span>a six opens the yard and buys another roll</span>
        </div>

        {state.over && (
          <Panel className="w-full max-w-[560px] p-4 text-center">
            <p className="display text-[20px] text-cream-100">
              {state.winner === null ? 'Level board' : state.winner === 0 ? 'Every token home' : mode === 'ai' ? 'The machine wins' : 'Rose wins'}
            </p>
            <p className="text-[12.5px] text-cream-500 mt-1">{state.reason}</p>
            <div className="flex justify-center gap-2 mt-3">
              <Button variant="primary" onClick={reset} icon={<Icon name="rotate" size={13} />}>Play again</Button>
            </div>
          </Panel>
        )}

        <p role="status" aria-live="polite" className="sr-only">
          {status} Gold: {homeCount(state, 0)} of {TOKENS} home. Rose: {homeCount(state, 1)} of {TOKENS} home.
        </p>
      </div>
    </SoloShell>
  );
}
