import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { BoardProps } from './types';

/**
 * Which component draws which game, in one place.
 *
 * The room renders from this map; `__tests__/catalog.test.ts` asserts that every
 * game marked online has an entry, so a new multiplayer game cannot ship with a
 * lobby and no board.
 */
export const BOARDS: Record<string, LazyExoticComponent<ComponentType<BoardProps<any>>>> = {
  tictactoe: lazy(() => import('./TicTacToeBoard')),
  connect4: lazy(() => import('./ConnectFourBoard')),
  memory: lazy(() => import('./MemoryBoard')),
  chess: lazy(() => import('./ChessBoard')),
  checkers: lazy(() => import('./CheckersBoard')),
  battleship: lazy(() => import('./BattleshipBoard')),
  cards: lazy(() => import('./WildEightsBoard')),
  trivia: lazy(() => import('./SparkQuizBoard')),
  reaction: lazy(() => import('./ReactionBoard')),
  sketch: lazy(() => import('./SketchBoard')),
  reversi: lazy(() => import('./ReversiBoard')),
  gomoku: lazy(() => import('./GomokuBoard')),
  dots: lazy(() => import('./DotsBoard')),
  mancala: lazy(() => import('./MancalaBoard')),
  wyr: lazy(() => import('./WouldYouRatherBoard')),
  wordbomb: lazy(() => import('./WordBombBoard')),
  bluff: lazy(() => import('./BluffTriviaBoard')),
};
