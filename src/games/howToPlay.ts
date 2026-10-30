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
  carrom: {
    goal: 'Pot all nine of your own coins, and take the queen while you are at it.',
    steps: [
      'Press on your own half of the board to slide the striker along your baseline, then pull back from it and let go to flick.',
      'Sink one of your own coins and you shoot again. Sink an opponent’s coin and they get the point, and your turn ends.',
      'Put the striker down a pocket and one of your coins comes back onto the centre spot. Touch nothing at all and that is a foul too.',
      'The queen is only yours once you cover her — sink one of your own coins on the same shot or the next one, or she returns to the middle.',
      'You cannot go out while the queen is still on the board: your last coin comes back until she is taken.',
    ],
    tip: 'Aim at the ghost of the striker behind the coin, on the line from the coin to the pocket — a straight hit at the coin itself just pushes it away from the hole.',
  },
  sudoku: {
    goal: 'Fill the grid so every row, column and 3×3 box holds 1–9 exactly once.',
    steps: [
      'Tap a cell, then a number to place it. Tap Notes first to pencil small candidates instead.',
      'Every board is generated and then checked to have exactly one answer, so a correct board is the only answer — there is nothing to guess.',
      'Errors are counted as you go; turn “Check as I go” off if you would rather not see the red — the count still runs.',
      'Today’s grid has three tasks: finish it, finish it with no wrong entries, and finish inside twelve minutes.',
      'Undo takes a move back, and three hints per board will place one correct number for you.',
    ],
    tip: 'The same digit is highlighted wherever it sits on the board — use it to find the row where a number has only one home left.',
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
  bingo: {
    goal: 'Mark five in a line on your card before they do — or fill the whole card, if you set it that way.',
    steps: [
      'On your turn the drum shows you two balls. Call one; both cards are stamped with it.',
      'The ball you do not call goes back into the drum, so nothing is ever wasted.',
      'Every number is marked for you — the only decision in the game is which ball to call.',
      'A green tick on a ball means it is on your card. A completed line ends it.',
    ],
    tip: 'A ball that finishes your row finishes nothing for them, and a ball that sits on both cards is the one to argue about.',
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
  spyfall: {
    goal: 'Work out where you are and who does not know, before the vote — while the spy tries to blend in and survive long enough to name the location.',
    steps: [
      'Three to eight players, one phone. Each person is dealt a private card: either a role at a secret location, or nothing at all — that person is the spy.',
      'Pass the phone round. Cards are only ever shown to their owner; the screen stays covered between players.',
      'Take turns asking each other questions out loud about the place. Answer in character — specific enough to prove you know it, vague enough that the spy cannot learn it.',
      'When the clock runs out, or someone calls the vote, everyone votes in secret on one device. A clear most-voted player is accused; a tie accuses nobody.',
      'Caught spy: every other player scores a point. Escaped spy: the spy scores two — plus one more if they can name the location in a final guess.',
    ],
    tip: 'Ask questions whose answers only make sense in this place, and answer with something only a local would say. The spy has to bluff every answer at once, so press the person who keeps answering with questions.',
  },
  bluff: {
    goal: 'Write a lie convincing enough to steal a vote, and stay sharp enough to spot the real answer among the inventions.',
    steps: [
      'Every round starts with a real trivia question. Both players invent a wrong answer — something that sounds plausible — and nobody sees the other lie.',
      'The truth and both lies are shuffled into one ballot. Pick the answer you believe; you are not allowed to vote for your own lie.',
      'Voting for the truth is worth two points. Every vote your own lie steals is worth one point to you.',
      'After the vote the ballot opens up: the true answer is marked, and so is whose lie was whose.',
    ],
    tip: 'A lie in the right shape wins: same length and same kind of answer as the truth. A number in the hundreds beats a vague amount, and a near-miss beats an invention.',
  },
  berry: {
    goal: 'Fill the picnic basket with ripe berries for a minute without taking a rotten one, and keep a streak alive for the bonus.',
    steps: [
      'Slide a thumb — or hold the arrow keys — to move the basket under the falling berries.',
      'A ripe berry that lands in the basket scores. Every fourth one in a row is worth an extra point, up to five.',
      'A rotten berry in the basket costs one of three lives. A ripe one you let fall just resets the streak, so patience is cheap.',
      'The run ends when the clock does or the lives are gone; the score is the berries you actually caught.',
    ],
    tip: 'Do not chase every berry. A rotten one falling toward you is not a problem — moving out of its way is always cheaper than catching it.',
  },
  daily: {
    goal: 'Reproduce the hidden picture from its row and column counts alone — one grid a day, the same grid for everyone.',
    steps: [
      'Each number beside a row or under a column is the length of one unbroken run of filled squares, left to right or top to bottom.',
      'Tap a square to fill it. Switch to Mark ✕ and tap to record a square you have proved empty; a header goes quiet once that line is satisfied.',
      'The puzzle is finished the moment every row and column count is met — any picture that fits the clues is accepted.',
      'Finish it to bank the day and grow your streak; miss a day and the streak starts again.',
    ],
    tip: 'Start with the biggest numbers. A 5 in a five-wide line fills the whole line, and any run longer than half the line has squares you can fill for certain.',
  },
  wordbomb: {
    goal: 'Keep the fuse moving: score more words than your opponent before the turns run out, and never be the one holding it when it goes off.',
    steps: [
      'A letter is lit. Type any word that starts with it — three letters or more — and press play.',
      'The last letter of your word becomes the next lit letter, and the fuse passes to the other player.',
      'Miss the clock and you take a strike. Two strikes and the bomb goes off, whatever the score.',
      'The match also ends when the turns run out; whoever has more words then wins.',
    ],
    tip: 'End your words on easy letters — e, t, s, r — and you leave the other person an easy answer but a short clock. Ending on a hard letter is a gamble that pays off more often than it should.',
  },
  wyr: {
    goal: 'Score more points than your opponent by either reading them, or surprising them.',
    steps: [
      'Each round one player is the chooser and the other is the guesser — the roles swap every round.',
      'The chooser picks the option they would genuinely choose. The guesser picks the one they think the chooser will take.',
      'Both answers stay hidden until you have both locked in, then the round is revealed.',
      'A correct guess scores for the guesser; a wrong one scores for the chooser. One point per round.',
    ],
    tip: 'Answer honestly as the chooser. The moment you start picking what you think they expect, the game stops being about you.',
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
