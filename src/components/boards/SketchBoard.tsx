import { useCallback, useEffect, useRef, useState } from 'react';
import type { BoardProps } from './types';
import { Button, Icon, Panel } from '../ui';
import { BoardStage } from './BoardStage';
import {
  BRUSHES, PALETTE, DRAW_MS, MAX_POINTS, ERASER_COLOR_INDEX, CANVAS_BG,
  type SketchState, type Stroke,
} from '../../games/sketch/rules';

/**
 * Guess & Draw board.
 *
 * The drawer gets a canvas; the guesser gets the same canvas read-only plus a
 * text box. Which one you are is decided by `state.drawer`, never by anything
 * local, and the word only exists in the payload if the server decided you are
 * allowed to see it.
 *
 * Strokes are committed on pointer-up as a single move. Streaming every pointer
 * event would be a firehose through a server-authoritative relay for no real
 * gain; a stroke in progress is painted locally so the drawer sees no lag, and
 * long strokes are flushed every 1.2s so the guesser is never watching a frozen
 * canvas during a slow outline.
 */

const VB = 1000;   // the coordinate space strokes are stored in

/**
 * Points are stored in a square 0..1000 space, normalised on input by the
 * canvas's own width AND height. So they have to be scaled back by width and
 * height separately. Scaling both axes by the width (which is what this did
 * first) pushed everything below y≈750 clean off a 4:3 canvas — a stroke along
 * the bottom edge rendered nowhere at all, silently deleting the lower quarter
 * of every drawing. Per-axis scaling also means the picture lands in the same
 * relative place even if the two players' canvases are different shapes.
 */
function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke, sx: number, sy: number) {
  if (s.p.length < 2) return;
  ctx.strokeStyle = PALETTE[s.c] ?? PALETTE[0];
  // the nib stays round: a per-axis width would turn it into an ellipse
  ctx.lineWidth = (BRUSHES[s.w] ?? BRUSHES[1]) * Math.min(sx, sy);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(s.p[0] * sx, s.p[1] * sy);
  if (s.p.length === 2) {
    // a single tap is a dot, not a zero-length line
    ctx.lineTo(s.p[0] * sx + 0.01, s.p[1] * sy);
  } else {
    for (let i = 2; i < s.p.length; i += 2) ctx.lineTo(s.p[i] * sx, s.p[i + 1] * sy);
  }
  ctx.stroke();
}

export default function SketchBoard({ state, youSlot, onMove, interactive, names }: BoardProps<SketchState>) {
  const cv = useRef<HTMLCanvasElement>(null);
  const live = useRef<number[]>([]);          // the stroke being drawn right now
  const drawing = useRef(false);
  const flushAt = useRef(0);
  const [colour, setColour] = useState(0);
  const [brush, setBrush] = useState(1);
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen');
  const [guess, setGuess] = useState('');
  const [left, setLeft] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const activeColor = tool === 'eraser' ? ERASER_COLOR_INDEX : colour;

  const amDrawer = state.drawer === youSlot;
  const canDraw = amDrawer && state.phase === 'draw' && interactive !== false;
  const canGuess = !amDrawer && state.phase === 'draw' && interactive !== false;

  /* Reset tool to pen on new round */
  useEffect(() => {
    setTool('pen');
  }, [state.round]);

  /* Keyboard shortcuts for drawer (E = eraser, B/P = pen, Ctrl+Z = undo) */
  useEffect(() => {
    if (!canDraw) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'e' || e.key === 'E') {
        e.preventDefault();
        setTool((t) => (t === 'eraser' ? 'pen' : 'eraser'));
      } else if (e.key === 'p' || e.key === 'P' || e.key === 'b' || e.key === 'B') {
        e.preventDefault();
        setTool('pen');
      } else if ((e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (state.strokes.length) onMove({ t: 'undo' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canDraw, state.strokes.length, onMove]);

  /* ---------- countdown ---------- */
  useEffect(() => {
    const id = setInterval(() => setLeft(Math.max(0, state.endsAt - Date.now())), 200);
    setLeft(Math.max(0, state.endsAt - Date.now()));
    return () => clearInterval(id);
  }, [state.endsAt]);

  /* ---------- paint ---------- */
  const paint = useCallback(() => {
    const c = cv.current;
    if (!c) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    }
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = CANVAS_BG;
    ctx.fillRect(0, 0, w, h);
    const sx = w / VB, sy = h / VB;
    for (const s of state.strokes) drawStroke(ctx, s, sx, sy);
    if (live.current.length >= 2) drawStroke(ctx, { p: live.current, c: activeColor, w: brush }, sx, sy);
  }, [state.strokes, activeColor, brush]);

  useEffect(() => { paint(); }, [paint]);
  useEffect(() => {
    const ro = new ResizeObserver(() => paint());
    if (cv.current) ro.observe(cv.current);
    return () => ro.disconnect();
  }, [paint]);

  /* ---------- drawing input ---------- */
  const at = (e: PointerEvent | React.PointerEvent) => {
    const c = cv.current!;
    const r = c.getBoundingClientRect();
    return [
      Math.max(0, Math.min(VB, Math.round(((e.clientX - r.left) / r.width) * VB))),
      Math.max(0, Math.min(VB, Math.round(((e.clientY - r.top) / r.height) * VB))),
    ];
  };

  const commit = useCallback(() => {
    const pts = live.current;
    if (pts.length >= 2) onMove({ t: 'stroke', p: pts.slice(0, MAX_POINTS * 2), c: activeColor, w: brush });
    live.current = [];
  }, [onMove, activeColor, brush]);

  const onDown = (e: React.PointerEvent) => {
    if (!canDraw) return;
    e.preventDefault();
    drawing.current = true;
    flushAt.current = performance.now() + 1200;
    const [x, y] = at(e);
    live.current = [x, y];
    cv.current?.setPointerCapture(e.pointerId);
    paint();
  };
  const onMoveP = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const [x, y] = at(e);
    const p = live.current;
    const n = p.length;
    // thin out: ignore anything within 6 units of the last point
    if (n >= 2 && Math.abs(p[n - 2] - x) < 6 && Math.abs(p[n - 1] - y) < 6) return;
    p.push(x, y);
    // a long stroke is flushed mid-draw so the other screen keeps up
    if (p.length / 2 >= MAX_POINTS || performance.now() > flushAt.current) {
      const tail = [p[p.length - 2], p[p.length - 1]];
      commit();
      live.current = tail;                       // continue seamlessly from the last point
      flushAt.current = performance.now() + 1200;
    }
    paint();
  };
  const onUp = () => {
    if (!drawing.current) return;
    drawing.current = false;
    commit();
    paint();
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = guess.trim();
    if (!t || !canGuess) return;
    onMove({ t: 'guess', text: t });
    setGuess('');
  };

  const secs = Math.ceil(left / 1000);
  const urgent = state.phase === 'draw' && secs <= 15;
  const pct = state.phase === 'draw' ? Math.max(0, Math.min(1, left / DRAW_MS)) : 0;

  return (
    <div className="w-full max-w-[1020px] mx-auto grid lg:grid-cols-[1fr_300px] gap-3 items-start">
      {/* ---------------- canvas ---------------- */}
      <div className="space-y-2">
        <Panel className="p-3">
          <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
            <div className="min-w-0">
              <p className="eyebrow">
                Round {state.round + 1} of {state.rounds} · {amDrawer ? 'you are drawing' : `${names[state.drawer]} is drawing`}
              </p>
              <p className={`font-display text-[20px] font-extrabold tracking-wide ${amDrawer || state.phase !== 'draw' ? 'text-cream-100' : 'text-cream-300'}`}>
                {state.word
                  ? state.word.toUpperCase()
                  : <span className="tracking-[0.3em]">{state.hint}</span>}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="eyebrow">{state.phase === 'draw' ? 'Time' : 'Next round'}</p>
              <p className={`font-display text-[22px] font-extrabold tabular-nums ${urgent ? 'text-blush-600' : 'text-cream-100'}`}>
                {secs}s
              </p>
            </div>
          </div>
          <div className="h-1.5 bg-ink-600 overflow-hidden mb-2" aria-hidden>
            <div className={`h-full transition-[width] duration-200 ${urgent ? 'bg-[#e05a74]' : 'bg-volt-400'}`}
              style={{ width: `${pct * 100}%` }} />
          </div>

          {/* The canvas was a fixed 4:3 block in a 1020 px column — 765 px tall, which
              pushed the brush tray and the guess box under the fold on a laptop and
              left the drawer scrolling mid-round. The stage caps it against the
              viewport height as well as the column width. */}
          <BoardStage ratio={4 / 3} max={760} min={220} reserve={210} chrome={64}>
          <canvas
            ref={cv}
            onPointerDown={onDown}
            onPointerMove={onMoveP}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            onPointerLeave={onUp}
            className={`block w-full aspect-[4/3] border-2 border-ink-500 bg-ink-800 touch-none select-none ${
              canDraw ? (tool === 'eraser' ? 'cursor-cell' : 'cursor-crosshair') : ''
            }`}
            role="img"
            aria-label={amDrawer
              ? `Your drawing canvas for the word ${state.word ?? ''}. ${state.strokes.length} strokes so far.`
              : `${names[state.drawer]}'s drawing, ${state.strokes.length} strokes so far. Type your guess below.`}
          />
          </BoardStage>
        </Panel>

        {/* ---------------- drawer tools ---------------- */}
        {canDraw && (
          <Panel className="p-3 flex items-center gap-3 flex-wrap">
            {/* Tool mode: Pen vs Eraser */}
            <div className="flex gap-1 bg-blush-100 p-1 border-2 border-ink-500 rounded-full shrink-0">
              <button
                type="button"
                onClick={() => setTool('pen')}
                aria-pressed={tool === 'pen'}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-bold transition-all no-tap ${
                  tool === 'pen'
                    ? 'bg-volt-400 text-[#5a3a12] shadow-[0_2px_0_0_#e0a21f]'
                    : 'text-cream-500 hover:text-cream-100'
                }`}
                title="Pen tool (B or P)"
              >
                <Icon name="pen" size={13} />
                <span>Pen</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  if (tool === 'eraser') {
                    setTool('pen');
                  } else {
                    setTool('eraser');
                    if (brush === 0) setBrush(2);
                  }
                }}
                aria-pressed={tool === 'eraser'}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-bold transition-all no-tap ${
                  tool === 'eraser'
                    ? 'bg-ember-600 text-white shadow-[0_2px_0_0_#9a2b43]'
                    : 'text-cream-500 hover:text-cream-100'
                }`}
                title="Eraser tool (E)"
              >
                <Icon name="eraser" size={13} />
                <span>Eraser</span>
              </button>
            </div>

            {/* Colour palette (8 colours) */}
            <div className={`flex gap-1.5 transition-opacity ${tool === 'eraser' ? 'opacity-40 hover:opacity-100' : ''}`} role="radiogroup" aria-label="Pen colour">
              {PALETTE.slice(0, 8).map((hex, i) => (
                <button key={hex} role="radio" aria-checked={tool === 'pen' && colour === i} aria-label={`Colour ${i + 1}`}
                  onClick={() => { setTool('pen'); setColour(i); }}
                  className={`w-8 h-8 rounded-full border-2 transition-transform ${tool === 'pen' && colour === i ? 'border-cream-100 scale-110 shadow-sm ring-2 ring-volt-400' : 'border-ink-500 hover:scale-105'}`}
                  style={{ background: hex }} />
              ))}
            </div>

            {/* Brush & Eraser sizes */}
            <div className="flex gap-1.5" role="radiogroup" aria-label={tool === 'eraser' ? 'Eraser size' : 'Brush size'}>
              {BRUSHES.map((px, i) => (
                <button key={px} role="radio" aria-checked={brush === i} aria-label={`${tool === 'eraser' ? 'Eraser' : 'Brush'} size ${i + 1}`}
                  onClick={() => setBrush(i)}
                  title={`${tool === 'eraser' ? 'Eraser' : 'Brush'} size ${i + 1}`}
                  className={`w-8 h-8 grid place-items-center border-2 notch-sm ${brush === i ? 'border-volt-400 bg-volt-50' : 'border-ink-500 hover:border-ink-400'}`}>
                  <span className={`rounded-full block ${tool === 'eraser' ? 'bg-ember-600' : 'bg-cream-100'}`} style={{ width: Math.min(px + 2, 22), height: Math.min(px + 2, 22) }} />
                </button>
              ))}
            </div>

            <div className="flex gap-1.5 ml-auto">
              <Button size="sm" variant="ghost" onClick={() => onMove({ t: 'undo' })}
                disabled={!state.strokes.length} icon={<Icon name="undo" size={13} />}>Undo</Button>
              <Button size="sm" variant="ghost" onClick={() => onMove({ t: 'clear' })}
                disabled={!state.strokes.length} icon={<Icon name="x" size={13} />}>Clear</Button>
              <Button size="sm" variant="ghost" onClick={() => onMove({ t: 'skip' })}
                icon={<Icon name="flag" size={13} />}>Give up</Button>
            </div>
          </Panel>
        )}

        {/* ---------------- guesser input ---------------- */}
        {canGuess && (
          <Panel className="p-3">
            <form onSubmit={submit} className="flex gap-2">
              <label className="sr-only" htmlFor="sketch-guess">Your guess</label>
              <input id="sketch-guess" ref={inputRef} value={guess} onChange={(e) => setGuess(e.target.value)}
                autoComplete="off" maxLength={64} placeholder="What is it?"
                className="flex-1 min-w-0 px-3 py-2.5 bg-ink-800 border-2 border-ink-500 text-cream-100 text-[15px] font-semibold placeholder:text-cream-500 focus:border-volt-400 outline-none notch-sm" />
              <Button type="submit" disabled={!guess.trim()} icon={<Icon name="check" size={14} />}>Guess</Button>
            </form>
          </Panel>
        )}
      </div>

      {/* ---------------- side rail ---------------- */}
      <div className="space-y-3">
        <Panel className="p-3">
          <p className="eyebrow mb-2">Score</p>
          {[0, 1].map((i) => (
            <div key={i} className="flex items-center justify-between gap-2 py-1">
              <span className={`text-[13.5px] font-semibold truncate ${i === youSlot ? 'text-cream-100' : 'text-cream-300'}`}>
                {names[i]}{i === youSlot ? ' (you)' : ''}
                {state.drawer === i && state.phase === 'draw' && (
                  <span className="ml-1.5 eyebrow text-volt-700">drawing</span>
                )}
              </span>
              <span data-score-slot={i} className="font-display text-[19px] font-extrabold tabular-nums text-cream-100">{state.scores[i]}</span>
            </div>
          ))}
        </Panel>

        <Panel className="p-3">
          <p className="eyebrow mb-2">Guesses</p>
          {state.guesses.length === 0 ? (
            <p className="text-[13px] text-cream-500">
              {amDrawer ? 'Nothing yet — keep drawing.' : 'Type anything, wrong guesses cost nothing.'}
            </p>
          ) : (
            <ul className="space-y-1 max-h-[220px] overflow-y-auto" aria-live="polite">
              {state.guesses.slice().reverse().map((g, i) => (
                <li key={state.guesses.length - i}
                  className={`text-[13px] px-2 py-1 notch-sm ${g.hit ? 'bg-[#2f9c71]/15 text-leaf-700 font-bold' : 'text-cream-300'}`}>
                  {g.hit ? '✓ ' : ''}{g.text}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {state.phase === 'reveal' && (
          <Panel className="p-3 text-center">
            <p className="eyebrow mb-1">{state.solvedBy === null ? 'Nobody got it' : 'Got it!'}</p>
            <p className="font-display text-[22px] font-extrabold text-cream-100">{state.word}</p>
            {state.solvedBy !== null && (
              <p className="text-[13px] text-cream-300 mt-1">{names[state.solvedBy]} guessed it</p>
            )}
          </Panel>
        )}
      </div>
    </div>
  );
}
