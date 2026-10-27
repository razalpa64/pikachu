import { useEffect, useMemo, useRef, useState, useDeferredValue } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { GAMES, GENRE_LABEL } from '../games/registry';
import type { GameMeta } from '../games/types';
import { GameCard } from '../components/GameCard';
import { PikaScene } from '../mascot';
import { Button, EmptyState, Icon, Panel, Segmented } from '../components/ui';
import { Sheet } from '../components/Sheet';
import { haptic } from '../lib/haptics';
import { AdSlot } from '../components/AdSlot';
import { useStore, useAmbience } from '../lib/store';
import { useSiteContent } from '../lib/content';
import { LIBRARY_HEADING } from '../lib/copy';
import { LIBRARY_FAQ } from '../lib/seo';
import { BoltRule } from '../mascot';

type Filter = 'all' | 'online' | 'solo' | 'ai' | 'coop' | 'favourites' | 'recent'
  | 'strategy' | 'arcade' | 'puzzle' | 'party';
type Sort = 'featured' | 'name' | 'duration' | 'played';

/** Sort options, shared by the wide-screen control and the phone sheet. */
const SORTS: { value: Sort; label: string }[] = [
  { value: 'featured', label: 'Featured' },
  { value: 'name', label: 'A–Z' },
  { value: 'duration', label: 'Quickest' },
  { value: 'played', label: 'Most played' },
];

/** How many games each filter will actually show — the number comes from the
 *  registry, so a chip can never advertise an empty shelf. */
const countFor = (id: Filter, favourites: string[]): number => {
  switch (id) {
    case 'all': return GAMES.length;
    case 'online': return GAMES.filter((g) => g.modes.includes('online')).length;
    case 'solo': return GAMES.filter((g) => g.modes.includes('solo') || g.modes.includes('ai')).length;
    case 'ai': return GAMES.filter((g) => g.modes.includes('ai')).length;
    case 'coop': return GAMES.filter((g) => g.modes.includes('coop')).length;
    case 'favourites': return favourites.length;
    case 'recent': return -1; // dynamic: the count is whatever is in the profile
    case 'strategy': case 'arcade': case 'puzzle': case 'party':
      return GAMES.filter((g) => g.genre === id).length;
  }
};

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
  const copy = useSiteContent();
  useAmbience('hub');
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query);
  const searchRef = useRef<HTMLInputElement>(null);
  const clearSearch = () => { setQuery(''); searchRef.current?.focus(); };

  /* `/` focuses search from anywhere on the page — the convention people already
     have from every other catalogue — and Escape clears it without leaving. The
     handler must not fire while the user is typing in another field. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (e.key === '/' && !typing) { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === 'Escape' && el === searchRef.current && query) { e.preventDefault(); clearSearch(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [query]);
  const [sort, setSort] = useState<Sort>('featured');
  const filter = (params.get('mode') as Filter) ?? 'all';

  /**
   * The filter rail scrolls sideways on a phone, which means the chip that is
   * actually applied can be off-screen — and a link like `/library?mode=solo`
   * then shows a page filtered to something the visitor cannot see a tick on.
   * Bring the active chip into view whenever the filter changes (including on
   * the first render, which is the deep-link case).
   */
  const railRef = useRef<HTMLDivElement>(null);
  /* The phone filter sheet. On a wide screen the chips and the sort control fit
     beside the search box; on a phone they were a second and third row of chrome
     above the content, and the last chip was always clipped mid-word. */
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilter = FILTERS.find((f) => f.id === filter) ?? FILTERS[0];
  useEffect(() => {
    const active = railRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (active && typeof active.scrollIntoView === 'function') {
      active.scrollIntoView({ block: 'nearest', inline: 'center' });
    }
  }, [filter]);

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
    <div className="mx-auto max-w-[1340px] px-[var(--shell-pad)] pt-3 pb-7 sm:py-7">
      <header className="mb-3 lg:mb-6 flex items-start justify-between gap-6">
        <div className="min-w-0">
          {/* On a phone the title bar already says "Games", so the eyebrow and the
              three-line pitch are just 150 px between you and a game. They come
              back at sm, where there is room for them. */}
          <p className="eyebrow text-volt-700 mb-1.5 hidden sm:block">Everything here is playable today</p>
          <h1 className="display text-[26px] sm:text-[38px] text-cream-100">{copy('library.title', LIBRARY_HEADING)}</h1>
          <p className="text-[13.5px] text-cream-500 mt-1.5 max-w-[62ch] hidden sm:block">
            {GAMES.length} finished games with real engines behind them. No placeholders, no “coming soon” tiles —
            search, filter, and start one in a click.
          </p>
        </div>
        <PikaScene clip="meadow" className="hidden lg:block w-[260px] shrink-0" rounded={20} tilt={1.5} />
      </header>

      {/* Controls. Sticky under the header: on a long library page the search box
          used to scroll away, so narrowing 20 games meant scrolling back to the
          top to type. `top` is the same 58 px every other sticky bar in the app uses, so the search
          box tucks under the header instead of leaving a sliver of page visible. */}
      <div className="sticky top-[58px] z-20 -mx-[var(--shell-pad)] px-[var(--shell-pad)] py-2 mb-3 bg-ink-900/92 backdrop-blur-md blur-heavy border-b border-ink-600/70">
        {/* Search and filters share one row on every screen: stacked, they were
            two 46 px bands of chrome between the title and the first game. */}
        <div className="flex flex-row items-center gap-2.5">
          <div className="relative flex-1 min-w-0">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-cream-500"><Icon name="search" size={16} /></span>
            <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} type="search"
              placeholder="Search games, genres, mechanics…"
              aria-label="Search games"
              className="w-full bg-ink-800 border-2 border-ink-500 pl-9 pr-16 py-2.5 text-[13.5px] text-cream-100 placeholder:text-cream-400 notch-sm focus:border-volt-500 outline-none" />
            {query ? (
              <button onClick={clearSearch} aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 grid place-items-center rounded-full text-cream-500 hover:text-cream-100 hover:bg-blush-100 no-tap">
                <Icon name="x" size={13} />
              </button>
            ) : (
              <kbd aria-hidden className="hidden sm:block absolute right-2.5 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded border border-ink-400 bg-ink-850 text-[10px] font-bold text-cream-400">/</kbd>
            )}
          </div>
          {/* One button opens everything that is not the search box. It carries
              the name of the filter that is applied, so the state is never
              hidden behind an icon. */}
          <button
            type="button"
            onClick={() => { haptic('tap'); setFiltersOpen(true); }}
            aria-haspopup="dialog"
            aria-expanded={filtersOpen}
            className="lg:hidden shrink-0 flex items-center gap-2 h-[46px] px-3.5 rounded-2xl border-2 border-ink-500 bg-ink-800 text-cream-100 active:scale-95 transition-transform no-tap"
          >
            <Icon name="sliders" size={16} />
            <span className="text-[12px] font-extrabold uppercase tracking-wider max-w-[92px] truncate">{activeFilter.label}</span>
            {filter !== 'all' && <span className="w-1.5 h-1.5 rounded-full bg-blush-600" aria-hidden />}
          </button>
          <div className="hidden lg:flex items-center justify-between gap-2 shrink-0">
            <span className="eyebrow">Sort</span>
            <Segmented value={sort} onChange={setSort} size="sm" label="Sort games"
              options={[{ value: 'featured', label: 'Featured' }, { value: 'name', label: 'A–Z' }, { value: 'duration', label: 'Quickest' }, { label: 'Most played', value: 'played' }]} />
          </div>
        </div>
      </div>

      {/* filter rail: on a phone it scrolls, and the soft edge on the right is
          the only thing that says so — without it the last chip looks cut off
          rather than waiting to be swiped to. */}
      <div className="relative mb-5 hidden lg:block">
      <div ref={railRef} className="flex gap-1.5 pb-2.5 flex-wrap">
        {FILTERS.map((f) => {
          const active = filter === f.id;
          const n = countFor(f.id, progress.favourites);
          const count = n >= 0 ? n : undefined;
          return (
            <button key={f.id} onClick={() => setFilter(f.id)} aria-pressed={active}
              className={`shrink-0 flex items-center gap-1.5 px-3 py-2 text-[11.5px] font-extrabold uppercase tracking-wider border transition-colors notch-sm no-tap
                ${active ? 'bg-volt-400 text-[#5a3a12] border-volt-200' : 'bg-ink-800 text-cream-500 border-ink-600 hover:text-cream-100 hover:border-ink-400'}`}>
              {f.icon && <Icon name={f.icon} size={13} />}{f.label}
              {count !== undefined && <span className="opacity-60 tabnum">{count}</span>}
            </button>
          );
        })}
      </div>
      </div>

      {/* The phone sheet: every filter and the sort order, with the counts the
          chips show, so choosing is one tap rather than a swipe and a guess. */}
      <Sheet open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filter games">
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Filter by">
          {FILTERS.map((f) => {
            const active = filter === f.id;
            const n = countFor(f.id, progress.favourites);
            return (
              <button
                key={f.id}
                type="button"
                aria-pressed={active}
                onClick={() => { haptic('select'); setFilter(f.id); setFiltersOpen(false); }}
                className={`flex items-center gap-2 min-h-[46px] px-3 rounded-2xl border-2 text-left no-tap transition-colors ${
                  active ? 'bg-volt-200 border-ink-500 text-[#5a3a12]' : 'bg-white border-ink-500 text-cream-100'
                }`}
              >
                {f.icon && <Icon name={f.icon} size={15} />}
                <span className="text-[12px] font-extrabold uppercase tracking-wider truncate flex-1">{f.label}</span>
                {n >= 0 && <span className="text-[11px] font-bold opacity-60 tabnum">{n}</span>}
              </button>
            );
          })}
        </div>

        <p className="eyebrow mt-5 mb-2">Sort by</p>
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Sort by">
          {SORTS.map((o) => (
            <button
              key={o.value}
              type="button"
              aria-pressed={sort === o.value}
              onClick={() => { haptic('select'); setSort(o.value); }}
              className={`min-h-[44px] px-3 rounded-2xl border-2 text-[12px] font-extrabold uppercase tracking-wider no-tap transition-colors ${
                sort === o.value ? 'bg-blush-100 border-blush-600 text-[#8f1740]' : 'bg-white border-ink-500 text-cream-100'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>

        <div className="mt-4 flex gap-2">
          <Button
            variant="primary"
            className="flex-1"
            onClick={() => { haptic('tap'); setFiltersOpen(false); }}
          >Show {results.length} {results.length === 1 ? 'game' : 'games'}</Button>
          {(filter !== 'all' || sort !== 'featured') && (
            <Button variant="ghost" onClick={() => { haptic('tap'); setFilter('all'); setSort('featured'); }}>
              Reset
            </Button>
          )}
        </div>
      </Sheet>

      {results.length === 0 ? (
        <Panel>
          <EmptyState mascot="thinking" title="Nothing matches that yet"
            body={filter === 'favourites' ? 'Tap the star on any game card to pin it here.' : 'Try a different filter or clear your search.'}
            action={<Button variant="primary" size="sm" onClick={() => { setQuery(''); setFilter('all'); }}>Show all games</Button>} />
        </Panel>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {results.map((g) => <GameCard key={g.id} game={g} />)}
        </div>
      )}

      {/* The count stays on screen in both branches: "Showing 0 of 20" answers
          "did my search work?" better than a lone empty state can. */}
      {results.length > 0 && <BoltRule className="mt-9" />}
      <p className="text-center text-[11.5px] text-cream-400 mt-4" aria-live="polite">
        Showing {results.length} of {GAMES.length} games
      </p>
      <AdSlot placement="library-foot" className="mt-8 max-w-[860px] mx-auto" />

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
            Twenty-six games, one or two players, nothing to install. A private room is a five-letter code you
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
