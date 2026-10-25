/**
 * The shelf that was asked for.
 *
 * `catalog.test.ts` proves the catalogue is internally consistent. This one is
 * narrower and more personal: it names the ten games that were requested, one by
 * one, and refuses to let any of them quietly stop existing, lose its cover, lose
 * its rules card, or lose the screen that makes it playable.
 *
 * A game can be satisfied in exactly two ways here, and nothing else counts:
 *
 *   • a solo/offline game needs a real `SoloView` on disk *and* an importer in
 *     `views.ts` — a registry entry alone is a promise, not a game;
 *   • an online game needs a board component *and* the referee the relay runs,
 *     because "online" without a referee is a room that cannot start.
 *
 * If a future tidy-up removes one of these ten, this file fails and says which.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { GAMES, gameById, defaultGameSettings, onlineGames } from '../registry';
import { HOW_TO } from '../howToPlay';
import { REFEREES } from '../referees';
import { SOLO_IMPORTERS } from '../views';
import { BOARDS } from '../../components/boards/registry';
import { ART } from '../../components/artManifest';

const ROOT = process.cwd();
const exists = (rel: string) => fs.existsSync(path.join(ROOT, rel));
const SOLO_MODES = new Set(['solo', 'ai', 'local', 'coop']);

/** The ten games, by the name they are asked for and the id they answer to. */
const REQUESTED = [
  { id: 'wyr', asked: 'Would You Rather', needs: 'online' },
  { id: 'memory', asked: 'Pika Pairs', needs: 'online' },
  { id: 'wordbomb', asked: 'Word Bomb', needs: 'online' },
  { id: 'reaction', asked: 'Spark Reflex', needs: 'online' },
  { id: 'sketch', asked: 'Guess & Draw', needs: 'online' },
  { id: 'bluff', asked: 'Bluff Trivia', needs: 'online' },
  { id: 'spyfall', asked: 'Spyfall', needs: 'solo' },
  { id: 'connect4', asked: 'Four in a Row', needs: 'online' },
  { id: 'berry', asked: 'Berry Catch', needs: 'solo' },
  { id: 'daily', asked: 'Daily Puzzle', needs: 'solo' },
] as const;

describe('the ten requested games', () => {
  it('are all in the registry, live, and named as they were asked for', () => {
    for (const { id, asked } of REQUESTED) {
      const game = gameById(id);
      expect(game, `${asked} (${id}) is missing from the registry`).toBeTruthy();
      expect(game!.status, `${asked} is not live`).toBe('live');
      expect(game!.title.toLowerCase(), `${asked} lost its name`).toBe(asked.toLowerCase());
    }
    expect(new Set(REQUESTED.map((g) => g.id)).size, 'a game is listed twice').toBe(REQUESTED.length);
  });

  it('each have a cover, a rules card, and a description long enough to be honest', () => {
    for (const { id, asked } of REQUESTED) {
      const game = gameById(id)!;
      const art = ART[game.artKey as keyof typeof ART];
      expect(art, `${asked} has no art entry`).toBeTruthy();
      expect(exists(`public${art.src}`), `${asked} cover is missing at public${art.src}`).toBe(true);

      const card = HOW_TO[id];
      expect(card, `${asked} has no how-to card`).toBeTruthy();
      expect(card.goal.length, `${asked} goal`).toBeGreaterThan(20);
      expect(card.steps.length, `${asked} steps`).toBeGreaterThanOrEqual(3);
      expect(game.description.length, `${asked} description`).toBeGreaterThan(60);
    }
  });

  it('each have somewhere to actually play', () => {
    for (const { id, asked, needs } of REQUESTED) {
      const game = gameById(id)!;

      if (needs === 'online') {
        expect(game.serverRefereed, `${asked} claims a mode the relay cannot referee`).toBe(true);
        expect(onlineGames().some((g) => g.id === id), `${asked} is not offered online`).toBe(true);
        expect(REFEREES[id], `${asked} has no referee`).toBeTruthy();
        expect(BOARDS[id], `${asked} has no board component`).toBeTruthy();

        const state = REFEREES[id].createInitialState(defaultGameSettings(game), 20261025);
        expect(REFEREES[id].result(state).over, `${asked} opens already over`).toBe(false);
      }

      if (game.modes.some((m) => SOLO_MODES.has(m))) {
        expect(SOLO_IMPORTERS[id], `${asked} has a solo mode but no solo view`).toBeTruthy();
      }
    }
  });

  it('does not leave the rest of the library behind', () => {
    // The ten were added to a working arcade; nothing pre-existing may vanish.
    const earlier = [
      'chess', 'tictactoe', 'checkers', 'battleship', 'reversi', 'gomoku', 'dots',
      'mancala', 'snake', 'puzzle', 'arcade', 'trivia', 'cards', 'detective', 'imposter', 'dare',
    ];
    for (const id of earlier) {
      expect(gameById(id), `${id} was removed while adding games`).toBeTruthy();
    }
    expect(GAMES.length, 'the library shrank').toBeGreaterThanOrEqual(26);
  });
});
