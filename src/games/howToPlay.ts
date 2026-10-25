/**
 * How to play — one short card per game.
 *
 * Every board here enforces its own rules, which is exactly why a page of rules is
 * needed somewhere: the game will refuse a move but it cannot explain itself. These
 * are written to be read in fifteen seconds, in the same voice as the rest of the
 * app, and they are the only rulebook a new player ever has to find.
 *
 * `goal` is one sentence. `steps` are the turn. `tip` is the one thing that makes
 * the game click — the thing you would say if you were teaching it across a table.
 */
export interface HowTo {
  goal: string;
  steps: string[];
  tip?: string;
}

export const HOW_TO: Record<string, HowTo> = {
  chess: {
    goal: 'Checkmate the opposing king — attack it so it cannot escape.',
    steps: [
      'Tap one of your pieces, then tap a highlighted square to move.',
      'Legal moves are highlighted for you; the server checks every one.',
      'Castling, en passant and promotion all work. A pawn reaching the far rank lets you choose.',
      'Clocks are optional. Resign or offer a draw from the bar above the board.',
    ],
    tip: 'Get your knights and bishops out before you go hunting. The engine punishes an early queen raid.',
  },
  tictactoe: {
    goal: 'Line up three marks in a row, column or diagonal.',
    steps: [
      'Take turns tapping any empty square.',
      'On 4×4 and 5×5 the target is four in a row.',
      'A drawn board simply resets — the series keeps score across rounds.',
    ],
    tip: 'Take the centre. On 3×3 against the top level, a draw is the best either of you can do.',
  },
  connect4: {
    goal: 'Get four discs in a line — across, down or diagonally.',
    steps: [
      'Pick a column; your disc drops to the lowest free slot.',
      'Columns that are full cannot be played.',
      'Four in a row wins immediately; a full board is a draw.',
    ],
    tip: 'The middle column touches more winning lines than any other. Fight for it and watch the diagonals.',
  },
  memory: {
    goal: 'Find more matching pairs than your opponent — or clear the board together in co-op.',
    steps: [
      'Flip two cards. A pair stays face up and you keep the turn.',
      'A miss turns both cards back and passes the turn.',
      'Co-op mode counts one shared score instead of two.',
    ],
    tip: 'Say the card positions out loud to yourself. The board is only as good as your memory of it.',
  },
  reaction: {
    goal: 'Press first once the panel lights up. Best of the set wins.',
    steps: [
      'Wait through the countdown — nothing is clickable yet.',
      'The instant it turns gold, hit your button.',
      'Press early and it counts as a false start, which costs you the round.',
      'Rounds are timed by the server, so both of you are measured the same way.',
    ],
    tip: 'Do not chase the light. Rest your finger and react to it — anticipation is what causes false starts.',
  },
  checkers: {
    goal: 'Capture every opposing piece, or leave them with no legal move.',
    steps: [
      'Pieces move one square diagonally forward on the dark squares.',
      'Captures are compulsory: if a jump is available, you must take it.',
      'Multi-jumps chain in one turn.',
      'Reach the far rank and your piece is crowned a king, which can move backwards.',
    ],
    tip: 'Keep your back row together. An open lane to your king is how most games are lost.',
  },
  battleship: {
    goal: 'Sink all five of your opponent’s ships before they sink yours.',
    steps: [
      'Place each ship on your own grid — rotate it before you commit.',
      'Take turns calling a square on the enemy grid. Hit, miss and sunk are all reported.',
      'The command ship is three squares long; the others are shorter.',
      'Your fleet never leaves your device: the server keeps it and only tells your opponent where you are.',
    ],
    tip: 'Fire on a checkerboard pattern first. Every ship is at least two long, so you cannot miss one for long.',
  },
  reversi: {
    goal: 'Finish with more coins on the board than your opponent.',
    steps: [
      'Place a coin so that one or more of your opponent’s coins sit in a straight line between it and one of yours.',
      'Every coin bracketed like that turns over to your colour.',
      'If you have no legal move you pass, and the other player moves again.',
      'The game ends when neither of you can move — empty squares may still be there.',
    ],
    tip: 'Corners can never be taken back. The four squares diagonally next to a corner hand the corner to your opponent.',
  },
  gomoku: {
    goal: 'Be first to line up five stones in a row — any direction.',
    steps: [
      'Take turns placing one stone on any empty intersection.',
      'Five or more in a straight line wins immediately.',
      'A full board with no line is a draw, which in practice never happens.',
    ],
    tip: 'A line with two open ends is worth far more than one with a single end. Build threats two at a time.',
  },
  dots: {
    goal: 'Claim more boxes than your opponent before the grid is full.',
    steps: [
      'Draw one line between two neighbouring dots.',
      'Close the fourth side of a box and it becomes yours — then you move again.',
      'When every box is claimed, the player holding more wins.',
    ],
    tip: 'Never hand over the third side of a box unless it buys you something bigger. Long chains are decided by whoever is forced to open first.',
  },
  mancala: {
    goal: 'Collect more seeds in your store than your opponent.',
    steps: [
      'Lift every seed from one of your six pits and sow them one per pit, counter-clockwise.',
      'The last seed landing in your own store means you go again.',
      'The last seed landing in an empty pit of yours captures that seed plus everything in the pit opposite.',
      'When one side runs dry, the seeds left on the other side go into that player’s store.',
    ],
    tip: 'Watch the pit opposite your own empty ones. That gap is a trap you can set as well as fall into.',
  },
  snake: {
    goal: 'Collect charge and grow, without running into a wall or yourself.',
    steps: [
      'Steer with the arrow keys, WASD or a swipe. Nothing moves until you do.',
      'Berries and charge bolts add points; longer snakes are faster.',
      'Turn on wrap walls if you would rather not lose to an edge.',
      'Space pauses. The rival snake, when enabled, pathfinds towards the food.',
    ],
    tip: 'Stay near the middle of the meadow. Corners kill more runs than speed does.',
  },
  puzzle: {
    goal: 'Solve the puzzle in as few moves as you can.',
    steps: [
      'Slide: shuffle the numbered tiles back into order.',
      'Lights: tap a lamp to toggle it and its neighbours; turn them all off.',
      'Lock: guess the code and use the pegs to work out which digits are right.',
      'Echo: watch the sequence, then repeat it. Sum: fill the grid so rows and columns match their totals.',
    ],
    tip: 'Every puzzle is generated backwards from a solved board, so there is always a solution — and never a guess.',
  },
  arcade: {
    goal: 'Run as far as you can, collecting charge on the way.',
    steps: [
      'Jump the things on the ground; duck under the things in the air.',
      'Charge pickups add to your score and shields buy you one mistake.',
      'The lane gets faster the longer you last.',
    ],
    tip: 'Jump late. A jump that starts early lands you right on top of the next wall.',
  },
  trivia: {
    goal: 'Answer more questions correctly than your opponent.',
    steps: [
      'Four answers per question. Tap one — you only get one try.',
      'The per-question timer can be switched off; faster answers score more when it is on.',
      'Maths questions are generated fresh every round.',
      'A streak adds points, and a wrong answer resets it.',
    ],
    tip: 'Answer quickly when you are sure and slowly when you are not: the timer only ever costs you points, never correctness.',
  },
  cards: {
    goal: 'Be the first to get rid of every card in your hand.',
    steps: [
      'Play a card that matches the suit or the rank on top of the pile, or draw one.',
      'An eight is wild: play it and name the suit you want next.',
      'A two makes the next player pick up two, unless they stack one of their own.',
      'Skip cards jump the next player.',
    ],
    tip: 'Hold your eights. They are the only way out when the pile is the wrong colour and the wrong number.',
  },
  detective: {
    goal: 'Work out the suspect, the place and the object, then make one accusation.',
    steps: [
      'Read every clue on the case board.',
      'Use the grid to rule candidates out — tap to mark a possibility as impossible.',
      'When exactly one triple is left, accuse it.',
      'A wrong accusation costs you the case.',
    ],
    tip: 'Every clue on the board is load-bearing. If you have not used one, you are missing something.',
  },
  sketch: {
    goal: 'Guess the word while they draw — then swap and return the favour.',
    steps: [
      'The drawer sees a word and ninety seconds on the clock.',
      'The guesser types guesses; wrong guesses cost nothing.',
      'Guess it quickly for more points, then the two of you swap roles.',
      'The word never reaches the guesser’s device until the round is over.',
    ],
    tip: 'Draw the shape of the thing before the detail. A plain outline reads faster than a careful drawing.',
  },
  imposter: {
    goal: 'Find the imposter — or, if you are the imposter, blend in and steal the guess.',
    steps: [
      'Pass the phone around so everybody sees the secret word, except the imposter.',
      'One word each, going round the table, describing the word without saying it.',
      'Debate, then vote for who you think is bluffing.',
      'If the imposter is caught, they get one guess at the word. Right guess, they win anyway.',
    ],
    tip: 'The imposter should give a word that could belong to any of a dozen answers. Vague, never wrong.',
  },
  dare: {
    goal: 'Two people, a deck of cards, and no score to keep.',
    steps: [
      'Draw a card: truth or dare.',
      'Every card can be passed with no penalty, and the pass button is always there.',
      'Three heat levels; the spicier deck is behind its own switch and stays off until you turn it on.',
    ],
    tip: 'The point is the conversation, not the card. Follow the ones that make you laugh.',
  },
};

export const howToFor = (id: string): HowTo | undefined => HOW_TO[id];
