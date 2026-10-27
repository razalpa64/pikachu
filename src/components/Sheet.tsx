/**
 * A bottom sheet: the mobile half of every overlay in the app.
 *
 * The site used to present everything as a centred desktop dialog (`grid
 * place-items-center`). On a phone that is the wrong object: it floats in the
 * middle of the screen, its buttons sit far from a thumb, and it looks like a
 * web page wearing a costume. A sheet rises from the edge the hand is already
 * near, has a grab handle and a title you can read while it comes up, and its
 * actions sit along the bottom where the thumb rests.
 *
 * It is a real modal, not a styled div:
 *   • `role="dialog" aria-modal="true"`, labelled by its title;
 *   • focus moves in on open and returns to whatever opened it on close;
 *   • Tab is trapped inside, Escape and the backdrop both dismiss;
 *   • the page behind it cannot scroll, so the sheet is never dragged off
 *     screen by the momentum of the page under it.
 *
 * Everything here is one element tree with CSS breakpoints — no `matchMedia`
 * branch — so the server-rendered markup and the hydrated markup always agree.
 *
 * It renders through a portal on purpose. A sheet opened from inside a screen
 * inherits that screen's stacking context, and the app's fixed tab bar is
 * outside it — which is how the "Show 26 games" button ended up *behind* the tab
 * bar. Portal or not, a modal has to be the top layer.
 */
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './ui';

export function Sheet({
  open,
  onClose,
  title,
  label,
  children,
  className = '',
}: {
  open: boolean;
  onClose: () => void;
  /** visible heading; omit for a sheet that is all content (a menu grid) */
  title?: string;
  /** accessible name when there is no visible heading */
  label?: string;
  children: ReactNode;
  className?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const node = panel.current;
    const focusables = () => Array.from(
      node?.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? [],
    ).filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);

    /* Focus the panel itself rather than its first button: landing on "Close"
       makes a screen reader announce a close button before the sheet's title. */
    node?.focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key !== 'Tab') return;
      const f = focusables();
      if (!f.length) { e.preventDefault(); return; }
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === node)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);

    /* Lock the page, not just the sheet. `overflow: hidden` on the body is the
       one thing that stops iOS from scrolling the document under the sheet. */
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      previous?.focus?.({ preventScroll: true });
    };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-end lg:items-center justify-center">
      <div
        className="absolute inset-0 sheet-backdrop bg-[#5c4035]/45 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : label}
        tabIndex={-1}
        className={`sheet-in relative w-full outline-none bg-[#fffaf1] border-ink-500
          rounded-t-[26px] border-t-2 border-x-0 border-b-0
          lg:rounded-2xl lg:border-2 lg:max-w-[460px] lg:mb-0 lg:shadow-[0_24px_60px_-24px_rgba(92,64,53,.55)]
          shadow-[0_-18px_50px_-28px_rgba(92,64,53,.65)]
          max-h-[88dvh] flex flex-col ${className}`}
        style={{ paddingBottom: 'max(10px, env(safe-area-inset-bottom))' }}
      >
        {/* The grab handle. Decorative, but it is what tells a thumb "this
            comes from the bottom and goes back there". */}
        <div className="lg:hidden pt-2.5 pb-1 grid place-items-center shrink-0" aria-hidden>
          <span className="w-9 h-1 rounded-full bg-ink-400/60" />
        </div>

        {(title || true) && (
          <div className="flex items-start justify-between gap-3 px-4 pb-2 pt-1 lg:pt-4 shrink-0">
            {title
              ? <h2 id={titleId} className="display text-[19px] leading-tight text-cream-100 pt-1">{title}</h2>
              : <span />}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-mr-1 -mt-1 w-10 h-10 grid place-items-center rounded-full text-cream-500 hover:text-cream-100 hover:bg-blush-100 no-tap shrink-0"
            >
              <Icon name="x" size={18} />
            </button>
          </div>
        )}

        <div className="overflow-y-auto overscroll-contain px-4 pb-2">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * The action row at the bottom of a sheet.
 *
 * On a phone the primary action is full width and *above* the cancel — the
 * shape a thumb reaches first — and on a wide screen the two sit side by side
 * on the right, like every other dialog in the arcade.
 */
export function SheetActions({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col-reverse gap-2 pt-3 pb-1 lg:flex-row lg:justify-end lg:gap-2.5">
      {children}
    </div>
  );
}
