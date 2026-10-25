/**
 * The `<noscript>` index inside index.html.
 *
 * A client-rendered app with JavaScript off is a blank page, and a blank page is
 * what a non-rendering crawler indexes. This block gives those visitors — and
 * those crawlers — the real thing: what the arcade is, every game with its
 * one-line description, and links that can be followed.
 *
 * It is generated, never hand-edited: `npm run seo` rewrites the marked region
 * of index.html from the registry, and a unit test fails if the committed block
 * drifts from what the registry would produce. Content only — no timestamps — so
 * regenerating is idempotent and a clean working tree stays clean.
 */

import type { GameMeta } from '../games/types';

export const NOSCRIPT_START = '<!--seo-noscript:start-->';
export const NOSCRIPT_END = '<!--seo-noscript:end-->';

export const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function renderNoscriptIndex(games: GameMeta[]): string {
  const live = games.filter((g) => g.status === 'live');
  const items = live
    .map((g) => `          <li><a href="/solo/${g.slug}">${escapeHtml(g.title)}</a> — ${escapeHtml(g.tagline)}</li>`)
    .join('\n');

  return `${NOSCRIPT_START}
    <noscript>
      <div style="max-width:44rem;margin:0 auto;padding:1.75rem 1.25rem;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#5c4035;line-height:1.55;background:#fff8ec">
        <h1 style="font-size:1.7rem;margin:0 0 .5rem">Pikachu Arcade — an arcade for two</h1>
        <p style="margin:0 0 1.1rem">
          ${live.length} free browser games for one or two people: board games, card games, puzzles,
          quizzes and party games. Open a private room, share a five-letter code, and play from anywhere —
          no downloads, no accounts, nothing to install. <strong>Turn JavaScript on to play.</strong>
        </p>
        <h2 style="font-size:1.15rem;margin:1.4rem 0 .5rem">Every game</h2>
        <ul style="margin:0 0 1.2rem;padding-left:1.15rem">
${items}
        </ul>
        <h2 style="font-size:1.15rem;margin:1.4rem 0 .5rem">How a match works</h2>
        <p style="margin:0 0 1.1rem">
          One player opens a room and sends the five-letter code to the other. The relay server referees
          every move, so the board survives a dropped connection — reopen the link and the game is exactly
          where you left it. Every game also runs solo against an AI opponent.
        </p>
        <p style="margin:0">
          <a href="/library">Game library</a> ·
          <a href="/together">Play together</a> ·
          <a href="/solo">Single player</a> ·
          <a href="/challenges">Daily challenges</a> ·
          <a href="/feedback">Suggest a game</a>
        </p>
      </div>
    </noscript>
    ${NOSCRIPT_END}`;
}

/** Replaces the marked region of index.html, adding the markers if missing. */
export function applyNoscriptIndex(html: string, games: GameMeta[]): string {
  const block = renderNoscriptIndex(games);
  const start = html.indexOf(NOSCRIPT_START);
  const end = html.indexOf(NOSCRIPT_END);
  if (start !== -1 && end !== -1) {
    return html.slice(0, start) + block + html.slice(end + NOSCRIPT_END.length);
  }
  return html.replace('</body>', `    ${block}\n  </body>`);
}
