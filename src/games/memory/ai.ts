import type { Difficulty } from '../types';
import type { MemState, CardId } from './rules';

/** Imperfect-information opponent: it only "remembers" cards it has actually seen,
 *  with a per-difficulty recall probability and a bounded memory window. */
export interface MemoryBrain { seen: Map<number, CardId>; order: number[]; }
export const newBrain = (): MemoryBrain => ({ seen: new Map(), order: [] });

const RECALL: Record<Difficulty, number> = { beginner: 0.2, casual: 0.45, intermediate: 0.7, advanced: 0.88, expert: 1 };
const CAPACITY: Record<Difficulty, number> = { beginner: 3, casual: 6, intermediate: 10, advanced: 16, expert: 64 };

export function observe(brain: MemoryBrain, index: number, card: CardId, diff: Difficulty) {
  if (Math.random() > RECALL[diff]) return;
  if (!brain.seen.has(index)) brain.order.push(index);
  brain.seen.set(index, card);
  while (brain.order.length > CAPACITY[diff]) {
    const drop = brain.order.shift()!;
    brain.seen.delete(drop);
  }
}

export function pickMemoryFlip(s: MemState, brain: MemoryBrain, _diff: Difficulty): number | null {
  const open = (i: number) => !s.matched.includes(i) && !s.revealed.includes(i);
  const avail: number[] = [];
  for (let i = 0; i < s.deck.length; i++) if (open(i)) avail.push(i);
  if (!avail.length) return null;

  if (s.revealed.length === 1) {
    const target = s.deck[s.revealed[0]];
    for (const [idx, card] of brain.seen) if (open(idx) && card === target) return idx;
  } else {
    // look for a known pair
    const byCard = new Map<CardId, number[]>();
    for (const [idx, card] of brain.seen) {
      if (!open(idx)) continue;
      byCard.set(card, [...(byCard.get(card) ?? []), idx]);
    }
    for (const [, idxs] of byCard) if (idxs.length >= 2) return idxs[0];
  }
  const unknown = avail.filter((i) => !brain.seen.has(i));
  const pool = unknown.length ? unknown : avail;
  return pool[Math.floor(Math.random() * pool.length)];
}
