/**
 * Catalogue integrity.
 *
 * Every surface in this app derives from `GAMES`: the library, the home page, the
 * lobby picker, routing, prefetching and the relay. That is only safe if the registry
 * cannot claim something that does not exist, so this test walks the whole catalogue
 * and refuses to let it drift:
 *
 *   • a game marked online must have a referee that really accepts a first move
 *   • a game marked online must have a board component
 *   • a game playable alone must have a solo view that exists on disk
 *   • every game must have cover art on disk and a rules card
 *   • ids and slugs must be unique, and the difficulty ladder must be complete
 *
 * It is deliberately structural rather than visual: "the card is there but the game
 * crashes" is the failure mode that reaches players.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { GAMES, gameById, gameBySlug, onlineGames, defaultGameSettings } from '../registry';
import { HOW_TO } from '../howToPlay';
import { REFEREES } from '../referees';
import { SOLO_IMPORTERS } from '../views';
import { BOARDS } from '../../components/boards/registry';
import { ART } from '../../components/artManifest';
import type { GameMeta } from '../types';

const ROOT = process.cwd();
const exists = (rel: string) => fs.existsSync(path.join(ROOT, rel));
const SOLO_MODES: GameMeta['modes'] = ['solo', 'ai', 'local', 'coop'];

describe('catalogue', () => {
  it('is big enough to be worth launching, and every entry is complete', () => {
    expect(GAMES.length).toBeGreaterThanOrEqual(20);
    for (const g of GAMES) {
      expect(g.id, 'id').toMatch(/^[a-z0-9]+$/);
      expect(g.slug, `${g.id} slug`).toMatch(/^[a-z0-9-]+$/);
      expect(g.title.length, `${g.id} title`).toBeGreaterThan(2);
      expect(g.tagline.length, `${g.id} tagline`).toBeGreaterThan(4);
      expect(g.description.length, `${g.id} description`).toBeGreaterThan(60);
      expect(g.players[0], `${g.id} seats`).toBeLessThanOrEqual(g.players[1]);
      expect(g.players[0]).toBeGreaterThanOrEqual(1);
      expect(g.duration).toBeGreaterThan(0);
      expect(g.modes.length, `${g.id} modes`).toBeGreaterThan(0);
      expect(g.status).toBe('live');
    }
  });

  it('has no duplicate ids or slugs', () => {
    expect(new Set(GAMES.map((g) => g.id)).size).toBe(GAMES.length);
    expect(new Set(GAMES.map((g) => g.slug)).size).toBe(GAMES.length);
    for (const g of GAMES) {
      expect(gameById(g.id)).toBe(g);
      expect(gameBySlug(g.slug)).toBe(g);
    }
  });

  it('advertises only online games that the relay can actually referee', () => {
    for (const g of onlineGames()) {
      expect(g.serverRefereed, `${g.id} claims online but is not serverRefereed`).toBe(true);
      const rules = REFEREES[g.id];
      expect(rules, `${g.id} has no referee in REFEREES`).toBeTruthy();
      expect(rules.id, `${g.id} referee id mismatch`).toBe(g.id);

      // the referee must produce a playable opening position
      const state = rules.createInitialState(defaultGameSettings(g), 1234);
      expect(state, `${g.id} opening state`).toBeTruthy();
      expect(rules.result(state).over, `${g.id} opens already finished`).toBe(false);
      const starter = rules.currentPlayer(state);
      if (starter === null) {
        /* Some games have no single current player by design: Spark Reflex waits for
           the server's signal, Paper Fleet opens in a simultaneous placement phase,
           Spark Quiz has both seats answering at once. Those are validated per-action
           rather than enumerated, so there is nothing further to assert here — but a
           game that opens that way must still expose an action path. */
        expect(typeof rules.isLegal, `${g.id} has no isLegal`).toBe('function');
        expect(typeof rules.applyMove, `${g.id} has no applyMove`).toBe('function');
        continue;
      }
      const moves = rules.legalMoves(state, starter);
      expect(moves.length, `${g.id} opening legal moves`).toBeGreaterThan(0);
      expect(rules.isLegal(state, starter as 0 | 1, moves[0]), `${g.id} first move legal`).toBe(true);
      const after = rules.applyMove(state, starter as 0 | 1, moves[0]);
      expect(rules.result(after).over, `${g.id} ends on move one`).toBe(false);
      expect(rules.result(after)).toBeTruthy();
    }
  });

  it('has a board component for every online game', () => {
    for (const g of onlineGames()) {
      expect(BOARDS[g.id], `${g.id} has no board in BOARDS`).toBeTruthy();
    }
    for (const id of Object.keys(BOARDS)) {
      expect(gameById(id), `BOARDS has ${id} but the registry does not`).toBeTruthy();
      expect(exists(`src/components/boards/${boardFileFor(id)}`), `${id} board file`).toBe(true);
    }
  });

  it('has a solo view for every game playable without a second device', () => {
    for (const g of GAMES) {
      const alone = SOLO_MODES.some((m) => g.modes.includes(m));
      if (!alone) continue;
      expect(SOLO_IMPORTERS[g.id], `${g.id} is playable alone but has no solo view`).toBeTruthy();
      expect(exists(`src/games/${g.id}/SoloView.tsx`), `${g.id}/SoloView.tsx missing`).toBe(true);
    }
    for (const id of Object.keys(SOLO_IMPORTERS)) {
      expect(gameById(id), `a solo view exists for unknown game ${id}`).toBeTruthy();
      const g = gameById(id)!;
      expect(SOLO_MODES.some((m) => g.modes.includes(m)), `${id} has a solo view but no solo mode`).toBe(true);
    }
  });

  it('has cover art on disk for every game, and no orphan art keys', () => {
    for (const g of GAMES) {
      const art = ART[g.artKey as keyof typeof ART];
      expect(art, `${g.id} artKey ${g.artKey} is not in the art manifest`).toBeTruthy();
      expect(exists(`public${art.src}`), `public${art.src} missing`).toBe(true);
      // a WebP cover is a heavy file: warn-by-test if one is wildly out of family
      const bytes = fs.statSync(path.join(ROOT, `public${art.src}`)).size;
      expect(bytes).toBeGreaterThan(8_000);
      expect(bytes, `${g.artKey} cover is ${(bytes / 1024).toFixed(0)} KB`).toBeLessThan(400_000);
    }
    const used = new Set(GAMES.map((g) => g.artKey));
    for (const key of Object.keys(ART)) {
      expect(used.has(key), `art key ${key} is not used by any game`).toBe(true);
    }
  });

  it('teaches every game how to play it', () => {
    for (const g of GAMES) {
      const how = HOW_TO[g.id];
      expect(how, `${g.id} has no rules card`).toBeTruthy();
      expect(how.goal.length, `${g.id} goal`).toBeGreaterThan(20);
      expect(how.steps.length, `${g.id} steps`).toBeGreaterThanOrEqual(3);
      for (const step of how.steps) expect(step.length, `${g.id} step too short`).toBeGreaterThan(20);
      expect(how.tip, `${g.id} tip`).toBeTruthy();
    }
    for (const id of Object.keys(HOW_TO)) {
      expect(gameById(id), `rules card for unknown game ${id}`).toBeTruthy();
    }
  });

  it('offers all five AI levels wherever an AI is offered', () => {
    const ladder = ['beginner', 'casual', 'intermediate', 'advanced', 'expert'];
    for (const g of GAMES) {
      if (!g.modes.includes('ai')) continue;
      expect(g.difficulties ?? [], `${g.id} difficulty ladder`).toEqual(ladder);
    }
  });

  it('gives every declared setting a default that is legal in its own options', () => {
    for (const g of GAMES) {
      for (const s of g.settings ?? []) {
        if (s.type === 'select') {
          const values = (s.options ?? []).map((o) => String(o.value));
          expect(values, `${g.id}.${s.key} has no options`).not.toHaveLength(0);
          expect(values, `${g.id}.${s.key} default not in options`).toContain(String(s.default));
        } else {
          expect(typeof s.default, `${g.id}.${s.key} toggle default`).toBe('boolean');
        }
      }
      // and the derived settings object must reproduce those defaults
      const derived = defaultGameSettings(g);
      for (const s of g.settings ?? []) expect(derived[s.key]).toEqual(s.default);
    }
  });

  it('keeps two-player rooms legal for every online game', () => {
    for (const g of onlineGames()) {
      expect(g.players[0], `${g.id} needs more than two seats`).toBeLessThanOrEqual(2);
      expect(g.players[1], `${g.id} cannot seat two`).toBeGreaterThanOrEqual(2);
    }
  });
});

/** The board files do not follow the id exactly (cards → WildEightsBoard). */
function boardFileFor(id: string): string {
  const known: Record<string, string> = {
    tictactoe: 'TicTacToeBoard', connect4: 'ConnectFourBoard', memory: 'MemoryBoard',
    chess: 'ChessBoard', checkers: 'CheckersBoard', battleship: 'BattleshipBoard',
    cards: 'WildEightsBoard', trivia: 'SparkQuizBoard', reaction: 'ReactionBoard',
    sketch: 'SketchBoard', reversi: 'ReversiBoard', gomoku: 'GomokuBoard',
    dots: 'DotsBoard', mancala: 'MancalaBoard', wyr: 'WouldYouRatherBoard', wordbomb: 'WordBombBoard', bluff: 'BluffTriviaBoard',
    bingo: 'BingoBoard', carrom: 'CarromBoard',
  };
  return `${known[id] ?? 'Unknown'}.tsx`;
}
