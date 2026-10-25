import { useCallback, useEffect, useRef, useState } from 'react';
import { reactionRules as R, type RDState } from './rules';
import ReactionBoard from '../../components/boards/ReactionBoard';
import SoloShell, { ModeRail } from '../../components/SoloShell';
import { ResultOverlay } from '../../components/Overlays';
import { Panel, Segmented, Stat } from '../../components/ui';
import { useStore } from '../../lib/store';
import type { Difficulty, GameMeta } from '../types';

/** Calibrated AI reflexes — a plausible human distribution per difficulty, never superhuman. */
const PROFILE: Record<Difficulty, { mean: number; sd: number; falseStart: number }> = {
  beginner: { mean: 520, sd: 130, falseStart: 0.1 },
  casual: { mean: 400, sd: 95, falseStart: 0.07 },
  intermediate: { mean: 320, sd: 70, falseStart: 0.05 },
  advanced: { mean: 255, sd: 48, falseStart: 0.04 },
  expert: { mean: 205, sd: 34, falseStart: 0.03 },
};
const gauss = (m: number, sd: number) => {
  let u = 0, v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.max(110, Math.round(m + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)));
};

export default function ReactionSolo({ game }: { game: GameMeta }) {
  const { finishMatch, sfx } = useStore();
  const [difficulty, setDifficulty] = useState<Difficulty>('intermediate');
  const [bestOf, setBestOf] = useState(5);
  const [state, setState] = useState<RDState>(() => R.createInitialState({ bestOf: 5 }, Date.now() >>> 0));
  const [shown, setShown] = useState(false);
  const aiTimer = useRef<number | null>(null);
  const aiArmedFor = useRef(-1);

  const reset = useCallback(() => {
    if (aiTimer.current) clearTimeout(aiTimer.current);
    aiArmedFor.current = -1;
    setState(R.createInitialState({ bestOf }, (Date.now() ^ 0x1f123bb5) >>> 0));
    setShown(false);
  }, [bestOf]);
  useEffect(() => { reset(); }, [bestOf, difficulty]);

  /* ReactionBoard voices the countdown and the signal; everything that happens
     *after* you move was silent, which made the whole duel feel dead. */
  const heard = useRef({ resp: 0, fs: 0, wins: 0, round: -1 });
  useEffect(() => {
    const h = heard.current;
    if (state.round !== h.round) { h.round = state.round; h.resp = 0; h.fs = 0; }
    const resp = state.responses.filter((r) => r !== null).length;
    const fs = state.falseStart.filter(Boolean).length;
    const wins = state.wins[0] + state.wins[1];
    if (fs > h.fs) sfx('error');            // someone jumped the gun
    else if (resp > h.resp) sfx('hit');     // a clean press landed
    if (wins > h.wins) sfx(state.rounds[state.rounds.length - 1]?.winner === 0 ? 'coin' : 'block');
    h.resp = resp; h.fs = fs; h.wins = wins;
  }, [state, sfx]);

  /* local authoritative tick (solo play has no network, so the client clock IS the referee) */
  useEffect(() => {
    if (state.over) return;
    const h = window.setInterval(() => setState((s) => R.tick!(s, Date.now())), 40);
    return () => clearInterval(h);
  }, [state.over]);

  /* schedule the AI response when the signal fires */
  useEffect(() => {
    if (state.phase !== 'signal' || state.over) return;
    if (aiArmedFor.current === state.round) return;
    aiArmedFor.current = state.round;
    const p = PROFILE[difficulty];
    const delay = Math.random() < p.falseStart ? -1 : gauss(p.mean, p.sd);
    if (delay < 0) { setState((s) => R.applyMove(s, 1, { type: 'press' })); return; }
    aiTimer.current = window.setTimeout(() => setState((s) => (s.phase === 'signal' ? R.applyMove(s, 1, { type: 'press' }) : s)), delay);
    return () => { if (aiTimer.current) clearTimeout(aiTimer.current); };
  }, [state.phase, state.round, difficulty, state.over]);

  useEffect(() => {
    if (!state.over || shown) return;
    setShown(true);
    const mine = state.rounds.map((r) => r.responses[0]).filter((x): x is number => typeof x === 'number');
    finishMatch({
      gameId: 'reaction', mode: 'ai',
      result: state.winner === null ? 'draw' : state.winner === 0 ? 'win' : 'loss',
      score: mine.length ? Math.min(...mine) : undefined,
      meta: { reactionMs: mine.length ? Math.min(...mine) : undefined, difficulty },
    });
  }, [state.over]);

  const mine = state.rounds.map((r) => r.responses[0]).filter((x): x is number => typeof x === 'number');
  const avg = mine.length ? Math.round(mine.reduce((a, b) => a + b, 0) / mine.length) : null;

  return (
    <SoloShell game={game}
      mascot={state.phase === 'signal' ? 'excited' : state.over ? (state.winner === 0 ? 'victory' : 'defeated') : 'competitive'}
      mascotLine={state.over ? (state.winner === 0 ? 'Fastest hands in the arena!' : 'Beaten to the strike. Again?') : 'Wait for the flash. Jumping early costs you the round.'}
      onRestart={reset}
      controls={<ModeRail mode="ai" setMode={() => {}} difficulty={difficulty} setDifficulty={setDifficulty}
        modes={[{ value: 'ai', label: 'vs AI reflexes' }]}
        extra={<><span className="eyebrow ml-1">Rounds</span><Segmented value={bestOf} onChange={setBestOf} size="sm" label="Rounds"
          options={[{ value: 3, label: 'Bo3' }, { value: 5, label: 'Bo5' }, { value: 7, label: 'Bo7' }]} /></>} />}
      hud={
        <Panel className="p-2 sm:p-3 flex items-center gap-2 sm:gap-3 flex-wrap justify-center">
          <Stat label="Best" value={mine.length ? `${Math.min(...mine)} ms` : '—'} accent="#8d5a05" />
          <Stat label="Average" value={avg ? `${avg} ms` : '—'} />
          <Stat label="Rounds" value={`${state.rounds.length}/${state.bestOf}`} />
        </Panel>
      }>
      <div className="relative w-full flex justify-center">
        <ReactionBoard state={state} youSlot={0} onMove={(m) => setState((s) => (R.isLegal(s, 0, m) ? R.applyMove(s, 0, m) : s))}
          interactive={!state.over} names={['You', `AI (${difficulty})`]} />
        {state.over && shown && (
          <ResultOverlay verdict={state.winner === null ? 'draw' : state.winner === 0 ? 'win' : 'loss'} reason={state.reason}
            playerA={{ name: 'You', score: state.wins[0], you: true }}
            playerB={{ name: `AI (${difficulty})`, score: state.wins[1] }}
            rows={[{ label: 'Best time', a: mine.length ? `${Math.min(...mine)} ms` : '—', b: '' }, { label: 'Average', a: avg ? `${avg} ms` : '—', b: '' }]}
            onRematch={reset} rematchLabel="Run it back" onExit={reset} />
        )}
      </div>
    </SoloShell>
  );
}
