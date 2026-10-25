import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { gomokuRules as R, type GomokuState } from './rules';
import { pickGomokuMove, explainGomoku } from './ai';
import GomokuBoard from '../../components/boards/GomokuBoard';
import SoloShell, { ModeRail, useSeries } from '../../components/SoloShell';
import { ResultOverlay } from '../../components/Overlays';
import { Panel, Stat } from '../../components/ui';
import { useStore } from '../../lib/store';
import type { Difficulty, GameMeta } from '../types';

const MODES = [{ value: 'ai', label: 'vs AI' }, { value: 'local', label: 'Same device' }];

export default function GomokuSolo({ game }: { game: GameMeta }) {
  const { sfx, finishMatch } = useStore();
  const [mode, setMode] = useState<'ai' | 'local'>('ai');
  const [difficulty, setDifficulty] = useState<Difficulty>('intermediate');
  const [size, setSize] = useState(15);
  const [state, setState] = useState<GomokuState>(() => R.createInitialState({ size: 15 }, 0));
  const [shown, setShown] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const series = useSeries(3);
  const recorded = useRef<string | null>(null);

  const reset = useCallback((keep = true) => {
    setState(R.createInitialState({ size }, 0));
    setShown(false);
    setLine(null);
    recorded.current = null;
    if (!keep) series.reset();
  }, [size]);

  useEffect(() => { reset(false); }, [mode, difficulty, size]);  // eslint-disable-line react-hooks/exhaustive-deps

  const play = useCallback((cell: number) => {
    setState((s) => {
      if (!R.isLegal(s, s.turn, { cell })) return s;
      sfx('place');
      return R.applyMove(s, s.turn, { cell });
    });
  }, [sfx]);

  useEffect(() => {
    if (mode !== 'ai' || state.over || state.turn !== 1) return;
    const t = setTimeout(() => {
      setState((s) => {
        if (s.over || s.turn !== 1) return s;
        const mv = pickGomokuMove(s, 1, difficulty);
        if (!mv) return s;
        setLine(explainGomoku(s, 1, mv));
        sfx('place');
        return R.applyMove(s, 1, mv);
      });
    }, 320);
    return () => clearTimeout(t);
  }, [state, mode, difficulty, sfx]);

  useEffect(() => {
    if (!state.over || shown) return;
    setShown(true);
    series.record(state.winner);
    finishMatch({
      gameId: 'gomoku', mode, result: state.winner === null ? 'draw' : state.winner === 0 ? 'win' : 'loss',
      meta: { difficulty, stones: state.history.length },
    });
  }, [state.over]);  // eslint-disable-line react-hooks/exhaustive-deps

  const stones = (p: 0 | 1) => state.board.filter((v) => v === p).length;

  const memo = useMemo(() => {
    if (state.over) {
      if (state.winner === null) return 'The board filled up. Nobody blinked.';
      return state.winner === 0 ? 'Five in a row. Clean as a river stone.' : 'Five stones slipped past me. Again?';
    }
    return 'Five in a row wins. Try to build two threats at once.';
  }, [state]);

  return (
    <SoloShell
      game={game}
      mascot={state.over ? (state.winner === 0 ? 'victory' : state.winner === 1 ? 'defeated' : 'thinking') : state.turn === 1 && mode === 'ai' ? 'thinking' : 'competitive'}
      mascotLine={line ?? memo}
      onRestart={() => reset(false)}
      controls={
        <ModeRail mode={mode} setMode={setMode} difficulty={difficulty} setDifficulty={setDifficulty}
          modes={MODES} showDifficulty={mode === 'ai'}
          extra={
            <label className="flex items-center gap-2 text-[11.5px] font-bold text-cream-300">
              <span className="eyebrow">Board</span>
              <select
                value={size}
                onChange={(e) => setSize(Number(e.target.value))}
                className="bg-white border-2 border-ink-500 rounded-full px-3 py-1.5 text-[12px] font-bold text-cream-100 outline-none focus:border-blush-300 cursor-pointer"
              >
                <option value={15}>15 × 15</option>
                <option value={13}>13 × 13</option>
                <option value={11}>11 × 11</option>
                <option value={9}>9 × 9</option>
              </select>
            </label>
          } />
      }
      hud={
        <Panel className="p-2 sm:p-3 flex items-center gap-2 sm:gap-3 flex-wrap justify-center">
          <Stat label={mode === 'ai' ? 'You' : 'Gold'} value={series.wins[0]} accent="#8d5a05" />
          <Stat label="Draws" value={series.draws} />
          <Stat label={mode === 'ai' ? `AI ${difficulty}` : 'Rose'} value={series.wins[1]} accent="#1f6699" />
          <span className={`px-2.5 py-1 text-[10.5px] font-extrabold uppercase tracking-wider notch-sm ${state.turn === 0 ? 'bg-volt-400 text-[#5a3a12]' : 'bg-blush-200 text-[#5a3a12]'}`}>
            {state.over ? 'Round over' : state.turn === 0 ? 'Gold to place' : mode === 'ai' ? 'AI thinking' : 'Rose to place'}
          </span>
        </Panel>
      }
    >
      <GomokuBoard
        state={state}
        youSlot={mode === 'local' ? state.turn : 0}
        onMove={(m) => play((m as { cell: number }).cell)}
        interactive={mode === 'local' ? !state.over : !state.over && state.turn === 0}
        names={mode === 'ai' ? ['You', 'AI'] : ['Gold', 'Rose']}
        hint
      />
      {state.over && (
        <ResultOverlay
          verdict={state.winner === null ? 'draw' : state.winner === 0 ? 'win' : 'loss'}
          reason={state.reason}
          playerA={{ name: mode === 'ai' ? 'You' : 'Gold', score: stones(0) }}
          playerB={{ name: mode === 'ai' ? `AI (${difficulty})` : 'Rose', score: stones(1) }}
          rows={[{ label: 'Stones placed', a: stones(0), b: stones(1) }]}
          onRematch={() => reset(false)}
          rematchLabel="Play again"
        />
      )}
    </SoloShell>
  );
}
