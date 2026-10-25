import type { Slot, TurnGameRules, Outcome } from '../types';

export interface TTTState {
  size: number;          // 3 | 4 | 5
  need: number;          // in-a-row required
  cells: (Slot | null)[];
  turn: Slot;
  moves: number[];
  winLine: number[] | null;
  winner: Slot | null;
  over: boolean;
  reason: string;
}
export type TTTMove = { cell: number };

const LINES_CACHE = new Map<string, number[][]>();

export function lines(size: number, need: number): number[][] {
  const key = `${size}:${need}`;
  const hit = LINES_CACHE.get(key);
  if (hit) return hit;
  const out: number[][] = [];
  const idx = (r: number, c: number) => r * size + c;
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (let r = 0; r < size; r++)
    for (let c = 0; c < size; c++)
      for (const [dr, dc] of dirs) {
        const er = r + dr * (need - 1), ec = c + dc * (need - 1);
        if (er < 0 || er >= size || ec < 0 || ec >= size) continue;
        const line: number[] = [];
        for (let k = 0; k < need; k++) line.push(idx(r + dr * k, c + dc * k));
        out.push(line);
      }
  LINES_CACHE.set(key, out);
  return out;
}

export function findWin(s: TTTState): { winner: Slot; line: number[] } | null {
  for (const ln of lines(s.size, s.need)) {
    const first = s.cells[ln[0]];
    if (first === null) continue;
    let ok = true;
    for (let i = 1; i < ln.length; i++) if (s.cells[ln[i]] !== first) { ok = false; break; }
    if (ok) return { winner: first, line: ln };
  }
  return null;
}

export const tictactoeRules: TurnGameRules<TTTState, TTTMove> = {
  id: 'tictactoe',
  createInitialState(config) {
    const size = Number(config.size ?? 3);
    const need = size >= 5 ? 4 : size === 4 ? 4 : 3;
    return { size, need, cells: Array(size * size).fill(null), turn: 0, moves: [], winLine: null, winner: null, over: false, reason: '' };
  },
  currentPlayer: (s) => (s.over ? null : s.turn),
  legalMoves(s, p) {
    if (s.over || s.turn !== p) return [];
    const out: TTTMove[] = [];
    for (let i = 0; i < s.cells.length; i++) if (s.cells[i] === null) out.push({ cell: i });
    return out;
  },
  isLegal(s, p, m): m is TTTMove {
    const mv = m as TTTMove;
    if (!mv || typeof mv.cell !== 'number' || !Number.isInteger(mv.cell)) return false;
    if (s.over || s.turn !== p) return false;
    return mv.cell >= 0 && mv.cell < s.cells.length && s.cells[mv.cell] === null;
  },
  applyMove(s, p, m) {
    if (!this.isLegal(s, p, m)) return s;
    const cells = s.cells.slice();
    cells[m.cell] = p;
    const next: TTTState = { ...s, cells, turn: p === 0 ? 1 : 0, moves: [...s.moves, m.cell] };
    const win = findWin(next);
    if (win) return { ...next, over: true, winner: win.winner, winLine: win.line, reason: 'line' };
    if (cells.every((c) => c !== null)) return { ...next, over: true, winner: null, reason: 'board full' };
    return next;
  },
  result: (s): Outcome => (s.over ? { over: true, winner: s.winner, reason: s.reason } : { over: false }),
  describeMove(s, p, m) {
    const r = Math.floor(m.cell / s.size) + 1, c = (m.cell % s.size) + 1;
    return `${p === 0 ? 'Volt' : 'Spark'} → r${r}c${c}`;
  },
};
