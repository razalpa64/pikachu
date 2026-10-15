import type { Slot, TurnGameRules, Outcome } from '../types';
import { rng } from '../types';

export const BS_SIZE = 10;
export const FLEET = [
  { id: 'carrier',  name: 'Storm Carrier', len: 5 },
  { id: 'battle',   name: 'Volt Cruiser',  len: 4 },
  { id: 'cruiser',  name: 'Arc Frigate',   len: 3 },
  { id: 'sub',      name: 'Spark Sub',     len: 3 },
  { id: 'destroyer',name: 'Bolt Skiff',    len: 2 },
] as const;

export interface Ship { id: string; len: number; cells: number[]; hits: number[] }
export interface BSState {
  size: number;
  phase: 'placement' | 'battle' | 'done';
  ready: [boolean, boolean];
  fleets: [Ship[], Ship[]];
  shots: [number[], number[]];      // cells each player has fired at (into the OTHER board)
  hits:  [number[], number[]];
  sunk:  [string[], string[]];
  turn: Slot;
  lastShot: { by: Slot; cell: number; hit: boolean; sunk?: string } | null;
  over: boolean; winner: Slot | null; reason: string;
}
export type BSMove =
  | { type: 'place'; ships: { id: string; cells: number[] }[] }
  | { type: 'ready' }
  | { type: 'fire'; cell: number };

export const rcOf = (i: number, size = BS_SIZE) => [Math.floor(i / size), i % size] as const;

export function validPlacement(ships: { id: string; cells: number[] }[], size = BS_SIZE): string | null {
  if (!Array.isArray(ships) || ships.length !== FLEET.length) return 'Fleet incomplete';
  const used = new Set<number>();
  for (const spec of FLEET) {
    const s = ships.find((x) => x.id === spec.id);
    if (!s) return `Missing ${spec.name}`;
    if (!Array.isArray(s.cells) || s.cells.length !== spec.len) return `${spec.name} must be ${spec.len} cells`;
    const sorted = [...s.cells].sort((a, b) => a - b);
    for (const c of sorted) {
      if (!Number.isInteger(c) || c < 0 || c >= size * size) return 'Cell out of bounds';
      if (used.has(c)) return 'Ships overlap';
      used.add(c);
    }
    const [r0, c0] = rcOf(sorted[0], size);
    const horizontal = sorted.every((c, k) => c === sorted[0] + k && Math.floor(c / size) === r0);
    const vertical = sorted.every((c, k) => c === sorted[0] + k * size && (c % size) === c0);
    if (!horizontal && !vertical) return `${spec.name} must be a straight line`;
  }
  return null;
}

export function autoPlace(seed: number, size = BS_SIZE): { id: string; cells: number[] }[] {
  const r = rng(seed);
  const used = new Set<number>();
  const out: { id: string; cells: number[] }[] = [];
  for (const spec of FLEET) {
    for (let attempt = 0; attempt < 500; attempt++) {
      const horiz = r() < 0.5;
      const row = Math.floor(r() * size);
      const col = Math.floor(r() * size);
      const cells: number[] = [];
      let ok = true;
      for (let k = 0; k < spec.len; k++) {
        const rr = horiz ? row : row + k;
        const cc = horiz ? col + k : col;
        if (rr >= size || cc >= size) { ok = false; break; }
        const idx = rr * size + cc;
        if (used.has(idx)) { ok = false; break; }
        cells.push(idx);
      }
      if (!ok) continue;
      cells.forEach((c) => used.add(c));
      out.push({ id: spec.id, cells });
      break;
    }
  }
  return out;
}

export const battleshipRules: TurnGameRules<BSState, BSMove> = {
  id: 'battleship',
  createInitialState(config) {
    const size = Number(config.size ?? BS_SIZE);
    return {
      size, phase: 'placement', ready: [false, false], fleets: [[], []],
      shots: [[], []], hits: [[], []], sunk: [[], []], turn: 0, lastShot: null,
      over: false, winner: null, reason: '',
    };
  },
  currentPlayer: (s) => (s.over ? null : s.phase === 'placement' ? null : s.turn),
  legalMoves(s, p) {
    if (s.over) return [];
    if (s.phase === 'placement') return s.fleets[p].length ? [{ type: 'ready' } as BSMove] : [];
    if (s.turn !== p) return [];
    const out: BSMove[] = [];
    for (let i = 0; i < s.size * s.size; i++) if (!s.shots[p].includes(i)) out.push({ type: 'fire', cell: i });
    return out;
  },
  isLegal(s, p, m): m is BSMove {
    const mv = m as BSMove;
    if (!mv || typeof mv.type !== 'string' || s.over) return false;
    if (mv.type === 'place') return s.phase === 'placement' && !s.ready[p] && validPlacement(mv.ships, s.size) === null;
    if (mv.type === 'ready') return s.phase === 'placement' && s.fleets[p].length === FLEET.length && !s.ready[p];
    if (mv.type === 'fire') {
      if (s.phase !== 'battle' || s.turn !== p) return false;
      return Number.isInteger(mv.cell) && mv.cell >= 0 && mv.cell < s.size * s.size && !s.shots[p].includes(mv.cell);
    }
    return false;
  },
  applyMove(s, p, m) {
    if (m.type === 'place') {
      const fleets = [s.fleets[0], s.fleets[1]] as [Ship[], Ship[]];
      fleets[p] = m.ships.map((x) => ({ id: x.id, len: x.cells.length, cells: [...x.cells], hits: [] }));
      return { ...s, fleets };
    }
    if (m.type === 'ready') {
      const ready = [...s.ready] as [boolean, boolean];
      ready[p] = true;
      if (ready[0] && ready[1]) return { ...s, ready, phase: 'battle', turn: 0 };
      return { ...s, ready };
    }
    // fire
    const opp = (p === 0 ? 1 : 0) as Slot;
    const shots = [[...s.shots[0]], [...s.shots[1]]] as [number[], number[]];
    shots[p].push(m.cell);
    const fleets = [s.fleets[0].map((x) => ({ ...x, cells: [...x.cells], hits: [...x.hits] })), s.fleets[1].map((x) => ({ ...x, cells: [...x.cells], hits: [...x.hits] }))] as [Ship[], Ship[]];
    const target = fleets[opp].find((sh) => sh.cells.includes(m.cell));
    const hits = [[...s.hits[0]], [...s.hits[1]]] as [number[], number[]];
    const sunkList = [[...s.sunk[0]], [...s.sunk[1]]] as [string[], string[]];
    let sunkNow: string | undefined;
    if (target) {
      target.hits.push(m.cell);
      hits[p].push(m.cell);
      if (target.hits.length === target.len) { sunkList[p].push(target.id); sunkNow = target.id; }
    }
    const allSunk = fleets[opp].every((sh) => sh.hits.length === sh.len);
    const next: BSState = {
      ...s, shots, hits, fleets, sunk: sunkList,
      lastShot: { by: p, cell: m.cell, hit: !!target, sunk: sunkNow },
      turn: target ? p : opp,                    // hit = fire again
    };
    if (allSunk) return { ...next, over: true, phase: 'done', winner: p, reason: 'fleet destroyed' };
    return next;
  },
  result: (s): Outcome => (s.over ? { over: true, winner: s.winner, reason: s.reason } : { over: false }),
  /** CRITICAL: the opponent's ship coordinates never leave the server. */
  redact(s, forPlayer) {
    const me = forPlayer === 'spectator' ? -1 : (forPlayer as number);
    const opp = me === 0 ? 1 : 0;
    const visibleOpp = s.over
      ? s.fleets[opp]
      : s.fleets[opp].map((sh) => (sh.hits.length === sh.len
          ? sh                                           // sunk ships become visible
          : { id: sh.id, len: sh.len, cells: [], hits: sh.hits }));
    const fleets = me === 0 ? [s.fleets[0], visibleOpp] : me === 1 ? [visibleOpp, s.fleets[1]] : [[], []];
    return { ...s, fleets };
  },
  describeMove: (s, p, m) => {
    if (m.type !== 'fire') return m.type;
    const [r, c] = rcOf(m.cell, s.size);
    return `${p === 0 ? 'Volt' : 'Spark'} fires ${String.fromCharCode(65 + c)}${r + 1}`;
  },
};
