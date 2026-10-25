import { Link } from 'react-router-dom';
import { GAMES, GENRE_LABEL } from '../games/registry';
import { howToFor } from '../games/howToPlay';
import type { GameMeta } from '../games/types';
import { Icon } from './ui';
import { useStore } from '../lib/store';

/**
 * GameAbout — the readable page under the board.
 *
 * Two jobs at once. For a player who has just landed on a game they half
 * remember, it is the rules in full, in the same voice, without opening a
 * disclosure mid-match. For a search engine it is the only place on the site
 * where a game's rules, modes and genre exist as plain, indexable prose — the
 * in-play rulebook is a closed `<details>`-style disclosure, so it is not in the
 * DOM until someone opens it.
 *
 * It sits *below* the board on purpose: nothing here delays the first move.
 */
export function GameAbout({ game }: { game: GameMeta }) {
  const how = howToFor(game.id);
  const { sfx } = useStore();
  const related = GAMES.filter((g) => g.genre === game.genre && g.id !== game.id).slice(0, 3);
  const online = game.modes.includes('online');

  return (
    <section aria-labelledby="game-about-h" className="border-t-2 border-ink-600 bg-ink-850">
      <div className="mx-auto max-w-[860px] px-[var(--shell-pad)] py-9 sm:py-12">
        <p className="eyebrow text-volt-700 mb-2">
          {GENRE_LABEL[game.genre]} · {game.players[0]}–{game.players[1]} players · about {game.duration} min
        </p>
        <h2 id="game-about-h" className="display text-[25px] sm:text-[32px] text-cream-100 leading-tight">
          How to play {game.title}
        </h2>
        <p className="mt-3 text-[14px] sm:text-[15px] text-cream-300 leading-relaxed max-w-[64ch]">{game.description}</p>

        {how && (
          <>
            <p className="mt-5 text-[14.5px] font-extrabold text-cream-100 leading-snug">{how.goal}</p>
            <ol className="mt-3 grid gap-2 sm:grid-cols-2">
              {how.steps.map((step, i) => (
                <li key={i} className="flex gap-2.5 text-[13px] text-cream-300 leading-relaxed">
                  <span
                    className="shrink-0 mt-0.5 w-5 h-5 rounded-full bg-blush-100 border-2 border-ink-500 text-[10px] font-extrabold text-cream-300 grid place-items-center tabnum"
                    aria-hidden
                  >
                    {i + 1}
                  </span>
                  <span className="min-w-0">{step}</span>
                </li>
              ))}
            </ol>
            {how.tip && (
              <p className="mt-4 text-[13px] text-cream-300 leading-relaxed border-l-4 border-volt-400 pl-3">
                <strong className="text-volt-700">Tip.</strong> {how.tip}
              </p>
            )}
          </>
        )}

        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          <div>
            <h3 className="display text-[18px] text-cream-100 mb-2">Ways to play</h3>
            <ul className="flex flex-col gap-1.5 text-[13px] text-cream-300">
              <li className="flex items-center gap-2">
                <Icon name="user" size={13} /> Solo against the AI — pick any difficulty
              </li>
              {game.modes.includes('local') && (
                <li className="flex items-center gap-2">
                  <Icon name="users" size={13} /> Pass-and-play on one device
                </li>
              )}
              {online && (
                <li className="flex items-center gap-2">
                  <Icon name="link" size={13} /> Private room with a five-letter code
                </li>
              )}
            </ul>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link to={`/solo/${game.slug}`} onClick={() => sfx('click')}
                className="btn btn-sm btn-primary no-underline">
                <Icon name="play" size={12} /> Play {game.title}
              </Link>
              {online && (
                <Link to={`/together?game=${game.id}`} onClick={() => sfx('select')}
                  className="btn btn-sm btn-blue no-underline">
                  <Icon name="users" size={12} /> Play with a friend
                </Link>
              )}
            </div>
          </div>

          {related.length > 0 && (
            <div>
              <h3 className="display text-[18px] text-cream-100 mb-2">More {GENRE_LABEL[game.genre].toLowerCase()} games</h3>
              <ul className="flex flex-col gap-1.5">
                {related.map((g) => (
                  <li key={g.id}>
                    <Link to={`/solo/${g.slug}`} onClick={() => sfx('click')}
                      className="group flex items-center gap-2 text-[13px] text-cream-300 hover:text-cream-100 no-underline">
                      <span className="w-1.5 h-4 shrink-0" style={{ background: g.accent }} aria-hidden />
                      <span className="font-semibold">{g.title}</span>
                      <span className="text-cream-500 truncate">— {g.tagline}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              <Link to="/library" onClick={() => sfx('click')}
                className="inline-flex items-center gap-1 mt-3 text-[11.5px] font-extrabold uppercase tracking-wider text-blush-600 hover:text-[#8f1740] no-underline">
                All {GAMES.length} games <Icon name="chevron-right" size={12} />
              </Link>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export default GameAbout;
