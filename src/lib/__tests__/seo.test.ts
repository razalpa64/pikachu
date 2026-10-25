import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { GAMES } from '../../games/registry';
import { howToFor } from '../../games/howToPlay';
import {
  LIBRARY_FAQ,
  OG_IMAGE,
  SITE_URL,
  gameDescription,
  gameTitle,
  seoForPath,
} from '../seo';
import { renderRobots, renderSitemap, sitemapEntries } from '../sitemap';
import { applyNoscriptIndex, renderNoscriptIndex } from '../noscript';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const indexHtml = readFileSync(join(root, 'index.html'), 'utf8');

/** Walk the JSON-LD graph and collect every node of a given @type. */
function nodesOfType(graph: Record<string, unknown>[], type: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    if (obj['@type'] === type) out.push(obj);
    Object.values(obj).forEach(visit);
  };
  graph.forEach(visit);
  return out;
}

describe('page metadata', () => {
  it('gives every game a unique, search-sized title and description', () => {
    const titles = new Set<string>();
    const descriptions = new Set<string>();

    for (const game of GAMES) {
      const title = gameTitle(game);
      expect(title.length, title).toBeLessThanOrEqual(65);
      expect(title).toContain(game.title);
      expect(titles.has(title), `duplicate title: ${title}`).toBe(false);
      titles.add(title);

      const description = gameDescription(game);
      expect(description.length, description).toBeGreaterThan(70);
      expect(description.length, description).toBeLessThanOrEqual(160);
      expect(descriptions.has(description), `duplicate description: ${description}`).toBe(false);
      descriptions.add(description);

      // every description starts from that game's own rules, not a template
      const goal = howToFor(game.id)?.goal;
      if (goal) expect(description.startsWith(goal)).toBe(true);
    }
  });

  it('serves a game page with a VideoGame, HowTo and breadcrumb trail', () => {
    const meta = seoForPath('/solo/chess-arena');
    expect(meta.canonical).toBe(`${SITE_URL}/solo/chess-arena`);
    expect(meta.robots).toContain('index');
    expect(meta.title).toContain('Chess Arena');

    const game = nodesOfType(meta.jsonLd, 'VideoGame')[0];
    expect(game?.name).toBe('Chess Arena');
    expect(game?.url).toBe(`${SITE_URL}/solo/chess-arena`);
    expect((game?.offers as Record<string, string>).price).toBe('0');

    const howTo = nodesOfType(meta.jsonLd, 'HowTo')[0];
    expect(howTo).toBeTruthy();
    expect((howTo.step as unknown[]).length).toBeGreaterThan(2);

    const crumbs = nodesOfType(meta.jsonLd, 'BreadcrumbList')[0];
    expect((crumbs.itemListElement as unknown[]).length).toBe(3);
  });

  it('never indexes a private room, a device-local screen or a typo', () => {
    for (const path of ['/room/ABCDE', '/profile', '/settings', '/nope', '/solo/not-a-game']) {
      const meta = seoForPath(path);
      expect(meta.robots, path).toBe('noindex, follow');
      expect(meta.canonical.startsWith(SITE_URL), path).toBe(true);
      expect(meta.canonical.includes('//solo'), path).toBe(false);
    }
  });

  it('keeps the home graph to things that are actually on the page', () => {
    const meta = seoForPath('/');
    expect(nodesOfType(meta.jsonLd, 'WebSite')).toHaveLength(1);
    expect(nodesOfType(meta.jsonLd, 'ItemList')[0].numberOfItems).toBe(GAMES.length);
    // FAQPage markup is only allowed where the questions are visible: /library
    expect(nodesOfType(meta.jsonLd, 'FAQPage')).toHaveLength(0);
    expect(nodesOfType(seoForPath('/library').jsonLd, 'FAQPage')[0]).toBeTruthy();
  });

  it('mirrors the visible FAQ exactly', () => {
    const faq = nodesOfType(seoForPath('/library').jsonLd, 'FAQPage')[0];
    const entities = faq.mainEntity as { name: string; acceptedAnswer: { text: string } }[];
    expect(entities).toHaveLength(LIBRARY_FAQ.length);
    LIBRARY_FAQ.forEach((item, i) => {
      expect(entities[i].name).toBe(item.q);
      expect(entities[i].acceptedAnswer.text).toBe(item.a);
    });
  });

  it('produces JSON-LD that survives serialisation', () => {
    for (const path of ['/', '/library', '/together', ...GAMES.map((g) => `/solo/${g.slug}`)]) {
      const meta = seoForPath(path);
      const json = JSON.stringify({ '@context': 'https://schema.org', '@graph': meta.jsonLd });
      expect(json).not.toContain('undefined');
      expect((JSON.parse(json) as { '@graph': unknown[] })['@graph'].length).toBeGreaterThan(0);
    }
  });

  it('points every canonical at one https host with no stray slashes', () => {
    for (const game of GAMES) {
      const meta = seoForPath(`/solo/${game.slug}`);
      expect(meta.canonical).toBe(`${SITE_URL}/solo/${game.slug}`);
      expect(meta.image).toBe(`${SITE_URL}${OG_IMAGE}`);
    }
    expect(seoForPath('/').canonical).toBe(`${SITE_URL}/`);
  });
});

describe('sitemap and robots', () => {
  it('lists every live game exactly once, and nothing private', () => {
    const entries = sitemapEntries();
    const paths = entries.map((e) => e.path);

    expect(new Set(paths).size).toBe(paths.length);
    for (const game of GAMES.filter((g) => g.status === 'live')) {
      expect(paths).toContain(`/solo/${game.slug}`);
    }
    expect(paths.some((p) => p.startsWith('/room'))).toBe(false);
    expect(paths).not.toContain('/profile');
    expect(paths).not.toContain('/settings');
  });

  it('renders valid XML with one <url> per entry', () => {
    const xml = renderSitemap(SITE_URL);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml.trim().endsWith('</urlset>')).toBe(true);
    expect((xml.match(/<url>/g) ?? []).length).toBe(sitemapEntries().length);
    expect((xml.match(/<loc>/g) ?? []).length).toBe(sitemapEntries().length);
    expect(xml).not.toContain('undefined');
  });

  it('points crawlers at the sitemap and keeps them out of rooms', () => {
    const txt = renderRobots(SITE_URL);
    expect(txt).toContain(`Sitemap: ${SITE_URL}/sitemap.xml`);
    expect(txt).toContain('Disallow: /room/');
    expect(txt).toContain('Allow: /');
  });
});

describe('the static shell', () => {
  it('has the head tags a non-JS crawler needs', () => {
    expect(indexHtml).toContain('<html lang="en-GB">');
    expect(indexHtml).toContain(`<link rel="canonical" href="${SITE_URL}/" />`);
    expect(indexHtml).toContain('property="og:image"');
    expect(indexHtml).toContain('name="twitter:card" content="summary_large_image"');
    expect(indexHtml).toContain('application/ld+json');
    expect(indexHtml).toContain('<div id="root"></div>');
  });

  it('keeps the committed <noscript> index in sync with the registry', () => {
    // If this fails, run `npm run seo` — a game was added or renamed and the
    // fallback index (what non-JS crawlers read) still lists the old set.
    expect(applyNoscriptIndex(indexHtml, GAMES)).toBe(indexHtml);
    expect(indexHtml).toContain(renderNoscriptIndex(GAMES));
    for (const game of GAMES) {
      expect(indexHtml).toContain(`href="/solo/${game.slug}"`);
    }
  });
});
