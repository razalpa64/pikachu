import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { chessRules as R, undoChess, resign as doResign, startClock, load, type ChessState, type ChessMove } from './rules';
import ChessBoard, { CapturedRow } from '../../components/boards/ChessBoard';
import SoloShell, { ModeRail } from '../../components/SoloShell';
import { ResultOverlay } from '../../components/Overlays';
import { Button, ConfirmDialog, Icon, Panel, Segmented, Stat } from '../../components/ui';
import { useStore } from '../../lib/store';
import type { Difficulty, GameMeta } from '../types';
import { takeWarmChessWorker } from '../../lib/prefetch';

const TCS = [
  { value: 'none', label: 'Untimed' }, { value: 'blitz', label: '3+2' },
  { value: 'rapid', label: '10+5' }, { value: 'classical', label: '30+10' },
];

export default function ChessSolo({ game }: { game: GameMeta }) {
  const { sfx, finishMatch, settings } = useStore();
  const [mode, setMode] = useState<'ai' | 'local'>('ai');
  const [difficulty, setDifficulty] = useState<Difficulty>('intermediate');
  const [tc, setTc] = useState('rapid');
  const [state, setState] = useState<ChessState>(() => startClock(R.createInitialState({ timeControl: 'rapid' }, 0)));
  const [shown, setShown] = useState(false);
  const [engineInfo, setEngineInfo] = useState<{ depth: number; nodes: number; eval: number | null } | null>(null);
  const [resignOpen, setResignOpen] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const reqId = useRef(0);
  const [thinking, setThinking] = useState(false);

  /* One worker for the whole session; always terminated on unmount.
     If the app pre-warmed one during idle time we adopt it, which removes the
     module-worker spawn from the critical path of the first move. */
  useEffect(() => {
    const w = takeWarmChessWorker()
      ?? new Worker(new URL('../../workers/chessEngine.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = w;
    w.onmessage = (e) => {
      const { id, move, depth, nodes, eval: ev } = e.data;
      if (id !== reqId.current) return;
      setThinking(false);
      if (!move) return;
      setEngineInfo({ depth, nodes, eval: ev });
      setState((s) => (s.over || (s.fen.split(' ')[1] === 'w' ? 0 : 1) !== 1 ? s : (sfx('move'), R.applyMove(s, 1, move as ChessMove))));
    };
    return () => { w.terminate(); workerRef.current = null; };
  }, [sfx]);

  const reset = useCallback(() => {
    reqId.current += 1;
    setThinking(false);
    setState(startClock(R.createInitialState({ timeControl: tc }, 0)));
    setShown(false); setEngineInfo(null);
  }, [tc]);
  useEffect(() => { reset(); }, [tc, mode, difficulty]);

  /* clock tick */
  useEffect(() => {
    if (!state.clock || state.over) return;
    const h = window.setInterval(() => setState((s) => R.tick!(s, Date.now())), 250);
    return () => clearInterval(h);
  }, [state.clock, state.over]);

  /* engine turn */
  const turn: 0 | 1 = state.fen.split(' ')[1] === 'w' ? 0 : 1;
  useEffect(() => {
    if (mode !== 'ai' || state.over || turn !== 1 || !workerRef.current) return;
    reqId.current += 1;
    setThinking(true);
    workerRef.current.postMessage({ fen: state.fen, difficulty, id: reqId.current });
  }, [state.fen, mode, difficulty, turn, state.over]);

  useEffect(() => {
    if (!state.over || shown) return;
    setShown(true);
    finishMatch({
      gameId: 'chess', mode: mode === 'ai' ? 'ai' : 'local',
      result: state.winner === null ? 'draw' : state.winner === 0 ? 'win' : 'loss',
      meta: { moves: state.pgnMoves.length, difficulty },
    });
  }, [state.over]);

  const chess = useMemo(() => load(state.fen), [state.fen]);
  const inCheck = chess.inCheck();
  const canUndo = mode === 'ai' && state.pgnMoves.length >= 2 && !state.over;

  const move = (m: ChessMove) => setState((s) => (R.isLegal(s, turn, m) ? R.applyMove(s, turn, m) : s));

  return (
    <SoloShell game={game} wide
      mascot={state.over ? (state.winner === 0 ? 'victory' : state.winner === 1 ? 'defeated' : 'thinking') : thinking ? 'thinking' : inCheck ? 'competitive' : 'idle'}
      mascotLine={state.over ? `${state.reason}.` : thinking ? 'Searching the tree…' : inCheck ? 'Check! Deal with that first.' : 'Develop pieces, control the centre, castle early.'}
      onRestart={reset}
      controls={<ModeRail mode={mode} setMode={setMode} difficulty={difficulty} setDifficulty={setDifficulty} showDifficulty={mode === 'ai'}
        modes={[{ value: 'ai', label: 'vs Engine' }, { value: 'local', label: 'Same device' }]}
        extra={<>
          <span className="eyebrow ml-1">Clock</span>
          <Segmented value={tc} onChange={setTc} size="sm" label="Time control" options={TCS as any} />
          {canUndo && <Button size="sm" variant="ghost" onClick={() => { sfx('back'); reqId.current += 1; setThinking(false); setState((s) => undoChess(s, 2)); }} icon={<Icon name="undo" size={13} />}>Take back</Button>}
          <Button size="sm" variant="ghost" onClick={() => setResignOpen(true)} icon={<Icon name="flag" size={13} />}>Resign</Button>
        </>} />}
      hud={
        <Panel className="p-2 sm:p-3 flex items-center gap-2 sm:gap-3 flex-wrap justify-center">
          {state.clock && <Stat label="White" value={clock(state.clock[0])} accent={turn === 0 ? '#f0b429' : undefined} />}
          {state.clock && <Stat label="Black" value={clock(state.clock[1])} accent={turn === 1 ? '#f0b429' : undefined} />}
          <Stat label="Move" value={Math.ceil(state.pgnMoves.length / 2) + 1} />
          <span className={`px-2.5 py-1 text-[10.5px] font-extrabold uppercase tracking-wider notch-sm ${inCheck ? 'bg-ember-400 text-[#4a0a1e]' : turn === 0 ? 'bg-volt-400 text-[#5a3a12]' : 'bg-blush-100 text-cream-300'}`}>
            {state.over ? 'Game over' : inCheck ? 'Check' : turn === 0 ? 'White to move' : thinking ? 'Engine thinking' : 'Black to move'}
          </span>
          {engineInfo && settings.showHints && (
            <span className="text-[10.5px] text-cream-500 tabnum">depth {engineInfo.depth} · {engineInfo.nodes.toLocaleString()} nodes{engineInfo.eval !== null ? ` · ${(engineInfo.eval / 100).toFixed(1)}` : ''}</span>
          )}
        </Panel>
      }>
      <div className="relative flex flex-col xl:flex-row gap-5 items-start justify-center w-full">
        <div className="relative mx-auto">
          <ChessBoard state={state} youSlot={mode === 'local' ? turn : 0} onMove={move}
            interactive={!state.over && (mode === 'local' || turn === 0)} names={['White', 'Black']} hint={settings.showHints} />
          {state.over && shown && (
            <ResultOverlay verdict={state.winner === null ? 'draw' : state.winner === 0 ? 'win' : 'loss'} reason={state.reason}
              playerA={{ name: 'White', score: Math.ceil(state.pgnMoves.length / 2), you: mode === 'ai' }}
              playerB={{ name: mode === 'ai' ? `Volt Engine (${difficulty})` : 'Black', score: Math.floor(state.pgnMoves.length / 2) }}
              rows={[{ label: 'Moves', a: state.pgnMoves.length, b: state.reason }]}
              onRematch={reset} rematchLabel="New game" onExit={reset} exitLabel="Reset board" />
          )}
        </div>

        <Panel className="p-3.5 w-full xl:w-[250px] shrink-0">
          <p className="eyebrow mb-2">Move history</p>
          <div className="max-h-[230px] overflow-y-auto pr-1 font-mono text-[12px] leading-relaxed">
            {state.pgnMoves.length === 0 && <p className="text-cream-400 text-[11.5px] font-sans">No moves yet.</p>}
            {Array.from({ length: Math.ceil(state.pgnMoves.length / 2) }).map((_, i) => (
              <div key={i} className="grid grid-cols-[26px_1fr_1fr] gap-1">
                <span className="text-cream-400">{i + 1}.</span>
                <span className="text-cream-100">{state.pgnMoves[i * 2]}</span>
                <span className="text-cream-300">{state.pgnMoves[i * 2 + 1] ?? ''}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 pt-3 border-t border-ink-600 flex flex-col gap-2">
            <div className="flex items-center gap-2"><span className="eyebrow text-[9px] w-12">White</span><CapturedRow fen={state.fen} colour="w" /></div>
            <div className="flex items-center gap-2"><span className="eyebrow text-[9px] w-12">Black</span><CapturedRow fen={state.fen} colour="b" /></div>
          </div>
        </Panel>
      </div>

      <ConfirmDialog open={resignOpen} title="Resign the game?" body="The engine takes the point." danger confirmLabel="Resign"
        onConfirm={() => { setState((s) => doResign(s, 0)); setResignOpen(false); }} onCancel={() => setResignOpen(false)} />
    </SoloShell>
  );
}

const clock = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
