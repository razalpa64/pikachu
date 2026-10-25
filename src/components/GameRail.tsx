import { useRef, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { GameMeta } from '../games/types';
import { GENRE_LABEL } from '../games/registry';
import { GameArtwork } from './GameArtwork';
import { Icon } from './ui';
import { useStore } from '../lib/store';
import { prefetchGame } from '../lib/prefetch';

/**
 * A shelf, not a grid.
 *
 * The library grid is the right shape when you are choosing; the front page is
 * the wrong place to ask someone to read eighteen cards. A rail shows a row of
 * covers at a glance, keeps the page's vertical rhythm short, and — because it
 * scrolls horizontally with snapping — stays a single row on a phone instead of
 * becoming six stacked cards.
 *
 * The arrow buttons exist for pointer users who do not discover shift-scroll;
 * they disappear at the ends rather than sitting there dead, and the scroll is
 * plain `scrollBy` so it inherits the platform's own smooth-scroll and respects
 * reduced motion via CSS.
 */
export function GameRail({
  eyebrow, title, action, games, note, id,
}: {
  eyebrow?: string;
  title: string;
  action?: ReactNode;
  games: GameMeta[];
  note?: string;
  id?: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);

  const nudge = (dir: -1 | 1) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(240, el.clientWidth * 0.8), behavior: 'smooth' });
  };

  if (!games.length) return null;

  return (
    <section aria-labelledby={id} className="relative">
      <div className="flex items-end justify-between gap-4 mb-3">
        <div className="min-w-0">
          {eyebrow && <p className="eyebrow mb-1">{eyebrow}</p>}
          <h2 id={id} className="display text-[21px] sm:text-[25px] text-cream-100">{title}</h2>
          {note && <p className="text-[12px] text-cream-500 mt-0.5">{note}</p>}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {action}
          <div className="hidden sm:flex gap-1.5">
            <button onClick={() => nudge(-1)} aria-label={`Scroll ${title} left`}
              className="w-9 h-9 grid place-items-center rounded-full border-2 border-ink-500 bg-white/80 text-cream-300 hover:border-ink-400 hover:text-cream-100 no-tap">
              <Icon name="chevron-left" size={15} />
            </button>
            <button onClick={() => nudge(1)} aria-label={`Scroll ${title} right`}
              className="w-9 h-9 grid place-items-center rounded-full border-2 border-ink-500 bg-white/80 text-cream-300 hover:border-ink-400 hover:text-cream-100 no-tap">
              <Icon name="chevron-right" size={15} />
            </button>
          </div>
        </div>
      </div>

      <div
        ref={scroller}
        className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-2 -mx-[var(--shell-pad)] px-[var(--shell-pad)] lg:mx-0 lg:px-0 no-scrollbar"
      >
        {games.map((g) => <ShelfTile key={g.id} game={g} />)}
      </div>
    </section>
  );
}

/** One cover on the shelf: picture, name, the two facts that decide a click. */
function ShelfTile({ game }: { game: GameMeta }) {
  const nav = useNavigate();
  const { progress, sfx } = useStore();
  const stat = progress.stats[game.id];
  const soloable = (['solo', 'ai', 'local'] as const).some((m) => game.modes.includes(m));
  const go = () => {
    sfx('select');
    nav(soloable ? `/solo/${game.slug}` : `/together?game=${game.id}`);
  };

  return (
    <button
      onClick={go}
      onMouseEnter={() => prefetchGame(game.id)}
      onFocus={() => prefetchGame(game.id)}
      onTouchStart={() => prefetchGame(game.id)}
      className="group relative w-[176px] sm:w-[196px] shrink-0 snap-start text-left panel notch-sm overflow-hidden no-tap
                 transition-all duration-300 hover:-translate-y-1 hover:border-blush-300"
      aria-label={`Play ${game.title} — ${game.tagline}`}
    >
      <span className="relative block h-[104px] overflow-hidden border-b border-ink-600">
        <GameArtwork artKey={game.artKey} className="transition-transform duration-[650ms] group-hover:scale-[1.09]" />
        <span className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-[#fffdf7] to-transparent" />
        <span className="absolute top-2 left-2 px-1.5 py-[2px] rounded-full bg-white/92 border border-ink-500 text-[8.5px] font-extrabold uppercase tracking-wider text-cream-300">
          {GENRE_LABEL[game.genre]}
        </span>
      </span>
      <span className="block p-2.5">
        <span className="block display text-[14px] text-cream-100 leading-tight truncate">{game.title}</span>
        <span className="mt-1 flex items-center gap-2 text-[10px] text-cream-500 font-bold">
          <span className="flex items-center gap-1"><Icon name="clock" size={10} />{game.duration}m</span>
          <span className="flex items-center gap-1"><Icon name="users" size={10} />{game.players[0]}–{game.players[1]}</span>
          {stat?.played > 0 && <span className="text-volt-700">{stat.wins}W</span>}
        </span>
      </span>
      {/* the play affordance arrives on hover/focus, so the shelf stays calm */}
      <span aria-hidden className="absolute bottom-2 right-2 w-7 h-7 grid place-items-center rounded-full bg-volt-400 border-2 border-[#c98a16] text-[#5a3a12] opacity-0 scale-75 group-hover:opacity-100 group-hover:scale-100 group-focus-visible:opacity-100 transition-all">
        <Icon name="play" size={11} />
      </span>
    </button>
  );
}

/**
 * Spotlight — one game, given the room it deserves.
 *
 * Used for a real, rotating pick (the daily seed decides, so it changes at
 * midnight and is the same for both people): a wide painted cover, a reason to
 * play it tonight, and one button. It is the visual anchor between the hero and
 * the shelves, which is otherwise the flattest part of a discovery page.
 */
export function Spotlight({ game, label, blurb }: { game: GameMeta; label: string; blurb: string }) {
  const nav = useNavigate();
  const { sfx, progress } = useStore();
  const soloable = (['solo', 'ai', 'local'] as const).some((m) => game.modes.includes(m));
  const stat = progress.stats[game.id];

  return (
    <section className="relative panel panel-notch overflow-hidden" aria-labelledby="spotlight-h">
      <div className="grid md:grid-cols-[1.05fr_0.95fr]">
        <div className="relative min-h-[210px] md:min-h-[262px] overflow-hidden">
          <GameArtwork artKey={game.artKey} className="transition-transform duration-[1200ms] hover:scale-[1.03]" priority />
          <div className="absolute inset-0 bg-gradient-to-t from-[#fff8ec]/92 via-transparent to-transparent md:bg-gradient-to-r md:from-transparent md:via-transparent md:to-[#fffaf0]/85" />
          <span className="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-white/94 border-2 border-ink-500 text-[9.5px] font-extrabold uppercase tracking-[.14em] text-blush-600">
            {label}
          </span>
        </div>

        <div className="relative p-5 sm:p-7 flex flex-col justify-center gap-3">
          <p className="eyebrow text-volt-700">{GENRE_LABEL[game.genre]} · {game.duration} minutes · {game.players[0]}–{game.players[1]} players</p>
          <h2 id="spotlight-h" className="display text-[26px] sm:text-[32px] text-cream-100 leading-none">{game.title}</h2>
          <p className="text-[13px] text-cream-500 leading-relaxed max-w-[46ch]">{blurb}</p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button onClick={() => { sfx('select'); nav(soloable ? `/solo/${game.slug}` : `/together?game=${game.id}`); }}
              className="btn btn-primary">
              <Icon name="play" size={14} />Play {game.title}
            </button>
            <button onClick={() => { sfx('select'); nav('/library'); }}
              className="btn btn-ghost btn-sm">
              More games
            </button>
            {stat?.played > 0 && (
              <span className="text-[11px] font-bold text-cream-400 ml-1">You have played this {stat.played}×</span>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

export default GameRail;
