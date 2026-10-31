import { describe, expect, it } from 'vitest';
import { diffCues, type Snap } from '../matchCues';

/**
 * The room's soundtrack, tested where it can be: `diffCues` is the pure half of
 * `useMatchCues`, so a state change can be asserted without a renderer.
 *
 * The cases that matter are the ones that were silent before this file existed —
 * the two board games (ludo, carrom-adjacent bingo) whose rooms shared a canvas
 * that had no audio of its own.
 */

const snap = (p: Partial<Snap>): Snap => ({ moves: 0, secondary: 0, tertiary: 0, tag: '', ...p });
const none = snap({});

describe('diffCues', () => {
  it('keeps every game silent when nothing changed', () => {
    for (const id of ['ludo', 'bingo', 'tictactoe', 'chess', 'memory', 'mancala']) {
      expect(diffCues(id, none, none, 0, 0), id).toEqual([]);
    }
  });

  it('voices a ludo roll and then the hop it buys', () => {
    const rolled = snap({ tag: '3|roll:0' });
    expect(diffCues('ludo', none, rolled, 0, 0)).toEqual(['die']);
    const hopped = snap({ moves: 1, tag: '3|move:0' });
    expect(diffCues('ludo', rolled, hopped, 0, 0)).toEqual(['hop']);
  });

  it('uses a different cue for each ludo event', () => {
    const base = snap({ moves: 4, tag: '6|move:1' });
    const after = (kind: string) => snap({ moves: 5, tag: '6|' + kind });
    expect(diffCues('ludo', base, after('capture:0'), 0, 0)).toEqual(['capture']);
    expect(diffCues('ludo', base, after('home:2'), 0, 0)).toEqual(['coin']);
    expect(diffCues('ludo', base, after('out:3'), 0, 0)).toEqual(['coin']);
    expect(diffCues('ludo', base, after('burn:1'), 0, 0)).toEqual(['error']);
    expect(diffCues('ludo', base, after('pass:0'), 0, 0)).toEqual(['cue']);
  });

  it('does not re-voice the same ludo event', () => {
    const s = snap({ moves: 2, tag: '5|capture:1' });
    expect(diffCues('ludo', s, s, 0, 0)).toEqual([]);
  });

  it('calls a bingo ball, and rings the bell for a completed line', () => {
    const first = snap({ moves: 1, secondary: 12, tertiary: 0 });
    expect(diffCues('bingo', none, first, 0, 0)).toEqual(['flip']);
    const line = snap({ moves: 2, secondary: 14, tertiary: 1 });
    expect(diffCues('bingo', first, line, 0, 0)).toEqual(['coin']);
  });

  it('still separates a chess capture from a quiet move', () => {
    expect(diffCues('chess', none, snap({ moves: 1, tag: 'Nf3' }), 0, 0)).toEqual(['move']);
    expect(diffCues('chess', none, snap({ moves: 1, tag: 'Bxc6' }), 0, 0)).toEqual(['capture']);
    expect(diffCues('chess', none, snap({ moves: 1, tag: 'Qh5+' }), 0, 0)).toEqual(['check']);
  });

  it('sounds a memory miss only once per miss', () => {
    const miss = snap({ moves: 2, tag: 'miss' });
    expect(diffCues('memory', snap({ moves: 1 }), miss, 0, 0)).toEqual(['flip', 'miss']);
    expect(diffCues('memory', miss, snap({ moves: 3, tag: 'miss' }), 0, 0)).toEqual(['flip']);
  });

  it('only cues a draw when my own hand grew', () => {
    const s = snap({ moves: 1 });
    expect(diffCues('cards', none, s, 6, 5)).toEqual(['drop', 'pickup']);
    expect(diffCues('cards', none, s, 5, 6)).toEqual(['drop']);
  });

  it('says nothing for a game it does not know', () => {
    expect(diffCues('betweenus', none, snap({ moves: 9 }), 0, 0)).toEqual([]);
  });
});
