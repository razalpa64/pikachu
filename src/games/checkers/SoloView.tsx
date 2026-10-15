import { useCallback, useEffect, useState } from 'react';
import { checkersRules as R, resignCheckers, type CKState } from './rules';
import { pickCheckersMove } from './ai';
import CheckersBoard from '../../components/boards/CheckersBoard';
import SoloShell, { ModeRail } from '../../components/SoloShell';
import { ResultOverlay } from '../../components/Overlays';
import { Button, Icon, Panel, Stat, Toggle } from '../../components/ui';
import { useStore } from '../../lib/store';
import type { Difficulty, GameMeta } from '../types';

export default function CheckersSolo({ game }: { game: GameMeta }) {
  const { sfx, finishMatch, settings } = useStore();
  const [mode, setMode] = useState<'ai' | 'local'>('ai');
  const [difficulty, setDifficulty] = useState<Difficulty>('intermediate');
  const [mandatory, setMandatory] = useState(true);
  const [state, setState] = useState<CKState>(() => R.createInitialState({ mandatoryCapture: true }, 0));
  const [shown, setShown] = useState(false);

  const reset = useCallback(() => { setState(R.createInitialState({ mandatoryCapture: mandatory }, 0)); setShown(false); }, [mandatory]);
  useEffect(() => { reset(); }, [mandatory, mode, difficulty]);

  useEffect(() => {
    if (mode !== 'ai' || state.over || state.turn !== 1) return;
    const t = setTimeout(() => {
      setState((s) => {
        if (s.over || s.turn !== 1) return s;
        const mv = pickCheckersMove(s, 1, difficulty, difficulty === 'expert' ? 900 : 550);
        if (!mv) return s;
        sfx(Math.abs(mv.to - mv.from) > 9 ? 'capture' : 'move');
        return R.applyMove(s, 1, mv);
      });
    }, 340);
    return () => clearTimeout(t);
  }, [state, mode, difficulty, sfx]);

  useEffect(() => {
    if (!state.over || shown) return;
    setShown(true);
    finishMatch({
      gameId: 'checkers', mode: mode === 'ai' ? 'ai' : 'local',
      result: state.winner === null ? 'draw' : state.winner === 0 ? 'win' : 'loss',
      meta: { kings: state.board.filter((b) => b?.p === 0 && b.king).length, difficulty },
    });
  }, [state.over]);

  const myPieces = state.board.filter((b) => b?.p === 0).length;
  const theirPieces = state.board.filter((b) => b?.p === 1).length;

  return (
    <SoloShell game={game}
      mascot={state.over ? (state.winner === 0 ? 'victory' : state.winner === 1 ? 'defeated' : 'thinking') : state.turn === 1 && mode === 'ai' ? 'thinking' : 'competitive'}
      mascotLine={state.over ? `${state.reason}.` : state.mustContinueFrom !== null ? 'Chain jump available — keep taking!' : mandatory ? 'Captures are compulsory. Choose your trades carefully.' : 'Free captures. Build a king.'}
      onRestart={reset}
      controls={<ModeRail mode={mode} setMode={setMode} difficulty={difficulty} setDifficulty={setDifficulty} showDifficulty={mode === 'ai'}
        modes={[{ value: 'ai', label: 'vs AI' }, { value: 'local', label: 'Same device' }]}
        extra={<>
          <Toggle checked={mandatory} onChange={setMandatory} label="Mandatory capture" />
          <Button size="sm" variant="ghost" onClick={() => setState((s) => resignCheckers(s, 0))} icon={<Icon name="flag" size={13} />}>Resign</Button>
        </>} />}
      hud={
        <Panel className="p-2 sm:p-3 flex items-center gap-2 sm:gap-3 flex-wrap justify-center">
          <Stat label="Gold" value={myPieces} accent="#f0b429" />
          <Stat label="Charcoal" value={theirPieces} />
          <Stat label="Kings" value={state.board.filter((b) => b?.king).length} accent="#3fae82" />
          <span className={`px-2.5 py-1 text-[10.5px] font-extrabold uppercase tracking-wider notch-sm ${state.turn === 0 ? 'bg-volt-400 text-[#5a3a12]' : 'bg-blush-100 text-cream-300'}`}>
            {state.over ? 'Game over' : state.turn === 0 ? 'Gold to move' : mode === 'ai' ? 'AI calculating' : 'Charcoal to move'}
          </span>
        </Panel>
      }>
      <div className="relative pb-7">
        <CheckersBoard state={state} youSlot={mode === 'local' ? state.turn : 0} onMove={(m) => setState((s) => (R.isLegal(s, s.turn, m) ? (sfx(Math.abs(m.to - m.from) > 9 ? 'capture' : 'move'), R.applyMove(s, s.turn, m)) : s))}
          interactive={!state.over && (mode === 'local' || state.turn === 0)} names={['Gold', 'Charcoal']} hint={settings.showHints} />
        {state.over && shown && (
          <ResultOverlay verdict={state.winner === null ? 'draw' : state.winner === 0 ? 'win' : 'loss'} reason={state.reason}
            playerA={{ name: 'Gold', score: myPieces, you: true }}
            playerB={{ name: mode === 'ai' ? `AI (${difficulty})` : 'Charcoal', score: theirPieces }}
            rows={[{ label: 'Moves', a: state.history.length, b: '' }]}
            onRematch={reset} rematchLabel="New game" onExit={reset} exitLabel="Reset board" />
        )}
      </div>
    </SoloShell>
  );
}
