/**
 * PIKACHU — SEO, in one place.
 *
 * The app is a client-rendered SPA, so two different audiences have to be
 * served from the same code:
 *
 *   • crawlers that execute JavaScript (Googlebot, Bingbot) end up here, on
 *     `useSeo()`, which rewrites the title, description, canonical, Open Graph
 *     tags and JSON-LD on every route change;
 *   • everything else (social scrapers, link unfurlers, non-JS bots) only ever
 *     sees `index.html`, which carries the static defaults, the site-level
 *     structured data and a `<noscript>` index of every game.
 *
 * Nothing here fabricates a signal. No fake ratings, no invented review counts,
 * no keyword stuffing — just accurate metadata, real page content and honest
 * structured data, which is what actually survives a Google update.
 */

import { RETRO_SHELF } from './retroShelf.generated';
import { GAMES, gameBySlug, GENRE_LABEL } from '../games/registry';

/** Counted from the registry, never typed by hand — the headline has to stay true
 *  as games are added. */
const ONLINE_COUNT = GAMES.filter((g) => g.serverRefereed).length;
import { howToFor } from '../games/howToPlay';
import type { GameMeta } from '../games/types';

/**
 * Canonical production origin — the custom domain, not the *.vercel.app host.
 * Preview deploys deliberately point here too, so a preview URL never competes
 * with production in an index.
 */
export const SITE_URL = 'https://pikachu.invytra.in';
export const SITE_NAME = 'Pikachu Arcade';
export const SITE_SHORT = 'PIKACHU';
export const OG_IMAGE = '/og/pikachu-og.png';
export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;
/** The app writes British English ("favourite", "colour"). Say so honestly. */
export const SITE_LANG = 'en-GB';

export const DEFAULT_TITLE = 'Pikachu Arcade — Free Two-Player Browser Games';
export const DEFAULT_DESCRIPTION =
  'Twenty-six free browser games for two: chess, checkers, battleship, cards, quizzes and more. Open a private room, share a five-letter code, play from anywhere. No downloads, no accounts.';

const INDEX = 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1';
const NOINDEX = 'noindex, follow';

export interface SeoMeta {
  title: string;
  description: string;
  /** Absolute URL, always with the production origin. */
  canonical: string;
  robots: string;
  image: string;
  /** Open Graph object type. */
  type: 'website' | 'article';
  jsonLd: Record<string, unknown>[];
}

/* ------------------------------------------------------------------ helpers */

const absolute = (path: string) => `${SITE_URL}${path === '/' ? '/' : path.replace(/\/+$/, '')}`;

const trim = (s: string, max: number) => {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${cut.slice(0, space > 40 ? space : max).replace(/[.,;:—-]$/, '')}…`;
};

const MODE_TEXT: Record<string, string> = {
  online: 'private online rooms',
  ai: 'AI opponents',
  local: 'pass-and-play on one device',
  solo: 'solo runs',
  coop: 'co-op',
};

/** "private online rooms, AI opponents or pass-and-play on one device" */
export function modesPhrase(game: GameMeta): string {
  const labels = game.modes.map((m) => MODE_TEXT[m]).filter(Boolean);
  if (labels.length <= 1) return labels[0] ?? 'a browser';
  return `${labels.slice(0, -1).join(', ')} or ${labels[labels.length - 1]}`;
}

export function gameTitle(game: GameMeta): string {
  const withBrand = `${game.title} — Play Free Online · ${SITE_SHORT}`;
  return withBrand.length <= 62 ? withBrand : `${game.title} — Play Free Online`;
}

/**
 * One unique description per game, built from its own rules copy: the goal
 * sentence first because that is what a search for the game name is asking.
 */
export function gameDescription(game: GameMeta): string {
  const goal = howToFor(game.id)?.goal ?? game.tagline;
  const tail = ` Play ${game.title} free in your browser with ${modesPhrase(game)}.`;
  const full = `${goal}${tail}`;
  if (full.length <= 158) return full;
  const shorter = `${goal} Play ${game.title} free in your browser.`;
  return shorter.length <= 158 ? shorter : trim(shorter, 158);
}

/* ------------------------------------------------------------- structured data */

export function websiteJsonLd(): Record<string, unknown> {
  return {
    '@type': 'WebSite',
    '@id': `${SITE_URL}/#website`,
    url: `${SITE_URL}/`,
    name: SITE_NAME,
    alternateName: SITE_SHORT,
    description: DEFAULT_DESCRIPTION,
    inLanguage: SITE_LANG,
    publisher: { '@id': `${SITE_URL}/#org` },
  };
}

export function webAppJsonLd(): Record<string, unknown> {
  return {
    '@type': 'WebApplication',
    '@id': `${SITE_URL}/#app`,
    name: SITE_NAME,
    url: `${SITE_URL}/`,
    applicationCategory: 'GameApplication',
    applicationSubCategory: 'Puzzle and board games',
    operatingSystem: 'Any (web browser)',
    browserRequirements: 'Requires JavaScript',
    inLanguage: SITE_LANG,
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'GBP' },
    publisher: { '@id': `${SITE_URL}/#org` },
  };
}

export function breadcrumbsJsonLd(trail: { name: string; path: string }[]): Record<string, unknown> {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((step, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: step.name,
      item: absolute(step.path),
    })),
  };
}

export function videoGameJsonLd(game: GameMeta): Record<string, unknown> {
  const how = howToFor(game.id);
  return {
    '@type': 'VideoGame',
    '@id': `${absolute(`/solo/${game.slug}`)}#game`,
    name: game.title,
    url: absolute(`/solo/${game.slug}`),
    description: game.description,
    image: absolute(OG_IMAGE),
    genre: GENRE_LABEL[game.genre],
    gamePlatform: 'Web browser',
    playMode: game.modes.includes('online') ? ['MultiPlayer', 'SinglePlayer'] : ['SinglePlayer'],
    numberOfPlayers: { '@type': 'QuantitativeValue', minValue: game.players[0], maxValue: game.players[1] },
    applicationCategory: 'GameApplication',
    operatingSystem: 'Any (web browser)',
    inLanguage: SITE_LANG,
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'GBP', availability: 'https://schema.org/InStock' },
    publisher: { '@id': `${SITE_URL}/#org` },
    ...(how
      ? {
          howToPlay: {
            '@type': 'HowTo',
            name: `How to play ${game.title}`,
            description: how.goal,
            step: how.steps.map((text, i) => ({
              '@type': 'HowToStep',
              position: i + 1,
              name: `Step ${i + 1}`,
              text,
            })),
          },
        }
      : {}),
  };
}

export function faqJsonLd(items: { q: string; a: string }[]): Record<string, unknown> {
  return {
    '@type': 'FAQPage',
    mainEntity: items.map(({ q, a }) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a },
    })),
  };
}

export function itemListJsonLd(games: GameMeta[]): Record<string, unknown> {
  return {
    '@type': 'ItemList',
    name: 'Every game in the Pikachu arcade',
    numberOfItems: games.length,
    itemListElement: games.map((g, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: g.title,
      url: absolute(`/solo/${g.slug}`),
    })),
  };
}

export function webPageJsonLd(opts: { path: string; title: string; description: string }): Record<string, unknown> {
  return {
    '@type': 'WebPage',
    '@id': `${absolute(opts.path)}#page`,
    url: absolute(opts.path),
    name: opts.title,
    description: opts.description,
    isPartOf: { '@id': `${SITE_URL}/#website` },
    inLanguage: SITE_LANG,
  };
}

/* ---------------------------------------------------------------- route table */

interface PageCopy {
  title: string;
  description: string;
  noindex?: boolean;
  jsonLd?: Record<string, unknown>[];
}

/** Rendered visibly at the bottom of /library and mirrored into FAQPage JSON-LD. */
export const LIBRARY_FAQ: { q: string; a: string }[] = [
  {
    q: 'Do I need an account to play?',
    a: 'No. There are no sign-ups, passwords or email addresses. Your trainer name lives on your own device, and a five-letter room code is all you need to play with someone else.',
  },
  {
    q: 'How do I play with a friend on another device?',
    a: 'Open Play together, create a room, and send the code to your player two. They join with the code, you both ready up, and the match starts. The relay server referees every move, so a dropped connection never loses the game.',
  },
  {
    q: 'Which games can two people play online?',
    a: `${ONLINE_COUNT} of the ${GAMES.length} games are refereed online, including chess, checkers, Four in a Row, Battleship, Lantern Flip, River Stones, Mancala, Wild Eights, Spark Quiz, Word Bomb and Would You Rather. The rest are solo or pass-and-play on one device.`,

  },
  {
    q: 'Is everything free?',
    a: 'Yes. Every game is free to play in the browser, with no ads inside a match, no energy timers and nothing to unlock with money.',
  },
  {
    q: 'Does it work on a phone?',
    a: 'Yes — every board is built for touch first, with tap targets sized for fingers and layouts that reflow down to a 360px screen. Two people can also share one phone in pass-and-play.',
  },
  {
    q: 'What if I lose connection mid-match?',
    a: 'The room keeps your seat. Reopen the room link and the board is exactly where it was, because the server — not the browser — holds the state of the game.',
  },
];

/**
 * The retro shelf is data on disk (`public/retro/roms.json`) read at runtime. The
 * list here is generated from that manifest by `npm run retro:import`, so
 * structured data and the sitemap never list a cartridge that is not playable.
 * A unit test keeps the two in step — see `retro.test.ts`.
 */
export const RETRO_TITLES = RETRO_SHELF;

const STATIC_PAGES: Record<string, PageCopy> = {
  '/': {
    title: 'Pikachu Arcade — Free Two-Player Browser Games',
    description: DEFAULT_DESCRIPTION,
    jsonLd: [
      websiteJsonLd(),
      webAppJsonLd(),
      itemListJsonLd(GAMES),
    ],
  },
  '/library': {
    title: 'All 20 Games — Free to Play in Your Browser',
    description:
      'Browse every game in the arcade: board games, card games, puzzles, quizzes and party games for one or two players. Search, filter by mode or genre, and play instantly.',
    jsonLd: [
      {
        '@type': 'CollectionPage',
        name: 'The game library',
        description: 'Every game in the Pikachu arcade, playable in the browser.',
        hasPart: GAMES.map((g) => ({ '@id': `${absolute(`/solo/${g.slug}`)}#game` })),
      },
      itemListJsonLd(GAMES),
      faqJsonLd(LIBRARY_FAQ),
    ],
  },
  '/together': {
    title: 'Play Together — Random Opponents or a Private Room',
    description:
      'Press “Find an opponent” to be matched with someone who is online right now, or open a private room and share its five-letter code. The server referees every move, so a dropped connection never costs a match.',
  },
  '/solo': {
    title: 'Single-Player Games — Play Against the AI',
    description:
      'Every game works on your own too. Pick a board, choose an AI level from beginner to expert, and play a full match against a patient opponent that never needs a second controller.',
  },
  '/challenges': {
    title: 'Daily Challenges — A Little Goal Every Day',
    description:
      'Three fresh challenges each day, from winning a match to trying a new board. Progress is stored on your device and resets at midnight.',
  },
  '/achievements': {
    title: 'Achievements & Trophies',
    description:
      'Every trophy you have collected across the arcade, how it was earned, and what is still waiting to be unlocked.',
  },
  '/retro': {
    title: 'Retro Arcade — Game Boy Advance in Your Browser',
    description:
      'Play freely redistributable Game Boy Advance homebrew in the browser: Alien Invasion, Cyber Citadel and Simple Frogger, with sound, save states and fullscreen. No BIOS, no account, no commercial ROMs.',
    jsonLd: [
      {
        '@type': 'CollectionPage',
        name: 'Retro Arcade',
        description:
          'Open-source Game Boy Advance cartridges running in an emulator inside the browser, loaded only when a game is launched.',
        about: { '@type': 'SoftwareApplication', name: 'mGBA', applicationCategory: 'Emulator' },
        hasPart: RETRO_TITLES.map((g) => ({ '@type': 'VideoGame', name: g.title, gamePlatform: 'Nintendo Game Boy Advance', applicationCategory: 'Game' })),
      },
    ],
  },
  '/music': {
    title: 'The Sound Room — Music & Ambience',
    description:
      'The arcade soundtrack: soft loops and match ambience, with independent volume controls for music and effects.',
  },
  '/feedback': {
    title: 'Suggest a Game or Report a Bug',
    description:
      'Tell us what to build next, review a game, or report something broken. Feedback is read by the person who made the arcade.',
  },
  '/privacy': {
    title: 'Privacy — No Account, No Tracking',
    description:
      'What this arcade stores (a few keys in your own browser), what a private room sends to the referee server, and the one switch that controls advertising.',
  },
  '/profile': {
    title: 'Your Trainer Profile',
    description: 'Your name, mascot and level — stored only on this device.',
    noindex: true,
  },
  '/settings': {
    title: 'Settings',
    description: 'Motion, sound, quality and privacy settings for this device.',
    noindex: true,
  },
  /* Unlinked, unlisted and noindex: the door is a URL plus a roster row in
     Postgres. Nothing on the public site points here. */
  '/admin': {
    title: 'Maintainer Desk',
    description: 'The back office for the arcade shelf.',
    noindex: true,
  },
};

const NOT_FOUND: PageCopy = {
  title: 'Page not found',
  description: 'That page does not exist in the arcade.',
  noindex: true,
};

export function seoForPath(pathname: string): SeoMeta {
  const path = pathname === '' ? '/' : pathname;
  const base = {
    canonical: absolute(path),
    image: absolute(OG_IMAGE),
    type: 'website' as const,
  };

  // The live-games app view: dynamic room codes must never be indexed.
  if (/^\/room(\/|$)/.test(path)) {
    return {
      ...base,
      title: 'Private Match Room',
      description: 'A private room in the Pikachu arcade.',
      robots: NOINDEX,
      jsonLd: [],
    };
  }

  /* A cartridge player is an app view, not a landing page: it renders nothing
     until ~1.5 MB of emulator has downloaded, so it should not compete for a
     search result with the shelf that explains it. */
  if (/^\/retro\/.+/.test(path)) {
    const known = RETRO_TITLES.find((g) => path === `/retro/${g.id}`);
    return {
      ...base,
      title: known ? `${known.title} — Retro Arcade` : 'Retro Arcade Player',
      description: 'A Game Boy Advance cartridge running in the browser.',
      robots: NOINDEX,
      jsonLd: [],
    };
  }

  const gameMatch = /^\/solo\/([^/]+)\/?$/.exec(path);
  if (gameMatch) {
    const game = gameBySlug(gameMatch[1]);
    if (!game) {
      return { ...base, ...NOT_FOUND, robots: NOINDEX, jsonLd: [] };
    }
    const title = gameTitle(game);
    const description = gameDescription(game);
    return {
      ...base,
      title,
      description,
      robots: INDEX,
      jsonLd: [
        webPageJsonLd({ path: `/solo/${game.slug}`, title, description }),
        videoGameJsonLd(game),
        breadcrumbsJsonLd([
          { name: 'Home', path: '/' },
          { name: 'Library', path: '/library' },
          { name: game.title, path: `/solo/${game.slug}` },
        ]),
      ],
    };
  }

  const page = STATIC_PAGES[path.replace(/\/+$/, '') || '/'];
  if (!page) return { ...base, ...NOT_FOUND, robots: NOINDEX, jsonLd: [] };

  return {
    ...base,
    title: page.title,
    description: page.description,
    robots: page.noindex ? NOINDEX : INDEX,
    jsonLd: [
      webPageJsonLd({ path, title: page.title, description: page.description }),
      ...(page.jsonLd ?? []),
      ...(path === '/'
        ? []
        : [breadcrumbsJsonLd([{ name: 'Home', path: '/' }, { name: page.title.split(' — ')[0], path }])]),
    ],
  };
}

/* ------------------------------------------------------------------ DOM writer */

const upsertMeta = (selector: string, attrs: Record<string, string>) => {
  let el = document.head.querySelector<HTMLMetaElement>(selector);
  if (!el) {
    el = document.createElement('meta');
    document.head.appendChild(el);
  }
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
};

const upsertLink = (rel: string, href: string) => {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (el) {
    if (el.getAttribute('href') === href) return;
  } else {
    el = document.createElement('link');
    el.rel = rel;
    document.head.appendChild(el);
  }
  el.href = href;
};

/**
 * Writes a route's metadata into the live document. Idempotent: called on every
 * navigation, it updates the tags index.html already shipped rather than
 * appending duplicates (which is how SPAs end up with three canonical tags and
 * a confused crawler).
 */
export function applySeo(meta: SeoMeta): void {
  document.title = meta.title;

  upsertMeta('meta[name="description"]', { name: 'description', content: meta.description });
  upsertMeta('meta[name="robots"]', { name: 'robots', content: meta.robots });
  upsertMeta('meta[property="og:title"]', { property: 'og:title', content: meta.title });
  upsertMeta('meta[property="og:description"]', { property: 'og:description', content: meta.description });
  upsertMeta('meta[property="og:url"]', { property: 'og:url', content: meta.canonical });
  upsertMeta('meta[property="og:type"]', { property: 'og:type', content: meta.type });
  upsertMeta('meta[property="og:image"]', { property: 'og:image', content: meta.image });
  upsertMeta('meta[property="og:image:alt"]', { property: 'og:image:alt', content: `${SITE_SHORT} — an arcade for two` });
  upsertMeta('meta[name="twitter:title"]', { name: 'twitter:title', content: meta.title });
  upsertMeta('meta[name="twitter:description"]', { name: 'twitter:description', content: meta.description });
  upsertMeta('meta[name="twitter:image"]', { name: 'twitter:image', content: meta.image });
  upsertLink('canonical', meta.canonical);

  const id = 'seo-jsonld';
  let script = document.getElementById(id) as HTMLScriptElement | null;
  if (!script) {
    script = document.createElement('script');
    script.id = id;
    script.type = 'application/ld+json';
    document.head.appendChild(script);
  }
  script.textContent = JSON.stringify({ '@context': 'https://schema.org', '@graph': meta.jsonLd });
}
