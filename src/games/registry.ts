import type { GameMeta } from './types';

/**
 * Single source of truth for what exists. The library, search, filters, routes, lobby
 * and the server referee all read from here. Nothing is advertised that cannot be launched.
 */
export const GAMES: GameMeta[] = [
  {
    id: 'chess', slug: 'chess-arena', title: 'Chess Arena',
    tagline: 'Slow games, long evenings',
    description: 'Full-rules chess on a warm little board. Castling, en passant, promotion, every draw rule, optional clocks, and a search engine with five moods — from gentle to merciless.',
    genre: 'strategy', modes: ['ai', 'online', 'local'], players: [1, 2], duration: 14,
    accent: '#96630c', artKey: 'chess', status: 'live', serverRefereed: true,
    difficulties: ['beginner', 'casual', 'intermediate', 'advanced', 'expert'],
    settings: [
      { key: 'timeControl', label: 'Time control', type: 'select', default: 'rapid', options: [
        { value: 'none', label: 'Untimed' }, { value: 'bullet', label: 'Bullet · 1+0' },
        { value: 'blitz', label: 'Blitz · 3+2' }, { value: 'rapid', label: 'Rapid · 10+5' },
        { value: 'classical', label: 'Classical · 30+10' },
      ] },
    ],
  },
  {
    id: 'tictactoe', slug: 'tic-tac-toe-duel', title: 'Tic-Tac-Toe Duel',
    tagline: 'Best of three, loser makes tea',
    description: 'The one everyone knows, rebuilt as a best-of series with drawn win lines, a running tally, and a minimax opponent that genuinely cannot be beaten on 3×3.',
    genre: 'strategy', modes: ['ai', 'online', 'local'], players: [1, 2], duration: 3,
    accent: '#c13d63', artKey: 'ttt', status: 'live', serverRefereed: true,
    difficulties: ['beginner', 'casual', 'intermediate', 'advanced', 'expert'],
    settings: [
      { key: 'size', label: 'Board', type: 'select', default: 3, options: [
        { value: 3, label: '3×3 · three in a row' }, { value: 4, label: '4×4 · four in a row' }, { value: 5, label: '5×5 · four in a row' },
      ] },
      { key: 'bestOf', label: 'Series', type: 'select', default: 3, options: [
        { value: 1, label: 'Single round' }, { value: 3, label: 'Best of 3' }, { value: 5, label: 'Best of 5' },
      ] },
    ],
  },
  {
    id: 'connect4', slug: 'connect-four', title: 'Four in a Row',
    tagline: 'Drop, stack, sneak a win',
    description: 'Four in a row with satisfying, weighty falling discs. Every win direction is checked properly, and the alpha-beta engine reads nine moves ahead when you ask it to.',
    genre: 'strategy', modes: ['ai', 'online', 'local'], players: [1, 2], duration: 6,
    accent: '#c23d5a', artKey: 'c4', status: 'live', serverRefereed: true,
    difficulties: ['beginner', 'casual', 'intermediate', 'advanced', 'expert'],
  },
  {
    id: 'memory', slug: 'memory-match', title: 'Pika Pairs',
    tagline: 'Who remembers better?',
    description: 'Eighteen hand-drawn cards to turn over. Flip, remember, chain a streak. Play alone against the clock, race each other, or clear the whole board together as a team.',
    genre: 'puzzle', modes: ['solo', 'ai', 'online', 'coop'], players: [1, 2], duration: 5,
    accent: '#257c5a', artKey: 'memory', status: 'live', serverRefereed: true,
    difficulties: ['beginner', 'casual', 'intermediate', 'advanced', 'expert'],
    settings: [
      { key: 'size', label: 'Board', type: 'select', default: '4x4', options: [
        { value: '4x3', label: '4×3 · 6 pairs' }, { value: '4x4', label: '4×4 · 8 pairs' },
        { value: '6x4', label: '6×4 · 12 pairs' }, { value: '6x6', label: '6×6 · 18 pairs' },
      ] },
      { key: 'coop', label: 'Co-op mode', type: 'toggle', default: false },
    ],
  },
  {
    id: 'reaction', slug: 'reaction-duel', title: 'Spark Reflex',
    tagline: 'Blink and you lose',
    description: 'A server-timed reflex duel. The panel hums, waits a random moment, then lights up — first honest press takes the round. Jump the gun and it is a false start.',
    genre: 'party', modes: ['online', 'ai', 'local'], players: [1, 2], duration: 2,
    accent: '#96630c', artKey: 'reaction', status: 'live', serverRefereed: true,
    difficulties: ['beginner', 'casual', 'intermediate', 'advanced', 'expert'],
    settings: [
      { key: 'bestOf', label: 'Rounds', type: 'select', default: 5, options: [
        { value: 3, label: 'Best of 3' }, { value: 5, label: 'Best of 5' }, { value: 7, label: 'Best of 7' },
      ] },
    ],
  },
  {
    id: 'checkers', slug: 'checkers', title: 'Checkers Royale',
    tagline: 'Jump, chain, get crowned',
    description: 'English draughts done properly: captures are compulsory, multi-jumps chain, and kings earn their crown. Legal moves light up softly so nobody argues about the rules.',
    genre: 'strategy', modes: ['ai', 'online', 'local'], players: [1, 2], duration: 10,
    accent: '#9c600c', artKey: 'checkers', status: 'live', serverRefereed: true,
    difficulties: ['beginner', 'casual', 'intermediate', 'advanced', 'expert'],
    settings: [
      { key: 'mandatoryCapture', label: 'Mandatory capture', type: 'toggle', default: true },
    ],
  },
  {
    id: 'battleship', slug: 'battleship', title: 'Paper Fleet',
    tagline: 'Hide your little fleet',
    description: 'Place five ships, then go hunting. Your opponent never receives your coordinates — the server keeps them — and the AI hunts with real probability maths, not x-ray vision.',
    genre: 'strategy', modes: ['ai', 'online'], players: [1, 2], duration: 9,
    accent: '#2a72af', artKey: 'battleship', status: 'live', serverRefereed: true,
    difficulties: ['beginner', 'casual', 'intermediate', 'advanced', 'expert'],
  },
  {
    id: 'reversi', slug: 'lantern-flip', title: 'Lantern Flip',
    tagline: 'Turn one coin, flip a whole row',
    description: 'Reversi with warm wooden coins. Every placement must bracket a line of your opponent’s coins, and everything bracketed turns over. Corners can never be taken back — and if you cannot move, you pass.',
    genre: 'strategy', modes: ['ai', 'online', 'local'], players: [2, 2], duration: 10,
    accent: '#257c5a', artKey: 'reversi', status: 'live', serverRefereed: true,
    difficulties: ['beginner', 'casual', 'intermediate', 'advanced', 'expert'],
    settings: [
      { key: 'size', label: 'Board', type: 'select', default: 8, options: [
        { value: 6, label: '6 × 6 · quick' }, { value: 8, label: '8 × 8 · classic' }, { value: 10, label: '10 × 10 · long' },
      ] },
    ],
  },
  {
    id: 'gomoku', slug: 'river-stones', title: 'River Stones',
    tagline: 'Five stones in a line',
    description: 'Gomoku on a wooden board: place a stone, and the first player to line up five — across, down or diagonally — takes it. Simple enough to teach in a sentence, deep enough to lose an evening to.',
    genre: 'strategy', modes: ['ai', 'online', 'local'], players: [2, 2], duration: 8,
    accent: '#9c600c', artKey: 'gomoku', status: 'live', serverRefereed: true,
    difficulties: ['beginner', 'casual', 'intermediate', 'advanced', 'expert'],
    settings: [
      { key: 'size', label: 'Board', type: 'select', default: 15, options: [
        { value: 9, label: '9 × 9 · tight' }, { value: 11, label: '11 × 11' }, { value: 13, label: '13 × 13' }, { value: 15, label: '15 × 15 · classic' },
      ] },
    ],
  },
  {
    id: 'dots', slug: 'dots-and-boxes', title: 'Dots & Boxes',
    tagline: 'Close the box and keep the turn',
    description: 'The pencil-and-paper classic, drawn properly. Join two dots, and any box you finish is yours — with another turn straight after. Hand over the third side of a box and you have just given your opponent a present.',
    genre: 'strategy', modes: ['ai', 'online', 'local'], players: [2, 2], duration: 7,
    accent: '#2a72af', artKey: 'dots', status: 'live', serverRefereed: true,
    difficulties: ['beginner', 'casual', 'intermediate', 'advanced', 'expert'],
    settings: [
      { key: 'size', label: 'Grid', type: 'select', default: 5, options: [
        { value: 4, label: '3 × 3 boxes' }, { value: 5, label: '4 × 4 boxes' }, { value: 6, label: '5 × 5 boxes' },
      ] },
    ],
  },
  {
    id: 'mancala', slug: 'mancala', title: 'Mancala',
    tagline: 'Sow the seeds, steal the store',
    description: 'The oldest board game there is, on a carved wooden tray. Lift a pit, sow the seeds one by one, and watch the two rules that matter: land in your own store and you go again; land in an empty pit and you capture everything opposite.',
    genre: 'strategy', modes: ['ai', 'online', 'local'], players: [2, 2], duration: 6,
    accent: '#96630c', artKey: 'mancala', status: 'live', serverRefereed: true,
    difficulties: ['beginner', 'casual', 'intermediate', 'advanced', 'expert'],
    settings: [
      { key: 'seeds', label: 'Seeds per pit', type: 'select', default: 4, options: [
        { value: 3, label: '3 seeds' }, { value: 4, label: '4 seeds · classic' }, { value: 5, label: '5 seeds' },
      ] },
    ],
  },
  {
    id: 'snake', slug: 'snake-arena', title: 'Snake Arena',
    tagline: 'One more go, promise',
    description: 'Grid-perfect snake in a pastel garden: four skins, speeds that climb until you panic, berries and charges to chase, and a pathfinding rival snake if you want company.',
    genre: 'arcade', modes: ['solo', 'ai', 'local'], players: [1, 2], duration: 4,
    accent: '#257c5a', artKey: 'snake', status: 'live', serverRefereed: false,
    difficulties: ['beginner', 'casual', 'intermediate', 'advanced', 'expert'],
  },
  {
    id: 'ludo', slug: 'ludo-royale', title: 'Ludo Royale',
    tagline: 'Four tokens, one way home',
    description: 'The board you grew up with, built properly: a ring of 52 squares, safe stars, captures that send a token back to its yard, three sixes burning your turn, and home that has to be landed on exactly. Tokens hop square by square, the die tumbles, and every capture is animated.',
    genre: 'strategy', modes: ['ai', 'online', 'local'], players: [1, 2], duration: 12,
    accent: '#b8642f', artKey: 'ludo', status: 'live', serverRefereed: true,
    difficulties: ['beginner', 'casual', 'intermediate', 'advanced', 'expert'],
  },
  {
    id: 'betweenus', slug: 'betweenus', title: 'Between Us',
    tagline: 'Two stations, half the truth each',
    description: 'A two-player co-op puzzle in a bunker, in 3D. One of you stands at the signal wall and can see three glyphs; the other stands at the console with three dials and a legend plate that turns a glyph into a number — and no way to see which glyphs are lit. Talk, translate, set the dials, pull the lever. Three frequencies to carry, three bad pulls and the room goes dark.',
    genre: 'puzzle', modes: ['online'], players: [2, 2], duration: 8,
    accent: '#2f6f7a', artKey: 'betweenUs', status: 'live', serverRefereed: true,
  },
  {
    id: 'carrom', slug: 'carrom-table', title: 'Carrom Table',
    tagline: 'Flick, cut, pocket',
    description: 'Real carrom physics: a proper striker, coins that cut off each other, four corner pockets and a queen you have to cover. Aim with a drag, break the pack, and play the board rather than the animation — every shot is simulated, so a clip off the rail is a clip you can see coming.',
    genre: 'strategy', modes: ['ai', 'online', 'local'], players: [1, 2], duration: 9,
    accent: '#8d3b2f', artKey: 'carrom', status: 'live', serverRefereed: true,
    difficulties: ['beginner', 'casual', 'intermediate', 'advanced', 'expert'],
  },
  {
    id: 'sudoku', slug: 'sudoku-daily', title: 'Sudoku Daily',
    tagline: 'One grid a day, done properly',
    description: 'Proper sudoku: every board is generated and then proved to have exactly one answer, so a guess is never the right move. Pencil marks, undo, three hints and five levels — plus a daily grid with three tasks and a streak that only counts the days you kept clean.',
    genre: 'puzzle', modes: ['solo'], players: [1, 1], duration: 12,
    accent: '#a4641d', artKey: 'sudoku', status: 'live', serverRefereed: false,
    settings: [
      { key: 'level', label: 'Level', type: 'select', default: 'casual', options: [
        { value: 'beginner', label: 'Beginner · 42 clues' }, { value: 'casual', label: 'Casual · 36 clues' },
        { value: 'intermediate', label: 'Inter · 31 clues' }, { value: 'advanced', label: 'Advanced · 27 clues' },
        { value: 'expert', label: 'Expert · 24 clues' },
      ] },
    ],
  },
  {
    id: 'puzzle', slug: 'puzzle-quest', title: 'Puzzle Quest',
    tagline: 'Five little brain teasers',
    description: 'Five quiet puzzle types — slide, lights, lock, echo and sum. Each one is built backwards from a solution that definitely exists, so you are never stuck on a broken board.',
    genre: 'puzzle', modes: ['solo'], players: [1, 1], duration: 7,
    accent: '#8057c5', artKey: 'puzzle', status: 'live', serverRefereed: false,
  },
  {
    id: 'arcade', slug: 'electric-arcade', title: 'Volt Runner',
    tagline: 'A run through the meadow',
    description: 'A sunset dash down a country lane: gather charge, duck under hay bales, dodge the birds and grab shields as the waves get faster. Smooth canvas, no stutter.',
    genre: 'arcade', modes: ['solo'], players: [1, 1], duration: 4,
    accent: '#c13d63', artKey: 'arcade', status: 'live', serverRefereed: false,
  },
  {
    id: 'trivia', slug: 'spark-quiz', title: 'Spark Quiz',
    tagline: 'Settle it with facts',
    description: 'Science, history, geography, animals, people and society, Filipino general knowledge and a little mental maths — with a rival who genuinely gets better as you raise the level. Maths questions are generated fresh every round, so that category never runs out.',
    genre: 'party', modes: ['solo', 'ai', 'online', 'local'], players: [1, 2], duration: 6,
    accent: '#96630c', artKey: 'trivia', status: 'live', serverRefereed: true,
    difficulties: ['beginner', 'casual', 'intermediate', 'advanced', 'expert'],
    settings: [
      { key: 'rounds', label: 'Rounds', type: 'select', default: 10, options: [
        { value: 5, label: '5 questions' }, { value: 10, label: '10 questions' }, { value: 20, label: '20 questions' },
      ] },
      { key: 'timed', label: 'Per-question timer', type: 'toggle', default: true },
    ],
  },
  {
    id: 'cards', slug: 'wild-eights', title: 'Wild Eights',
    tagline: 'Shed your hand first',
    description: 'Crazy Eights with a real deck: follow the suit or the rank, play an eight to rename the suit, stack a two to make them pick up. The opponent saves its eights and times its skips properly.',
    genre: 'strategy', modes: ['ai', 'online', 'local'], players: [1, 2], duration: 8,
    accent: '#c23d5a', artKey: 'cards', status: 'live', serverRefereed: true,
    difficulties: ['beginner', 'casual', 'intermediate', 'advanced', 'expert'],
    settings: [
      { key: 'handSize', label: 'Cards dealt', type: 'select', default: 7, options: [
        { value: 5, label: '5 each' }, { value: 7, label: '7 each' }, { value: 9, label: '9 each' },
      ] },
      { key: 'actionCards', label: 'Action cards', type: 'toggle', default: true },
    ],
  },
  {
    id: 'detective', slug: 'case-files', title: 'Detective Pikachu',
    tagline: 'Who, where, and what was left behind',
    description: 'A fresh mystery every time, generated and then checked: the clues on the board always narrow to exactly one answer, and none of them is filler. Rule names out, then make your accusation.',
    genre: 'puzzle', modes: ['solo'], players: [1, 1], duration: 9,
    accent: '#257c5a', artKey: 'detective', status: 'live', serverRefereed: false,
    difficulties: ['beginner', 'casual', 'intermediate', 'advanced', 'expert'],
  },
  {
    id: 'bingo', slug: 'bingo-night', title: 'Bingo Night',
    tagline: 'Two cards, one drum, one choice',
    description: 'A real 75-ball card each, both face up. On your turn you are shown two balls and call exactly one — the one that finishes your row also fills theirs. Five in a line wins, and the drum never lies.',
    genre: 'party', modes: ['online'], players: [2, 2], duration: 6,
    accent: '#b8860b', artKey: 'bingo', status: 'live', serverRefereed: true,
    settings: [
      { key: 'pattern', label: 'Winning card', type: 'select', default: 'line', options: [
        { value: 'line', label: 'Any line · five in a row' },
        { value: 'full', label: 'Full house · the whole card' },
      ] },
    ],
  },
  {
    id: 'sketch', slug: 'guess-and-draw', title: 'Guess & Draw',
    tagline: 'One of you draws, the other shouts',
    description: 'You get a word, ninety seconds and a brush; they get the canvas and a text box. Wrong guesses cost nothing, a fast one is worth more, and you swap roles every round. The word never leaves the server until the round is over.',
    genre: 'party', modes: ['online'], players: [2, 2], duration: 10,
    accent: '#28759c', artKey: 'sketch', status: 'live', serverRefereed: true,
    settings: [
      { key: 'rounds', label: 'Rounds', type: 'select', default: 6, options: [
        { value: 4, label: 'Four' }, { value: 6, label: 'Six' }, { value: 8, label: 'Eight' },
      ] },
    ],
  },
  {
    id: 'imposter', slug: 'imposter', title: 'Imposter',
    tagline: 'One of you is bluffing',
    description: 'Pass one phone around the table. Everybody sees the secret word except the imposter, who has to blend in on one-word clues alone. Vote, and if you catch them they still get one guess to steal it.',
    genre: 'party', modes: ['local'], players: [3, 8], duration: 7,
    accent: '#7a60a9', artKey: 'imposter', status: 'live', serverRefereed: false,
    settings: [
      { key: 'decoy', label: 'Decoy word', type: 'toggle', default: false },
      { key: 'clueRounds', label: 'Clue rounds', type: 'select', default: 1, options: [
        { value: 1, label: 'One round' }, { value: 2, label: 'Two rounds' }, { value: 3, label: 'Three rounds' },
      ] },
    ],
  },
  {
    id: 'spyfall', slug: 'spyfall', title: 'Spyfall',
    tagline: 'One of you is lying',
    description: 'Everyone is handed a role at the same secret location — except one player, who has no card at all. Ask, answer, and try to work out who is bluffing before the vote. Three to eight players on one phone, cards passed round in private.',
    genre: 'party', modes: ['local'], players: [3, 8], duration: 10,
    accent: '#1d5f70', artKey: 'spyfall', status: 'live', serverRefereed: false,
    difficulties: ['casual'],
    settings: [
      { key: 'rounds', label: 'Rounds', type: 'select', default: 3, options: [
        { value: 1, label: 'One round' }, { value: 3, label: 'Three rounds' }, { value: 5, label: 'Five rounds' },
      ] },
    ],
  },
  {
    id: 'bluff', slug: 'bluff-trivia', title: 'Bluff Trivia',
    tagline: 'Lie convincingly, guess better',
    description: 'Everyone invents a wrong answer to a real question, then everybody votes on which one is true. Two points for finding the truth, one for every vote your own lie steals.',
    genre: 'party', modes: ['ai', 'online'], players: [1, 2], duration: 7,
    accent: '#7b3f5e', artKey: 'bluff', status: 'live', serverRefereed: true,
    difficulties: ['beginner', 'casual', 'intermediate', 'advanced', 'expert'],
    settings: [
      { key: 'rounds', label: 'Rounds', type: 'select', default: 5, options: [
        { value: 3, label: 'Three questions' }, { value: 5, label: 'Five questions' }, { value: 8, label: 'Eight questions' },
      ] },
    ],
  },
  {
    id: 'berry', slug: 'berry-catch', title: 'Berry Catch',
    tagline: 'Keep the basket moving',
    description: 'Ripe berries are falling and the basket does not move itself. Catch the good ones, let the rotten ones drop, and hold a streak for a multiplier that caps at five.',
    genre: 'arcade', modes: ['solo'], players: [1, 1], duration: 3,
    accent: '#8a4b1f', artKey: 'berry', status: 'live', serverRefereed: false,
    difficulties: ['beginner'],
    settings: [
      { key: 'durationMs', label: 'Run', type: 'select', default: 60000, options: [
        { value: 30000, label: '30 seconds' }, { value: 60000, label: '60 seconds' }, { value: 90000, label: '90 seconds' },
      ] },
    ],
  },
  {
    id: 'daily', slug: 'daily-puzzle', title: 'Daily Puzzle',
    tagline: 'One warm-up a day',
    description: 'A 5×5 nonogram, the same grid for everyone, generated from the date — no server, no cache, no peeking. Solve it, keep the streak alive, and share a result that spoils nothing.',
    genre: 'puzzle', modes: ['solo'], players: [1, 1], duration: 3,
    accent: '#1d5f70', artKey: 'daily', status: 'live', serverRefereed: false,
    difficulties: ['beginner'],
  },
  {
    id: 'wordbomb', slug: 'word-bomb', title: 'Word Bomb',
    tagline: 'Keep the fuse moving',
    description: 'A letter is lit and a fuse is burning. Answer with a word that starts with that letter — the last letter of your word becomes the next light — before the clock runs out. Two strikes and it goes off.',
    genre: 'puzzle', modes: ['ai', 'online'], players: [1, 2], duration: 4,
    accent: '#28759c', artKey: 'wordbomb', status: 'live', serverRefereed: true,
    difficulties: ['beginner', 'casual', 'intermediate', 'advanced', 'expert'],
    settings: [
      { key: 'turnMs', label: 'Fuse', type: 'select', default: 20000, options: [
        { value: 30000, label: 'Gentle · 30s' }, { value: 20000, label: 'Normal · 20s' }, { value: 12000, label: 'Cruel · 12s' },
      ] },
      { key: 'rounds', label: 'Turns', type: 'select', default: 12, options: [
        { value: 8, label: 'Eight turns' }, { value: 12, label: 'Twelve turns' }, { value: 20, label: 'Twenty turns' },
      ] },
    ],
  },
  {
    id: 'wyr', slug: 'would-you-rather', title: 'Would You Rather',
    tagline: 'Guess what they would pick',
    description: 'One of you answers honestly, the other bets on the answer, and the roles swap every round. Forty dilemmas, no third option, and a point for every read that lands.',
    genre: 'party', modes: ['ai', 'online'], players: [1, 2], duration: 6,
    accent: '#8f4a2b', artKey: 'wyr', status: 'live', serverRefereed: true,
    difficulties: ['beginner', 'casual', 'intermediate', 'advanced', 'expert'],
    settings: [
      { key: 'rounds', label: 'Rounds', type: 'select', default: 10, options: [
        { value: 6, label: 'Six rounds' }, { value: 10, label: 'Ten rounds' }, { value: 14, label: 'Fourteen rounds' },
      ] },
    ],
  },
  {
    id: 'dare', slug: 'truth-or-dare', title: 'Truth or Dare',
    tagline: 'Sweet, flirty, or neither',
    description: 'A deck written for two people who already like each other, at three heat levels. The spicy deck is behind its own switch, and every single card can be passed on with no penalty.',
    genre: 'party', modes: ['local'], players: [2, 2], duration: 12,
    accent: '#b5495e', artKey: 'dare', status: 'live', serverRefereed: false,
    settings: [
      { key: 'spicy', label: 'Unlock the spicy deck', type: 'toggle', default: false },
    ],
  },
];

export const gameById = (id: string) => GAMES.find((g) => g.id === id);
export const gameBySlug = (slug: string) => GAMES.find((g) => g.slug === slug);
export const liveGames = () => GAMES.filter((g) => g.status === 'live');
export const onlineGames = () => GAMES.filter((g) => g.status === 'live' && g.modes.includes('online'));
/**
 * Everything playable without a second device: solo, against the AI, or
 * pass-and-play. Derived rather than listed, because a hand-maintained list of
 * ids silently drops every game added after it was written.
 */
export const offlineGames = () =>
  GAMES.filter((g) => g.status === 'live' && (['solo', 'ai', 'local'] as const).some((m) => g.modes.includes(m)));

export const GENRE_LABEL: Record<string, string> = {
  strategy: 'Strategy', arcade: 'Arcade', puzzle: 'Puzzle', party: 'Party', racing: 'Racing',
};
export const MODE_LABEL: Record<string, string> = {
  solo: 'Solo', ai: 'vs AI', online: 'Online', local: 'Same device', coop: 'Co-op',
};

export function defaultGameSettings(g: GameMeta | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const s of g?.settings ?? []) out[s.key] = s.default;
  if (g?.id === 'memory') {
    const [c, r] = String(out.size ?? '4x4').split('x').map(Number);
    out.cols = c; out.rows = r;
  }
  // Dots & Boxes is set by its square side; the engine speaks cols/rows
  if (g?.id === 'dots') {
    out.cols = Number(out.size ?? 5);
    out.rows = Number(out.size ?? 5);
  }
  return out;
}

