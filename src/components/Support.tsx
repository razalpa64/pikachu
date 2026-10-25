import { Icon } from './ui';
import { useStore } from '../lib/store';

/**
 * The tip jar.
 *
 * This site is a gift — no ads, no accounts, no upsell anywhere else in the app —
 * so the one place a support link is allowed to live is at the *end* of the home
 * page and in the footer, never floating over a board. It is a plain anchor, which
 * matters for three practical reasons: middle-click and "copy link" work, it can be
 * opened in a new tab without hijacking the tab you were playing in, and a crawler
 * or a screen reader sees a real link rather than a div pretending to be one.
 */
export const SUPPORT_URL = 'https://buymeacoffee.com/razalpa';

export function SupportLink({
  size = 'sm', className = '', label = 'Buy me a coffee',
}: { size?: 'sm' | 'md'; className?: string; label?: string }) {
  const { sfx } = useStore();
  return (
    <a
      href={SUPPORT_URL}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => sfx('select')}
      className={`btn btn-primary ${size === 'sm' ? 'btn-sm' : ''} no-tap inline-flex items-center gap-2 no-underline ${className}`}
    >
      <Icon name="coffee" size={15} />
      <span>{label}</span>
      <Icon name="external" size={12} className="opacity-70" />
      <span className="sr-only">(opens buymeacoffee.com in a new tab)</span>
    </a>
  );
}

/**
 * The card that sits at the bottom of the home page. Deliberately quiet: one
 * sentence, one button, and an honest note that nothing about the arcade depends
 * on it.
 */
export function SupportCard() {
  return (
    <section
      aria-labelledby="support-h"
      className="panel panel-notch overflow-hidden"
    >
      <div className="p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
        <div className="relative shrink-0 w-[54px] h-[54px] grid place-items-center rounded-2xl bg-volt-400 border-2 border-volt-600 shadow-[0_2px_0_0_#e0a21f]">
          <Icon name="coffee" size={26} className="text-[#5a3a12]" />
          <span aria-hidden className="absolute -top-1.5 -right-1.5 w-3 h-3 rounded-full bg-blush-300 border-2 border-ink-700" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="eyebrow text-volt-700 mb-0.5">The tip jar</p>
          <h2 id="support-h" className="font-display font-extrabold text-[17px] text-cream-100 leading-tight">
            Made by one person, for two players
          </h2>
          <p className="text-[12.5px] text-cream-500 leading-relaxed mt-1 max-w-[62ch]">
            No ads, no accounts, no paid tiers — every game here is free and stays free.
            If the arcade earned an evening, a coffee keeps the servers awake.
          </p>
        </div>
        <div className="shrink-0 sm:pl-2">
          <SupportLink size="md" />
        </div>
      </div>
    </section>
  );
}
