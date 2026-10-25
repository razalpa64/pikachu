import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { reversiRules as R, type ReversiState } from './rules';
import { pickReversiMove, explainReversi } from './ai';
import ReversiBoard from '../../components/boards/ReversiBoard';
import SoloShell, { ModeRail, useSeries } from '../../components/SoloShell';
import { ResultOverlay } from '../../components/Overlays';
import { Panel, Stat } from '../../components/ui';
import { useStore } from '../../lib/store';
import type { Difficulty, GameMeta } from '../types';

const MODES = [{ value: 'ai', label: 'vs AI' }, { value: 'local', label: 'Same device' }];

export default function ReversiSolo({ game }: { game: GameMeta }) {
  const { sfx, finishMatch } = useStore();
  const [mode, setMode] = useState<'ai' | 'local'>('ai');
  const [difficulty, setDifficulty] = useState<Difficulty>('intermediate');
  const [state, setState] = useState<ReversiState>(() => R.createInitialState({}, 0));
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

  const play = useCallback((cell: number) => {
    setState((s) => {
      if (!R.isLegal(s, s.turn, { cell })) return s;
      sfx('flip');
      return R.applyMove(s, s.turn, { cell });
    });
  }, [sfx]);

  /* one AI move per turn — cancelled if the player moves again first */
  useEffect(() => {
    if (mode !== 'ai' || state.over || state.turn !== 1) return;
    const t = setTimeout(() => {
      setState((s) => {
        if (s.over || s.turn !== 1) return s;
        const mv = pickReversiMove(s, 1, difficulty);
        if (!mv) return s;
        setLine(explainReversi(s, 1, mv));
        sfx('flip');
        return R.applyMove(s, 1, mv);
      });
    }, 380);
    return () => clearTimeout(t);
  }, [state, mode, difficulty, sfx]);

  useEffect(() => {
    if (!state.over || shown) return;
    setShown(true);
    series.record(state.winner);
    finishMatch({
      gameId: 'reversi', mode, result: state.winner === null ? 'draw' : state.winner === 0 ? 'win' : 'loss',
      meta: { difficulty, coins: state.counts[0] },
    });
  }, [state.over]);  // eslint-disable-line react-hooks/exhaustive-deps

  const memo = useMemo(() => {
    if (!state.over) {
      return state.passed !== null
        ? 'They had no legal move, so you go again.'
        : 'Take a line. Corners are forever.';
    }
    if (state.winner === null) return 'A dead heat on the count. Rare and rather lovely.';
    return state.winner === 0 ? 'The board is yours. Every coin counted.' : 'Beaten on the count. Rematch?';
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
          <Stat label={mode === 'ai' ? 'You' : 'Gold'} value={series.wins[0]} accent="#8d5a05" />
          <Stat label="Draws" value={series.draws} />
          <Stat label={mode === 'ai' ? `AI ${difficulty}` : 'Rose'} value={series.wins[1]} accent="#1f6699" />
          <span className={`px-2.5 py-1 text-[10.5px] font-extrabold uppercase tracking-wider notch-sm ${state.turn === 0 ? 'bg-volt-400 text-[#5a3a12]' : 'bg-blush-200 text-[#5a3a12]'}`}>
            {state.over ? 'Round over' : state.turn === 0 ? 'Gold to play' : mode === 'ai' ? 'AI thinking' : 'Rose to play'}
          </span>
        </Panel>
      }
    >
      <ReversiBoard
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
          playerA={{ name: mode === 'ai' ? 'You' : 'Gold', score: state.counts[0], you: state.winner !== 1 }}
          playerB={{ name: mode === 'ai' ? `AI (${difficulty})` : 'Rose', score: state.counts[1] }}
          rows={[{ label: 'Coins', a: state.counts[0], b: state.counts[1] }]}
          onRematch={() => reset(false)}
          rematchLabel="Play again"
        />
      )}
    </SoloShell>
  );
}
