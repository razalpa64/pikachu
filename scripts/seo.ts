/**
 * `npm run seo` — regenerate everything that is derived from the game registry:
 *
 *   public/robots.txt   crawl rules + the sitemap pointer
 *   public/sitemap.xml  every public URL, one per live game
 *   index.html          the <noscript> index between its markers
 *
 * Runs automatically before `npm run build`, so a newly added game is in the
 * sitemap and the non-JS fallback the same day it ships. Output is deterministic
 * (no timestamps), so re-running it does not dirty the working tree.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { GAMES } from '../src/games/registry.ts';
import { SITE_URL } from '../src/lib/seo.ts';
import { STATIC_ENTRIES, renderRobots, renderSitemap } from '../src/lib/sitemap.ts';
import { applyNoscriptIndex } from '../src/lib/noscript.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(root, 'public');

const robotsPath = join(publicDir, 'robots.txt');
writeFileSync(robotsPath, renderRobots(SITE_URL), 'utf8');

const sitemapPath = join(publicDir, 'sitemap.xml');
writeFileSync(sitemapPath, renderSitemap(SITE_URL), 'utf8');

const indexPath = join(root, 'index.html');
writeFileSync(indexPath, applyNoscriptIndex(readFileSync(indexPath, 'utf8'), GAMES), 'utf8');

const live = GAMES.filter((g) => g.status === 'live').length;
console.log(`[seo] robots.txt · sitemap.xml (${live} games + ${STATIC_ENTRIES.length} pages) · noscript index`);
