import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BoardProps } from './types';
import { Button, Icon, Panel } from '../ui';
import { BoardStage } from './BoardStage';
import {
  BRUSHES, PALETTE, DRAW_MS, MAX_POINTS, ERASER_COLOR_INDEX, CANVAS_BG,
  type SketchState, type Stroke,
} from '../../games/sketch/rules';
import {
  isDrawPointer, paintStroke, pointFrom, reconcilePending, shouldKeep, strokeCacheKey, thin,
} from '../../games/sketch/strokes';

/**
 * Guess & Draw board.
 *
 * The drawer gets a canvas; the guesser gets the same canvas read-only plus a
 * text box. Which one you are is decided by `state.drawer`, never by anything
 * local, and the word only exists in the payload if the server decided you are
 * allowed to see it.
 *
 * ## How the picture is painted, and why it is built this way
 *
 * Three things here are the difference between a drawing game and a drawing toy:
 *
 *  1. **Committed strokes live in an offscreen bitmap.** Every pointer sample
 *     used to repaint the whole history — hundreds of strokes, thousands of
 *     segments, per finger movement. On a phone that is a visible lag between
 *     the finger and the line, and the line is the whole game. The bitmap is
 *     rebuilt only when the authoritative strokes change (`strokeCacheKey`), and
 *     a sample costs one blit plus the stroke under the finger.
 *  2. **Sent-but-not-echoed strokes stay on this screen.** A long stroke is
 *     flushed mid-draw so the other player is not watching a frozen canvas. The
 *     local copy used to be dropped at that moment and reappear when the server
 *     echoed it, which is why lines blinked out while you drew them.
 *     `reconcilePending` keeps them until the echo lands.
 *  3. **One pointer draws.** A palm, a second finger or the right button used to
 *     start or end a stroke; `isDrawPointer` refuses all three, and the stroke
 *     ends only on pointer-up (not on pointer-leave, which fires while a finger
 *     is simply near the edge).
 *
 * The wire format is unchanged: one move per finished or flushed stroke, integer
 * coordinates in a 0..1000 square, so the server stays the authority and a
 * spectator cannot draw on your screen.
 */

const VB = 1000;   // the coordinate space strokes are stored in

/** Palette names, so the colour buttons are not "Colour 1..8" to a screen reader. */
const COLOUR_NAMES = ['Brown', 'Pink', 'Yellow', 'Green', 'Blue', 'Purple', 'Red', 'Tan'];

export default function SketchBoard({ state, youSlot, onMove, interactive, names }: BoardProps<SketchState>) {
  const cv = useRef<HTMLCanvasElement>(null);
  const cache = useRef<HTMLCanvasElement | null>(null);
  const cacheKey = useRef('');
  const live = useRef<number[]>([]);          // the stroke being drawn right now
  const pending = useRef<Stroke[]>([]);       // sent, not yet echoed
  const drawing = useRef(false);
  const pointerId = useRef<number | null>(null);
  const flushAt = useRef(0);
  const frame = useRef(0);
  const timer = useRef(0);
  const seenStrokes = useRef(state.strokes.length);
  const [colour, setColour] = useState(0);
  const [brush, setBrush] = useState(1);
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen');
  const [guess, setGuess] = useState('');
  const [wrong, setWrong] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [left, setLeft] = useState(0);
  /* A counter, not data: the local layers live in refs, but the UI reads their
     length (stroke count in the canvas label, whether Undo is enabled). Without
     this the buttons stayed disabled until the server echo arrived. */
  const [, bump] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const activeColor = tool === 'eraser' ? ERASER_COLOR_INDEX : colour;

  const amDrawer = state.drawer === youSlot;
  const canDraw = amDrawer && state.phase === 'draw' && interactive !== false;
  const canGuess = !amDrawer && state.phase === 'draw' && interactive !== false;

  /* ------------------------------- painting ------------------------------- */

  /**
   * Repaint once per frame, with a timer as a safety net.
   *
   * `requestAnimationFrame` is the right clock for a drawing surface — it matches
   * the display and it never paints twice in a frame. It is also *stopped* in a
   * few situations that have nothing to do with drawing: a background tab, a
   * headless renderer with no compositor, an embedded webview that has been
   * occluded. Relying on it alone meant the canvas simply never painted in those
   * cases — the board was blank, no stroke was ever committed, and the game looked
   * broken. Whichever of the two fires first wins; the other is cancelled.
   */
  const schedule = useCallback(() => {
    if (frame.current) return;
    const run = () => {
      if (!frame.current) return;
      cancelAnimationFrame(frame.current);
      clearTimeout(timer.current);
      frame.current = 0;
      timer.current = 0;
      paintRef.current();
    };
    frame.current = requestAnimationFrame(run);
    timer.current = window.setTimeout(run, 0);
  }, []);

  const paint = useCallback(() => {
    const c = cv.current;
    if (!c) return;
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (!w || !h) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pxW = Math.round(w * dpr);
    const pxH = Math.round(h * dpr);
    if (c.width !== pxW || c.height !== pxH) {
      c.width = pxW;
      c.height = pxH;
      cacheKey.current = '';                 // a resize invalidates the bitmap
    }
    const ctx = c.getContext('2d');
    if (!ctx) return;

    /* Committed strokes: rendered once per change into an offscreen canvas. */
    const key = strokeCacheKey(state.strokes, pxW, pxH);
    if (cacheKey.current !== key || !cache.current) {
      const off = cache.current ?? document.createElement('canvas');
      off.width = pxW;
      off.height = pxH;
      const octx = off.getContext('2d');
      if (octx) {
        octx.setTransform(dpr, 0, 0, dpr, 0, 0);
        octx.fillStyle = CANVAS_BG;
        octx.fillRect(0, 0, w, h);
        const sx = w / VB;
        const sy = h / VB;
        for (const s of state.strokes) {
          paintStroke(octx, s, sx, sy, PALETTE[s.c] ?? PALETTE[0], (i) => BRUSHES[i] ?? BRUSHES[1]);
        }
      }
      cache.current = off;
      cacheKey.current = key;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pxW, pxH);
    if (cache.current) ctx.drawImage(cache.current, 0, 0);

    /* The strokes we have sent but not seen echoed, then the stroke in progress.
       Drawn over the bitmap instead of into it, so they cost nothing to change. */
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const sx = w / VB;
    const sy = h / VB;
    const widthOf = (i: number) => BRUSHES[i] ?? BRUSHES[1];
    for (const s of pending.current) {
      paintStroke(ctx, s, sx, sy, PALETTE[s.c] ?? PALETTE[0], widthOf);
    }
    if (live.current.length >= 2) {
      paintStroke(ctx, { p: live.current, c: activeColor, w: brush }, sx, sy, PALETTE[activeColor], widthOf);
    }
  }, [state.strokes, activeColor, brush]);
  const paintRef = useRef(paint);
  paintRef.current = paint;

  /* The echo arrives: drop as many pending strokes as the state grew by, then
     paint at once. A new authoritative stroke is the other player's line, and
     making them wait a frame to see it — or worse, a frame that never comes on a
     hidden tab — reads as a laggy, half-broken board. */
  useEffect(() => {
    pending.current = reconcilePending(pending.current, seenStrokes.current, state.strokes.length);
    seenStrokes.current = state.strokes.length;
    paintRef.current();
  }, [state.strokes.length]);

  useEffect(() => { schedule(); }, [paint, schedule]);

  useEffect(() => {
    const c = cv.current;
    if (!c || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      cacheKey.current = '';
      schedule();
    });
    ro.observe(c);
    return () => ro.disconnect();
  }, [schedule]);

  useEffect(() => () => {
    if (frame.current) cancelAnimationFrame(frame.current);
    if (timer.current) clearTimeout(timer.current);
  }, []);

  /* Reset the local layers whenever the round changes. */
  useEffect(() => {
    setTool('pen');
    pending.current = [];
    live.current = [];
    drawing.current = false;
    pointerId.current = null;
    seenStrokes.current = 0;
    cacheKey.current = '';
    setFeedback(null);
    setGuess('');
    schedule();
  }, [state.round, schedule]);

  /* ------------------------------ shortcuts ------------------------------- */

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
        undo();
      } else if (/^[1-8]$/.test(e.key)) {
        e.preventDefault();
        setTool('pen');
        setColour(Number(e.key) - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canDraw, state.strokes.length, onMove]);

  /* ------------------------------- the clock ------------------------------ */

  useEffect(() => {
    const tick = () => setLeft(Math.max(0, state.endsAt - Date.now()));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [state.endsAt]);

  /* Both players get the whole picture.
   *
   * On a phone the room puts the board under a sticky bar, and on a 390×844
   * screen the top of the canvas ended up *behind* it — so a guesser was looking
   * at a drawing with its top row hidden, and the drawer was drawing into a
   * region they could not see. Neither is a cosmetic problem. `scroll-mt-24` on
   * the canvas keeps the sticky bar's height out of the way of `scrollIntoView`.
   *
   * This runs when the round starts and whenever the roles swap, once. It does
   * not fight the player's own scrolling: it only acts if the canvas is actually
   * clipped. */
  useEffect(() => {
    const c = cv.current;
    if (!c) return;
    const r = c.getBoundingClientRect();
    if (r.top < 0 || r.bottom > window.innerHeight) {
      c.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }, [state.round, amDrawer]);

  /* Focus the guess box the moment it is your turn to guess, and after a reveal
     rolls into a new round: the box is the only thing the guesser does. */
  useEffect(() => {
    if (canGuess) inputRef.current?.focus({ preventScroll: true });
  }, [canGuess, state.round]);

  /* ------------------------------ drawing input --------------------------- */

  const commit = useCallback((points: number[]) => {
    const p = thin(points);
    if (p.length >= 2) {
      const stroke: Stroke = { p: p.slice(0, MAX_POINTS * 2), c: activeColor, w: brush };
      pending.current = [...pending.current, stroke].slice(-12);
      onMove({ t: 'stroke', ...stroke });
    }
    bump((n) => n + 1);
    schedule();
  }, [onMove, activeColor, brush, schedule]);

  const undo = useCallback(() => {
    /* Our own unsent-echo strokes are on this screen but not in the server's
       state; an undo has to remove the last thing *we* see. Dropping the local
       queue and asking the server for the previous stroke is the closest the
       protocol allows, and it is what a player expects to see. */
    pending.current = [];
    onMove({ t: 'undo' });
    bump((n) => n + 1);
    schedule();
  }, [onMove, schedule]);

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!canDraw || !isDrawPointer(e)) return;
    e.preventDefault();
    if (drawing.current) return;          // a second finger does not start a stroke
    drawing.current = true;
    pointerId.current = e.pointerId;
    flushAt.current = performance.now() + 450;
    live.current = pointFrom(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    schedule();
  };

  const onMovePointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || e.pointerId !== pointerId.current) return;
    e.preventDefault();

    /* Fast digitizers deliver several samples between frames; using them all is
       what makes a fast circle round instead of a polygon. */
    const events = typeof e.nativeEvent.getCoalescedEvents === 'function'
      ? e.nativeEvent.getCoalescedEvents()
      : [];
    const samples = events.length ? events : [e.nativeEvent];
    const rect = e.currentTarget.getBoundingClientRect();
    const p = live.current;

    for (const sample of samples) {
      const [x, y] = pointFrom(sample.clientX, sample.clientY, rect);
      if (!shouldKeep(x, y, p)) continue;
      p.push(x, y);
    }

    /* A long stroke goes to the server before it ends, so the other screen is
       never more than half a second behind. The tail is kept so the next segment
       joins onto this one; the flushed part stays on screen via `pending`. */
    if (p.length / 2 >= MAX_POINTS || performance.now() > flushAt.current) {
      const tail = p.slice(-2);
      commit(p);
      live.current = tail;
      flushAt.current = performance.now() + 450;
    }
    schedule();
  };

  const endStroke = (commitIt: boolean) => {
    if (!drawing.current) return;
    drawing.current = false;
    pointerId.current = null;
    if (commitIt) commit(live.current);
    live.current = [];
    schedule();
  };

  const onUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerId !== pointerId.current) return;
    endStroke(true);
  };
  const onCancel = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerId !== pointerId.current) return;
    /* The browser took the pointer (a system gesture, a phone call). Throwing the
       stroke away is better than committing a line the player never finished. */
    endStroke(false);
  };

  /* -------------------------------- guessing ------------------------------ */

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = guess.trim();
    if (!t || !canGuess) return;
    onMove({ t: 'guess', text: t });
    setGuess('');
    setFeedback('Sent — waiting for the drawer…');
    window.setTimeout(() => setFeedback((f) => (f?.startsWith('Sent') ? null : f)), 2200);
  };

  const onGuessChange = (value: string) => {
    setGuess(value);
    if (feedback && !feedback.startsWith('Sent')) setFeedback(null);
    if (wrong) setWrong(0);
  };

  /* The server appends a guess; a wrong one means "try again" next to the box
     rather than silence. Read it from the state, so the feedback survives a
     re-render and appears on the same tick as the guess. */
  const lastGuess = state.guesses[state.guesses.length - 1];
  useEffect(() => {
    if (!canGuess || !lastGuess || lastGuess.by === state.drawer) return;
    if (lastGuess.hit) return;
    setWrong((n) => n + 1);
    setFeedback('Not it — keep going');
    inputRef.current?.focus({ preventScroll: true });
  }, [state.guesses.length, canGuess, lastGuess, state.drawer]);

  const secs = Math.ceil(left / 1000);
  const urgent = state.phase === 'draw' && secs <= 15;
  const pct = state.phase === 'draw' ? Math.max(0, Math.min(1, left / DRAW_MS)) : 0;
  const strokeCount = state.strokes.length + pending.current.length;

  const paletteSwatches = useMemo(() => PALETTE.slice(0, 8).map((hex, i) => (
    <button
      key={hex}
      role="radio"
      aria-checked={tool === 'pen' && colour === i}
      aria-label={`${COLOUR_NAMES[i]} pen`}
      onClick={() => { setTool('pen'); setColour(i); }}
      className={`relative w-9 h-9 sm:w-8 sm:h-8 shrink-0 rounded-full border-2 transition-transform no-tap ${
        tool === 'pen' && colour === i ? 'border-cream-100 scale-110 shadow-sm ring-2 ring-volt-400' : 'border-ink-500 hover:scale-105'
      }`}
      style={{ background: hex }}
    />
  )), [colour, tool]);

  return (
    /* the split waits for `xl`: below that the room already has a 324 px chat rail
       beside this board, and a second rail would leave the canvas phone-sized */
    <div className="w-full max-w-[1020px] mx-auto grid xl:grid-cols-[1fr_300px] gap-3 items-start">
      {/* ---------------- canvas ---------------- */}
      <div className="space-y-2 min-w-0">
        <Panel className="p-2.5 sm:p-3">
          <div className="flex items-start justify-between gap-3 mb-2">
            <div className="min-w-0">
              <p className="eyebrow truncate">
                Round {state.round + 1} of {state.rounds} · {amDrawer ? 'you draw' : `${names[state.drawer]} draws`}
              </p>
              {/* One line, big, never clipped: this is the word or the mask, and
                  both players are looking at it all round. */}
              <p
                className={`font-display text-[22px] sm:text-[24px] leading-tight font-extrabold tracking-wide truncate ${
                  state.word && amDrawer ? 'text-volt-700' : 'text-cream-100'
                }`}
                title={state.word ?? state.hint}
              >
                {state.word ? state.word.toUpperCase() : <span className="tracking-[0.3em]">{state.hint}</span>}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="eyebrow">{state.phase === 'draw' ? 'Time' : 'Next round'}</p>
              <p className={`font-display text-[24px] font-extrabold tabular-nums leading-none ${urgent ? 'text-blush-600' : 'text-cream-100'}`}>
                {secs}<span className="text-[13px] align-top">s</span>
              </p>
            </div>
          </div>

          <div
            className="h-1.5 bg-ink-600 overflow-hidden mb-2 rounded-full"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={DRAW_MS / 1000}
            aria-valuenow={secs}
            aria-label="Time left in the round"
          >
            <div className={`h-full transition-[width] duration-200 ${urgent ? 'bg-[#e05a74]' : 'bg-volt-400'}`}
              style={{ width: `${pct * 100}%` }} />
          </div>

          <BoardStage ratio={4 / 3} max={760} min={220} reserve={210} chrome={64}>
            <canvas
              ref={cv}
              onPointerDown={onDown}
              onPointerMove={onMovePointer}
              onPointerUp={onUp}
              onPointerCancel={onCancel}
              onContextMenu={(e) => e.preventDefault()}
              className={`block w-full aspect-[4/3] scroll-mt-24 border-2 border-ink-500 bg-[#fffdf7] touch-none select-none [-webkit-touch-callout:none] ${
                canDraw ? (tool === 'eraser' ? 'cursor-cell' : 'cursor-crosshair') : 'cursor-default'
              }`}
              role="img"
              aria-label={amDrawer
                ? `Your drawing canvas for the word ${state.word ?? ''}. ${strokeCount} strokes so far.`
                : `${names[state.drawer]}'s drawing, ${strokeCount} strokes so far. Type your guess below.`}
            />
          </BoardStage>

          {/* While the drawer is working, say so on the other screen — an empty
              canvas with no explanation reads as a broken page. */}
          {canGuess && strokeCount === 0 && (
            <p className="mt-2 text-[12px] text-cream-500 text-center" role="status">
              {names[state.drawer]} is thinking about what to draw…
            </p>
          )}
        </Panel>

        {/* ---------------- drawer tools ---------------- */}
        {canDraw && (
          <Panel className="p-2.5 sm:p-3 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex gap-1 bg-blush-100 p-1 border-2 border-ink-500 rounded-full shrink-0">
                <button type="button" onClick={() => setTool('pen')} aria-pressed={tool === 'pen'}
                  className={`flex items-center gap-1.5 px-3 min-h-[36px] rounded-full text-[12px] font-bold transition-all no-tap ${
                    tool === 'pen' ? 'bg-volt-400 text-[#5a3a12] shadow-[0_2px_0_0_#e0a21f]' : 'text-cream-500 hover:text-cream-100'
                  }`} title="Pen (B)">
                  <Icon name="pen" size={13} /><span>Pen</span>
                </button>
                <button type="button"
                  onClick={() => { if (tool === 'eraser') setTool('pen'); else { setTool('eraser'); if (brush === 0) setBrush(2); } }}
                  aria-pressed={tool === 'eraser'}
                  className={`flex items-center gap-1.5 px-3 min-h-[36px] rounded-full text-[12px] font-bold transition-all no-tap ${
                    tool === 'eraser' ? 'bg-ember-600 text-white shadow-[0_2px_0_0_#9a2b43]' : 'text-cream-500 hover:text-cream-100'
                  }`} title="Eraser (E)">
                  <Icon name="eraser" size={13} /><span>Eraser</span>
                </button>
              </div>

              {/* sizes */}
              <div className="flex gap-1.5" role="radiogroup" aria-label={tool === 'eraser' ? 'Eraser size' : 'Brush size'}>
                {BRUSHES.map((px, i) => (
                  <button key={px} role="radio" aria-checked={brush === i}
                    aria-label={`${tool === 'eraser' ? 'Eraser' : 'Brush'} size ${i + 1} of ${BRUSHES.length}`}
                    onClick={() => setBrush(i)}
                    className={`w-9 h-9 grid place-items-center border-2 notch-sm no-tap ${brush === i ? 'border-volt-400 bg-volt-50' : 'border-ink-500 hover:border-ink-400'}`}>
                    <span className={`rounded-full block ${tool === 'eraser' ? 'bg-ember-600' : 'bg-cream-100'}`}
                      style={{ width: Math.min(px + 2, 22), height: Math.min(px + 2, 22) }} />
                  </button>
                ))}
              </div>

              <div className="flex gap-1.5 ml-auto">
                <Button size="sm" variant="ghost" onClick={undo} disabled={!strokeCount}
                  icon={<Icon name="undo" size={13} />}>Undo</Button>
                <Button size="sm" variant="ghost"
                  onClick={() => { pending.current = []; onMove({ t: 'clear' }); bump((n) => n + 1); schedule(); }}
                  disabled={!strokeCount} icon={<Icon name="x" size={13} />}>Clear</Button>
                <Button size="sm" variant="ghost" onClick={() => onMove({ t: 'skip' })}
                  icon={<Icon name="flag" size={13} />}>Give up</Button>
              </div>
            </div>

            {/* Colours scroll sideways on a phone instead of wrapping into three
                rows and pushing the canvas off the screen. */}
            <div className="-mx-1 px-1 overflow-x-auto" role="radiogroup" aria-label="Pen colour">
              <div className={`flex gap-1.5 min-w-max transition-opacity ${tool === 'eraser' ? 'opacity-45 hover:opacity-100' : ''}`}>
                {paletteSwatches}
              </div>
            </div>
          </Panel>
        )}

        {/* ---------------- guesser input ---------------- */}
        {canGuess && (
          <Panel className="p-2.5 sm:p-3">
            <form onSubmit={submit} className="flex gap-2">
              <label className="sr-only" htmlFor="sketch-guess">Your guess</label>
              <input id="sketch-guess" ref={inputRef} value={guess} onChange={(e) => onGuessChange(e.target.value)}
                autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} enterKeyHint="send"
                maxLength={64} placeholder="What is it?"
                aria-describedby="sketch-guess-feedback"
                className={`flex-1 min-w-0 px-3 py-2.5 bg-ink-800 border-2 text-cream-100 text-[15px] font-semibold placeholder:text-cream-500 outline-none notch-sm ${
                  wrong ? 'border-blush-600 a-shake' : 'border-ink-500 focus:border-volt-400'
                }`} />
              <Button type="submit" disabled={!guess.trim()} icon={<Icon name="check" size={14} />}>Guess</Button>
            </form>
            <p id="sketch-guess-feedback" className={`text-[12px] mt-1.5 min-h-[16px] ${wrong ? 'text-blush-600 font-bold' : 'text-cream-500'}`}
              role="status" aria-live="polite">
              {feedback ?? 'Wrong guesses cost nothing — shout it out.'}
            </p>
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
                  {g.by === youSlot && <span className="text-cream-500"> · you</span>}
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
