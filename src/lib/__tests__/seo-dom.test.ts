// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { applySeo, seoForPath } from '../seo';
import { SeoHead } from '../../components/SeoHead';

/**
 * The risk with client-side metadata is not that it is missing — it is that it
 * accumulates: three canonical tags, two descriptions, one stale VideoGame node
 * describing the last page. These tests pin the writer to "update in place".
 */
beforeEach(() => {
  document.head.innerHTML = [
    '<title>Pikachu Arcade — Free Two-Player Browser Games</title>',
    '<meta name="description" content="static default" />',
    '<meta name="robots" content="index, follow" />',
    '<meta property="og:title" content="static default" />',
    '<link rel="canonical" href="https://pikachu-bay.vercel.app/" />',
  ].join('');
});

describe('applySeo', () => {
  it('updates the shipped tags instead of adding duplicates', () => {
    applySeo(seoForPath('/solo/chess-arena'));
    applySeo(seoForPath('/library'));
    applySeo(seoForPath('/solo/chess-arena'));

    expect(document.querySelectorAll('link[rel="canonical"]')).toHaveLength(1);
    expect(document.querySelectorAll('meta[name="description"]')).toHaveLength(1);
    expect(document.querySelectorAll('meta[name="robots"]')).toHaveLength(1);
    expect(document.querySelectorAll('script#seo-jsonld')).toHaveLength(1);

    expect(document.title).toBe(seoForPath('/solo/chess-arena').title);
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href'))
      .toBe('https://pikachu-bay.vercel.app/solo/chess-arena');
    expect(document.querySelector('meta[property="og:url"]')?.getAttribute('content'))
      .toBe('https://pikachu-bay.vercel.app/solo/chess-arena');
  });

  it('replaces the graph, so a game never leaks into the next page', () => {
    applySeo(seoForPath('/solo/chess-arena'));
    const gameGraph = JSON.parse(document.getElementById('seo-jsonld')?.textContent ?? '{}');
    expect(JSON.stringify(gameGraph)).toContain('"VideoGame"');

    applySeo(seoForPath('/together'));
    const pageGraph = JSON.parse(document.getElementById('seo-jsonld')?.textContent ?? '{}');
    expect(JSON.stringify(pageGraph)).not.toContain('"VideoGame"');
    expect(pageGraph['@context']).toBe('https://schema.org');
  });

  it('marks a private room noindex even though the shell is shared', () => {
    applySeo(seoForPath('/room/ABCDE'));
    expect(document.querySelector('meta[name="robots"]')?.getAttribute('content'))
      .toBe('noindex, follow');
  });
});

describe('SeoHead on navigation', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeAll(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  it('rewrites the head when the route changes', async () => {
    const Go = () => {
      const nav = useNavigate();
      return createElement('button', { id: 'go', onClick: () => nav('/solo/chess-arena') }, 'go');
    };
    await act(async () => {
      root.render(
        createElement(MemoryRouter, { initialEntries: ['/library'] },
          createElement(SeoHead), createElement(Go)),
      );
    });

    expect(document.title).toBe(seoForPath('/library').title);
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href'))
      .toBe('https://pikachu-bay.vercel.app/library');

    await act(async () => { (host.querySelector('#go') as HTMLButtonElement).click(); });

    expect(document.title).toContain('Chess Arena');
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href'))
      .toBe('https://pikachu-bay.vercel.app/solo/chess-arena');
    expect(document.querySelectorAll('link[rel="canonical"]')).toHaveLength(1);

    await act(async () => { root.unmount(); });
    host.remove();
  });
});
