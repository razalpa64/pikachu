import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

/**
 * BoardStage — the one place a board is allowed to decide how big it is.
 *
 * Before this, every board sized itself from the **viewport width**:
 * `min(10.2vw, 62px)` for chess, `min(5.6vw, 29px)` for River Stones,
 * `min(8.2vw, 38px)` for Paper Fleet, and in Pika Pairs a hand-tuned
 * `calc((75vh - 225px) / rows)`. Three things went wrong with that, and all three
 * are visible to a player:
 *
 *  1. **`vw` is not the space the board is in.** In a private room the board sits
 *     in a column that is ~320 px narrower than the window (the chat is docked
 *     beside it), and the solo shell is capped at 1120 px. So the board was sized
 *     against a width it never had.
 *  2. **Height was ignored.** Ten of the twelve boards never looked at the
 *     vertical space at all. On a 13-inch laptop, or a phone in landscape, a
 *     chessboard pushed the controls, the rulebook and the result card below the
 *     fold — you had to scroll mid-game to see the clock.
 *  3. **Hard px caps made the board a postage stamp.** A 318 px board floating in
 *     a 1120 px column with a full-width HUD above it is the "cramped" feeling:
 *     not too small to play, but too small for the page it is on.
 *
 * This component measures the two dimensions that actually matter — the width its
 * parent will give it, and the height left in the viewport under its own top edge
 * — and takes the smaller. The result is a board that is as large as the page can
 * honestly afford, at the ratio the game needs, never taller than the screen.
 *
 * Ratio, not pixels: every board inside a stage lays itself out with
 * `grid-template-columns: repeat(n, minmax(0, 1fr))` plus an `aspect-ratio`, so
 * the cells are derived from the stage instead of being computed per game. No
 * `vw` arithmetic survives anywhere in `components/boards`.
 *
 * A floor (`min`) matters in landscape: below roughly 230 px a board is not
 * playable, so the stage stops shrinking and lets the page scroll instead of
 * handing somebody a 120 px chessboard.
 */
export interface BoardStageProps {
  /** width ÷ height of the board itself. 1 for a square grid. */
  ratio?: number;
  /** hard ceiling in px — a board larger than this reads as a poster, not a game */
  max?: number;
  /** floor in px; below this the page scrolls rather than shrinking further */
  min?: number;
  /** px reserved under the board (rulebook toggle, bottom bar, breathing room) */
  reserve?: number;
  /** px of the stage taken by its own frame, caption or drop row, not the board */
  chrome?: number;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
  label?: string;
}

/**
 * The whole sizing rule, as arithmetic.
 *
 * `column`   the width the layout gives the board (not the window: the column)
 * `top`      where the stage starts, in viewport coordinates
 * `reserve`  px kept free under the board for the chrome that lives there
 * `chrome`   px of the stage itself that is not board (frame, caption, drop row)
 *
 * The board is the narrower of the column and the height it can afford, floored
 * at `min` (so landscape phones scroll instead of shrinking a board to nothing)
 * and capped at `max` (so a 2560 px monitor does not get a chessboard the size of
 * a poker table). Exported because this is the rule the layout tests pin down.
 */
export function fitBoardWidth({
  column, viewport, top, reserve, chrome, ratio, min, max,
}: {
  column: number; viewport: number; top: number;
  reserve: number; chrome: number; ratio: number; min: number; max: number;
}): number {
  const visibleTop = Math.max(0, Math.min(top, viewport));
  const under = Math.max(0, viewport - visibleTop - reserve);
  const fitted = Math.min(column, Math.max(0, under - chrome) * ratio);
  return Math.max(min, Math.min(max, Math.floor(fitted)));
}

/** Measure the space the stage is actually given, in both directions. */
export function useBoardFit(ratio: number, max: number, min: number, reserve: number, chrome = 0) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const measure = () => {
      const host = el.parentElement;
      const column = host ? host.clientWidth : window.innerWidth;
      if (!column) { setWidth(null); return; }               // jsdom / pre-layout: fall back to CSS
      const next = fitBoardWidth({
        column,
        viewport: window.innerHeight || 800,
        top: el.getBoundingClientRect().top,
        reserve, chrome, ratio, min, max,
      });
      setWidth((prev) => (prev !== null && Math.abs(prev - next) < 2 ? prev : next));
    };

    measure();
    const RO = (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    const ro = RO ? new RO(measure) : null;
    if (ro && el.parentElement) ro.observe(el.parentElement);
    if (ro) ro.observe(el);
    window.addEventListener('resize', measure);
    // Web fonts land after first paint and change the chrome height above the
    // board; one more measurement after that is enough to settle it.
    const settle = window.setTimeout(measure, 320);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
      window.clearTimeout(settle);
    };
  }, [ratio, max, min, reserve, chrome]);

  return { ref, width };
}

export function BoardStage({
  ratio = 1, max = 620, min = 232, reserve = 148, chrome = 0, className = '', style, children, label,
}: BoardStageProps) {
  const { ref, width } = useBoardFit(ratio, max, min, reserve, chrome);

  return (
    <div
      ref={ref}
      data-board-stage=""
      data-ratio={ratio}
      className={`board-stage ${className}`}
      style={{
        // `--stage-w` is what the board frame and grid read; when the measurement
        // has not run yet (first paint, or a test without layout) the CSS fallback
        // in styles.css keeps it width:100% inside its max-width.
        ['--stage-max' as string]: `${max}px`,
        ...(width ? { ['--stage-w' as string]: `${width}px` } : {}),
        ...style,
      }}
      data-board-label={label}
    >
      {children}
    </div>
  );
}

/**
 * The fluid grid every board's cells live in.
 *
 * `cols × rows` of equal fractions, at the game's own ratio: the cells come out
 * exactly square (or exactly the shape the game needs) at any stage width, with
 * no per-game arithmetic and no rounding drift at the edges.
 */
export function BoardGrid({
  cols, rows, gap = 'clamp(2px, 1.1%, 8px)', cellRatio = 1, className = '', children, style, ...rest
}: {
  cols: number; rows?: number; gap?: string;
  /** cell width ÷ height. 1 for square boards; 3/4 for a card table. */
  cellRatio?: number;
  className?: string; children: ReactNode;
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'children'>) {
  const r = rows ?? cols;
  return (
    <div
      className={`grid w-full ${className}`}
      style={{
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${r}, minmax(0, 1fr))`,
        aspectRatio: `${cols * cellRatio} / ${r}`,
        gap,
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}
