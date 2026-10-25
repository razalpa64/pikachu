import { useId, useState } from 'react';
import { howToFor } from '../games/howToPlay';
import { Icon } from './ui';
import { useStore } from '../lib/store';

/**
 * HowToPlay — the rules card.
 *
 * A disclosure rather than a dialog: it opens in place, needs no focus trap, and
 * cannot stack on top of a match the way a modal would. Nothing here is essential
 * to playing, so it starts closed and is remembered only for the session — the same
 * choice as every other settings strip in the app.
 */
export function HowToPlay({
  gameId, gameTitle, defaultOpen = false, compact = false, className = '',
}: {
  gameId: string;
  gameTitle?: string;
  defaultOpen?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const { sfx } = useStore();
  const id = useId();
  const how = howToFor(gameId);
  if (!how) return null;

  return (
    <div className={`${compact ? '' : 'panel notch-sm'} ${className}`}>
      <button
        type="button"
        onClick={() => { sfx('toggle'); setOpen((v) => !v); }}
        aria-expanded={open}
        aria-controls={id}
        className={`w-full flex items-center justify-between gap-3 text-left no-tap min-h-[40px] ${compact ? 'px-2.5 py-1.5' : 'px-3.5 py-2.5'}`}
      >
        <span className="flex items-center gap-2 min-w-0">
          <span className="grid place-items-center w-6 h-6 rounded-full bg-volt-200 border-2 border-volt-500 text-volt-700 shrink-0" aria-hidden>
            <Icon name="book" size={13} />
          </span>
          <span className="eyebrow truncate">How to play{gameTitle ? ` ${gameTitle}` : ''}</span>
        </span>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={15} className="text-cream-500 shrink-0" />
      </button>

      {open && (
      <div id={id} className="px-3.5 pb-3.5">
        <p className="text-[12.5px] font-extrabold text-cream-100 leading-snug">{how.goal}</p>
        <ol className="mt-2 flex flex-col gap-1.5">
          {how.steps.map((step, i) => (
            <li key={i} className="flex gap-2 text-[12px] text-cream-300 leading-relaxed">
              <span className="shrink-0 mt-[3px] w-4 h-4 rounded-full bg-blush-100 border-[1.5px] border-ink-500 text-[9px] font-extrabold text-cream-300 grid place-items-center tabnum">
                {i + 1}
              </span>
              <span className="min-w-0">{step}</span>
            </li>
          ))}
        </ol>
        {how.tip && (
          <p className="mt-2.5 text-[11.5px] text-cream-500 leading-relaxed border-t border-ink-600 pt-2">
            <strong className="text-volt-700">Tip.</strong> {how.tip}
          </p>
        )}
      </div>
      )}
    </div>
  );
}

export default HowToPlay;
