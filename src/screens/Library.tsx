import { useMemo, useState, useDeferredValue } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { GAMES, GENRE_LABEL } from '../games/registry';
import type { GameMeta } from '../games/types';
import { GameCard } from '../components/GameCard';
import { PikaScene } from '../mascot';
import { Button, EmptyState, Icon, Panel, Segmented } from '../components/ui';
import { useStore, useAmbience } from '../lib/store';
import { LIBRARY_FAQ } from '../lib/seo';
import { BoltRule } from '../mascot';

type Filter = 'all' | 'online' | 'solo' | 'ai' | 'coop' | 'favourites' | 'recent'
  | 'strategy' | 'arcade' | 'puzzle' | 'party';
type Sort = 'featured' | 'name' | 'duration' | 'played';

const FILTERS: { id: Filter; label: string; icon?: string }[] = [
  { id: 'all', label: 'All games', icon: 'grid' },
  { id: 'online', label: 'Multiplayer', icon: 'users' },
  { id: 'solo', label: 'Single player', icon: 'user' },
  { id: 'ai', label: 'Play vs AI', icon: 'brain' },
  { id: 'coop', label: 'Co-op', icon: 'sparkle' },
  { id: 'strategy', label: 'Strategy', icon: 'sword' },
  { id: 'arcade', label: 'Arcade', icon: 'bolt' },
  { id: 'puzzle', label: 'Puzzle', icon: 'target' },
  { id: 'party', label: 'Party', icon: 'star' },
  { id: 'recent', label: 'Recently played', icon: 'clock' },
  { id: 'favourites', label: 'Favourites', icon: 'star' },
];

export default function Library() {
  const [params, setParams] = useSearchParams();
  const { progress, sfx } = useStore();
  useAmbience('hub');
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query);
  const [sort, setSort] = useState<Sort>('featured');
  const filter = (params.get('mode') as Filter) ?? 'all';

  const setFilter = (f: Filter) => {
    sfx('toggle');
    if (f === 'all') setParams({}, { replace: true });
    else setParams({ mode: f }, { replace: true });
  };

  const results = useMemo(() => {
    let list: GameMeta[] = GAMES.slice();
    switch (filter) {
      case 'online': list = list.filter((g) => g.modes.includes('online')); break;
      case 'solo': list = list.filter((g) => g.modes.includes('solo') || g.modes.includes('ai')); break;
      case 'ai': list = list.filter((g) => g.modes.includes('ai')); break;
      case 'coop': list = list.filter((g) => g.modes.includes('coop')); break;
      case 'favourites': list = list.filter((g) => progress.favourites.includes(g.id)); break;
      case 'recent': {
        const order = progress.recents.map((r) => r.gameId);
        list = list.filter((g) => order.includes(g.id)).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
        break;
      }
      case 'strategy': case 'arcade': case 'puzzle': case 'party':
        list = list.filter((g) => g.genre === filter); break;
    }
    const q = deferred.trim().toLowerCase();
    if (q) list = list.filter((g) =>
      g.title.toLowerCase().includes(q) || g.tagline.toLowerCase().includes(q) ||
      g.description.toLowerCase().includes(q) || GENRE_LABEL[g.genre].toLowerCase().includes(q));

    if (filter !== 'recent') {
      if (sort === 'name') list = [...list].sort((a, b) => a.title.localeCompare(b.title));
      if (sort === 'duration') list = [...list].sort((a, b) => a.duration - b.duration);
      if (sort === 'played') list = [...list].sort((a, b) => (progress.stats[b.id]?.played ?? 0) - (progress.stats[a.id]?.played ?? 0));
    }
    return list;
  }, [filter, deferred, sort, progress]);

  return (
    <div className="mx-auto max-w-[1340px] px-[var(--shell-pad)] py-7">
      <header className="mb-6 flex items-start justify-between gap-6">
        <div className="min-w-0">
          <p className="eyebrow text-volt-700 mb-1.5">Everything here is playable today</p>
          <h1 className="display text-[30px] sm:text-[38px] text-cream-100">Game Library</h1>
          <p className="text-[13.5px] text-cream-500 mt-1.5 max-w-[62ch]">
            {GAMES.length} finished games with real engines behind them. No placeholders, no “coming soon” tiles.
          </p>
        </div>
        <PikaScene clip="meadow" className="hidden lg:block w-[260px] shrink-0" rounded={20} tilt={1.5} />
      </header>

      {/* controls */}
      <Panel className="p-3 mb-5 flex flex-col lg:flex-row gap-3 lg:items-center">
        <div className="relative flex-1 min-w-0">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-cream-500"><Icon name="search" size={16} /></span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} type="search" placeholder="Search games, genres, mechanics…"
            aria-label="Search games"
            className="w-full bg-ink-800 border border-ink-500 pl-9 pr-3 py-2.5 text-[13.5px] text-cream-100 placeholder:text-cream-400 notch-sm focus:border-volt-500 outline-none" />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="eyebrow hidden sm:inline">Sort</span>
          <Segmented value={sort} onChange={setSort} size="sm" label="Sort games"
            options={[{ value: 'featured', label: 'Featured' }, { value: 'name', label: 'A–Z' }, { value: 'duration', label: 'Quickest' }, { value: 'played', label: 'Most played' }]} />
        </div>
      </Panel>

      {/* filter rail */}
      <div className="flex gap-1.5 overflow-x-auto pb-2.5 mb-5 -mx-[var(--shell-pad)] px-[var(--shell-pad)] lg:mx-0 lg:px-0 lg:flex-wrap">
        {FILTERS.map((f) => {
          const active = filter === f.id;
          const count = f.id === 'favourites' ? progress.favourites.length : undefined;
          return (
            <button key={f.id} onClick={() => setFilter(f.id)} aria-pressed={active}
              className={`shrink-0 flex items-center gap-1.5 px-3 py-2 text-[11.5px] font-extrabold uppercase tracking-wider border transition-colors notch-sm no-tap
                ${active ? 'bg-volt-400 text-[#5a3a12] border-volt-200' : 'bg-ink-800 text-cream-500 border-ink-600 hover:text-cream-100 hover:border-ink-400'}`}>
              {f.icon && <Icon name={f.icon} size={13} />}{f.label}
              {count !== undefined && count > 0 && <span className="opacity-70">({count})</span>}
            </button>
          );
        })}
      </div>

      {results.length === 0 ? (
        <Panel>
          <EmptyState mascot="thinking" title="Nothing matches that yet"
            body={filter === 'favourites' ? 'Tap the star on any game card to pin it here.' : 'Try a different filter or clear your search.'}
            action={<Button variant="primary" size="sm" onClick={() => { setQuery(''); setFilter('all'); }}>Show all games</Button>} />
        </Panel>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {results.map((g) => <GameCard key={g.id} game={g} />)}
          </div>
          <BoltRule className="mt-9" />
          <p className="text-center text-[11.5px] text-cream-400 mt-4">
            Showing {results.length} of {GAMES.length} games
          </p>
        </>
      )}

      {/* The library is the page people land on from a search, so it answers the
          things a stranger actually wants to know: no account, free, works on a
          phone, what happens if the wifi drops. These same questions feed the
          FAQPage structured data in src/lib/seo.ts — one array, so the visible
          copy and the markup can never disagree. */}
      <section aria-labelledby="arcade-faq-h" className="mt-12 pt-8 border-t-2 border-ink-600">
        <div className="max-w-[820px]">
          <p className="eyebrow text-volt-700 mb-2">Good to know</p>
          <h2 id="arcade-faq-h" className="display text-[24px] sm:text-[30px] text-cream-100 leading-tight">
            Playing in this arcade
          </h2>
          <p className="mt-2 text-[13.5px] text-cream-300 leading-relaxed">
            Twenty games, one or two players, nothing to install. A private room is a five-letter code you
            send to the person you want to play with — and because the server referees every move, the board
            survives a dropped connection.
          </p>

          <div className="mt-5 flex flex-col gap-2">
            {LIBRARY_FAQ.map((item) => (
              <details key={item.q} className="panel notch-sm px-4 py-3">
                <summary className="cursor-pointer text-[13.5px] font-extrabold text-cream-100 marker:text-blush-600">
                  {item.q}
                </summary>
                <p className="mt-2 text-[13px] text-cream-300 leading-relaxed">{item.a}</p>
              </details>
            ))}
          </div>

          <p className="mt-6 text-[13px] text-cream-300 leading-relaxed">
            Ready to start?{' '}
            <Link to="/together" className="font-bold text-blush-600 hover:text-[#8f1740]">Open a private room</Link>
            {' '}for the two of you, browse the{' '}
            <Link to="/solo" className="font-bold text-blush-600 hover:text-[#8f1740]">single-player games</Link>
            {' '}for a quiet match against the AI, or{' '}
            <Link to="/feedback" className="font-bold text-blush-600 hover:text-[#8f1740]">suggest a game</Link>
            {' '}you would like to see here next.
          </p>
        </div>
      </section>
    </div>
  );
}
