import { memo } from 'react';
import { ART, FALLBACK, type ArtKey } from './artManifest';

export type { ArtKey };
export { ART };

/**
 * GameArtwork — one painted cover per game.
 *
 * These are real illustrations (soft gouache storybook style, shared palette), not
 * shapes drawn in CSS. They live in /public/art/game as 640px WebP, 21–95 KB each,
 * and are decoded off the main thread.
 */
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
