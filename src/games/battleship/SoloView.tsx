import { useCallback, useEffect, useRef, useState } from 'react';
import { battleshipRules as R, autoPlace, FLEET, type BSState } from './rules';
import { newBSBrain, pickBSShot, type BSBrain } from './ai';
import BattleshipBoard from '../../components/boards/BattleshipBoard';
import SoloShell, { ModeRail } from '../../components/SoloShell';
import { ResultOverlay } from '../../components/Overlays';
import { Panel, Stat } from '../../components/ui';
import { useStore } from '../../lib/store';
import type { Difficulty, GameMeta } from '../types';

export default function BattleshipSolo({ game }: { game: GameMeta }) {
  const { sfx, finishMatch } = useStore();
  const [difficulty, setDifficulty] = useState<Difficulty>('intermediate');
  const [state, setState] = useState<BSState>(() => R.createInitialState({}, 0));
  const [shown, setShown] = useState(false);
  const brain = useRef<BSBrain>(newBSBrain());

  const reset = useCallback(() => {
    let s = R.createInitialState({}, 0);
    s = R.applyMove(s, 1, { type: 'place', ships: autoPlace((Date.now() * 2654435761) >>> 0) });
    s = R.applyMove(s, 1, { type: 'ready' });
    setState(s); setShown(false);
    brain.current = newBSBrain();
  }, []);
  useEffect(() => { reset(); }, [difficulty]);

  const act = (move: any) => {
    setState((s) => {
      if (!R.isLegal(s, 0, move)) return s;
      if (move.type === 'fire') {
        const after = R.applyMove(s, 0, move);
        const shot = after.lastShot!;
        sfx(shot.sunk ? 'sunk' : shot.hit ? 'hit' : 'miss');
        return after;
      }
      return R.applyMove(s, 0, move);
    });
  };

  /* AI return fire */
  useEffect(() => {
    if (state.phase !== 'battle' || state.over || state.turn !== 1) return;
    const t = setTimeout(() => {
      setState((s) => {
        if (s.over || s.turn !== 1 || s.phase !== 'battle') return s;
        const cell = pickBSShot(s, 1, brain.current, difficulty);
        if (!R.isLegal(s, 1, { type: 'fire', cell })) return s;
        const after = R.applyMove(s, 1, { type: 'fire', cell });
        const shot = after.lastShot!;
        sfx(shot.sunk ? 'sunk' : shot.hit ? 'hit' : 'miss');
        return after;
      });
    }, 620);
    return () => clearTimeout(t);
  }, [state, difficulty, sfx]);

  useEffect(() => {
    if (!state.over || shown) return;
    setShown(true);
    const mine = state.fleets[0];
    finishMatch({
      gameId: 'battleship', mode: 'ai',
      result: state.winner === 0 ? 'win' : 'loss',
      meta: { flawlessFleet: state.winner === 0 && mine.every((s) => s.hits.length === 0), difficulty },
    });
  }, [state.over]);

  const shots = state.shots[0].length;
  const hits = state.hits[0].length;

  return (
    <SoloShell game={game} wide
      mascot={state.over ? (state.winner === 0 ? 'victory' : 'defeated') : state.lastShot?.hit && state.lastShot.by === 0 ? 'excited' : state.turn === 1 ? 'thinking' : 'competitive'}
      mascotLine={state.phase === 'placement' ? 'Lay out your fleet, then lock it in.'
        : state.over ? (state.winner === 0 ? 'Enemy fleet destroyed!' : 'Our fleet is gone. Rebuild and go again.')
        : state.lastShot ? `${state.lastShot.by === 0 ? 'You' : 'Enemy'} ${state.lastShot.sunk ? `sank the ${FLEET.find((f) => f.id === state.lastShot!.sunk)?.name}!` : state.lastShot.hit ? 'scored a hit!' : 'missed.'}`
        : 'Hits let you fire again. Hunt in a parity pattern.'}
      onRestart={reset}
      controls={<ModeRail mode="ai" setMode={() => {}} difficulty={difficulty} setDifficulty={setDifficulty}
        modes={[{ value: 'ai', label: 'vs AI Commander' }]} />}
      hud={
        <Panel className="p-2 sm:p-3 flex items-center gap-2 sm:gap-3 flex-wrap justify-center">
          <Stat label="Shots" value={shots} />
          <Stat label="Hits" value={hits} accent="#e05a74" />
          <Stat label="Accuracy" value={shots ? `${Math.round((hits / shots) * 100)}%` : '—'} accent="#4a9fd8" />
          <Stat label="Sunk" value={`${state.sunk[0].length}/5`} accent="#3fae82" />
          <Stat label="Lost" value={`${state.sunk[1].length}/5`} />
          <span className={`px-2.5 py-1 text-[10.5px] font-extrabold uppercase tracking-wider notch-sm ${state.phase === 'placement' ? 'bg-blush-100 text-cream-300' : state.turn === 0 ? 'bg-spark-400 text-[#5a3a12]' : 'bg-ember-400 text-cream-100'}`}>
            {state.over ? 'Battle over' : state.phase === 'placement' ? 'Deployment' : state.turn === 0 ? 'Your salvo' : 'Incoming fire'}
          </span>
        </Panel>
      }>
      <div className="relative">
        <BattleshipBoard state={state} youSlot={0} onMove={act}
          interactive={!state.over && (state.phase === 'placement' ? !state.ready[0] : state.turn === 0)}
          names={['You', 'AI Commander']} />
        {state.over && shown && (
          <ResultOverlay verdict={state.winner === 0 ? 'win' : 'loss'} reason={state.reason}
            playerA={{ name: 'You', score: `${state.sunk[0].length}/5`, you: true }}
            playerB={{ name: `AI (${difficulty})`, score: `${state.sunk[1].length}/5` }}
            rows={[{ label: 'Shots fired', a: state.shots[0].length, b: state.shots[1].length },
                   { label: 'Accuracy', a: `${shots ? Math.round((hits / shots) * 100) : 0}%`, b: `${state.shots[1].length ? Math.round((state.hits[1].length / state.shots[1].length) * 100) : 0}%` }]}
            onRematch={reset} rematchLabel="New battle" onExit={reset} exitLabel="Redeploy" />
        )}
      </div>
    </SoloShell>
  );
}
