import { memo, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { GameMeta } from '../games/types';
import { MODE_LABEL, GENRE_LABEL } from '../games/registry';
import { GameArtwork } from './GameArtwork';
import { Icon } from './ui';
import { useStore } from '../lib/store';
import { prefetchGame } from '../lib/prefetch';

/**
 * The library tile.
 *
 * Twenty games in one uniform grid is the thing that made this page feel like a
 * template: same panel, same crop, same three chips, twenty times. Each tile now
 * carries the identity of the game it represents, using data the registry already
 * holds rather than new artwork:
 *
 *   • **a genre treatment** — the artwork sits differently in a strategy tile than
 *     in a party tile (a framed board, a stack of cards, a mosaic, a speed streak),
 *     so the grid has texture before you read a single word;
 *   • **the game's own accent** — a hairline along the top of the cover and the
 *     tagline colour, both taken from `game.accent` (every one of those values is
 *     ≥ 5:1 on paper, which is why they are safe as small text);
 *   • **your history, if there is any** — a win count only once you have actually
 *     played it, never a fabricated statistic.
 *
 * Everything else stays put on purpose: the same panel, the same tap targets, the
 * same Play affordance. Identity is added around the content, not instead of it.
 */
const GENRE_TREATMENT: Record<string, { wrap: string; frame: string; mark?: ReactNode }> = {
  // a keyline inside the cover reads as a board with an edge
  strategy: {
    wrap: '',
    frame: 'after:absolute after:inset-[7px] after:rounded-[7px] after:border after:border-white/55 after:pointer-events-none',
  },
  // a blush mat, as if the cover were mounted on card stock
  party: {
    wrap: 'p-[7px] pb-0 bg-[linear-gradient(180deg,#fff0f4,#ffe4ec)]',
    frame: 'rounded-t-[10px] ring-1 ring-blush-300',
  },
  // a dotted mat under the pieces
  puzzle: {
    wrap: 'p-[7px]',
    frame: 'rounded-[9px]',
    mark: (
      <span aria-hidden className="absolute inset-0 pointer-events-none opacity-[.22]"
        style={{ backgroundImage: 'radial-gradient(#5c4035 1px, transparent 1.2px)', backgroundSize: '9px 9px' }} />
    ),
  },
  // diagonal streaks, because this one is about speed
  arcade: {
    wrap: '',
    frame: 'after:absolute after:inset-0 after:pointer-events-none',
    mark: (
      <span aria-hidden className="absolute -inset-y-4 -right-6 w-24 rotate-[18deg] pointer-events-none"
        style={{ background: 'repeating-linear-gradient(90deg, rgba(255,255,255,.5) 0 3px, transparent 3px 13px)' }} />
    ),
  },
};

const FALLBACK_TREATMENT = { wrap: '', frame: '' };

export const GameCard = memo(function GameCard({ game, size = 'md' }: { game: GameMeta; size?: 'md' | 'lg' | 'row' }) {
  const nav = useNavigate();
  const { progress, favourite, sfx } = useStore();
  const fav = progress.favourites.includes(game.id);
  const stat = progress.stats[game.id];
  const canOnline = game.modes.includes('online');
  /* Some games have no single-player mode at all (Guess & Draw). The card used to
     send those to /solo/<slug>, which could only ever say "this one is for two" —
     one wasted click on the most prominent button in the library. */
  const soloable = (['solo', 'ai', 'local'] as const).some((m) => game.modes.includes(m));

  const go = () => {
    sfx('select');
    nav(soloable ? `/solo/${game.slug}` : `/together?game=${game.id}`);
  };
  /* Start fetching this game's chunk the moment there is intent to play it. */
  const warm = { onMouseEnter: () => prefetchGame(game.id), onFocus: () => prefetchGame(game.id), onTouchStart: () => prefetchGame(game.id) };

  const treat = GENRE_TREATMENT[game.genre] ?? FALLBACK_TREATMENT;

  if (size === 'row') {
    return (
      <div {...warm} className="group relative flex items-stretch gap-0 panel notch-sm overflow-hidden hover:border-blush-300 transition-colors">
        <button onClick={go} className="relative w-[112px] shrink-0 overflow-hidden no-tap" aria-label={`Play ${game.title}`}>
          <GameArtwork artKey={game.artKey} className="transition-transform duration-500 group-hover:scale-[1.07]" />
          <span aria-hidden className="absolute inset-x-0 top-0 h-[3px]" style={{ background: game.accent }} />
        </button>
        <div className="flex-1 min-w-0 p-3 flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="display text-[14.5px] text-cream-100 truncate">{game.title}</p>
            <p className="text-[11.5px] text-cream-500 truncate">
              <span style={{ color: game.accent }} className="font-extrabold">{GENRE_LABEL[game.genre]}</span> · {game.tagline}
            </p>
          </div>
          <button onClick={go} className="btn btn-sm btn-primary shrink-0"><Icon name="play" size={12} />Play</button>
        </div>
      </div>
    );
  }

  return (
    <article {...warm}
      /* the hover glow is the game's own accent, at a whisper — 20 tiles now lift
         in 20 different colours */
      style={{ '--tile-accent': game.accent } as React.CSSProperties}
      className={`group relative panel panel-notch overflow-hidden flex flex-col transition-all duration-300
        hover:-translate-y-1 hover:border-blush-300 hover:shadow-[0_18px_32px_-22px_var(--tile-accent),0_1px_2px_-1px_rgba(120,80,55,.16)]
        ${size === 'lg' ? 'min-h-[330px]' : 'min-h-[272px]'}`}>

      {/* artwork, framed by genre */}
      <div className={`relative ${size === 'lg' ? 'h-[180px]' : 'h-[136px]'} overflow-hidden border-b border-ink-600 ${treat.wrap}`}>
        <div className={`relative h-full overflow-hidden ${treat.frame}`}>
          <GameArtwork artKey={game.artKey} className="transition-transform duration-[650ms] group-hover:scale-[1.08]" />
          {treat.mark}
          <span aria-hidden className="absolute inset-x-0 top-0 h-[3px]" style={{ background: game.accent }} />
          <div className="absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-[#fffdf7] to-transparent" />
          <div className="absolute top-2.5 left-2.5 flex flex-wrap gap-1">
            <span className="px-2 py-[3px] rounded-full bg-white/92 border-2 border-ink-500 text-[9px] font-extrabold uppercase tracking-wider"
              style={{ color: game.accent }}>
              {GENRE_LABEL[game.genre]}
            </span>
            {canOnline && (
              <span className="px-2 py-[3px] rounded-full bg-blush-300 border-2 border-blush-600 text-[#7a2440] text-[9px] font-extrabold uppercase tracking-wider">
                Together
              </span>
            )}
          </div>
          <button onClick={() => favourite(game.id)} aria-pressed={fav} aria-label={fav ? `Remove ${game.title} from favourites` : `Add ${game.title} to favourites`}
            className={`absolute top-2 right-2 w-8 h-8 grid place-items-center rounded-full bg-white/92 border-2 no-tap transition-all
              ${fav ? 'border-blush-600 text-blush-600 scale-105' : 'border-ink-500 text-cream-500 hover:text-blush-400 hover:border-blush-300'}`}>
            <svg width="16" height="15" viewBox="0 0 18 16" fill={fav ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
              <path d="M9 15S1 10.2 1 5.6A4.2 4.2 0 0 1 9 3.4 4.2 4.2 0 0 1 17 5.6C17 10.2 9 15 9 15Z" />
            </svg>
          </button>
        </div>
      </div>

      {/* body */}
      <div className="p-3.5 flex flex-col flex-1 gap-2">
        <div>
          <h3 className="display text-[17px] text-cream-100 leading-tight">{game.title}</h3>
          <p className="text-[11.5px] tracking-[.04em] font-extrabold mt-0.5" style={{ color: game.accent }}>{game.tagline}</p>
        </div>
        <p className="text-[12px] text-cream-500 leading-relaxed line-clamp-2 flex-1">{game.description}</p>

        <div className="flex flex-wrap gap-1 items-center">
          {game.modes.map((m) => (
            <span key={m} className="px-2 py-[3px] rounded-full bg-blush-100 border-[1.5px] border-ink-500 text-[9.5px] font-bold uppercase tracking-wider text-cream-300">
              {MODE_LABEL[m]}
            </span>
          ))}
        </div>

        <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-ink-600">
          <div className="flex items-center gap-2.5 text-[10.5px] text-cream-500 font-semibold">
            <span className="flex items-center gap-1"><Icon name="users" size={12} />{game.players[0]}–{game.players[1]}</span>
            <span className="flex items-center gap-1"><Icon name="clock" size={12} />{game.duration}m</span>
            {stat?.played > 0 && <span className="flex items-center gap-1 text-volt-700" title={`${stat.wins} wins in ${stat.played} matches`}><Icon name="trophy" size={12} />{stat.wins}W</span>}
          </div>
          <button onClick={go} className="btn btn-sm btn-primary"><Icon name="play" size={12} />Play</button>
        </div>
      </div>
    </article>
  );
});

export default GameCard;
