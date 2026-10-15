import { memo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { GameMeta } from '../games/types';
import { MODE_LABEL, GENRE_LABEL } from '../games/registry';
import { GameArtwork } from './GameArtwork';
import { Icon } from './ui';
import { useStore } from '../lib/store';
import { prefetchGame } from '../lib/prefetch';

export const GameCard = memo(function GameCard({ game, size = 'md' }: { game: GameMeta; size?: 'md' | 'lg' | 'row' }) {
  const nav = useNavigate();
  const { progress, favourite, sfx } = useStore();
  const fav = progress.favourites.includes(game.id);
  const stat = progress.stats[game.id];
  const canOnline = game.modes.includes('online');

  const go = () => { sfx('select'); nav(`/solo/${game.slug}`); };
  /* Start fetching this game's chunk the moment there is intent to play it. */
  const warm = { onMouseEnter: () => prefetchGame(game.id), onFocus: () => prefetchGame(game.id), onTouchStart: () => prefetchGame(game.id) };

  if (size === 'row') {
    return (
      <div {...warm} className="group relative flex items-stretch gap-0 panel notch-sm overflow-hidden hover:border-blush-300 transition-colors">
        <button onClick={go} className="relative w-[112px] shrink-0 overflow-hidden no-tap" aria-label={`Play ${game.title}`}>
          <GameArtwork artKey={game.artKey} className="transition-transform duration-500 group-hover:scale-[1.07]" />
        </button>
        <div className="flex-1 min-w-0 p-3 flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="display text-[14.5px] text-cream-100 truncate">{game.title}</p>
            <p className="text-[11.5px] text-cream-500 truncate">{game.tagline} · {GENRE_LABEL[game.genre]}</p>
          </div>
          <button onClick={go} className="btn btn-sm btn-primary shrink-0"><Icon name="play" size={12} />Play</button>
        </div>
      </div>
    );
  }

  return (
    <article {...warm} className={`group relative panel panel-notch overflow-hidden flex flex-col transition-all duration-300
      hover:-translate-y-1 hover:border-blush-300 ${size === 'lg' ? 'min-h-[330px]' : 'min-h-[272px]'}`}>
      {/* artwork */}
      <div className={`relative ${size === 'lg' ? 'h-[180px]' : 'h-[136px]'} overflow-hidden border-b border-ink-600`}>
        <GameArtwork artKey={game.artKey} className="transition-transform duration-[650ms] group-hover:scale-[1.08]" />
        <div className="absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-[#fffdf7] to-transparent" />
        <div className="absolute top-2 left-2 flex gap-1">
          <span className="px-2 py-[3px] rounded-full bg-white/92 border-2 border-ink-500 text-[9px] font-extrabold uppercase tracking-wider text-cream-300">
            {GENRE_LABEL[game.genre]}
          </span>
          {canOnline && (
            <span className="px-2 py-[3px] rounded-full bg-blush-300 border-2 border-blush-600 text-white text-[9px] font-extrabold uppercase tracking-wider">
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
            {stat?.played > 0 && <span className="flex items-center gap-1 text-volt-700"><Icon name="trophy" size={12} />{stat.wins}W</span>}
          </div>
          <button onClick={go} className="btn btn-sm btn-primary"><Icon name="play" size={12} />Play</button>
        </div>
      </div>
    </article>
  );
});

export default GameCard;
