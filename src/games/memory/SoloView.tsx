import { useCallback, useEffect, useRef, useState } from 'react';
import { memoryRules as R, type MemState } from './rules';
import { newBrain, observe, pickMemoryFlip, type MemoryBrain } from './ai';
import MemoryBoard from '../../components/boards/MemoryBoard';
import SoloShell, { ModeRail } from '../../components/SoloShell';
import { ResultOverlay } from '../../components/Overlays';
import { Panel, Segmented, Stat } from '../../components/ui';
import { useStore } from '../../lib/store';
import type { Difficulty, GameMeta } from '../types';

const SIZES = [{ value: '4x3', label: '4×3' }, { value: '4x4', label: '4×4' }, { value: '6x4', label: '6×4' }, { value: '6x6', label: '6×6' }];

export default function MemorySolo({ game }: { game: GameMeta }) {
  const { sfx, finishMatch } = useStore();
  const [mode, setMode] = useState<'solo' | 'ai' | 'local'>('solo');
  const [difficulty, setDifficulty] = useState<Difficulty>('intermediate');
  const [sizeKey, setSizeKey] = useState('4x4');
  const [state, setState] = useState<MemState>(() => make('4x4', false));
  const [shown, setShown] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const brain = useRef<MemoryBrain>(newBrain());

  const reset = useCallback(() => {
    setState(make(sizeKey, false));
    setShown(false); setElapsed(0); setBestStreak(0);
    brain.current = newBrain();
  }, [sizeKey]);
  useEffect(() => { reset(); }, [sizeKey, mode, difficulty]);

  useEffect(() => {
    if (state.over) return;
    const h = window.setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(h);
  }, [state.over, state.startedAt]);

  useEffect(() => { setBestStreak((b) => Math.max(b, state.streak[0], state.streak[1])); }, [state.streak]);

  const act = (move: any) => {
    setState((s) => {
      const actor = s.turn;
      if (!R.isLegal(s, actor, move)) return s;
      if ('flip' in move) observe(brain.current, move.flip, s.deck[move.flip], 'expert');
      return R.applyMove(s, actor, move);
    });
  };

  /* AI opponent turn */
  useEffect(() => {
    if (mode !== 'ai' || state.over || state.turn !== 1) return;
    const delay = state.revealed.length >= 2 ? 760 : 520 + Math.random() * 340;
    const t = setTimeout(() => {
      setState((s) => {
        if (s.over || s.turn !== 1) return s;
        if (s.revealed.length >= 2) return R.applyMove(s, 1, { resolve: true });
        const pick = pickMemoryFlip(s, brain.current, difficulty);
        if (pick === null) return s;
        observe(brain.current, pick, s.deck[pick], difficulty);
        sfx('flip');
        return R.applyMove(s, 1, { flip: pick });
      });
    }, delay);
    return () => clearTimeout(t);
  }, [state, mode, difficulty, sfx]);

  /* solo auto-resolve */
  useEffect(() => {
    if (mode !== 'solo' || state.revealed.length < 2) return;
    const t = setTimeout(() => setState((s) => (s.revealed.length >= 2 ? R.applyMove(s, s.turn, { resolve: true }) : s)), 760);
    return () => clearTimeout(t);
  }, [state.revealed.length, mode]);

  /* solo keeps the turn on the single player */
  useEffect(() => {
    if (mode === 'solo' && state.turn === 1 && !state.over) setState((s) => ({ ...s, turn: 0 }));
  }, [state.turn, mode, state.over]);

  useEffect(() => {
    if (!state.over || shown) return;
    setShown(true);
    const result = mode === 'solo' ? 'win' : state.winner === null ? 'draw' : state.winner === 0 ? 'win' : 'loss';
    finishMatch({ gameId: 'memory', mode, result, score: state.score[0], meta: { memoryStreak: bestStreak } });
  }, [state.over]);

  const interactive = !state.over && (mode === 'solo' || state.turn === 0 || mode === 'local');

  return (
    <SoloShell game={game}
      mascot={state.over ? (state.winner === 1 ? 'defeated' : 'victory') : state.lastResult === 'hit' ? 'excited' : state.lastResult === 'miss' ? 'thinking' : 'idle'}
      mascotLine={state.over ? (mode === 'solo' ? `Cleared in ${state.moves} flips!` : state.winner === 0 ? 'You remembered more pairs!' : state.winner === null ? 'Perfectly even.' : 'The AI had the better memory this time.')
        : state.streak[0] >= 3 ? `Streak of ${state.streak[0]}! Keep going!` : 'Flip two cards. Chain matches for bonus points.'}
      onRestart={reset}
      controls={<ModeRail mode={mode} setMode={setMode} difficulty={difficulty} setDifficulty={setDifficulty} showDifficulty={mode === 'ai'}
        modes={[{ value: 'solo', label: 'Solo run' }, { value: 'ai', label: 'vs AI' }, { value: 'local', label: 'Same device' }]}
        extra={<><span className="eyebrow ml-1">Board</span><Segmented value={sizeKey} onChange={setSizeKey} size="sm" label="Board size" options={SIZES as any} /></>} />}
      hud={
        <Panel className="p-2 sm:p-3 flex items-center gap-2 sm:gap-3 flex-wrap justify-center">
          <Stat label={mode === 'solo' ? 'Pairs' : 'You'} value={state.score[0]} accent="#f0b429" />
          {mode !== 'solo' && <Stat label={mode === 'ai' ? `AI ${difficulty}` : 'Player 2'} value={state.score[1]} accent="#4a9fd8" />}
          <Stat label="Flips" value={state.moves} />
          <Stat label="Streak" value={state.streak[state.turn]} accent="#3fae82" />
          <Stat label="Time" value={`${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`} />
          {mode !== 'solo' && (
            <span className={`px-2.5 py-1 text-[10.5px] font-extrabold uppercase tracking-wider notch-sm ${state.turn === 0 ? 'bg-volt-400 text-[#5a3a12]' : 'bg-spark-400 text-[#5a3a12]'}`}>
              {state.over ? 'Cleared' : state.turn === 0 ? 'Your flip' : mode === 'ai' ? 'AI recalling' : 'Player 2'}
            </span>
          )}
        </Panel>
      }>
      <div className="relative">
        <MemoryBoard state={state} youSlot={state.turn} onMove={act} interactive={interactive} names={['You', mode === 'ai' ? 'AI' : 'Player 2']} />
        {state.over && shown && (
          <ResultOverlay
            verdict={mode === 'solo' ? 'win' : state.winner === null ? 'draw' : state.winner === 0 ? 'win' : 'loss'}
            reason={mode === 'solo' ? `Board cleared in ${state.moves} flips` : state.reason}
            playerA={{ name: 'You', score: state.score[0], you: true }}
            playerB={{ name: mode === 'solo' ? 'Par' : mode === 'ai' ? `AI (${difficulty})` : 'Player 2', score: mode === 'solo' ? Math.round(state.deck.length * 1.6) : state.score[1] }}
            rows={[{ label: 'Flips', a: state.moves, b: `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}` }, { label: 'Best streak', a: bestStreak, b: '' }]}
            onRematch={reset} rematchLabel="Shuffle again" onExit={reset} exitLabel="New board" />
        )}
      </div>
    </SoloShell>
  );
}

function make(sizeKey: string, coop: boolean): MemState {
  const [cols, rows] = sizeKey.split('x').map(Number);
  return R.createInitialState({ cols, rows, coop }, (Date.now() ^ 0x5bf03635) >>> 0);
}
