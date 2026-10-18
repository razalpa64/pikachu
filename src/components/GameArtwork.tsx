import { memo } from 'react';

/**
 * GameArtwork — one painted cover per game.
 *
 * These are real illustrations (soft gouache storybook style, shared palette), not
 * shapes drawn in CSS. They live in /public/art/game as 640px WebP, 21–95 KB each,
 * and are decoded off the main thread.
 */
export type ArtKey =
  | 'chess' | 'ttt' | 'c4' | 'memory' | 'reaction'
  | 'checkers' | 'battleship' | 'snake' | 'puzzle' | 'arcade'
  | 'trivia' | 'dare' | 'imposter' | 'detective' | 'cards' | 'sketch';

const ART: Record<ArtKey, { src: string; alt: string; pos?: string }> = {
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
};

const FALLBACK: { src: string; alt: string } = ART.chess;

export const GameArtwork = memo(function GameArtwork({
  artKey, className = '', priority = false, sizes,
}: { artKey: string; className?: string; priority?: boolean; sizes?: string }) {
  const art = ART[artKey as ArtKey] ?? FALLBACK;
  return (
    <img
      src={art.src}
      alt=""
      aria-hidden
      draggable={false}
      decoding="async"
      loading={priority ? 'eager' : 'lazy'}
      sizes={sizes}
      className={`absolute inset-0 w-full h-full object-cover pointer-events-none ${className}`}
      style={{ objectPosition: art.pos ?? 'center' }}
    />
  );
});

/** the same picture, but as meaningful content rather than decoration */
export const GameArtworkFigure = memo(function GameArtworkFigure({
  artKey, className = '', priority = false,
}: { artKey: string; className?: string; priority?: boolean }) {
  const art = ART[artKey as ArtKey] ?? FALLBACK;
  return (
    <img
      src={art.src}
      alt={art.alt}
      draggable={false}
      decoding="async"
      loading={priority ? 'eager' : 'lazy'}
      className={className}
    />
  );
});

export function artSrc(artKey: string) {
  return (ART[artKey as ArtKey] ?? FALLBACK).src;
}

export default GameArtwork;
