import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { mancalaRules as R, storeOf, type MancalaState } from './rules';
import { pickMancalaMove, explainMancala } from './ai';
import MancalaBoard from '../../components/boards/MancalaBoard';
import SoloShell, { ModeRail, useSeries } from '../../components/SoloShell';
import { ResultOverlay } from '../../components/Overlays';
import { Panel, Stat } from '../../components/ui';
import { useStore } from '../../lib/store';
import type { Difficulty, GameMeta } from '../types';

const MODES = [{ value: 'ai', label: 'vs AI' }, { value: 'local', label: 'Same device' }];

export default function MancalaSolo({ game }: { game: GameMeta }) {
  const { sfx, finishMatch } = useStore();
  const [mode, setMode] = useState<'ai' | 'local'>('ai');
  const [difficulty, setDifficulty] = useState<Difficulty>('intermediate');
  const [state, setState] = useState<MancalaState>(() => R.createInitialState({}, 0));
  const [shown, setShown] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const series = useSeries(3);
  const recorded = useRef<string | null>(null);

  const reset = useCallback((keep = true) => {
    setState(R.createInitialState({}, 0));
    setShown(false);
    setLine(null);
    recorded.current = null;
    if (!keep) series.reset();
  }, []);

  useEffect(() => { reset(false); }, [mode, difficulty]);  // eslint-disable-line react-hooks/exhaustive-deps

  const play = useCallback((pit: number) => {
    setState((s) => {
      if (!R.isLegal(s, s.turn, { pit })) return s;
      const after = R.applyMove(s, s.turn, { pit });
      sfx(after.lastCapture > 0 ? 'capture' : 'place');
      return after;
    });
  }, [sfx]);

  useEffect(() => {
    if (mode !== 'ai' || state.over || state.turn !== 1) return;
    const t = setTimeout(() => {
      setState((s) => {
        if (s.over || s.turn !== 1) return s;
        const mv = pickMancalaMove(s, 1, difficulty);
        if (!mv) return s;
        setLine(explainMancala(s, 1, mv));
        sfx('place');
        return R.applyMove(s, 1, mv);
      });
    }, 420);
    return () => clearTimeout(t);
  }, [state, mode, difficulty, sfx]);

  useEffect(() => {
    if (!state.over || shown) return;
    setShown(true);
    series.record(state.winner);
    finishMatch({
      gameId: 'mancala', mode, result: state.winner === null ? 'draw' : state.winner === 0 ? 'win' : 'loss',
      meta: { difficulty, seeds: state.board[storeOf(state, 0)] },
    });
  }, [state.over]);  // eslint-disable-line react-hooks/exhaustive-deps

  const memo = useMemo(() => {
    if (state.over) {
      if (state.winner === null) return 'Level stores. A true draw.';
      return state.winner === 0 ? 'The stores are yours, seed for seed.' : 'Out-sown. Watch for the extra turns.';
    }
    if (state.lastCapture > 0) return `That capture took ${state.lastCapture} seeds.`;
    return 'Land the last seed in your own store and you go again.';
  }, [state]);

  return (
    <SoloShell
      game={game}
      mascot={state.over ? (state.winner === 0 ? 'victory' : state.winner === 1 ? 'defeated' : 'thinking') : state.turn === 1 && mode === 'ai' ? 'thinking' : 'competitive'}
      mascotLine={line ?? memo}
      onRestart={() => reset(false)}
      controls={
        <ModeRail mode={mode} setMode={setMode} difficulty={difficulty} setDifficulty={setDifficulty}
          modes={MODES} showDifficulty={mode === 'ai'} />
      }
      hud={
        <Panel className="p-2 sm:p-3 flex items-center gap-2 sm:gap-3 flex-wrap justify-center">
          <Stat label={mode === 'ai' ? 'Your store' : 'Gold store'} value={state.board[storeOf(state, 0)]} accent="#f0b429" />
          <Stat label="Series" value={`${series.wins[0]}–${series.wins[1]}`} />
          <Stat label={mode === 'ai' ? 'AI store' : 'Rose store'} value={state.board[storeOf(state, 1)]} accent="#4a9fd8" />
          <span className={`px-2.5 py-1 text-[10.5px] font-extrabold uppercase tracking-wider notch-sm ${state.turn === 0 ? 'bg-volt-400 text-[#5a3a12]' : 'bg-blush-200 text-[#5a3a12]'}`}>
            {state.over ? 'Round over' : state.turn === 0 ? 'Your turn' : mode === 'ai' ? 'AI sowing' : 'Rose to sow'}
          </span>
        </Panel>
      }
    >
      <MancalaBoard
        state={state}
        youSlot={mode === 'local' ? state.turn : 0}
        onMove={(m) => play((m as { pit: number }).pit)}
        interactive={mode === 'local' ? !state.over : !state.over && state.turn === 0}
        names={mode === 'ai' ? ['You', 'AI'] : ['Gold', 'Rose']}
      />
      {state.over && (
        <ResultOverlay
          verdict={state.winner === null ? 'draw' : state.winner === 0 ? 'win' : 'loss'}
          reason={state.reason}
          playerA={{ name: mode === 'ai' ? 'You' : 'Gold', score: state.board[storeOf(state, 0)] }}
          playerB={{ name: mode === 'ai' ? `AI (${difficulty})` : 'Rose', score: state.board[storeOf(state, 1)] }}
          rows={[
            { label: 'Seeds in store', a: state.board[storeOf(state, 0)], b: state.board[storeOf(state, 1)] },
            { label: 'Turns', a: state.history.filter((h) => h.slot === 0).length, b: state.history.filter((h) => h.slot === 1).length },
          ]}
          onRematch={() => reset(false)}
          onExit={() => reset(false)}
          rematchLabel="Play again"
          exitLabel="New board"
        />
      )}
    </SoloShell>
  );
}
