/**
 * Pure chat-feed logic for the arena chat.
 *
 * Kept out of the component on purpose: grouping, time dividers, chronological
 * ordering and reaction recognition are all rules, and rules deserve tests. The
 * component only decides what a row looks like.
 */
import type { SystemLine, SystemTone } from './useRoomLines';

/* ------------------------------------------------------------------ reactions
   The eight reactions are sent as their plain label ("GG!"), which means the
   relay needs no new message type and older messages that were sent with an
   emoji prefix ("⚡ GG!") still render as the drawn sticker instead of an OS
   emoji. `legacy` covers exactly those.
------------------------------------------------------------------------------ */

export interface ReactionSpec { label: string; legacy?: string }

export const REACTIONS: ReactionSpec[] = [
  { label: 'GG!', legacy: '⚡ GG!' },
  { label: 'Nice move!', legacy: '🔥 Nice move!' },
  { label: 'Good luck!', legacy: '👋 Good luck!' },
  { label: 'Thinking…', legacy: '🤔 Thinking...' },
  { label: 'Rematch?', legacy: '🎯 Rematch?' },
  { label: 'Oops!', legacy: '😅 Oops!' },
  { label: 'Wow!', legacy: '✨ Wow!' },
  { label: 'Pika pika!', legacy: '⚡ Pika Pika!' },
];

const BY_TEXT = new Map<string, ReactionSpec>();
for (const r of REACTIONS) {
  BY_TEXT.set(r.label, r);
  if (r.legacy) BY_TEXT.set(r.legacy, r);
}

/** The reaction a bubble should be drawn as, or null for ordinary text. */
export function reactionFor(text: string): ReactionSpec | null {
  return BY_TEXT.get(text.trim()) ?? null;
}

/* ------------------------------------------------------------------ feed rows */

export interface ChatLike {
  id: string;
  senderId: string;
  from: string;
  text: string;
  ts: number;
  isSelf: boolean;
}

export type FeedRow =
  | {
      kind: 'msg';
      key: string;
      ts: number;
      mine: boolean;
      senderId: string;
      from: string;
      text: string;
      /** true when this continues the previous bubble from the same person */
      grouped: boolean;
      /** a date/time label to print above this row, or null */
      divider: string | null;
      reaction: ReactionSpec | null;
    }
  | {
      kind: 'sys';
      key: string;
      ts: number;
      text: string;
      tone?: SystemTone;
      divider: string | null;
    };

/** Messages from one person spaced closer than this stay in a single group. */
export const GROUP_WINDOW = 5 * 60 * 1000;

export function timeLabel(ts: number, now = Date.now()): string {
  const d = new Date(ts);
  const today = new Date(now);
  const hh = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return `Today · ${hh}`;
  const yesterday = new Date(now - 86_400_000);
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday · ${hh}`;
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} · ${hh}`;
}

/**
 * Merge messages and system lines into one chronological feed, marking which
 * bubbles group together and where a time divider belongs.
 *
 * Rules:
 *  • chronological order, regardless of which array a row came from
 *  • a divider before the first row and whenever more than 5 minutes pass
 *  • a bubble groups with the previous one only if it is from the same sender,
 *    is a message (not a system line) and arrives inside the same 5 minutes
 */
/** Omit that distributes over a union, so each member keeps its own fields. */
type OmitDivider<T> = T extends unknown ? Omit<T, 'divider'> : never;

export function buildFeed(messages: ChatLike[], system: SystemLine[] = [], now = Date.now()): FeedRow[] {
  const raw: Array<{ ts: number; row: OmitDivider<FeedRow> }> = [
    ...system.map((s) => ({
      ts: s.ts,
      row: { kind: 'sys' as const, key: s.id, ts: s.ts, text: s.text, tone: s.tone },
    })),
    ...messages.map((m) => ({
      ts: m.ts,
      row: {
        kind: 'msg' as const,
        key: m.id,
        ts: m.ts,
        mine: m.isSelf,
        senderId: m.senderId,
        from: m.from,
        text: m.text,
        grouped: false,
        reaction: reactionFor(m.text),
      },
    })),
  ];

  // stable sort: equal timestamps keep system lines ahead of messages, which is
  // the order they were produced in (room event, then the chat that followed it)
  raw.sort((a, b) => a.ts - b.ts);

  const out: FeedRow[] = [];
  for (let i = 0; i < raw.length; i++) {
    const cur = raw[i];
    const prev = raw[i - 1];
    const gap = prev ? cur.ts - prev.ts : Infinity;
    const divider = gap > GROUP_WINDOW ? timeLabel(cur.ts, now) : null;

    if (cur.row.kind === 'msg') {
      const grouped = !!prev
        && prev.row.kind === 'msg'
        && prev.row.senderId === cur.row.senderId
        && gap < GROUP_WINDOW;
      out.push({ ...cur.row, grouped, divider });
    } else {
      out.push({ ...cur.row, divider });
    }
  }
  return out;
}

/** Unread count for the phone peek bar. */
export function unreadCount(total: number, read: number): number {
  return Math.max(0, total - read);
}
