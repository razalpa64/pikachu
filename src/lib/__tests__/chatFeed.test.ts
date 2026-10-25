import { describe, expect, it } from 'vitest';
import { buildFeed, reactionFor, timeLabel, unreadCount, GROUP_WINDOW, REACTIONS } from '../chatFeed';
import type { SystemLine } from '../useRoomLines';

const NOW = new Date('2026-05-04T18:00:00Z').getTime();
const MIN = 60_000;

function msg(id: string, senderId: string, text: string, minutesAgo: number, isSelf = false) {
  return {
    id, senderId, from: senderId, text,
    ts: NOW - minutesAgo * MIN,
    isSelf,
  };
}

describe('chat feed — reactions', () => {
  it('recognises every current label', () => {
    for (const r of REACTIONS) expect(reactionFor(r.label)?.label).toBe(r.label);
  });

  it('recognises the older emoji form, so nothing sent before this change breaks', () => {
    expect(reactionFor('⚡ GG!')?.label).toBe('GG!');
    expect(reactionFor('🔥 Nice move!')?.label).toBe('Nice move!');
    // the old build had one inconsistent ellipsis / capitalisation
    expect(reactionFor('🤔 Thinking...')?.label).toBe('Thinking…');
    expect(reactionFor('⚡ Pika Pika!')?.label).toBe('Pika pika!');
  });

  it('leaves ordinary sentences alone', () => {
    expect(reactionFor('gg that was close')).toBeNull();
    expect(reactionFor('')).toBeNull();
    expect(reactionFor('GG')).toBeNull(); // without the bang it is just typing
  });

  it('tolerates surrounding whitespace', () => {
    expect(reactionFor('  GG!  ')?.label).toBe('GG!');
  });
});

describe('chat feed — ordering and grouping', () => {
  it('orders messages and system lines together by time', () => {
    const system: SystemLine[] = [{ id: 's1', text: 'Match started', ts: NOW - 3 * MIN, tone: 'start' }];
    const rows = buildFeed([msg('a', 'p1', 'hi', 4), msg('b', 'p1', 'later', 2)], system, NOW);
    expect(rows.map((r) => r.kind)).toEqual(['msg', 'sys', 'msg']);
    expect(rows.map((r) => r.ts)).toEqual([NOW - 4 * MIN, NOW - 3 * MIN, NOW - 2 * MIN]);
  });

  it('groups consecutive messages from one person', () => {
    const rows = buildFeed([msg('a', 'p1', 'one', 4), msg('b', 'p1', 'two', 3)], [], NOW);
    expect(rows.map((r) => (r.kind === 'msg' ? r.grouped : null))).toEqual([false, true]);
  });

  it('does not group across a different sender', () => {
    const rows = buildFeed([msg('a', 'p1', 'one', 4), msg('b', 'p2', 'two', 3)], [], NOW);
    expect(rows.map((r) => (r.kind === 'msg' ? r.grouped : null))).toEqual([false, false]);
  });

  it('does not group once the window has passed', () => {
    const rows = buildFeed([
      msg('a', 'p1', 'one', 7),
      msg('b', 'p1', 'much later', 7 - GROUP_WINDOW / MIN - 1),
    ], [], NOW);
    expect(rows[1].kind === 'msg' && rows[1].grouped).toBe(false);
    expect(rows[1].divider).not.toBeNull();
  });

  it('never groups a message onto a system line', () => {
    const system: SystemLine[] = [{ id: 's1', text: 'Result', ts: NOW - 3 * MIN }];
    const rows = buildFeed([msg('a', 'p1', 'gg', 4)], system, NOW);
    expect(rows[1].kind).toBe('sys');
  });
});

describe('chat feed — time dividers', () => {
  it('always labels the first row', () => {
    const rows = buildFeed([msg('a', 'p1', 'hello', 1)], [], NOW);
    expect(rows[0].divider).toBe(timeLabel(NOW - MIN, NOW));
  });

  it('adds a divider only when the conversation pauses', () => {
    const rows = buildFeed([
      msg('a', 'p1', 'one', 12),
      msg('b', 'p1', 'two', 11),
      msg('c', 'p1', 'much later', 1),
    ], [], NOW);
    expect(rows[0].divider).not.toBeNull();
    expect(rows[1].divider).toBeNull();
    expect(rows[2].divider).not.toBeNull();
  });

  it('says "Today" for today and the date for older rows', () => {
    expect(timeLabel(NOW, NOW)).toMatch(/^Today · /);
    expect(timeLabel(NOW - 86_400_000, NOW)).toMatch(/^Yesterday · /);
    expect(timeLabel(NOW - 5 * 86_400_000, NOW)).not.toMatch(/Today|Yesterday/);
  });
});

describe('chat feed — attachments to the model', () => {
  it('marks which side a message belongs to', () => {
    const rows = buildFeed([msg('a', 'me', 'mine', 2, true), msg('b', 'them', 'theirs', 1)], [], NOW);
    expect(rows.map((r) => (r.kind === 'msg' ? r.mine : null))).toEqual([true, false]);
  });

  it('attaches the reaction so the renderer only has to draw it', () => {
    const rows = buildFeed([msg('a', 'p1', 'GG!', 1)], [], NOW);
    expect(rows[0].kind === 'msg' && rows[0].reaction?.label).toBe('GG!');
  });

  it('is pure — the same input twice gives identical output', () => {
    const input = [msg('a', 'p1', 'one', 3), msg('b', 'p2', 'two', 2)];
    expect(buildFeed(input, [], NOW)).toEqual(buildFeed(input, [], NOW));
  });

  it('handles an empty room', () => {
    expect(buildFeed([], [], NOW)).toEqual([]);
  });
});

describe('unread badge', () => {
  it('counts what arrived since the reader last looked', () => {
    expect(unreadCount(5, 2)).toBe(3);
    expect(unreadCount(2, 2)).toBe(0);
    // marking read can never go negative if a message list is trimmed
    expect(unreadCount(1, 4)).toBe(0);
  });
});
