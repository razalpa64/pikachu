import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Difficulty, GameMeta, Slot } from '../types';
import SoloShell, { DIFFS, ModeRail } from '../../components/SoloShell';
import { Button, Icon, Panel, Stat } from '../../components/ui';
import { useStore } from '../../lib/store';
import type { Shot } from './physics';
import { applyShot, createInitial, liveOf, pocketedOf, type CarromState } from './rules';
import { chooseShot } from './ai';
import CarromBoard from './Board';
import { BoardStage } from '../../components/boards/BoardStage';

/**
 * Carrom against the machine, or two people on one phone.
 *
 * The board is the same component the online room uses, which is deliberate:
 * a shot you learn here behaves exactly the same against a stranger.
 *
 * The opponent is not on a timer or a script — when its turn comes it runs the
 * same simulation you do, over a spread of candidate shots, and takes the best
 * one it found. A harder opponent imagines more shots and wobbles less.
 */
export default function CarromSolo({ game }: { game: GameMeta }) {
  const { sfx, finishMatch } = useStore();
  const [mode, setMode] = useState<'ai' | 'local'>('ai');
  const [difficulty, setDifficulty] = useState<Difficulty>('casual');
  const [state, setState] = useState<CarromState>(() => createInitial());
  const [thinking, setThinking] = useState(false);
  const recorded = useRef(false);

  const reset = useCallback(() => {
    setState(createInitial());
    recorded.current = false;
    setThinking(false);
    sfx('select');
  }, [sfx]);

  const shoot = useCallback((shot: Shot) => {
    setState((s) => {
      if (s.over) return s;
      const next = applyShot(s, s.turn, shot);
      const pocketed = next.lastShot?.pocketed.length ?? 0;
      if (next.lastShot?.foul) sfx('error');
      else if (pocketed) sfx('capture');
      else sfx('move');
      return next;
    });
  }, [sfx]);

  /* The machine's turn. Deliberately off the render path: thinking takes a few
     hundred milliseconds and the board must keep breathing while it does. */
  useEffect(() => {
    if (mode !== 'ai' || state.over || state.turn !== 1) return;
    let cancelled = false;
    setThinking(true);
    const t = setTimeout(() => {
      if (cancelled) return;
      const shot = chooseShot(state, 1, difficulty);
      setThinking(false);
      if (!cancelled) setState((s) => (s.turn === 1 ? applyShot(s, 1, shot) : s));
      sfx('move');
    }, 620);
    return () => { cancelled = true; clearTimeout(t); setThinking(false); };
  }, [mode, state, difficulty, sfx]);

  useEffect(() => {
    if (!state.over || recorded.current) return;
    recorded.current = true;
    const won = state.winner === 0;
    finishMatch({
      gameId: 'carrom', mode: mode === 'ai' ? 'ai' : 'local',
      result: state.winner === null ? 'draw' : won ? 'win' : 'loss',
      score: pocketedOf(state, 0) * 10,
      meta: { shots: state.shots, queen: state.queen, fouls: state.fouls },
    });
    sfx(won ? 'win' : state.winner === null ? 'draw' : 'lose');
  }, [state.over, state.winner, state.shots, state.queen, state.fouls, mode, finishMatch, sfx]);

  const human = mode === 'local' || state.turn === 0;
  const interactive = !state.over && human;
  const mine = pocketedOf(state, 0);
  const theirs = pocketedOf(state, 1);

  const queenLine = state.queen === 'board'
    ? state.queenPending === null ? 'Queen: on the board' : 'Queen sunk — cover her!'
    : `Queen: ${state.queen === 'p0' ? 'yours' : mode === 'local' ? 'black' : 'the machine'}`;

  const mascotLine = useMemo(() => {
    if (state.over) {
      if (state.winner === null) return 'Level. Another board?';
      return state.winner === 0 ? `Board cleared in ${state.shots} shots. ${state.reason}` : 'The machine took it. Ask for a kinder level.';
    }
    if (thinking) return 'The machine is lining something up…';
    const last = state.lastShot;
    if (last?.foul === 'queen_due') return 'You cannot go out with the queen still on the board — that coin comes back.';
    if (last?.strikerIn) return 'Striker in the pocket. One of yours goes back to the centre.';
    if (last && !last.contact) return 'That shot touched nothing. Foul.';
    if (state.turn === 1 && mode === 'ai') return 'Opponent to shoot.';
    if (state.queenPending === 0) return 'Queen is down — sink one of yours to claim her.';
    return mine > theirs ? 'You are ahead on coins.' : mine < theirs ? 'Behind — a cut shot would help.' : 'Your shot. Pull back from the striker and let go.';
  }, [state, thinking, mode, mine, theirs]);

  return (
    <SoloShell
      game={game}
      wide
      mascot={state.over ? (state.winner === 0 ? 'victory' : 'defeated') : thinking ? 'thinking' : 'competitive'}
      mascotLine={mascotLine}
      onRestart={reset}
      hud={
        <Panel className="p-2 sm:p-3 flex items-center gap-2 sm:gap-4 flex-wrap justify-center">
          <Stat label={mode === 'ai' ? 'You' : 'White'} value={`${mine}/9`} accent={game.accent} />
          <Stat label={mode === 'ai' ? 'Machine' : 'Black'} value={`${theirs}/9`} />
          <Stat label="Queen" value={state.queen === 'board' ? '—' : state.queen === 'p0' ? (mode === 'ai' ? 'You' : 'W') : (mode === 'ai' ? 'AI' : 'B')} />
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
        <div className="w-full max-w-[640px] flex items-center justify-between gap-2 px-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className={`w-2.5 h-2.5 rounded-full ${state.turn === 0 ? 'bg-[#f6e6c6] ring-2 ring-[#c39a63]' : 'bg-[#3b3029] ring-2 ring-[#120c09]'}`} aria-hidden />
            <span className="text-[12px] text-cream-300 truncate">
              {state.over ? 'Board finished' : state.turn === 0
                ? (mode === 'ai' ? 'Your shot (white)' : 'White to shoot')
                : (mode === 'ai' ? (thinking ? 'Machine thinking…' : 'Machine to shoot (black)') : 'Black to shoot')}
            </span>
          </div>
          <span className="text-[11px] text-cream-400 truncate">{queenLine}</span>
        </div>

        <BoardStage ratio={1} max={620} min={260} reserve={96} chrome={6} label="Carrom board">
          <CarromBoard state={state} youSlot={0 as Slot} interactive={interactive} onShoot={shoot} />
        </BoardStage>

        <p className="text-[11px] text-cream-400 text-center max-w-[52ch] leading-snug">
          Press on your half to slide the striker along the line, pull back from it and let go.
          {state.turn === 0 && !state.over ? ' The dashed line is where it will go.' : ''}
        </p>

        {state.over && (
          <Panel className="w-full max-w-[560px] p-4 text-center">
            <p className="display text-[20px] text-cream-100">
              {state.winner === null ? 'Level board' : state.winner === 0 ? 'You cleared the board' : mode === 'ai' ? 'The machine cleared the board' : 'Black cleared the board'}
            </p>
            <p className="text-[12.5px] text-cream-500 mt-1">{state.reason}</p>
            <div className="flex justify-center gap-2 mt-3">
              <Button variant="primary" onClick={reset} icon={<Icon name="rotate" size={13} />}>New board</Button>
            </div>
          </Panel>
        )}

        <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[11px] text-cream-400">
          <span>{liveOf(state, 0)} white · {liveOf(state, 1)} black left</span>
          <span aria-hidden>·</span>
          <span>{state.shots} shot{state.shots === 1 ? '' : 's'}</span>
          <span aria-hidden>·</span>
          <span className={state.fouls[0] > state.fouls[1] ? 'text-[#c2453a]' : ''}>
            fouls {state.fouls[0]}–{state.fouls[1]}
          </span>
        </div>

        <p role="status" aria-live="polite" className="sr-only">
          {state.over ? state.reason : `${state.turn === 0 ? 'Your' : 'Opponent'} turn. ${mine} of nine down.`}
        </p>
      </div>
    </SoloShell>
  );
}
