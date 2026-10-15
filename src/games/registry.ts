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
    accent: '#c07f0f', artKey: 'chess', status: 'live', serverRefereed: true,
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
    accent: '#d9456f', artKey: 'ttt', status: 'live', serverRefereed: true,
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
    id: 'connect4', slug: 'connect-four', title: 'Drop Four',
    tagline: 'Drop, stack, sneak a win',
    description: 'Four in a row with satisfying, weighty falling discs. Every win direction is checked properly, and the alpha-beta engine reads nine moves ahead when you ask it to.',
    genre: 'strategy', modes: ['ai', 'online', 'local'], players: [1, 2], duration: 6,
    accent: '#c73f5c', artKey: 'c4', status: 'live', serverRefereed: true,
    difficulties: ['beginner', 'casual', 'intermediate', 'advanced', 'expert'],
  },
  {
    id: 'memory', slug: 'memory-match', title: 'Memory Match',
    tagline: 'Who remembers better?',
    description: 'Eighteen hand-drawn cards to turn over. Flip, remember, chain a streak. Play alone against the clock, race each other, or clear the whole board together as a team.',
    genre: 'puzzle', modes: ['solo', 'ai', 'online', 'coop'], players: [1, 2], duration: 5,
    accent: '#2f9c71', artKey: 'memory', status: 'live', serverRefereed: true,
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
    id: 'reaction', slug: 'reaction-duel', title: 'Reaction Duel',
    tagline: 'Blink and you lose',
    description: 'A server-timed reflex duel. The panel hums, waits a random moment, then lights up — first honest press takes the round. Jump the gun and it is a false start.',
    genre: 'party', modes: ['online', 'ai', 'local'], players: [1, 2], duration: 2,
    accent: '#c07f0f', artKey: 'reaction', status: 'live', serverRefereed: true,
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
    accent: '#a9680d', artKey: 'checkers', status: 'live', serverRefereed: true,
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
    accent: '#2f7fc4', artKey: 'battleship', status: 'live', serverRefereed: true,
    difficulties: ['beginner', 'casual', 'intermediate', 'advanced', 'expert'],
  },
  {
    id: 'snake', slug: 'snake-arena', title: 'Snake Arena',
    tagline: 'One more go, promise',
    description: 'Grid-perfect snake in a pastel garden: four skins, speeds that climb until you panic, berries and charges to chase, and a pathfinding rival snake if you want company.',
    genre: 'arcade', modes: ['solo', 'ai', 'local'], players: [1, 2], duration: 4,
    accent: '#2f9c71', artKey: 'snake', status: 'live', serverRefereed: false,
    difficulties: ['beginner', 'casual', 'intermediate', 'advanced', 'expert'],
  },
  {
    id: 'puzzle', slug: 'puzzle-quest', title: 'Puzzle Quest',
    tagline: 'Five little brain teasers',
    description: 'Five quiet puzzle types — slide, lights, lock, echo and sum. Each one is built backwards from a solution that definitely exists, so you are never stuck on a broken board.',
    genre: 'puzzle', modes: ['solo'], players: [1, 1], duration: 7,
    accent: '#8b5fd6', artKey: 'puzzle', status: 'live', serverRefereed: false,
  },
  {
    id: 'arcade', slug: 'electric-arcade', title: 'Volt Runner',
    tagline: 'A run through the meadow',
    description: 'A sunset dash down a country lane: gather charge, duck under hay bales, dodge the birds and grab shields as the waves get faster. Smooth canvas, no stutter.',
    genre: 'arcade', modes: ['solo'], players: [1, 1], duration: 4,
    accent: '#d9456f', artKey: 'arcade', status: 'live', serverRefereed: false,
  },
  {
    id: 'trivia', slug: 'spark-quiz', title: 'Spark Quiz',
    tagline: 'Settle it with facts',
    description: 'Science, history, general knowledge and mental maths, with a rival who actually gets better as you raise the level. Maths questions are generated fresh every round, so that category never runs out.',
    genre: 'party', modes: ['solo', 'ai', 'online', 'local'], players: [1, 2], duration: 6,
    accent: '#c07f0f', artKey: 'trivia', status: 'live', serverRefereed: true,
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
    accent: '#c73f5c', artKey: 'cards', status: 'live', serverRefereed: true,
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
    accent: '#2f9c71', artKey: 'detective', status: 'live', serverRefereed: false,
    difficulties: ['beginner', 'casual', 'intermediate', 'advanced', 'expert'],
  },
  {
    id: 'sketch', slug: 'guess-and-draw', title: 'Guess & Draw',
    tagline: 'One of you draws, the other shouts',
    description: 'You get a word, ninety seconds and a brush; they get the canvas and a text box. Wrong guesses cost nothing, a fast one is worth more, and you swap roles every round. The word never leaves the server until the round is over.',
    genre: 'party', modes: ['online'], players: [2, 2], duration: 10,
    accent: '#37a0d6', artKey: 'sketch', status: 'live', serverRefereed: true,
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
    accent: '#9b7ad6', artKey: 'imposter', status: 'live', serverRefereed: false,
    settings: [
      { key: 'decoy', label: 'Decoy word', type: 'toggle', default: false },
      { key: 'clueRounds', label: 'Clue rounds', type: 'select', default: 1, options: [
        { value: 1, label: 'One round' }, { value: 2, label: 'Two rounds' }, { value: 3, label: 'Three rounds' },
      ] },
    ],
  },
  {
    id: 'dare', slug: 'truth-or-dare', title: 'Truth or Dare',
    tagline: 'Sweet, flirty, or neither',
    description: 'A deck written for two people who already like each other, at three heat levels. The spicy deck is behind its own switch, and every single card can be passed on with no penalty.',
    genre: 'party', modes: ['local'], players: [2, 2], duration: 12,
    accent: '#e05a74', artKey: 'dare', status: 'live', serverRefereed: false,
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
