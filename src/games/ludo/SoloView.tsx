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
    /* The updater is pure: which animation to play is decided out here, from the
       move, not from inside React's state calculation. */
    if (move.t === 'roll') {
      setRolling(true);
      window.setTimeout(() => setRolling(false), 560);
    }
    setState((s) => {
      if (s.over) return s;
      return ludoRules.applyMove(s, s.turn, move) as LudoState;
    });
    sfx(move.t === 'roll' ? 'click' : 'move');
  }, [sfx]);

  /* The machine rolls and plays, with a pause that reads as thought rather than
     lag. It reads the position out here and hands back a finished state, instead
     of doing arithmetic inside React's state updater — an updater that called
     setState of its own ran twice under StrictMode and could drop a roll. */
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (!isAiTurn) { setThinking(false); return; }
    setThinking(true);
    const delay = state.dice === null ? 620 : 780;
    const t = window.setTimeout(() => {
      const s = stateRef.current;
      if (s.turn !== 1 || s.over) { setThinking(false); return; }
      if (s.dice === null) {
        setRolling(true);
        window.setTimeout(() => setRolling(false), 520);
        setState(ludoRules.applyMove(s, 1, { t: 'roll' }) as LudoState);
        sfx('click');
        return;
      }
      const token = chooseToken(s, 1, difficulty);
      const mv: LudoMove = token === null ? { t: 'pass' } : { t: 'move', token };
      setState(ludoRules.applyMove(s, 1, mv) as LudoState);
      setThinking(false);
      sfx(token === null ? 'select' : 'move');
    }, delay);
    return () => clearTimeout(t);
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

  /* Whose move the *device* is being asked to make. In a two-player game that is
     whoever is on turn; against the machine it is always you.
     Everything below is computed against this seat, not against seat 0 — using
     seat 0 unconditionally meant that on Rose's turn `legalMoves(state, 0)` was
     empty, `[].every(...)` was vacuously true, and the screen offered a "Nothing
     to move — pass" button while four tokens were plainly movable. Clicking it
     did nothing and the game was stuck for good. */
  const acting: Slot = mode === 'local' ? state.turn : 0;
  const yourTurn = mode === 'local' || state.turn === 0;
  const legal = yourTurn && state.dice !== null && !state.over ? ludoRules.legalMoves(state, acting) : [];
  const canRoll = !state.over && yourTurn && state.dice === null;
  const canPass = !state.over && yourTurn && state.dice !== null && legal.length > 0 && legal.every((m) => m.t === 'pass');
  const mustMove = !state.over && yourTurn && state.dice !== null && legal.some((m) => m.t === 'move');

  const gold = SEAT_PAINT[0];
  const rose = SEAT_PAINT[2];
  const seatPaint = acting === 0 ? gold : rose;

  /* One name per side, used by every sentence on the screen, so the board, the
     scoreboard and the talking Pikachu never disagree about who is who. */
  const who = useCallback(
    (slot: Slot) => (mode === 'ai' ? (slot === 0 ? 'You' : 'The machine') : slot === 0 ? 'Blue' : 'Rose'),
    [mode],
  );

  const status = useMemo(() => {
    const mover = who(state.turn);
    if (state.over) {
      if (state.winner === null) return 'Level board.';
      if (state.winner === 0) return mode === 'ai' ? 'Every token home — you won.' : 'Every token home — Blue won.';
      return mode === 'ai' ? 'The machine got there first.' : 'Every token home — Rose won.';
    }
    if (state.event?.kind === 'burn') return 'Three sixes in a row — the turn is burnt.';
    if (state.event?.kind === 'pass') return `Nothing could move on a ${state.event.dice}.`;
    if (state.event?.kind === 'capture') return 'Captured — that token is back in its yard.';
    if (state.event?.kind === 'home') return 'A token is home.';
    if (state.dice !== null) {
      if (!yourTurn) return `${mover} rolled ${state.dice}.`;
      if (mustMove) return `${mode === 'ai' ? 'You' : mover} rolled ${state.dice}. Tap a glowing token.`;
      return `${mode === 'ai' ? 'You' : mover} rolled ${state.dice} — nothing can use it.`;
    }
    if (thinking) return 'The machine is rolling…';
    if (yourTurn) return mode === 'ai' ? 'Your roll.' : `${mover} — roll the die.`;
    return `${mover} to roll.`;
  }, [state, yourTurn, thinking, mode, mustMove, who]);

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
            { slot: 0 as Slot, paint: gold, label: mode === 'ai' ? 'You' : 'Blue' },
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
          <LudoBoard state={state} youSlot={acting} interactive={!state.over && yourTurn} onMove={play} />
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
            ) : yourTurn ? (
              <p className="text-[12px] text-cream-400">Nothing on the board can use a {state.dice}.</p>
            ) : (
              <p className="text-[12px] text-cream-400">{mode === 'ai' ? 'The machine is playing…' : 'Rose is playing…'}</p>
            )}
          </div>
        </div>

        {/* The board is a canvas, so it is a picture to a keyboard and a screen
            reader. These are the same moves as real buttons. */}
        {mustMove && (
          <div className="flex flex-wrap items-center justify-center gap-2" role="group" aria-label={`Move a token ${state.dice}`}>
            {[0, 1, 2, 3].map((token) => {
              const canUse = legal.some((m) => m.t === 'move' && m.token === token);
              const at = state.tokens[acting][token];
              const where = at < 0 ? 'in the yard' : at >= 56 ? 'home' : `${56 - at} to home`;
              return (
                <button
                  key={token}
                  type="button"
                  disabled={!canUse}
                  onClick={() => canUse && play({ t: 'move', token })}
                  aria-label={`Move token ${token + 1} — ${where}`}
                  className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-semibold transition-colors ${
                    canUse
                      ? 'border-volt-600 bg-volt-100/50 text-ink-900 hover:bg-volt-200'
                      : 'border-ink-600/60 text-cream-500 opacity-55'
                  }`}
                >
                  <span
                    aria-hidden
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ background: `radial-gradient(circle at 32% 26%, #fff, ${seatPaint.light} 24%, ${seatPaint.mid} 66%, ${seatPaint.deep})` }}
                  />
                  Token {token + 1}
                  <span className="text-[10px] font-normal opacity-75 tabnum">{where}</span>
                </button>
              );
            })}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[11px] text-cream-400">
          <span className="flex items-center gap-1">
            <span aria-hidden className="w-2 h-2 rounded-full" style={{ background: gold.mid }} /> blue
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
          {status} Blue: {homeCount(state, 0)} of {TOKENS} home. Rose: {homeCount(state, 1)} of {TOKENS} home.
        </p>
      </div>
    </SoloShell>
  );
}
