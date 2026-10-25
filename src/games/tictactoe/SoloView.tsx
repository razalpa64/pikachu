import { useCallback, useEffect, useRef, useState } from 'react';
import { tictactoeRules as R, type TTTState } from './rules';
import { pickTTTMove } from './ai';
import TicTacToeBoard, { VoltMark, SparkMark } from '../../components/boards/TicTacToeBoard';
import SoloShell, { ModeRail, useSeries } from '../../components/SoloShell';
import { ResultOverlay } from '../../components/Overlays';
import { Panel, Segmented, Stat } from '../../components/ui';
import { useStore } from '../../lib/store';
import type { Difficulty, GameMeta, Slot } from '../types';

export default function TicTacToeSolo({ game }: { game: GameMeta }) {
  const { sfx, finishMatch, settings } = useStore();
  const [mode, setMode] = useState<'ai' | 'local'>('ai');
  const [difficulty, setDifficulty] = useState<Difficulty>('intermediate');
  const [size, setSize] = useState(3);
  const [bestOf, setBestOf] = useState(3);
  const series = useSeries(bestOf);
  const [state, setState] = useState<TTTState>(() => R.createInitialState({ size }, 0));
  const [shownResult, setShownResult] = useState(false);
  const thinking = useRef(false);

  const reset = useCallback((keepSeries = true) => {
    setState(R.createInitialState({ size }, 0));
    setShownResult(false);
    if (!keepSeries) series.reset();
  }, [size]);

  useEffect(() => { reset(false); }, [size, mode, difficulty, bestOf]);

  const play = (cell: number) => {
    setState((s) => {
      if (!R.isLegal(s, s.turn, { cell })) return s;
      sfx('place');
      return R.applyMove(s, s.turn, { cell });
    });
  };

  // AI turn
  useEffect(() => {
    if (mode !== 'ai' || state.over || state.turn !== 1) return;
    thinking.current = true;
    const t = setTimeout(() => {
      setState((s) => {
        if (s.over || s.turn !== 1) return s;
        const mv = pickTTTMove(s, 1 as Slot, difficulty);
        if (!mv) return s;
        sfx('place');
        return R.applyMove(s, 1, mv);
      });
      thinking.current = false;
    }, 330 + Math.random() * 260);
    return () => { clearTimeout(t); thinking.current = false; };
  }, [state, mode, difficulty, sfx]);

  // round end
  useEffect(() => {
    if (!state.over || shownResult) return;
    setShownResult(true);
    series.record(state.winner);
    const result = state.winner === null ? 'draw' : state.winner === 0 ? 'win' : 'loss';
    finishMatch({
      gameId: 'tictactoe', mode: mode === 'ai' ? 'ai' : 'local', result,
      meta: { ttt_expert_draw: difficulty === 'expert' && mode === 'ai' && state.winner === null && size === 3 },
    });
  }, [state.over]);

  const myTurn = mode === 'local' ? !state.over : state.turn === 0 && !state.over;
  const mascot = state.over
    ? (state.winner === 0 ? 'victory' : state.winner === 1 ? 'defeated' : 'thinking')
    : state.turn === 1 && mode === 'ai' ? 'thinking' : 'competitive';
  const line = state.over
    ? (state.winner === null ? 'Dead even. One more?' : state.winner === 0 ? 'That line was perfect!' : 'Ouch. I saw it coming too late.')
    : mode === 'ai' && state.turn === 1 ? 'Let me think about this…'
    : `${state.need} in a row wins. Your move.`;

  return (
    <SoloShell game={game} mascot={mascot as any} mascotLine={line} onRestart={() => reset(false)}
      controls={
        <ModeRail mode={mode} setMode={setMode} difficulty={difficulty} setDifficulty={setDifficulty}
          showDifficulty={mode === 'ai'}
          modes={[{ value: 'ai', label: 'vs AI' }, { value: 'local', label: 'Same device' }]}
          extra={
            <>
              <span className="eyebrow ml-1">Board</span>
              <Segmented value={size} onChange={setSize} size="sm" label="Board size"
                options={[{ value: 3, label: '3×3' }, { value: 4, label: '4×4' }, { value: 5, label: '5×5' }]} />
              <span className="eyebrow ml-1">Series</span>
              <Segmented value={bestOf} onChange={setBestOf} size="sm" label="Series length"
                options={[{ value: 1, label: 'Single' }, { value: 3, label: 'Bo3' }, { value: 5, label: 'Bo5' }]} />
            </>
          } />
      }
      hud={
        <Panel className="p-2 sm:p-3 flex items-center gap-2 sm:gap-3 flex-wrap justify-center">
          <span className="flex items-center gap-2"><VoltMark size={22} /><span className="text-[12.5px] font-extrabold text-cream-100">{mode === 'ai' ? 'You' : 'Player 1'}</span></span>
          <Stat label="Series" value={`${series.wins[0]} – ${series.wins[1]}`} accent="#8d5a05" />
          {series.draws > 0 && <Stat label="Draws" value={series.draws} />}
          <span className="flex items-center gap-2"><span className="text-[12.5px] font-extrabold text-cream-100">{mode === 'ai' ? `AI · ${difficulty}` : 'Player 2'}</span><SparkMark size={22} /></span>
          <span className={`px-2.5 py-1 text-[10.5px] font-extrabold uppercase tracking-wider notch-sm ${state.turn === 0 ? 'bg-volt-400 text-[#5a3a12]' : 'bg-blush-300 text-[#5a3a12]'}`}>
            {state.over ? 'Round over' : state.turn === 0 ? (mode === 'ai' ? 'Your turn' : 'Player 1') : (mode === 'ai' ? 'AI thinking' : 'Player 2')}
          </span>
        </Panel>
      }>
      <div className="relative">
        <TicTacToeBoard state={state} youSlot={state.turn} onMove={(m) => play(m.cell)}
          interactive={myTurn} names={['You', mode === 'ai' ? 'AI' : 'Player 2']} hint={settings.showHints} />
        {state.over && shownResult && (
          <ResultOverlay
            verdict={state.winner === null ? 'draw' : state.winner === 0 ? 'win' : 'loss'}
            reason={state.reason}
            playerA={{ name: mode === 'ai' ? 'You' : 'Player 1', score: series.wins[0], you: true }}
            playerB={{ name: mode === 'ai' ? `AI (${difficulty})` : 'Player 2', score: series.wins[1] }}
            rows={[{ label: 'Rounds played', a: series.wins[0] + series.wins[1] + series.draws, b: '' }]}
            rematchLabel={series.decided ? 'New series' : 'Next round'}
            onRematch={() => reset(!series.decided)}
            onExit={() => reset(false)} exitLabel="Reset series" />
        )}
      </div>
    </SoloShell>
  );
}
