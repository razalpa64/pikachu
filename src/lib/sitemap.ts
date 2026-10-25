/**
 * Sitemap + robots.txt, generated from the same registry the app renders from.
 *
 * Hand-written sitemaps rot the moment someone adds a game. `npm run seo` (run
 * automatically by `prebuild`) rewrites both files from GAMES, so the day a game
 * ships it is already in the sitemap.
 *
 * Deliberately excluded:
 *   /room/:code   — infinite, private, and noindexed
 *   /profile      — this device's own trainer data
 *   /settings     — no standalone search value
 */

import { GAMES } from '../games/registry';

export interface SitemapEntry {
  path: string;
  changefreq: 'daily' | 'weekly' | 'monthly';
  priority: string;
}

export const STATIC_ENTRIES: SitemapEntry[] = [
  { path: '/', changefreq: 'weekly', priority: '1.0' },
  { path: '/library', changefreq: 'weekly', priority: '0.9' },
  { path: '/together', changefreq: 'monthly', priority: '0.8' },
  { path: '/solo', changefreq: 'monthly', priority: '0.7' },
  { path: '/challenges', changefreq: 'daily', priority: '0.6' },
  { path: '/achievements', changefreq: 'monthly', priority: '0.5' },
  { path: '/music', changefreq: 'monthly', priority: '0.4' },
  { path: '/feedback', changefreq: 'monthly', priority: '0.5' },
];

export function sitemapEntries(): SitemapEntry[] {
  const games: SitemapEntry[] = GAMES.filter((g) => g.status === 'live').map((g) => ({
    path: `/solo/${g.slug}`,
    changefreq: 'monthly',
    priority: '0.8',
  }));
  return [...STATIC_ENTRIES, ...games];
}

/**
 * `lastmod` is optional on purpose: writing the build date on every deploy is a
 * known way to teach Google to ignore the field. Callers that know a real content
 * date can pass one.
 */
export function renderSitemap(origin: string, lastmod?: string): string {
  const urls = sitemapEntries()
    .map(
      (e) => `  <url>
    <loc>${origin}${e.path}</loc>${
      lastmod
        ? `
    <lastmod>${lastmod}</lastmod>`
        : ''
    }
    <changefreq>${e.changefreq}</changefreq>
    <priority>${e.priority}</priority>
  </url>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

export function renderRobots(origin: string): string {
  return `# PIKACHU — an arcade for two
User-agent: *
Allow: /
# Private, one-off and device-local screens: nothing to index, but crawl the
# links inside them so a shared room link is not treated as a dead end.
Disallow: /room/
Disallow: /profile
Disallow: /settings

# Social and preview fetchers need the Open Graph tags, never a rate limit.
User-agent: Twitterbot
Allow: /

User-agent: facebookexternalhit
Allow: /

Sitemap: ${origin}/sitemap.xml
`;
}
