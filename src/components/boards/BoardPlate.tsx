import type { ReactNode } from 'react';

/**
 * BoardPlate — the cream "table" every board sits on.
 *
 * All of the newer boards (and the four added with them) share this frame so a
 * game can never look like it came from a different app: one warm gradient, one
 * cocoa outline, one soft two-layer shadow, one caption row. The plate is
 * decoration only — the interactive elements are the children, each of which
 * carries its own accessible name.
 */
export function BoardPlate({
  children, label, right, className = '', width,
}: {
  children: ReactNode;
  label?: string;
  right?: ReactNode;
  className?: string;
  width?: number | string;
}) {
  return (
    <div className={`relative inline-block select-none ${className}`} style={{ width }}>
      <div
        aria-hidden
        className="absolute -inset-3 sm:-inset-4 rounded-[26px]"
        style={{
          background: 'linear-gradient(168deg,#fff8ea,#ffe9d3)',
          border: '3px solid #e9c7a6',
          boxShadow: '0 26px 52px -32px rgba(120,80,55,.62), inset 0 2px 0 rgba(255,255,255,.9)',
        }}
      />
      <div className="relative">
        {(label || right) && (
          <div className="flex items-center justify-between gap-3 px-1 pb-2">
            {label && <span className="text-[9.5px] font-extrabold uppercase tracking-[.22em] text-cream-300">{label}</span>}
            {right}
          </div>
        )}
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
      <span className="w-2 h-2 rounded-full" style={{ background: accent }} aria-hidden />
      <span className="opacity-70">{label}</span>
      <span className="tabnum text-cream-100">{value}</span>
    </span>
  );
}
