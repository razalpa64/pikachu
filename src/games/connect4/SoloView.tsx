import { useCallback, useEffect, useRef, useState } from 'react';
import { connect4Rules as R, undoC4, type C4State } from './rules';
import { pickC4Move, explainC4 } from './ai';
import ConnectFourBoard from '../../components/boards/ConnectFourBoard';
import SoloShell, { ModeRail, useSeries } from '../../components/SoloShell';
import { ResultOverlay } from '../../components/Overlays';
import { Button, Icon, Panel, Stat } from '../../components/ui';
import { useStore } from '../../lib/store';
import type { Difficulty, GameMeta } from '../types';

export default function ConnectFourSolo({ game }: { game: GameMeta }) {
  const { sfx, finishMatch, settings } = useStore();
  const [mode, setMode] = useState<'ai' | 'local'>('ai');
  const [difficulty, setDifficulty] = useState<Difficulty>('intermediate');
  const [state, setState] = useState<C4State>(() => R.createInitialState({}, 0));
  const [shown, setShown] = useState(false);
  const [explain, setExplain] = useState<string | null>(null);
  const series = useSeries(3);
  const busy = useRef(false);

  const reset = useCallback((keep = true) => { setState(R.createInitialState({}, 0)); setShown(false); setExplain(null); if (!keep) series.reset(); }, []);
  useEffect(() => { reset(false); }, [mode, difficulty]);

  const drop = (col: number) => {
    setState((s) => { if (!R.isLegal(s, s.turn, { col })) return s; sfx('drop'); return R.applyMove(s, s.turn, { col }); });
  };

  useEffect(() => {
    if (mode !== 'ai' || state.over || state.turn !== 1) return;
    busy.current = true;
    const t = setTimeout(() => {
      setState((s) => {
        if (s.over || s.turn !== 1) return s;
        const mv = pickC4Move(s, 1, difficulty, difficulty === 'expert' ? 900 : 500);
        if (!mv) return s;
        if (settings.showHints) setExplain(explainC4(s, 1, mv));
        sfx('drop');
        return R.applyMove(s, 1, mv);
      });
      busy.current = false;
    }, 300);
    return () => { clearTimeout(t); busy.current = false; };
  }, [state, mode, difficulty, settings.showHints, sfx]);

  useEffect(() => {
    if (!state.over || shown) return;
    setShown(true);
    series.record(state.winner);
    const diagonal = !!state.winLine && (() => {
      const line = state.winLine!;
      const d = line[1] - line[0];
      return d !== 1 && d !== state.cols;
    })();
    finishMatch({
      gameId: 'connect4', mode: mode === 'ai' ? 'ai' : 'local',
      result: state.winner === null ? 'draw' : state.winner === 0 ? 'win' : 'loss',
      meta: { diagonalWin: state.winner === 0 && diagonal, difficulty },
    });
  }, [state.over]);

  const canUndo = mode === 'ai' && state.history.length >= 2 && !state.over;
  const mascot = state.over ? (state.winner === 0 ? 'victory' : state.winner === 1 ? 'defeated' : 'thinking')
    : state.turn === 1 && mode === 'ai' ? 'thinking' : 'competitive';

  return (
    <SoloShell game={game} mascot={mascot as any}
      mascotLine={explain ?? (state.over ? (state.winner === 0 ? 'Four in a row — beautiful.' : state.winner === 1 ? 'The cabinet wins this one.' : 'Board full. Dead heat.') : 'Stack four. Watch the diagonals.')}
      onRestart={() => reset(false)}
      controls={<ModeRail mode={mode} setMode={setMode} difficulty={difficulty} setDifficulty={setDifficulty} showDifficulty={mode === 'ai'}
        modes={[{ value: 'ai', label: 'vs AI' }, { value: 'local', label: 'Same device' }]}
        extra={canUndo ? <Button size="sm" variant="ghost" onClick={() => { sfx('back'); setState((s) => undoC4(s, 2)); setExplain(null); }} icon={<Icon name="undo" size={13} />}>Undo</Button> : null} />}
      hud={
        <Panel className="p-2 sm:p-3 flex items-center gap-2 sm:gap-3 flex-wrap justify-center">
          <Stat label={mode === 'ai' ? 'You' : 'Player 1'} value={series.wins[0]} accent="#f0b429" />
          <Stat label="Draws" value={series.draws} />
          <Stat label={mode === 'ai' ? `AI ${difficulty}` : 'Player 2'} value={series.wins[1]} accent="#4a9fd8" />
          <span className={`px-2.5 py-1 text-[10.5px] font-extrabold uppercase tracking-wider notch-sm ${state.turn === 0 ? 'bg-volt-400 text-[#5a3a12]' : 'bg-spark-400 text-[#5a3a12]'}`}>
            {state.over ? 'Round over' : state.turn === 0 ? 'Gold to drop' : mode === 'ai' ? 'AI calculating' : 'Blue to drop'}
          </span>
        </Panel>
      }>
      <div className="relative">
        <ConnectFourBoard state={state} youSlot={state.turn} onMove={(m) => drop(m.col)}
          interactive={!state.over && (mode === 'local' || state.turn === 0)} names={['You', 'AI']} />
        {state.over && shown && (
          <ResultOverlay verdict={state.winner === null ? 'draw' : state.winner === 0 ? 'win' : 'loss'} reason={state.reason}
            playerA={{ name: mode === 'ai' ? 'You' : 'Player 1', score: series.wins[0], you: true }}
            playerB={{ name: mode === 'ai' ? `AI (${difficulty})` : 'Player 2', score: series.wins[1] }}
            rows={[{ label: 'Discs played', a: Math.ceil(state.history.length / 2), b: Math.floor(state.history.length / 2) }]}
            onRematch={() => reset(true)} onExit={() => reset(false)} exitLabel="Reset series" />
        )}
      </div>
    </SoloShell>
  );
}
