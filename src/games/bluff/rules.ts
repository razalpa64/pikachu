/**
 * Bluff Trivia — everyone lies, then everyone votes.
 *
 * The loop, per round:
 *
 *   write   both players invent a *convincing wrong answer* to a real question
 *   vote    the truth and the two inventions are shuffled together; each player
 *           picks the one they believe, and may not vote for their own lie
 *   reveal  the ballot is opened up and scored
 *
 * Scoring is deliberately lopsided toward finding the truth, because a game
 * where lying well beats knowing anything is a game that rewards noise:
 *
 *   • **+2** for voting for the real answer
 *   • **+1** to an author for every vote their invention stole
 *
 * Two things are enforced here rather than in the UI, because a client cannot be
 * trusted with either:
 *
 *   1. **The truth is never sent while a vote is open.** `redact` strips the
 *      question's answer array and the option owners; a player holding the state
 *      sees three strings and no way to tell which one is real.
 *   2. **An empty round cannot hang.** Every phase has a deadline and `tick`
 *      closes it, so a player who walks away loses the round rather than the match.
 */
import { rng, shuffled, type Outcome, type Slot, type TurnGameRules } from '../types';
import { BANK, type Question } from '../trivia/bank';

export type BluffPhase = 'write' | 'vote' | 'reveal' | 'done';

export interface BluffConfig {
  rounds: number;
  /** ms allowed to write a lie */
  writeMs: number;
  /** ms allowed to vote */
  voteMs: number;
}

export const DEFAULT_BLUFF: BluffConfig = { rounds: 5, writeMs: 45_000, voteMs: 30_000 };
export const REVEAL_MS = 5200;
/** a lie longer than this is not a lie, it is a paragraph */
export const MAX_LIE = 60;

export interface BluffRound {
  question: Question;
  /** the truth, kept for the reveal only */
  truth: string;
  lies: [string | null, string | null];
  /** shuffled display order, truth included */
  options: string[];
  /** who owns each option: 0, 1, or 'truth' */
  owner: (Slot | 'truth')[];
  votes: [number | null, number | null];
  points: [number, number];
  /** both players wrote nothing usable */
  empty: boolean;
}

export interface BluffState {
  config: BluffConfig;
  seed: number;
  queue: Question[];
  index: number;
  phase: BluffPhase;
  phaseEndsAt: number;
  lies: [string | null, string | null];
  options: string[];
  owner: (Slot | 'truth')[];
  votes: [number | null, number | null];
  history: BluffRound[];
  score: [number, number];
  over: boolean;
  winner: Slot | null;
  reason: string;
}

export type BluffMove =
  | { type: 'lie'; text: string }
  | { type: 'vote'; option: number };

const norm = (s: string) => s.trim().toLowerCase().replace(/[.!?]+$/, '').replace(/\s+/g, ' ');
const clean = (s: string) => s.trim().replace(/\s+/g, ' ');

/** Questions that make good bluffs: factual answers, not arithmetic. */
export const bluffable = (pool: Question[] = BANK) =>
  pool.filter((q) => q.cat !== 'maths' && q.a[0].length <= 34);

export function buildBluffQueue(rounds: number, seed: number, pool: Question[] = BANK): Question[] {
  return shuffled(bluffable(pool).map((q) => q), seed).slice(0, Math.max(1, rounds));
}

/**
 * Build the ballot. Kept pure and exported so the solo screen builds exactly the
 * same ballot the server would — a duel you can win offline by a different rule
 * than the one you play online is two different games.
 */
export function ballot(
  truth: string, lies: [string | null, string | null], seed: number, index: number,
): { options: string[]; owner: (Slot | 'truth')[] } {
  const entries: { text: string; owner: Slot | 'truth' }[] = [{ text: truth, owner: 'truth' }];
  for (const seat of [0, 1] as Slot[]) {
    const lie = lies[seat];
    if (!lie) continue;
    const n = norm(lie);
    if (!n || n === norm(truth)) continue;                // a lie that *is* the truth is no lie
    if (entries.some((e) => norm(e.text) === n)) continue; // the same lie twice is one option
    entries.push({ text: clean(lie), owner: seat });
  }
  const order = shuffled(entries.map((_, i) => i), (seed ^ ((index + 1) * 0x85ebca6b)) >>> 0);
  return { options: order.map((i) => entries[i].text), owner: order.map((i) => entries[i].owner) };
}

/**
 * Score a closed ballot. `+2` for the truth, `+1` per vote stolen, and a voter
 * never scores for their own invention (they cannot vote for it in the first
 * place, but the check keeps this function safe to call from anywhere).
 */
export function scoreBallot(
  options: string[], owner: (Slot | 'truth')[], votes: [number | null, number | null],
): [number, number] {
  const points: [number, number] = [0, 0];
  const truthIndex = owner.indexOf('truth');
  for (const seat of [0, 1] as Slot[]) {
    const pick = votes[seat];
    if (pick === null || pick < 0 || pick >= options.length) continue;
    if (pick === truthIndex) { points[seat] += 2; continue; }
    const author = owner[pick];
    if (author !== 'truth' && author !== seat) points[author] += 1;
  }
  return points;
}

function openWrite(s: BluffState, now: number): BluffState {
  if (s.index >= s.queue.length) return finish(s);
  return {
    ...s, phase: 'write', phaseEndsAt: now + s.config.writeMs,
    lies: [null, null], options: [], owner: [], votes: [null, null],
  };
}

function openVote(s: BluffState, now: number): BluffState {
  const q = s.queue[s.index];
  const { options, owner } = ballot(q.a[0], s.lies, s.seed, s.index);
  // with no usable lies there is nothing to vote on: show the answer and move on
  if (options.length < 2) return closeRound({ ...s, options, owner, votes: [null, null] }, now);
  return { ...s, phase: 'vote', phaseEndsAt: now + s.config.voteMs, options, owner, votes: [null, null] };
}

function closeRound(s: BluffState, now: number): BluffState {
  const q = s.queue[s.index];
  const points = scoreBallot(s.options, s.owner, s.votes);
  const round: BluffRound = {
    question: q,
    truth: q.a[0],
    lies: [s.lies[0], s.lies[1]],
    options: s.options,
    owner: s.owner,
    votes: [s.votes[0], s.votes[1]],
    points,
    empty: s.options.length < 2,
  };
  return {
    ...s,
    phase: 'reveal',
    phaseEndsAt: now + REVEAL_MS,
    score: [s.score[0] + points[0], s.score[1] + points[1]],
    history: [...s.history, round],
  };
}

function finish(s: BluffState): BluffState {
  const [a, b] = s.score;
  const winner: Slot | null = a === b ? null : a > b ? 0 : 1;
  const reason = a === b
    ? `Level at ${a} — nobody can lie to anybody.`
    : `${winner === 0 ? 'Volt' : 'Spark'} took it ${Math.max(a, b)} to ${Math.min(a, b)}.`;
  return { ...s, phase: 'done', over: true, winner, reason };
}

export const bluffRules: TurnGameRules<BluffState, BluffMove> = {
  id: 'bluff',

  createInitialState(config, seed) {
    const cfg: BluffConfig = {
      rounds: Math.max(2, Math.min(12, Number(config.rounds ?? DEFAULT_BLUFF.rounds))),
      writeMs: Math.max(10_000, Math.min(120_000, Number(config.writeMs ?? DEFAULT_BLUFF.writeMs))),
      voteMs: Math.max(8_000, Math.min(90_000, Number(config.voteMs ?? DEFAULT_BLUFF.voteMs))),
    };
    const base: BluffState = {
      config: cfg, seed, queue: buildBluffQueue(cfg.rounds, seed), index: 0,
      phase: 'write', phaseEndsAt: 0, lies: [null, null], options: [], owner: [],
      votes: [null, null], history: [], score: [0, 0], over: false, winner: null, reason: '',
    };
    return openWrite(base, Date.now());
  },

  // simultaneous: both players write, then both vote
  currentPlayer: () => null,

  legalMoves(s, p) {
    if (s.over) return [];
    if (s.phase === 'write') return s.lies[p] === null ? [{ type: 'lie', text: '' }] : [];
    if (s.phase === 'vote' && s.votes[p] === null) {
      return s.options
        .map((_, i) => i)
        .filter((i) => s.owner[i] !== p)          // never your own lie
        .map((option) => ({ type: 'vote', option }) as BluffMove);
    }
    return [];
  },

  isLegal(s, p, move): move is BluffMove {
    const m = move as BluffMove;
    if (!m || typeof m !== 'object') return false;
    if (s.over) return false;
    if (m.type === 'lie') {
      if (s.phase !== 'write' || s.lies[p] !== null) return false;
      if (typeof m.text !== 'string') return false;
      const text = clean(m.text);
      if (text.length < 1 || text.length > MAX_LIE) return false;
      const q = s.queue[s.index];
      // the real answer is not a lie, and letting it through would put the truth
      // on the ballot twice
      return !!q && norm(text) !== norm(q.a[0]);
    }
    if (m.type === 'vote') {
      if (s.phase !== 'vote' || s.votes[p] !== null) return false;
      if (!Number.isInteger(m.option) || m.option < 0 || m.option >= s.options.length) return false;
      return s.owner[m.option] !== p;
    }
    return false;
  },

  applyMove(s, p, m) {
    if (!this.isLegal(s, p, m)) return s;
    const now = Date.now();
    if (m.type === 'lie') {
      const lies: [string | null, string | null] = [s.lies[0], s.lies[1]];
      lies[p] = clean(m.text);
      const next = { ...s, lies };
      return lies[0] !== null && lies[1] !== null ? openVote(next, now) : next;
    }
    const votes: [number | null, number | null] = [s.votes[0], s.votes[1]];
    votes[p] = m.option;
    const next = { ...s, votes };
    return votes[0] !== null && votes[1] !== null ? closeRound(next, now) : next;
  },

  result: (s): Outcome => (s.over ? { over: true, winner: s.winner, reason: s.reason } : { over: false }),

  tick(s, now) {
    if (s.over) return s;
    if (s.phase !== 'reveal' && now >= s.phaseEndsAt) {
      // the deadline closed the phase for whoever was slow
      return s.phase === 'write' ? openVote(s, now) : closeRound(s, now);
    }
    if (s.phase === 'reveal' && now >= s.phaseEndsAt) {
      const advanced = { ...s, index: s.index + 1 };
      return advanced.index >= advanced.queue.length ? finish(advanced) : openWrite(advanced, now);
    }
    return s;
  },

  /**
   * While the lie is being written, the opponent's lie is not sent at all. While
   * the vote is open the ballot is sent, but with the owners and the question's
   * answer array stripped — otherwise the client could simply look up the truth
   * it was just asked to guess. Both are re-sent in full at the reveal.
   */
  redact(s, forPlayer) {
    const writing = s.phase === 'write';
    const voting = s.phase === 'vote';
    const lies: [string | null, string | null] = writing
      ? [forPlayer === 0 ? s.lies[0] : null, forPlayer === 1 ? s.lies[1] : null]
      : [s.lies[0], s.lies[1]];
    const submitted: [boolean, boolean] = [s.lies[0] !== null, s.lies[1] !== null];
    const votes: [number | null, number | null] = voting
      ? [forPlayer === 0 ? s.votes[0] : null, forPlayer === 1 ? s.votes[1] : null]
      : [s.votes[0], s.votes[1]];
    const inVote: [boolean, boolean] = [s.votes[0] !== null, s.votes[1] !== null];

    // the question's own answers are the answer key: never sent before the reveal
    const queue = s.queue.slice(0, s.index + 1).map((q, i) =>
      i === s.index && s.phase !== 'reveal' && s.phase !== 'done'
        ? { ...q, a: ['', '', '', ''] as Question['a'], note: undefined }
        : q);

    return {
      ...s,
      lies,
      votes,
      submitted,
      inVote,
      owner: s.phase === 'reveal' || s.phase === 'done' ? s.owner : [],
      queue,
      total: s.queue.length,
    } as BluffState & { submitted: [boolean, boolean]; inVote: [boolean, boolean]; total: number };
  },

  describeMove(s, p, m) {
    const who = p === 0 ? 'Volt' : 'Spark';
    if (m.type === 'lie') return `${who} wrote a bluff`;
    if (s.phase === 'vote') return `${who} voted`;
    return `${who} made a move`;
  },
};

/** Exported for the solo screen: which decoy to use as the arcade's lie. */
export function aiLie(q: Question, seed: number, index: number): string {
  const r = rng((seed ^ ((index + 1) * 0x9e3779b1)) >>> 0);
  const decoys = [q.a[1], q.a[2], q.a[3]].filter(Boolean);
  return decoys[Math.floor(r() * decoys.length)] ?? 'Something else entirely';
}
