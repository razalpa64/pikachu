/**
 * Game cover art, in one table.
 *
 * Each key is a painted 640px WebP in `/public/art/game`. The table lives outside the
 * component so it can be imported by tests (a missing file is a broken card, not a
 * missing image) without pulling React into that import graph.
 */
export type ArtKey =
  | 'chess' | 'ttt' | 'c4' | 'memory' | 'reaction'
  | 'checkers' | 'battleship' | 'snake' | 'puzzle' | 'arcade'
  | 'trivia' | 'dare' | 'imposter' | 'detective' | 'cards' | 'sketch'
  | 'reversi' | 'gomoku' | 'dots' | 'mancala' | 'wyr' | 'wordbomb';

export const ART: Record<ArtKey, { src: string; alt: string; pos?: string }> = {
  chess:      { src: '/art/game/chess.webp',      alt: 'A pastel chess set on a honey chequerboard' },
  ttt:        { src: '/art/game/ttt.webp',        alt: 'A crayon noughts-and-crosses grid filled with hearts and stars' },
  c4:         { src: '/art/game/c4.webp',         alt: 'A wooden connect-four frame with pink and yellow discs' },
  memory:     { src: '/art/game/memory.webp',     alt: 'Scattered cards with heart-patterned backs, two matched face up' },
  reaction:   { src: '/art/game/reaction.webp',   alt: 'A pastel stopwatch ringing beside three countdown lamps' },
  checkers:   { src: '/art/game/checkers.webp',   alt: 'A cosy draughts board with crowned pieces beside a teacup' },
  battleship: { src: '/art/game/battleship.webp', alt: 'A paper sea chart with little folded boats' },
  snake:      { src: '/art/game/snake.webp',      alt: 'A ribbon trail winding through a strawberry garden' },
  puzzle:     { src: '/art/game/puzzle.webp',     alt: 'A wooden sliding-tile tray with a tile floating free' },
  arcade:     { src: '/art/game/arcade.webp',     alt: 'A candy running lane heading into the sunset' },
  trivia:     { src: '/art/game/trivia.webp',     alt: 'Quiz cards fanned beside a brass bell and a glowing bulb' },
  dare:       { src: '/art/game/dare.webp',       alt: 'A bottle mid-spin on a picnic blanket at dusk' },
  imposter:   { src: '/art/game/imposter.webp',   alt: 'A ring of pastel masks with one turned face down' },
  detective:  { src: '/art/game/detective.webp',  alt: 'A case folder, magnifying glass and pinned cards on red thread' },
  cards:      { src: '/art/game/cards.webp',      alt: 'A fan of cards on rose felt beside a draw pile' },
  sketch:     { src: '/art/game/sketch.webp',     alt: 'A wooden easel holding a half-drawn crayon cat, with question-mark speech bubbles' },
  reversi:    { src: '/art/game/reversi.webp',    alt: 'A mint-green reversi board half-filled with gold and rose coins' },
  gomoku:     { src: '/art/game/gomoku.webp',     alt: 'A wooden gomoku board with gold and rose pebbles in a long diagonal' },
  dots:       { src: '/art/game/dots.webp',       alt: 'A pencil dots-and-boxes grid with a few boxes coloured in' },
  mancala:    { src: '/art/game/mancala.webp',    alt: 'A carved wooden mancala tray with little seeds in its pits' },
  wyr:        { src: '/art/game/wyr.webp',        alt: 'Two illustrated cards side by side on a picnic cloth, one golden and one rose' },
  wordbomb:   { src: '/art/game/wordbomb.webp',   alt: 'A round gold-fused bomb resting on a pile of letter tiles' },
};


export const FALLBACK = ART.chess;
