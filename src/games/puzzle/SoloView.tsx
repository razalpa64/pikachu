import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  PUZZLE_INFO, PUZZLE_KINDS, lightsSolved, lightsToggle, lockFeedback, makeEcho, makeLights,
  makeLock, makeSlide, makeSum, slideNeighbours, slideSolved, sumSolved,
  type AnyPuzzle, type EchoP, type LightsP, type LockP, type PuzzleKind, type SlideP, type SumP,
} from './generators';
import SoloShell from '../../components/SoloShell';
import { ResultOverlay } from '../../components/Overlays';
import { Button, Icon, Panel, Segmented, Stat } from '../../components/ui';
import { useStore } from '../../lib/store';
import type { Cue } from '../../lib/audio';
import type { GameMeta } from '../types';

type Diff = 'easy' | 'standard' | 'hard';
const DIFF_OPTS = [{ value: 'easy', label: 'Easy' }, { value: 'standard', label: 'Standard' }, { value: 'hard', label: 'Hard' }];

function build(kind: PuzzleKind, diff: Diff, seed: number): AnyPuzzle {
  switch (kind) {
    case 'slide': return makeSlide(diff === 'easy' ? 3 : diff === 'standard' ? 4 : 5, seed);
    case 'lights': return makeLights(diff === 'easy' ? 4 : diff === 'standard' ? 5 : 6, seed, diff === 'easy' ? 4 : diff === 'standard' ? 7 : 11);
    case 'lock': return makeLock(diff === 'easy' ? 3 : diff === 'standard' ? 4 : 5, diff === 'hard' ? 8 : 6, seed);
    case 'echo': return makeEcho(diff === 'easy' ? 4 : diff === 'standard' ? 6 : 9, 24, seed);
    case 'sum': return makeSum(diff === 'easy' ? 4 : diff === 'standard' ? 5 : 6, seed);
  }
}

export default function PuzzleSolo({ game }: { game: GameMeta }) {
  const { sfx, finishMatch } = useStore();
  const [kind, setKind] = useState<PuzzleKind>('slide');
  const [diff, setDiff] = useState<Diff>('standard');
  const [seed, setSeed] = useState(() => Date.now() >>> 0);
  const puzzle = useMemo(() => build(kind, diff, seed), [kind, diff, seed]);
  const [solved, setSolved] = useState(false);
  const [moves, setMoves] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [failed, setFailed] = useState<string | null>(null);
  const [kindsCleared, setKindsCleared] = useState<string[]>([]);

  const reset = useCallback((k = kind) => {
    setSeed((Date.now() ^ Math.floor(Math.random() * 0xffff)) >>> 0);
    setSolved(false); setMoves(0); setElapsed(0); setFailed(null);
  }, [kind]);
  useEffect(() => { reset(); }, [kind, diff]);

  useEffect(() => {
    if (solved || failed) return;
    const h = window.setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(h);
  }, [solved, failed, seed]);

  const win = useCallback((bonusMeta?: Record<string, unknown>) => {
    setSolved(true);
    sfx('win');
    const cleared = kindsCleared.includes(kind) ? kindsCleared : [...kindsCleared, kind];
    setKindsCleared(cleared);
    finishMatch({
      gameId: 'puzzle', mode: 'solo', result: 'win',
      score: Math.max(50, 1200 - moves * 8 - elapsed * 4),
      meta: { puzzleKinds: cleared.length, moves, kind, difficulty: diff, ...bonusMeta },
    });
  }, [kind, kindsCleared, moves, elapsed, diff, finishMatch, sfx]);

  const lose = useCallback((why: string) => { setFailed(why); sfx('lose'); }, [sfx]);

  const info = PUZZLE_INFO[kind];

  return (
    <SoloShell game={game}
      mascot={solved ? 'victory' : failed ? 'defeated' : 'thinking'}
      mascotLine={solved ? 'Solved! Logic beats luck every time.' : failed ? failed : info.rule}
      onRestart={() => reset()}
      controls={
        <div className="flex items-center gap-2 flex-wrap">
          <span className="eyebrow">Chamber</span>
          <Segmented value={kind} onChange={(v) => setKind(v as PuzzleKind)} size="sm" label="Puzzle type"
            options={PUZZLE_KINDS.map((k) => ({ value: k, label: PUZZLE_INFO[k].name }))} />
          <span className="eyebrow ml-1">Scale</span>
          <Segmented value={diff} onChange={(v) => setDiff(v as Diff)} size="sm" label="Difficulty" options={DIFF_OPTS as any} />
          <Button size="sm" variant="ghost" onClick={() => reset()} icon={<Icon name="rotate" size={13} />}>New puzzle</Button>
        </div>
      }
      hud={
        <Panel className="p-2 sm:p-3 flex items-center gap-2 sm:gap-3 flex-wrap justify-center">
          <Stat label="Chamber" value={info.name} accent="#9b7ad6" />
          <Stat label="Moves" value={moves} />
          <Stat label="Time" value={`${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`} />
          <Stat label="Chambers cleared" value={`${kindsCleared.length}/5`} accent="#3fae82" />
        </Panel>
      }>
      <div className="relative w-full flex flex-col items-center gap-4">
        <p className="text-[12.5px] text-cream-400 max-w-[520px] text-center">{info.rule}</p>

        {puzzle.kind === 'slide' && <Slide p={puzzle} onMove={() => setMoves((m) => m + 1)} onWin={win} locked={solved} sfx={sfx} />}
        {puzzle.kind === 'lights' && <Lights p={puzzle} onMove={() => setMoves((m) => m + 1)} onWin={win} locked={solved} sfx={sfx} />}
        {puzzle.kind === 'lock' && <Lock p={puzzle} onMove={() => setMoves((m) => m + 1)} onWin={win} onFail={lose} locked={solved || !!failed} sfx={sfx} />}
        {puzzle.kind === 'echo' && <Echo p={puzzle} onMove={() => setMoves((m) => m + 1)} onWin={win} onFail={lose} locked={solved || !!failed} sfx={sfx} />}
        {puzzle.kind === 'sum' && <Sum p={puzzle} onMove={() => setMoves((m) => m + 1)} onWin={win} locked={solved} sfx={sfx} />}

        {(solved || failed) && (
          <ResultOverlay verdict={solved ? 'win' : 'loss'} reason={solved ? `${info.name} solved in ${moves} moves` : failed ?? undefined}
            playerA={{ name: 'You', score: moves, you: true }}
            playerB={{ name: 'Clock', score: `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}` }}
            rows={[{ label: 'Chamber', a: info.name, b: diff }, { label: 'Chambers cleared', a: `${kindsCleared.length}/5`, b: '' }]}
            onRematch={() => reset()} rematchLabel="Next puzzle"
            onExit={() => { const i = PUZZLE_KINDS.indexOf(kind); setKind(PUZZLE_KINDS[(i + 1) % PUZZLE_KINDS.length]); }}
            exitLabel="Switch chamber" />
        )}
      </div>
    </SoloShell>
  );
}

/* ---------------- 1. Shard Slide ---------------- */
function Slide({ p, onMove, onWin, locked, sfx }: { p: SlideP; onMove: () => void; onWin: () => void; locked: boolean; sfx: (k: Cue) => void }) {
  const [tiles, setTiles] = useState(p.tiles);
  const [blank, setBlank] = useState(p.blank);
  useEffect(() => { setTiles(p.tiles); setBlank(p.blank); }, [p]);

  const move = (i: number) => {
    if (locked || !slideNeighbours(blank, p.n).includes(i)) return;
    const next = tiles.slice();
    next[blank] = next[i]; next[i] = 0;
    setTiles(next); setBlank(i); onMove(); sfx('move');
    if (slideSolved({ ...p, tiles: next, blank: i })) setTimeout(onWin, 180);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const map: Record<string, number> = { ArrowUp: blank + p.n, ArrowDown: blank - p.n, ArrowLeft: blank + 1, ArrowRight: blank - 1 };
      const t = map[e.key];
      if (t === undefined) return;
      e.preventDefault();
      if (t >= 0 && t < p.n * p.n && slideNeighbours(blank, p.n).includes(t)) move(t);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [blank, tiles, locked]);

  return (
    <div className="panel panel-notch p-3">
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${p.n}, minmax(0,1fr))`, width: `min(84vw, ${p.n * 76}px)` }}>
        {tiles.map((t, i) => t === 0 ? <div key={i} className="aspect-square inset-grid" />
          : <button key={i} onClick={() => move(i)} disabled={locked}
              className="aspect-square grid place-items-center display text-[clamp(16px,4.5vw,26px)] text-[#5a3a12] bg-gradient-to-br from-volt-300 to-gold-500 notch-sm no-tap transition-transform hover:scale-[1.03] disabled:opacity-70"
              aria-label={`Tile ${t}`}>{t}</button>)}
      </div>
    </div>
  );
}

/* ---------------- 2. Circuit Grid ---------------- */
function Lights({ p, onMove, onWin, locked, sfx }: { p: LightsP; onMove: () => void; onWin: () => void; locked: boolean; sfx: (k: Cue) => void }) {
  const [cells, setCells] = useState(p.cells);
  useEffect(() => setCells(p.cells), [p]);
  const tap = (i: number) => {
    if (locked) return;
    const next = cells.slice();
    for (const t of lightsToggle(i, p.n)) next[t] = !next[t];
    setCells(next); onMove(); sfx('place');
    if (lightsSolved({ ...p, cells: next })) setTimeout(onWin, 180);
  };
  const lit = cells.filter(Boolean).length;
  return (
    <div className="panel panel-notch p-3">
      <p className="eyebrow text-center mb-2">{lit} node{lit === 1 ? '' : 's'} still live</p>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${p.n}, minmax(0,1fr))`, width: `min(84vw, ${p.n * 68}px)` }}>
        {cells.map((on, i) => (
          <button key={i} onClick={() => tap(i)} disabled={locked} aria-pressed={on} aria-label={`Node ${i + 1} ${on ? 'live' : 'down'}`}
            className={`aspect-square notch-sm no-tap grid place-items-center transition-colors ${on ? 'bg-volt-400 text-[#5a3a12] shadow-[0_0_16px_rgba(255,203,5,.45)]' : 'bg-ink-800 text-cream-400 border border-ink-600'}`}>
            <svg width="40%" height="40%" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4 14h6l-1 8 9-12h-6z" /></svg>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------------- 3. Volt Lock ---------------- */
function Lock({ p, onMove, onWin, onFail, locked, sfx }: { p: LockP; onMove: () => void; onWin: () => void; onFail: (s: string) => void; locked: boolean; sfx: (k: Cue) => void }) {
  const [guess, setGuess] = useState<number[]>(() => new Array(p.len).fill(1));
  const [log, setLog] = useState<{ g: number[]; exact: number; partial: number }[]>([]);
  useEffect(() => { setGuess(new Array(p.len).fill(1)); setLog([]); }, [p]);

  const submit = () => {
    if (locked) return;
    const fb = lockFeedback(p.code, guess);
    const next = [...log, { g: [...guess], exact: fb.exact, partial: fb.partial }];
    setLog(next); onMove();
    if (fb.exact === p.len) { setTimeout(onWin, 150); return; }
    sfx('place');
    if (next.length >= p.tries) onFail(`Lock seized — the code was ${p.code.join('-')}.`);
  };
  const bump = (i: number, d: number) => setGuess((g) => g.map((v, k) => (k === i ? ((v - 1 + d + p.digits) % p.digits) + 1 : v)));

  return (
    <div className="panel panel-notch p-4 w-[min(92vw,460px)]">
      <div className="flex justify-center gap-2 mb-3">
        {guess.map((v, i) => (
          <div key={i} className="flex flex-col items-center gap-1">
            <button onClick={() => bump(i, 1)} disabled={locked} className="text-cream-400 hover:text-volt-700 no-tap" aria-label={`Increase dial ${i + 1}`}><Icon name="chevron-up" size={16} /></button>
            <div className="w-12 h-14 grid place-items-center bg-ink-800 border border-ink-600 notch-sm display text-[22px] text-volt-700 tabnum">{v}</div>
            <button onClick={() => bump(i, -1)} disabled={locked} className="text-cream-400 hover:text-volt-700 no-tap" aria-label={`Decrease dial ${i + 1}`}><Icon name="chevron-down" size={16} /></button>
          </div>
        ))}
      </div>
      <Button className="w-full" onClick={submit} disabled={locked}>Test code · {p.tries - log.length} left</Button>
      <div className="mt-3 space-y-1.5 max-h-[180px] overflow-y-auto">
        {log.map((r, i) => (
          <div key={i} className="flex items-center gap-2 text-[12.5px]">
            <span className="font-mono text-cream-300 tabnum">{r.g.join(' ')}</span>
            <span className="flex-1" />
            {Array.from({ length: r.exact }).map((_, k) => <span key={`e${k}`} className="w-2.5 h-2.5 bg-volt-400 rounded-full" title="Right digit, right slot" />)}
            {Array.from({ length: r.partial }).map((_, k) => <span key={`p${k}`} className="w-2.5 h-2.5 bg-spark-400 rounded-full" title="Right digit, wrong slot" />)}
            {r.exact + r.partial === 0 && <span className="text-cream-400 text-[11px]">no match</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- 4. Pattern Echo ---------------- */
function Echo({ p, onMove, onWin, onFail, locked, sfx }: { p: EchoP; onMove: () => void; onWin: () => void; onFail: (s: string) => void; locked: boolean; sfx: (k: Cue) => void }) {
  const [round, setRound] = useState(1);
  const [playing, setPlaying] = useState(true);
  const [active, setActive] = useState<number | null>(null);
  const [input, setInput] = useState<number[]>([]);
  const timers = useRef<number[]>([]);

  useEffect(() => { setRound(1); setInput([]); setPlaying(true); }, [p]);

  useEffect(() => {
    if (locked) return;
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setPlaying(true); setInput([]);
    const seq = p.sequence.slice(0, round);
    seq.forEach((pad, i) => {
      timers.current.push(window.setTimeout(() => { setActive(pad); sfx(`tone${pad % 5}` as Cue); }, 420 + i * 560));
      timers.current.push(window.setTimeout(() => setActive(null), 420 + i * 560 + 330));
    });
    timers.current.push(window.setTimeout(() => setPlaying(false), 420 + seq.length * 560));
    return () => timers.current.forEach(clearTimeout);
  }, [round, p, locked]);

  const tap = (pad: number) => {
    if (playing || locked) return;
    sfx(`tone${pad % 5}` as Cue);
    setActive(pad); setTimeout(() => setActive(null), 150);
    const next = [...input, pad];
    setInput(next);
    const expected = p.sequence.slice(0, round);
    if (next[next.length - 1] !== expected[next.length - 1]) { onFail(`Sequence broken at step ${next.length}. You reached round ${round}.`); return; }
    if (next.length === expected.length) {
      onMove();
      if (round >= 12) { setTimeout(onWin, 220); return; }
      setTimeout(() => setRound((r) => r + 1), 520);
    }
  };

  const cols = p.pads <= 4 ? 2 : p.pads <= 6 ? 3 : 3;
  const COLORS = ['#f0b429', '#4a9fd8', '#3fae82', '#e05a74', '#9b7ad6', '#ff9d2e', '#f5f0e1', '#6fe3d2', '#ff6fae'];
  return (
    <div className="panel panel-notch p-4 flex flex-col items-center gap-3">
      <p className="eyebrow">Round {round} / 12 · {playing ? 'Watch' : 'Repeat'}</p>
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))`, width: `min(80vw, ${cols * 92}px)` }}>
        {Array.from({ length: p.pads }).map((_, i) => (
          <button key={i} onClick={() => tap(i)} disabled={playing || locked} aria-label={`Pad ${i + 1}`}
            className="aspect-square notch-sm no-tap border transition-all duration-100"
            style={{
              background: active === i ? COLORS[i % COLORS.length] : `${COLORS[i % COLORS.length]}22`,
              borderColor: `${COLORS[i % COLORS.length]}99`,
              boxShadow: active === i ? `0 0 22px ${COLORS[i % COLORS.length]}99` : 'none',
              transform: active === i ? 'scale(0.96)' : 'none',
            }} />
        ))}
      </div>
      <div className="flex gap-1">
        {p.sequence.slice(0, round).map((_, i) => (
          <span key={i} className={`w-2 h-2 rounded-full ${i < input.length ? 'bg-volt-400' : 'bg-ink-600'}`} />
        ))}
      </div>
    </div>
  );
}

/* ---------------- 5. Volt Sum ---------------- */
function Sum({ p, onMove, onWin, locked, sfx }: { p: SumP; onMove: () => void; onWin: () => void; locked: boolean; sfx: (k: Cue) => void }) {
  const [picked, setPicked] = useState<boolean[]>(() => new Array(p.n * p.n).fill(false));
  useEffect(() => setPicked(new Array(p.n * p.n).fill(false)), [p]);
  const toggle = (i: number) => {
    if (locked) return;
    const next = picked.slice(); next[i] = !next[i];
    setPicked(next); onMove(); sfx('place');
    if (sumSolved(p, next)) setTimeout(onWin, 180);
  };
  const rowSum = (r: number) => { let t = 0; for (let c = 0; c < p.n; c++) if (picked[r * p.n + c]) t += c + 1; return t; };
  const colSum = (c: number) => { let t = 0; for (let r = 0; r < p.n; r++) if (picked[r * p.n + c]) t += r + 1; return t; };

  return (
    <div className="panel panel-notch p-3 overflow-x-auto">
      <div className="grid gap-1" style={{ gridTemplateColumns: `28px repeat(${p.n}, minmax(0,1fr)) 40px`, width: `min(90vw, ${p.n * 56 + 80}px)` }}>
        <span />
        {Array.from({ length: p.n }).map((_, c) => <span key={`h${c}`} className="text-center text-[10px] font-bold text-cream-400 tabnum">{c + 1}</span>)}
        <span />
        {Array.from({ length: p.n }).map((_, r) => (
          <Fragment key={`r${r}`}>
            <span className="grid place-items-center text-[10px] font-bold text-cream-400 tabnum">{r + 1}</span>
            {Array.from({ length: p.n }).map((_, c) => {
              const i = r * p.n + c;
              return (
                <button key={i} onClick={() => toggle(i)} disabled={locked} aria-pressed={picked[i]} aria-label={`Row ${r + 1} column ${c + 1}`}
                  className={`aspect-square notch-sm no-tap border transition-colors ${picked[i] ? 'bg-volt-400 border-volt-300' : 'bg-ink-800 border-ink-600 hover:border-ink-500'}`} />
              );
            })}
            <span className={`grid place-items-center text-[12px] font-extrabold tabnum ${rowSum(r) === p.rowTargets[r] ? 'text-leaf-700' : rowSum(r) > p.rowTargets[r] ? 'text-ember-600' : 'text-cream-300'}`}>
              {p.rowTargets[r]}
            </span>
          </Fragment>
        ))}
        <span />
        {Array.from({ length: p.n }).map((_, c) => (
          <span key={`f${c}`} className={`text-center text-[12px] font-extrabold tabnum ${colSum(c) === p.colTargets[c] ? 'text-leaf-700' : colSum(c) > p.colTargets[c] ? 'text-ember-600' : 'text-cream-300'}`}>
            {p.colTargets[c]}
          </span>
        ))}
        <span />
      </div>
    </div>
  );
}
