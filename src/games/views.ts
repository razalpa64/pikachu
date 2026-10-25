import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { GameMeta } from './types';

/**
 * Single list of solo/same-device views.
 *
 * `Solo.tsx` used to hold this map and `lib/prefetch.ts` held a second copy, which
 * meant a new game could load on navigation and never be warmed — or worse, warm a
 * chunk that no longer existed. Both now read this module.
 */
type SoloViewProps = { game: GameMeta };
type Importer = () => Promise<{ default: ComponentType<SoloViewProps> }>;

export const SOLO_IMPORTERS: Record<string, Importer> = {
  chess: () => import('./chess/SoloView'),
  tictactoe: () => import('./tictactoe/SoloView'),
  connect4: () => import('./connect4/SoloView'),
  memory: () => import('./memory/SoloView'),
  reaction: () => import('./reaction/SoloView'),
  snake: () => import('./snake/SoloView'),
  battleship: () => import('./battleship/SoloView'),
  checkers: () => import('./checkers/SoloView'),
  puzzle: () => import('./puzzle/SoloView'),
  arcade: () => import('./arcade/SoloView'),
  trivia: () => import('./trivia/SoloView'),
  wyr: () => import('./wyr/SoloView'),
  wordbomb: () => import('./wordbomb/SoloView'),
  daily: () => import('./daily/SoloView'),
  berry: () => import('./berry/SoloView'),
  bluff: () => import('./bluff/SoloView'),
  spyfall: () => import('./spyfall/SoloView'),
  dare: () => import('./dare/SoloView'),
  imposter: () => import('./imposter/SoloView'),
  detective: () => import('./detective/SoloView'),
  cards: () => import('./cards/SoloView'),
  reversi: () => import('./reversi/SoloView'),
  gomoku: () => import('./gomoku/SoloView'),
  dots: () => import('./dots/SoloView'),
  mancala: () => import('./mancala/SoloView'),
};

export const SOLO_VIEWS: Record<string, LazyExoticComponent<ComponentType<SoloViewProps>>> =
  Object.fromEntries(Object.entries(SOLO_IMPORTERS).map(([id, load]) => [id, lazy(load)]));
