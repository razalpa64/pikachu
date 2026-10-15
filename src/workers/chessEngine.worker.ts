/// <reference lib="webworker" />
/**
 * Volt Engine — a compact alpha-beta chess search that runs OFF the main thread.
 *
 * Material + piece-square evaluation, MVV-LVA capture ordering, killer moves,
 * quiescence on captures, iterative deepening bounded by a wall-clock budget so a
 * modest laptop never locks up. Difficulty maps to depth, budget and deliberate
 * evaluation noise rather than to cheating.
 */
import { Chess, type Move } from 'chess.js';

type Difficulty = 'beginner' | 'casual' | 'intermediate' | 'advanced' | 'expert';

const VALUE: Record<string, number> = { p: 100, n: 320, b: 335, r: 500, q: 950, k: 0 };

/* piece-square tables, white's point of view, a8..h1 */
const PST: Record<string, number[]> = {
  p: [0,0,0,0,0,0,0,0, 50,50,50,50,50,50,50,50, 10,10,20,30,30,20,10,10, 5,5,10,25,25,10,5,5,
      0,0,0,20,20,0,0,0, 5,-5,-10,0,0,-10,-5,5, 5,10,10,-20,-20,10,10,5, 0,0,0,0,0,0,0,0],
  n: [-50,-40,-30,-30,-30,-30,-40,-50, -40,-20,0,0,0,0,-20,-40, -30,0,10,15,15,10,0,-30,
      -30,5,15,20,20,15,5,-30, -30,0,15,20,20,15,0,-30, -30,5,10,15,15,10,5,-30,
      -40,-20,0,5,5,0,-20,-40, -50,-40,-30,-30,-30,-30,-40,-50],
  b: [-20,-10,-10,-10,-10,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,10,10,5,0,-10,
      -10,5,5,10,10,5,5,-10, -10,0,10,10,10,10,0,-10, -10,10,10,10,10,10,10,-10,
      -10,5,0,0,0,0,5,-10, -20,-10,-10,-10,-10,-10,-10,-20],
  r: [0,0,0,0,0,0,0,0, 5,10,10,10,10,10,10,5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5,
      -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, 0,0,0,5,5,0,0,0],
  q: [-20,-10,-10,-5,-5,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,5,5,5,0,-10, -5,0,5,5,5,5,0,-5,
      0,0,5,5,5,5,0,-5, -10,5,5,5,5,5,0,-10, -10,0,5,0,0,0,0,-10, -20,-10,-10,-5,-5,-10,-10,-20],
  k: [-30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30,
      -30,-40,-40,-50,-50,-40,-40,-30, -20,-30,-30,-40,-40,-30,-30,-20, -10,-20,-20,-20,-20,-20,-20,-10,
      20,20,0,0,0,0,20,20, 20,30,10,0,0,10,30,20],
};

const sqIndex = (sq: string) => (8 - Number(sq[1])) * 8 + (sq.charCodeAt(0) - 97);

function evaluate(c: Chess): number {
  let score = 0;
  let pieces = 0;
  for (const row of c.board()) {
    for (const sq of row) {
      if (!sq) continue;
      pieces++;
      const base = VALUE[sq.type];
      const idx = sqIndex(sq.square);
      const pst = PST[sq.type][sq.color === 'w' ? idx : 63 - idx];
      score += sq.color === 'w' ? base + pst : -(base + pst);
    }
  }
  // light mobility term, cheap because chess.js already caches move generation per position
  const mob = c.moves().length;
  score += (c.turn() === 'w' ? mob : -mob) * 1.2;
  if (pieces < 12) score *= 1.05;                     // encourage trading when ahead
  return score;
}

const mvvLva = (m: Move) => (m.captured ? VALUE[m.captured] * 10 - VALUE[m.piece] : 0)
  + (m.promotion ? 800 : 0) + (m.san.includes('+') ? 40 : 0);

let nodes = 0;
let deadline = 0;
let aborted = false;

function quiesce(c: Chess, alpha: number, beta: number, depth: number): number {
  const stand = evaluate(c) * (c.turn() === 'w' ? 1 : -1);
  if (stand >= beta) return beta;
  if (stand > alpha) alpha = stand;
  if (depth <= 0) return alpha;
  const caps = c.moves({ verbose: true }).filter((m) => m.captured || m.promotion).sort((a, b) => mvvLva(b) - mvvLva(a));
  for (const m of caps) {
    if ((++nodes & 1023) === 0 && Date.now() > deadline) { aborted = true; return alpha; }
    c.move(m);
    const score = -quiesce(c, -beta, -alpha, depth - 1);
    c.undo();
    if (aborted) return alpha;
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

const killers: string[][] = Array.from({ length: 32 }, () => []);

function negamax(c: Chess, depth: number, alpha: number, beta: number, ply: number): number {
  if ((++nodes & 1023) === 0 && Date.now() > deadline) { aborted = true; return alpha; }
  if (c.isCheckmate()) return -100000 + ply;
  if (c.isDraw() || c.isStalemate() || c.isThreefoldRepetition()) return 0;
  if (depth <= 0) return quiesce(c, alpha, beta, 4);

  const moves = c.moves({ verbose: true });
  const k = killers[ply] ?? [];
  moves.sort((a, b) => (mvvLva(b) + (k.includes(b.san) ? 90 : 0)) - (mvvLva(a) + (k.includes(a.san) ? 90 : 0)));

  for (const m of moves) {
    c.move(m);
    const score = -negamax(c, depth - 1, -beta, -alpha, ply + 1);
    c.undo();
    if (aborted) return alpha;
    if (score >= beta) {
      if (!m.captured) { killers[ply] = [m.san, ...(killers[ply] ?? [])].slice(0, 2); }
      return beta;
    }
    if (score > alpha) alpha = score;
  }
  return alpha;
}

const PROFILE: Record<Difficulty, { depth: number; budget: number; noise: number; blunder: number }> = {
  beginner:     { depth: 1, budget: 120,  noise: 160, blunder: 0.45 },
  casual:       { depth: 2, budget: 260,  noise: 80,  blunder: 0.18 },
  intermediate: { depth: 3, budget: 620,  noise: 32,  blunder: 0.05 },
  advanced:     { depth: 4, budget: 1300, noise: 10,  blunder: 0.01 },
  expert:       { depth: 6, budget: 2600, noise: 0,   blunder: 0 },
};

self.onmessage = (e: MessageEvent) => {
  const { fen, difficulty, id } = e.data as { fen: string; difficulty: Difficulty; id: number };
  const profile = PROFILE[difficulty] ?? PROFILE.intermediate;
  const c = new Chess();
  c.load(fen);
  const legal = c.moves({ verbose: true });
  if (!legal.length) { (self as any).postMessage({ id, move: null }); return; }

  nodes = 0; aborted = false;
  deadline = Date.now() + profile.budget;

  // deliberate, bounded mistakes on the lower rungs — never illegal, just human
  if (Math.random() < profile.blunder) {
    const quiet = legal.filter((m) => !m.captured) ;
    const pool = quiet.length ? quiet : legal;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    (self as any).postMessage({ id, move: { from: pick.from, to: pick.to, promotion: pick.promotion }, depth: 0, nodes: 0, eval: null });
    return;
  }

  let best = legal[0];
  let bestScore = -Infinity;
  let reachedDepth = 0;

  for (let d = 1; d <= profile.depth; d++) {
    let localBest = best;
    let localScore = -Infinity;
    const ordered = [...legal].sort((a, b) => mvvLva(b) - mvvLva(a));
    for (const m of ordered) {
      c.move(m);
      let score = -negamax(c, d - 1, -Infinity, Infinity, 1);
      c.undo();
      if (profile.noise) score += (Math.random() - 0.5) * profile.noise;
      if (score > localScore) { localScore = score; localBest = m; }
      if (aborted) break;
    }
    if (!aborted) { best = localBest; bestScore = localScore; reachedDepth = d; }
    if (aborted || Date.now() > deadline) break;
  }

  (self as any).postMessage({
    id,
    move: { from: best.from, to: best.to, promotion: best.promotion },
    san: best.san, depth: reachedDepth, nodes, eval: Math.round(bestScore),
  });
};
