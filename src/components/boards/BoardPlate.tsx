import type { ReactNode } from 'react';

/**
 * BoardPlate — the cream "table" every board sits on.
 *
 * All of the newer boards (and the four added with them) share this frame so a
 * game can never look like it came from a different app: one warm gradient, one
 * cocoa outline, one soft two-layer shadow, one caption row. The plate is
 * decoration only — the interactive elements are the children, each of which
 * carries its own accessible name.
 *
 * The frame is **padding, not an overlay**. It used to be an `absolute -inset-3`
 * slab behind the children, which grew the plate 24 px wider and 24 px taller
 * than the board it framed. On a phone the board was already sized off `vw`, so
 * the frame is what actually reached past the edge of the screen, and on a
 * desktop it is what made the caption drift left of the board. As real padding
 * the plate can never be bigger than the column, and everything inside it stays
 * aligned.
 */
export function BoardPlate({
  children, label, right, className = '',
}: {
  children: ReactNode;
  label?: string;
  right?: ReactNode;
  className?: string;
  width?: number | string;
}) {
  return (
    <div className={`w-full select-none ${className}`}>
      {(label || right) && (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-0.5 pb-2">
          {label && <span className="text-[9.5px] font-extrabold uppercase tracking-[.22em] text-cream-300">{label}</span>}
          {right}
        </div>
      )}
      <div
        className="relative rounded-[clamp(15px,2.4%,26px)] p-[clamp(5px,1.6%,14px)]"
        style={{
          background: 'linear-gradient(168deg,#fff8ea,#ffe9d3)',
          border: '3px solid #e9c7a6',
          boxShadow: '0 26px 52px -32px rgba(120,80,55,.62), inset 0 2px 0 rgba(255,255,255,.9)',
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** A small pastel pill used for scores and turn state inside a board. */
export function ScoreChip({ label, value, accent, active }: { label: string; value: ReactNode; accent: string; active?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full border-2 text-[10.5px] font-extrabold uppercase tracking-wider transition-colors
        ${active ? 'bg-white border-ink-400 text-cream-100' : 'bg-white/60 border-ink-500 text-cream-500'}`}
    >
      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: accent }} aria-hidden />
      <span className="opacity-70 truncate max-w-[9ch]">{label}</span>
      <span className="tabnum text-cream-100">{value}</span>
    </span>
  );
}
