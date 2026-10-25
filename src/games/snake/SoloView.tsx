import { useCallback, useEffect, useRef, useState } from 'react';
import { useTouch } from '../../lib/useTouch';
import { aiDir, createSnake, queueDir, step, xy, type Dir, type SnakeState } from './engine';
import SoloShell, { ModeRail } from '../../components/SoloShell';
import { ResultOverlay } from '../../components/Overlays';
import { Button, Icon, Panel, Segmented, Stat, Toggle } from '../../components/ui';
import { useStore } from '../../lib/store';
import type { Difficulty, GameMeta } from '../types';

const SKINS: Record<string, { body: string; head: string; glow: string; label: string }> = {
  volt: { body: '#f6c445', head: '#fff0bd', glow: 'rgba(246,196,69,.55)', label: 'Butter' },
  spark: { body: '#ff9fbd', head: '#ffe0ea', glow: 'rgba(255,159,189,.55)', label: 'Blossom' },
  leaf: { body: '#7fd4b0', head: '#dcf6ec', glow: 'rgba(127,212,176,.55)', label: 'Mint' },
  ember: { body: '#b79af0', head: '#e8ddff', glow: 'rgba(183,154,240,.55)', label: 'Lilac' },
};
const KEYS: Record<string, Dir> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right',
};
const P2KEYS: Record<string, Dir> = { w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right' };
const BEST_KEY = (d: Difficulty) => `pikachu.snake.best.${d}`;
const readBest = (d: Difficulty) => { try { return Number(localStorage.getItem(BEST_KEY(d))) || 0; } catch { return 0; } };
const writeBest = (d: Difficulty, v: number) => { try { localStorage.setItem(BEST_KEY(d), String(v)); } catch { /* storage blocked */ } };

const SPEEDS: Record<Difficulty, number> = { beginner: 160, casual: 135, intermediate: 112, advanced: 92, expert: 74 };

export default function SnakeSolo({ game }: { game: GameMeta }) {
  const touch = useTouch();
  const { sfx, finishMatch, settings } = useStore();
  const [mode, setMode] = useState<'solo' | 'ai' | 'local'>('solo');
  const [difficulty, setDifficulty] = useState<Difficulty>('intermediate');
  const [skin, setSkin] = useState('volt');
  const [maze, setMaze] = useState(false);
  const [wrap, setWrap] = useState(false);
  const [paused, setPaused] = useState(false);
  const [shown, setShown] = useState(false);
  /* the arena stays still until the player actually takes the controls — nobody
     should lose a run to a wall they never had the chance to steer away from */
  const [armed, setArmed] = useState(false);
  const [best, setBest] = useState(0);
  const beat = useRef(false);
  const [state, setState] = useState<SnakeState>(() => createSnake({ players: 1, withAi: false }, Date.now() >>> 0));

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const raf = useRef(0);
  const acc = useRef(0);
  const lastTs = useRef(0);
  const prevScore = useRef(0);

  const players = mode === 'local' ? 2 : 1;
  const withAi = mode === 'ai';

  const reset = useCallback(() => {
    setState(createSnake({ players: players as 1 | 2, withAi, maze }, (Date.now() ^ 0x27d4eb2f) >>> 0));
    setShown(false); setPaused(false); setArmed(false); acc.current = 0; prevScore.current = 0; beat.current = false;
  }, [players, withAi, maze]);
  useEffect(() => { reset(); }, [mode, maze, difficulty]);
  useEffect(() => { setBest(readBest(difficulty)); }, [difficulty]);

  /* ---------- input ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'p' || e.key === 'P') { e.preventDefault(); setPaused((p) => !p); return; }
      if (e.key === 'Escape') { setPaused(true); return; }
      if (mode === 'local') {
        if (e.key.startsWith('Arrow')) { e.preventDefault(); setArmed(true); setState((s) => queueDir(s, 0, KEYS[e.key])); }
        else if (P2KEYS[e.key]) { setArmed(true); setState((s) => queueDir(s, 1, P2KEYS[e.key])); }
        return;
      }
      const d = KEYS[e.key];
      if (!d) return;
      if (e.key.startsWith('Arrow')) e.preventDefault();
      setArmed(true);
      setState((s) => queueDir(s, 0, d));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode]);

  /* ---------- the loop: rAF with a fixed-step accumulator, suspended when hidden ---------- */
  useEffect(() => {
    const interval = () => {
      const base = SPEEDS[difficulty];
      const s = stateRef.current;
      const me = s.snakes[0];
      const boost = me && me.alive && s.tick < me.boostUntil ? 0.62 : 1;
      const ramp = Math.max(0.68, 1 - Math.floor((me?.score ?? 0) / 150) * 0.05);
      return base * boost * ramp;
    };
    const frame = (ts: number) => {
      raf.current = requestAnimationFrame(frame);
      if (!lastTs.current) lastTs.current = ts;
      const dt = Math.min(240, ts - lastTs.current);
      lastTs.current = ts;
      if (!armed || paused || stateRef.current.over || document.hidden) { acc.current = 0; draw(); return; }
      acc.current += dt;
      const ms = interval();
      let ticked = false;
      while (acc.current >= ms) {
        acc.current -= ms;
        let next = stateRef.current;
        if (withAi && next.snakes[1]?.alive) next = queueDir(next, 1, aiDir(next, 1, difficulty));
        next = step(next, wrap);
        stateRef.current = next;
        ticked = true;
      }
      if (ticked) setState(stateRef.current);
      draw();
    };
    raf.current = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf.current); lastTs.current = 0; };
  }, [armed, paused, difficulty, withAi, wrap, settings.quality]);

  /* audio cues on score / death. The three pickups are worth 10/25/40 and the
     25 is the speed bolt, so the delta tells us which one was eaten and each
     gets its own voice instead of one generic blip. */
  const crashed = useRef(false);
  useEffect(() => {
    const me = state.snakes[0];
    const sc = me?.score ?? 0;
    if (sc > prevScore.current) {
      const d = sc - prevScore.current;
      sfx(d >= 40 ? 'power' : d >= 25 ? 'zap' : 'pickup');
      prevScore.current = sc;
    }
    // the crash itself was silent — you simply stopped and the card appeared
    if (me && !me.alive && !crashed.current) { crashed.current = true; sfx('hit'); }
    if (me && me.alive) crashed.current = false;
  }, [state.snakes, sfx]);

  useEffect(() => {
    if (!state.over || shown) return;
    setShown(true);
    const me = state.snakes[0];
    const record = mode === 'solo' && me.score > best;
    if (record) { beat.current = true; writeBest(difficulty, me.score); setBest(me.score); }
    const result = mode === 'solo'
      ? (record ? 'win' as const : 'loss' as const)
      : state.winner === 0 ? 'win' as const : state.winner === null ? 'draw' as const : 'loss' as const;
    finishMatch({
      gameId: 'snake', mode, result, score: me.score,
      meta: { snakeLength: me.body.length, difficulty, personalBest: Math.max(best, me.score) },
    });
  }, [state.over]);

  /* ---------- canvas renderer ---------- */
  const draw = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const s = stateRef.current;
    const dpr = Math.min(window.devicePixelRatio || 1, settings.quality === 'performance' ? 1 : 2);
    const cell = Math.floor(Math.min(cv.clientWidth / s.cols, cv.clientHeight / s.rows));
    const w = cell * s.cols, h = cell * s.rows;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      cv.style.width = `${w}px`; cv.style.height = `${h}px`;
    }
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const paper = ctx.createLinearGradient(0, 0, 0, h);
    paper.addColorStop(0, '#fffaf0'); paper.addColorStop(1, '#fdeedd');
    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(176,137,104,.16)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= s.cols; x++) { ctx.beginPath(); ctx.moveTo(x * cell + .5, 0); ctx.lineTo(x * cell + .5, h); ctx.stroke(); }
    for (let y = 0; y <= s.rows; y++) { ctx.beginPath(); ctx.moveTo(0, y * cell + .5); ctx.lineTo(w, y * cell + .5); ctx.stroke(); }

    ctx.fillStyle = '#e3c3a0';
    for (const wl of s.walls) { const { x, y } = xy(wl, s.cols); ctx.fillRect(x * cell + 1, y * cell + 1, cell - 2, cell - 2); }

    for (const p of s.pickups) {
      const { x, y } = xy(p.i, s.cols);
      const cx = x * cell + cell / 2, cy = y * cell + cell / 2;
      const col = p.kind === 'bolt' ? '#6fb6e8' : p.kind === 'berry' ? '#f2779a' : '#f0b429';
      const pulse = settings.quality === 'performance' ? 1 : 1 + Math.sin(s.tick * 0.4 + p.i) * 0.08;
      ctx.fillStyle = col;
      if (p.kind === 'bolt') {
        ctx.beginPath();
        ctx.moveTo(cx + cell * .08, cy - cell * .34);
        ctx.lineTo(cx - cell * .22, cy + cell * .04);
        ctx.lineTo(cx - cell * .02, cy + cell * .04);
        ctx.lineTo(cx - cell * .08, cy + cell * .34);
        ctx.lineTo(cx + cell * .24, cy - cell * .06);
        ctx.lineTo(cx + cell * .04, cy - cell * .06);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(90,63,52,.8)'; ctx.lineWidth = Math.max(1, cell * .06); ctx.stroke();
      } else {
        ctx.beginPath(); ctx.arc(cx, cy, cell * 0.3 * pulse, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(90,63,52,.8)'; ctx.lineWidth = Math.max(1, cell * .07); ctx.stroke();
      }
    }

    s.snakes.forEach((sn, si) => {
      const sk = SKINS[si === 0 ? skin : si === 1 && withAi ? 'ember' : 'spark'];
      const boosting = sn.alive && s.tick < sn.boostUntil;
      sn.body.forEach((b, i) => {
        const { x, y } = xy(b, s.cols);
        const t = i / Math.max(1, sn.body.length);
        ctx.globalAlpha = sn.alive ? 1 - t * 0.45 : 0.3;
        ctx.fillStyle = i === 0 ? sk.head : sk.body;
        const pad = i === 0 ? 1 : 2;
        roundRect(ctx, x * cell + pad, y * cell + pad, cell - pad * 2, cell - pad * 2, i === 0 ? cell * .34 : cell * .26);
        ctx.fill();
        ctx.strokeStyle = 'rgba(90,63,52,.85)'; ctx.lineWidth = Math.max(1, cell * .07); ctx.stroke();
        if (i === 0 && sn.alive) {
          ctx.globalAlpha = 1;
          ctx.fillStyle = '#5a3f34';
          const d = sn.dir, cx = x * cell + cell / 2, cy = y * cell + cell / 2;
          const ox = d === 'left' ? -cell * .12 : d === 'right' ? cell * .12 : 0;
          const oy = d === 'up' ? -cell * .12 : d === 'down' ? cell * .12 : 0;
          const sx = d === 'up' || d === 'down' ? cell * .16 : 0;
          const sy = d === 'left' || d === 'right' ? cell * .16 : 0;
          ctx.beginPath(); ctx.arc(cx + ox - sx, cy + oy - sy, cell * .07, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(cx + ox + sx, cy + oy + sy, cell * .07, 0, Math.PI * 2); ctx.fill();
          if (boosting && settings.quality !== 'performance') {
            ctx.strokeStyle = sk.glow; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(cx, cy, cell * .55, 0, Math.PI * 2); ctx.stroke();
          }
        }
      });
      ctx.globalAlpha = 1;
    });
  }, [skin, withAi, settings.quality]);

  useEffect(() => { draw(); }, [draw, state]);

  const me = state.snakes[0];
  const rival = state.snakes[1];

  return (
    <SoloShell game={game} wide
      mascot={!armed && !state.over ? 'waiting' : state.over ? (mode !== 'solo' && state.winner === 0 ? 'victory' : mode === 'solo' ? 'thinking' : 'defeated') : paused ? 'waiting' : me?.boostUntil > state.tick ? 'excited' : 'competitive'}
      mascotLine={!armed && !state.over ? (touch ? 'Standing by. Swipe when you are ready — nothing moves until you do.' : 'Standing by. Steer when you are ready — nothing moves until you do.') : state.over ? `${state.reason} — ${me.score} charge collected.` : paused ? (touch ? 'Paused. Tap the board when you are ready.' : 'Paused. Press space when you are ready.')
        : mode === 'local' ? 'Player 1 arrows, Player 2 WASD. Last serpent alive wins.'
        : 'Arrows or WASD. Blue bolts boost, red berries are worth triple.'}
      onRestart={reset}
      controls={<ModeRail mode={mode} setMode={setMode} difficulty={difficulty} setDifficulty={setDifficulty}
        modes={[{ value: 'solo', label: 'Solo run' }, { value: 'ai', label: 'vs AI serpent' }, { value: 'local', label: 'Same device' }]}
        extra={<>
          <span className="eyebrow ml-1">Skin</span>
          <Segmented value={skin} onChange={setSkin} size="sm" label="Skin"
            options={Object.entries(SKINS).map(([v, s]) => ({ value: v, label: s.label }))} />
          <Toggle checked={maze} onChange={setMaze} label="Pillars" />
          <Toggle checked={wrap} onChange={setWrap} label="Wrap walls" />
          <Button size="sm" variant="ghost" onClick={() => setPaused((p) => !p)} icon={<Icon name={paused ? 'play' : 'pause'} size={13} />}>
            {paused ? 'Resume' : 'Pause'}
          </Button>
        </>} />}
      hud={
        <Panel className="p-2 sm:p-3 flex items-center gap-2 sm:gap-3 flex-wrap justify-center">
          <Stat label={mode === 'local' ? 'P1' : 'Charge'} value={me?.score ?? 0} accent={SKINS[skin].body} />
          <Stat label="Length" value={me?.body.length ?? 0} />
          {rival && <Stat label={withAi ? `AI ${difficulty}` : 'P2'} value={rival.score} accent="#b0301d" />}
          <Stat label="Ticks" value={state.tick} />
          {paused && <span className="px-2.5 py-1 text-[10.5px] font-extrabold uppercase tracking-wider notch-sm bg-blush-100 text-cream-300">Paused</span>}
        </Panel>
      }
      footer={
        <div className="flex gap-2 justify-center sm:hidden">
          <DPad onDir={(d) => { setArmed(true); setState((s) => queueDir(s, 0, d)); }} />
        </div>
      }>
      <div className="relative w-full flex justify-center">
        <div className="panel panel-notch p-2.5 inline-block">
          <canvas ref={canvasRef} className="block w-[min(88vw,760px)] h-[min(62vh,560px)] no-tap"
            role="img" aria-label={`Snake arena. Score ${me?.score ?? 0}, length ${me?.body.length ?? 0}.`} />
        </div>
        {!armed && !state.over && (
          <div className="absolute inset-0 grid place-items-center pointer-events-none">
            <div className="panel panel-notch px-6 py-4 text-center bg-ink-800/95 shadow-xl">
              <p className="font-display text-[19px] font-extrabold text-cream-100">Take the controls</p>
              <p className="mt-1 text-[12.5px] text-cream-300">
                {mode === 'local'
                  ? (touch ? 'Player 1 swipes or uses the pad, Player 2 uses W A S D.' : 'Player 1 presses an arrow key, Player 2 uses W A S D.')
                  : (touch ? 'Swipe the board, or use the pad below, to start.' : 'Press an arrow key to start the run.')}
              </p>
              <p className="mt-2 text-[11px] uppercase tracking-wider font-bold text-cream-500">
                {touch ? 'Tap the board to pause' : 'Space pauses · Esc holds'}
              </p>
            </div>
          </div>
        )}
        {state.over && shown && (
          <ResultOverlay
            verdict={mode === 'solo' ? (beat.current ? 'win' : 'loss') : state.winner === 0 ? 'win' : state.winner === null ? 'draw' : 'loss'}
            reason={mode === 'solo' ? (beat.current ? `New record — ${state.reason.toLowerCase()}` : state.reason) : state.reason}
            playerA={{ name: mode === 'local' ? 'Player 1' : 'You', score: me.score, you: true }}
            playerB={{ name: mode === 'solo' ? `Best (${difficulty})` : withAi ? `AI (${difficulty})` : 'Player 2', score: rival ? rival.score : best }}
            rows={[{ label: 'Length', a: me.body.length, b: rival?.body.length ?? '' }, { label: 'Ticks survived', a: state.tick, b: '' }]}
            onRematch={reset} rematchLabel="Run again" onExit={reset} />
        )}
      </div>
    </SoloShell>
  );
}

function DPad({ onDir }: { onDir: (d: Dir) => void }) {
  const btn = 'w-12 h-12 grid place-items-center panel text-cream-100 active:bg-volt-400 active:text-[#5a3a12] no-tap';
  return (
    <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Direction pad">
      <span />
      <button className={btn} onClick={() => onDir('up')} aria-label="Up"><Icon name="chevron-up" size={18} /></button>
      <span />
      <button className={btn} onClick={() => onDir('left')} aria-label="Left"><Icon name="chevron-left" size={18} /></button>
      <button className={btn} onClick={() => onDir('down')} aria-label="Down"><Icon name="chevron-down" size={18} /></button>
      <button className={btn} onClick={() => onDir('right')} aria-label="Right"><Icon name="chevron-right" size={18} /></button>
    </div>
  );
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
