/**
 * Detective Pikachu — rules.
 *
 * A deduction game with generated mysteries. The important property is that a
 * generated case is *fair*: the clue set is checked by brute force to admit
 * exactly one (suspect, place, object) triple, and then pruned so that every
 * clue still on the board is load-bearing. A case you cannot solve by reasoning
 * alone is a bug, and `generateCase` will not return one.
 */
import { rng, shuffled, type Difficulty } from '../types';

export interface Candidate { suspect: number; place: number; object: number }

export type ClueKind =
  | 'not-suspect' | 'not-place' | 'not-object'
  | 'either-suspect' | 'either-place' | 'either-object'
  | 'implies-place' | 'implies-object'
  | 'not-pair-sp' | 'not-pair-so' | 'not-pair-po';

export interface Clue {
  kind: ClueKind;
  /** indices the clue talks about; meaning depends on kind */
  args: number[];
  text: string;
}

export interface CaseFile {
  seed: number;
  suspects: string[];
  places: string[];
  objects: string[];
  clues: Clue[];
  solution: Candidate;
  /** flavour only */
  title: string;
  brief: string;
}

/* ──────────────────────────── the cast ──────────────────────────── */

const SUSPECTS = [
  'Mara Vell', 'Oscar Quill', 'Lina Ferro', 'Dr. Ashwin Rao', 'Bea Calloway',
  'Tomas Ridge', 'Nadia Hoyt', 'Felix Marrow',
];
const PLACES = [
  'the conservatory', 'the record room', 'the boathouse', 'the tea pavilion',
  'the back stairwell', 'the walled garden', 'the clock tower', 'the pantry',
];
const OBJECTS = [
  'a brass key', 'a torn ticket stub', 'a silver thimble', 'a fountain pen',
  'a velvet ribbon', 'a pocket watch', 'a folded map', 'a china teacup',
];

const TITLES = [
  'The Quiet Hour', 'A Matter of Thimbles', 'The Missing Overture', 'Nine Minutes Past',
  'The Second Umbrella', 'An Honest Mistake', 'The Last Train Home', 'Something in the Tea',
];

/* ───────────────────────── clue evaluation ───────────────────────── */

export function holds(clue: Clue, c: Candidate): boolean {
  const [a, b] = clue.args;
  switch (clue.kind) {
    case 'not-suspect': return c.suspect !== a;
    case 'not-place': return c.place !== a;
    case 'not-object': return c.object !== a;
    case 'either-suspect': return c.suspect === a || c.suspect === b;
    case 'either-place': return c.place === a || c.place === b;
    case 'either-object': return c.object === a || c.object === b;
    // "if the culprit is a, the place/object is b"
    case 'implies-place': return c.suspect !== a || c.place === b;
    case 'implies-object': return c.suspect !== a || c.object === b;
    case 'not-pair-sp': return !(c.suspect === a && c.place === b);
    case 'not-pair-so': return !(c.suspect === a && c.object === b);
    case 'not-pair-po': return !(c.place === a && c.object === b);
  }
}

/** Every triple consistent with the clues. Used for generation, checking and hints. */
export function consistent(file: Pick<CaseFile, 'suspects' | 'places' | 'objects' | 'clues'>): Candidate[] {
  const out: Candidate[] = [];
  for (let s = 0; s < file.suspects.length; s++)
    for (let p = 0; p < file.places.length; p++)
      for (let o = 0; o < file.objects.length; o++) {
        const c = { suspect: s, place: p, object: o };
        if (file.clues.every((cl) => holds(cl, c))) out.push(c);
      }
  return out;
}

/* ──────────────────────────── generation ──────────────────────────── */

export const SIZES: Record<Difficulty, number> = {
  beginner: 3, casual: 4, intermediate: 4, advanced: 5, expert: 6,
};

/** Richer clue vocabulary at higher tiers — the reasoning gets less direct. */
const KINDS: Record<Difficulty, ClueKind[]> = {
  beginner: ['not-suspect', 'not-place', 'not-object', 'either-suspect'],
  casual: ['not-suspect', 'not-place', 'not-object', 'either-suspect', 'either-place', 'not-pair-sp'],
  intermediate: ['not-suspect', 'not-place', 'not-object', 'either-suspect', 'either-place', 'either-object', 'not-pair-sp', 'not-pair-so'],
  advanced: ['not-place', 'not-object', 'either-suspect', 'either-place', 'either-object', 'implies-place', 'implies-object', 'not-pair-sp', 'not-pair-so', 'not-pair-po'],
  expert: ['either-suspect', 'either-place', 'either-object', 'implies-place', 'implies-object', 'not-pair-sp', 'not-pair-so', 'not-pair-po'],
};

function phrase(kind: ClueKind, args: number[], S: string[], P: string[], O: string[]): string {
  const [a, b] = args;
  switch (kind) {
    case 'not-suspect': return `${S[a]} was accounted for all evening.`;
    case 'not-place': return `Nothing happened in ${P[a]} — the door was still locked.`;
    case 'not-object': return `${O[a]} was never out of its case.`;
    case 'either-suspect': return `It was either ${S[a]} or ${S[b]}. No one else had a reason.`;
    case 'either-place': return `It happened in ${P[a]} or ${P[b]}. The rest of the house was dark.`;
    case 'either-object': return `What was left behind was ${O[a]} or ${O[b]}.`;
    case 'implies-place': return `If ${S[a]} did it, it can only have been in ${P[b]}.`;
    case 'implies-object': return `If ${S[a]} did it, then ${O[b]} was involved.`;
    case 'not-pair-sp': return `${S[a]} has never once set foot in ${P[b]}.`;
    case 'not-pair-so': return `${S[a]} would not have touched ${O[b]}.`;
    case 'not-pair-po': return `${O[a]} could not have been in ${P[b]} that night.`;
  }
}

function makeClue(kind: ClueKind, sol: Candidate, n: number, r: () => number, S: string[], P: string[], O: string[]): Clue | null {
  const notIt = (v: number, max: number) => {
    const opts = Array.from({ length: max }, (_, i) => i).filter((i) => i !== v);
    return opts.length ? opts[Math.floor(r() * opts.length)] : -1;
  };
  const pick = (max: number) => Math.floor(r() * max);
  let args: number[] = [];

  switch (kind) {
    case 'not-suspect': args = [notIt(sol.suspect, n)]; break;
    case 'not-place': args = [notIt(sol.place, n)]; break;
    case 'not-object': args = [notIt(sol.object, n)]; break;
    case 'either-suspect': { const o = notIt(sol.suspect, n); args = r() < 0.5 ? [sol.suspect, o] : [o, sol.suspect]; break; }
    case 'either-place': { const o = notIt(sol.place, n); args = r() < 0.5 ? [sol.place, o] : [o, sol.place]; break; }
    case 'either-object': { const o = notIt(sol.object, n); args = r() < 0.5 ? [sol.object, o] : [o, sol.object]; break; }
    // a true implication: either about the real culprit (then the consequent is true),
    // or about someone innocent (vacuously true, and a nice red herring)
    case 'implies-place': args = r() < 0.4 ? [sol.suspect, sol.place] : [notIt(sol.suspect, n), pick(n)]; break;
    case 'implies-object': args = r() < 0.4 ? [sol.suspect, sol.object] : [notIt(sol.suspect, n), pick(n)]; break;
    case 'not-pair-sp': { const s = pick(n), p = pick(n); if (s === sol.suspect && p === sol.place) return null; args = [s, p]; break; }
    case 'not-pair-so': { const s = pick(n), o = pick(n); if (s === sol.suspect && o === sol.object) return null; args = [s, o]; break; }
    case 'not-pair-po': { const p = pick(n), o = pick(n); if (p === sol.place && o === sol.object) return null; args = [p, o]; break; }
  }
  if (args.some((v) => v < 0)) return null;
  const clue: Clue = { kind, args, text: phrase(kind, args, S, P, O) };
  return holds(clue, sol) ? clue : null;
}

/**
 * Build a case that has exactly one answer, using as few clues as we can manage.
 * Greedily add informative clues until the candidate set collapses to one, then
 * drop any clue the rest of the set already implies.
 */
export function generateCase(difficulty: Difficulty, seed: number): CaseFile {
  const n = SIZES[difficulty];
  const r = rng(seed);
  const S = shuffled(SUSPECTS, seed).slice(0, n);
  const P = shuffled(PLACES, (seed ^ 0x1b873593) >>> 0).slice(0, n);
  const O = shuffled(OBJECTS, (seed ^ 0xcc9e2d51) >>> 0).slice(0, n);
  const solution: Candidate = {
    suspect: Math.floor(r() * n), place: Math.floor(r() * n), object: Math.floor(r() * n),
  };

  const kinds = KINDS[difficulty];
  const clues: Clue[] = [];
  const shape = { suspects: S, places: P, objects: O };
  let pool = consistent({ ...shape, clues });
  let guard = 0;

  while (pool.length > 1 && guard++ < 4000) {
    const kind = kinds[Math.floor(r() * kinds.length)];
    const clue = makeClue(kind, solution, n, r, S, P, O);
    if (!clue) continue;
    if (clues.some((c) => c.kind === clue.kind && c.args.join() === clue.args.join())) continue;
    const next = pool.filter((c) => holds(clue, c));
    if (next.length === pool.length) continue;      // tells us nothing new
    clues.push(clue);
    pool = next;
  }

  // Fallback: if the vocabulary could not isolate it (possible at tiny sizes),
  // pin the remainder down with plain eliminations rather than ship an unfair case.
  for (let s = 0; pool.length > 1 && s < n; s++) {
    if (s === solution.suspect) continue;
    const clue: Clue = { kind: 'not-suspect', args: [s], text: phrase('not-suspect', [s], S, P, O) };
    if (clues.some((c) => c.kind === 'not-suspect' && c.args[0] === s)) continue;
    clues.push(clue); pool = pool.filter((c) => holds(clue, c));
  }
  for (let p = 0; pool.length > 1 && p < n; p++) {
    if (p === solution.place) continue;
    const clue: Clue = { kind: 'not-place', args: [p], text: phrase('not-place', [p], S, P, O) };
    if (clues.some((c) => c.kind === 'not-place' && c.args[0] === p)) continue;
    clues.push(clue); pool = pool.filter((c) => holds(clue, c));
  }
  for (let o = 0; pool.length > 1 && o < n; o++) {
    if (o === solution.object) continue;
    const clue: Clue = { kind: 'not-object', args: [o], text: phrase('not-object', [o], S, P, O) };
    if (clues.some((c) => c.kind === 'not-object' && c.args[0] === o)) continue;
    clues.push(clue); pool = pool.filter((c) => holds(clue, c));
  }

  // prune: a clue the others already cover is just noise on the board
  const kept: Clue[] = [];
  for (let i = clues.length - 1; i >= 0; i--) {
    const without = [...kept, ...clues.slice(0, i)];
    if (consistent({ ...shape, clues: without }).length !== 1) kept.unshift(clues[i]);
  }

  const title = TITLES[Math.floor(r() * TITLES.length)];
  return {
    seed, suspects: S, places: P, objects: O,
    clues: shuffled(kept, (seed ^ 0x27d4eb2f) >>> 0),
    solution, title,
    brief: `Something went missing from ${P[solution.place] === P[0] ? 'the house' : 'the house'} last night. ${n} people were still inside. The only certain thing is that whoever it was left something behind.`,
  };
}

/* ─────────────────────────── play state ─────────────────────────── */

export type Mark = 'unknown' | 'ruled-out' | 'suspected';

export interface DetectiveState {
  file: CaseFile;
  /** player's own notes; one mark per entry in each column */
  marks: { suspect: Mark[]; place: Mark[]; object: Mark[] };
  revealedClues: number;
  accusations: { pick: Candidate; correct: boolean }[];
  attemptsLeft: number;
  solved: boolean;
  over: boolean;
  startedAt: number;
  endedAt: number | null;
}

export const MAX_ATTEMPTS = 2;

export function createDetective(difficulty: Difficulty, seed: number): DetectiveState {
  const file = generateCase(difficulty, seed);
  const blank = (n: number): Mark[] => Array.from({ length: n }, () => 'unknown');
  return {
    file,
    marks: { suspect: blank(file.suspects.length), place: blank(file.places.length), object: blank(file.objects.length) },
    revealedClues: Math.min(file.clues.length, Math.max(3, Math.ceil(file.clues.length / 2))),
    accusations: [], attemptsLeft: MAX_ATTEMPTS, solved: false, over: false,
    startedAt: Date.now(), endedAt: null,
  };
}

const CYCLE: Mark[] = ['unknown', 'ruled-out', 'suspected'];

export function cycleMark(s: DetectiveState, col: 'suspect' | 'place' | 'object', i: number): DetectiveState {
  const marks = { ...s.marks, [col]: s.marks[col].slice() };
  const cur = marks[col][i];
  marks[col][i] = CYCLE[(CYCLE.indexOf(cur) + 1) % CYCLE.length];
  return { ...s, marks };
}

/** Reveal one more clue. Costs nothing but is recorded in the final score. */
export function revealClue(s: DetectiveState): DetectiveState {
  if (s.revealedClues >= s.file.clues.length) return s;
  return { ...s, revealedClues: s.revealedClues + 1 };
}

export function accuse(s: DetectiveState, pick: Candidate): DetectiveState {
  if (s.over) return s;
  const sol = s.file.solution;
  const correct = pick.suspect === sol.suspect && pick.place === sol.place && pick.object === sol.object;
  const attemptsLeft = correct ? s.attemptsLeft : s.attemptsLeft - 1;
  const over = correct || attemptsLeft <= 0;
  return {
    ...s,
    accusations: [...s.accusations, { pick, correct }],
    attemptsLeft, solved: correct, over,
    endedAt: over ? Date.now() : null,
  };
}

/** How close an incorrect accusation was — told honestly, without giving it away. */
export function feedback(file: CaseFile, pick: Candidate): { right: number; parts: string[] } {
  const sol = file.solution;
  const parts: string[] = [];
  let right = 0;
  if (pick.suspect === sol.suspect) { right++; parts.push('the right person'); }
  if (pick.place === sol.place) { right++; parts.push('the right room'); }
  if (pick.object === sol.object) { right++; parts.push('the right object'); }
  return { right, parts };
}

export function scoreCase(s: DetectiveState): number {
  if (!s.solved) return 0;
  const seconds = Math.round(((s.endedAt ?? Date.now()) - s.startedAt) / 1000);
  const base = 600 + s.file.suspects.length * 120;
  const extraClues = Math.max(0, s.revealedClues - Math.max(3, Math.ceil(s.file.clues.length / 2)));
  const wrong = s.accusations.filter((a) => !a.correct).length;
  return Math.max(50, base - seconds * 2 - extraClues * 60 - wrong * 150);
}
