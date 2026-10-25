import type { TurnGameRules } from './types';
import { tictactoeRules } from './tictactoe/rules';
import { connect4Rules } from './connect4/rules';
import { memoryRules } from './memory/rules';
import { chessRules } from './chess/rules';
import { checkersRules } from './checkers/rules';
import { battleshipRules } from './battleship/rules';
import { reactionRules } from './reaction/rules';
import { eightsRules } from './cards/rules';
import { quizOnlineRules } from './trivia/online';
import { sketchRules } from './sketch/rules';
import { reversiRules } from './reversi/rules';
import { gomokuRules } from './gomoku/rules';
import { dotsRules } from './dots/rules';
import { mancalaRules } from './mancala/rules';
import { wyrRules } from './wyr/rules';
import { wordBombRules } from './wordbomb/rules';
import { bluffRules } from './bluff/rules';

/**
 * The server's rulebook, in one place.
 *
 * `server/index.ts` referees from this map, and `__tests__/catalog.test.ts` reads it
 * to assert that every game advertised as online actually has a referee. Keeping the
 * list here rather than inline in the server means the two can never disagree — a
 * game that is listed as online but missing from this map cannot ship.
 */
export const REFEREES: Record<string, TurnGameRules<any, any>> = {
  tictactoe: tictactoeRules,
  connect4: connect4Rules,
  memory: memoryRules,
  chess: chessRules,
  checkers: checkersRules,
  battleship: battleshipRules,
  reaction: reactionRules,
  cards: eightsRules,
  trivia: quizOnlineRules,
  sketch: sketchRules,
  reversi: reversiRules,
  gomoku: gomokuRules,
  dots: dotsRules,
  mancala: mancalaRules,
  wyr: wyrRules,
  wordbomb: wordBombRules,
  bluff: bluffRules,
};
