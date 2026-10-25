import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { dotsRules as R, type DotsEdge, type DotsState } from './rules';
import { pickDotsMove, explainDots } from './ai';
import DotsBoard from '../../components/boards/DotsBoard';
import SoloShell, { ModeRail, useSeries } from '../../components/SoloShell';
import { ResultOverlay } from '../../components/Overlays';
import { Panel, Stat } from '../../components/ui';
import { useStore } from '../../lib/store';
import type { Difficulty, GameMeta } from '../types';

const MODES = [{ value: 'ai', label: 'vs AI' }, { value: 'local', label: 'Same device' }];
const SIZES = [
  { value: 4, label: '3 × 3 boxes' },
  { value: 5, label: '4 × 4 boxes' },
  { value: 6, label: '5 × 5 boxes' },
];

export default function DotsSolo({ game }: { game: GameMeta }) {
  const { sfx, finishMatch } = useStore();
  const [mode, setMode] = useState<'ai' | 'local'>('ai');
  const [difficulty, setDifficulty] = useState<Difficulty>('intermediate');
  const [dots, setDots] = useState(5);
  const [state, setState] = useState<DotsState>(() => R.createInitialState({ cols: 5, rows: 5 }, 0));
  const [shown, setShown] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const series = useSeries(3);
  const recorded = useRef<string | null>(null);

  const reset = useCallback((keep = true) => {
    setState(R.createInitialState({ cols: dots, rows: dots }, 0));
    setShown(false);
    setLine(null);
    recorded.current = null;
    if (!keep) series.reset();
  }, [dots]);

  useEffect(() => { reset(false); }, [mode, difficulty, dots]);  // eslint-disable-line react-hooks/exhaustive-deps

  const play = useCallback((e: DotsEdge) => {
    setState((s) => {
      if (!R.isLegal(s, s.turn, e)) return s;
      const after = R.applyMove(s, s.turn, e);
      sfx(after.lastGain > 0 ? 'coin' : 'move');
      return after;
    });
  }, [sfx]);

  useEffect(() => {
    if (mode !== 'ai' || state.over || state.turn !== 1) return;
    const t = setTimeout(() => {
      setState((s) => {
        if (s.over || s.turn !== 1) return s;
        const mv = pickDotsMove(s, 1, difficulty);
        if (!mv) return s;
        setLine(explainDots(s, 1, mv));
        sfx('move');
        return R.applyMove(s, 1, mv);
      });
    }, 360);
    return () => clearTimeout(t);
  }, [state, mode, difficulty, sfx]);

  useEffect(() => {
    if (!state.over || shown) return;
    setShown(true);
    series.record(state.winner);
    finishMatch({
      gameId: 'dots', mode, result: state.winner === null ? 'draw' : state.winner === 0 ? 'win' : 'loss',
      meta: { difficulty, boxes: state.scores[0] },
    });
  }, [state.over]);  // eslint-disable-line react-hooks/exhaustive-deps

  const memo = useMemo(() => {
    if (state.over) {
      if (state.winner === null) return 'An exact split. That almost never happens.';
      return state.winner === 0 ? 'Every box accounted for. Neatly done.' : 'Out-boxed. Watch those third sides.';
    }
    if (state.lastGain > 0) return `${state.lastGain} box${state.lastGain === 1 ? '' : 'es'} in one go — that is a chain.`;
    return 'Close the fourth side of a box to claim it, then go again.';
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
              <span className="eyebrow">Grid</span>
              <select
                value={dots}
                onChange={(e) => setDots(Number(e.target.value))}
                className="bg-white border-2 border-ink-500 rounded-full px-3 py-1.5 text-[12px] font-bold text-cream-100 outline-none focus:border-blush-300 cursor-pointer"
              >
                {SIZES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </label>
          } />
      }
      hud={
        <Panel className="p-2 sm:p-3 flex items-center gap-2 sm:gap-3 flex-wrap justify-center">
          <Stat label={mode === 'ai' ? 'You' : 'Gold'} value={state.scores[0]} accent="#8d5a05" />
          <Stat label={mode === 'ai' ? 'AI' : 'Rose'} value={state.scores[1]} accent="#1f6699" />
          <Stat label="Series" value={`${series.wins[0]}–${series.wins[1]}`} />
          <span className={`px-2.5 py-1 text-[10.5px] font-extrabold uppercase tracking-wider notch-sm ${state.turn === 0 ? 'bg-volt-400 text-[#5a3a12]' : 'bg-blush-200 text-[#5a3a12]'}`}>
            {state.over ? 'Grid complete' : state.turn === 0 ? 'Gold to draw' : mode === 'ai' ? 'AI drawing' : 'Rose to draw'}
          </span>
        </Panel>
      }
    >
      <DotsBoard
        state={state}
        youSlot={mode === 'local' ? state.turn : 0}
        onMove={(m) => play(m as DotsEdge)}
        interactive={mode === 'local' ? !state.over : !state.over && state.turn === 0}
        names={mode === 'ai' ? ['You', 'AI'] : ['Gold', 'Rose']}
      />
      {state.over && (
        <ResultOverlay
          verdict={state.winner === null ? 'draw' : state.winner === 0 ? 'win' : 'loss'}
          reason={state.reason}
          playerA={{ name: mode === 'ai' ? 'You' : 'Gold', score: state.scores[0] }}
          playerB={{ name: mode === 'ai' ? `AI (${difficulty})` : 'Rose', score: state.scores[1] }}
          rows={[{ label: 'Boxes', a: state.scores[0], b: state.scores[1] }]}
          onRematch={() => reset(false)}
          rematchLabel="Play again"
        />
      )}
    </SoloShell>
  );
}
