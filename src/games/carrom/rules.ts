/**
 * Carrom, the rules.
 *
 * `physics.ts` decides where the coins end up; this file decides what that
 * means. It is the same module the relay server referees with, so a player
 * cannot claim a pocket the simulation did not see.
 *
 * The rules implemented are the ones that make carrom a game rather than a
 * physics toy:
 *
 *   • white shoots first, then players alternate;
 *   • sinking one of your own coins earns another shot;
 *   • sinking an opponent's coin gives *them* the point and ends your turn;
 *   • sinking the striker is a foul — one of your own pocketed coins goes back
 *     on the board, at the centre;
 *   • a shot that touches nothing is a foul too;
 *   • the queen is only yours if you cover her by sinking one of your own coins
 *     in the same shot or your next one; otherwise she goes back to the centre.
 *
 * Deliberately not implemented, because guessing at them would be worse than
 * leaving them out: the thumb-line and corner-arrow restrictions on striker
 * placement, and the "due coin" bookkeeping for fouls when nothing is pocketed.
 * The board's own painted lines are decoration here, not law.
 */
import type { Outcome, Slot, TurnGameRules } from '../types';
import { BASELINE_X, BASELINE_Y, COIN_R, legalStrikerX, openingCoins, simulateShot } from './physics';
import type { Coin, CoinKind, Shot } from './physics';

export interface ShotSummary {
  player: Slot;
  pocketed: CoinKind[];
  strikerIn: boolean;
  contact: boolean;
  queenCovered: boolean;
  foul: string | null;
}

export interface CarromState {
  coins: Coin[];
  turn: Slot;
  /** where the striker sits for the player about to shoot */
  strikerX: number;
  /** the queen: on the board, owned by a player, or just returned */
  queen: 'board' | 'p0' | 'p1';
  /** set when the queen has been sunk but not yet covered */
  queenPending: Slot | null;
  fouls: [number, number];
  shots: number;
  lastShot: ShotSummary | null;
  /**
   * The shot that produced this state — the clamped one the referee actually ran,
   * not the one the player sent. It is here so that the *other* player's browser
   * can replay the shot frame by frame instead of watching the coins teleport.
   * `id` is the shot counter, which is what makes a replay run exactly once.
   */
  lastMove: { id: number; player: Slot; shot: Shot } | null;
  log: string[];
  over: boolean;
  winner: Slot | null;
  reason: string;
}

export const colourOf = (p: Slot): CoinKind => (p === 0 ? 'white' : 'black');
export const liveOf = (s: CarromState, p: Slot) => s.coins.filter((c) => c.alive && c.kind === colourOf(p)).length;
/** Counted from the coins themselves, not from a counter that can drift — and
 *  correct even on a hand-built board that holds fewer than nine of a colour. */
export const pocketedOf = (s: CarromState, p: Slot) => s.coins.filter((c) => !c.alive && c.kind === colourOf(p)).length;

/** Free spot nearest the centre for a coin coming back onto the board. */
export function respawnPoint(coins: Coin[]): { x: number; y: number } {
  const centre = { x: 50, y: 50 };
  const free = (x: number, y: number) => coins.every((c) => !c.alive || Math.hypot(c.x - x, c.y - y) > COIN_R * 2.02);
  if (free(centre.x, centre.y)) return centre;
  for (let ring = 1; ring <= 7; ring++) {
    const r = ring * COIN_R * 2;
    const count = 6 * ring;
    for (let k = 0; k < count; k++) {
      const a = (Math.PI * 2 * k) / count;
      const x = centre.x + Math.cos(a) * r;
      const y = centre.y + Math.sin(a) * r;
      if (x > COIN_R * 2 && x < 100 - COIN_R * 2 && y > COIN_R * 2 && y < 100 - COIN_R * 2 && free(x, y)) return { x, y };
    }
  }
  return centre;
}

function revive(state: CarromState, kind: CoinKind): CarromState {
  const coin = state.coins.find((c) => !c.alive && c.kind === kind);
  if (!coin) return state;
  const p = respawnPoint(state.coins);
  return {
    ...state,
    coins: state.coins.map((c) => (c.id === coin.id ? { ...c, alive: true, x: p.x, y: p.y } : c)),
  };
}

export function createInitial(): CarromState {
  return {
    coins: openingCoins(),
    turn: 0,
    strikerX: 50,
    queen: 'board',
    queenPending: null,
    fouls: [0, 0],
    shots: 0,
    lastShot: null,
    lastMove: null,
    log: ['White breaks.'],
    over: false,
    winner: null,
    reason: '',
  };
}

const clampShot = (s: CarromState, player: Slot, shot: Shot): Shot => ({
  x: legalStrikerX(s.coins, player, Number.isFinite(shot.x) ? shot.x : 50),
  angle: Number.isFinite(shot.angle) ? shot.angle : -Math.PI / 2,
  power: Math.min(1, Math.max(0.05, Number.isFinite(shot.power) ? shot.power : 0.6)),
});

/**
 * Take one shot. Pure: returns a new state, never touches the old one.
 *
 * The turn logic reads like the rules text on purpose — the order of the checks
 * is the order in which they matter: fouls first (they override everything),
 * then what was sunk, then whether the queen still needs covering.
 */
export function applyShot(state: CarromState, player: Slot, raw: Shot): CarromState {
  if (state.over || player !== state.turn) return state;
  const shot = clampShot(state, player, raw);
  const sim = simulateShot(state.coins, { x: shot.x, y: BASELINE_Y[player] }, shot);

  const sunk = sim.pocketed.map((id) => state.coins.find((c) => c.id === id)!).filter(Boolean);
  const kinds = sunk.map((c) => c.kind);
  const own = kinds.filter((k) => k === colourOf(player)).length;
  const opp = kinds.filter((k) => k === colourOf((player === 0 ? 1 : 0))).length;
  const queenIn = kinds.includes('queen');

  let next: CarromState = {
    ...state,
    coins: sim.coins,
    shots: state.shots + 1,
    lastMove: { id: state.shots + 1, player, shot },
    strikerX: legalStrikerX(sim.coins, (player === 0 ? 1 : 0) as Slot, 50),
  };

  const say = (text: string) => { next.log = [...next.log, text].slice(-14); };

  /* ---- fouls ---------------------------------------------------------- */
  if (sim.strikerPocketed) {
    next.fouls = [state.fouls[0] + (player === 0 ? 1 : 0), state.fouls[1] + (player === 1 ? 1 : 0)];
    next = revive(next, colourOf(player));
    say(`Striker in the pocket — a ${colourOf(player)} goes back. Foul.`);
    return passTurn(next, player, false);
  }
  if (!sim.contact) {
    next.fouls = [state.fouls[0] + (player === 0 ? 1 : 0), state.fouls[1] + (player === 1 ? 1 : 0)];
    say('Nothing touched. Foul.');
    return passTurn(next, player, false);
  }

  /* ---- the queen ------------------------------------------------------ */
  let queenCovered = false;
  if (queenIn) {
    if (own > 0) { queenCovered = true; next.queen = player === 0 ? 'p0' : 'p1'; next.queenPending = null; }
    else { next.queenPending = player; }
  } else if (state.queenPending === player) {
    if (own > 0) { queenCovered = true; next.queen = player === 0 ? 'p0' : 'p1'; next.queenPending = null; }
    else {
      next = revive(next, 'queen');
      next.queenPending = null;
      next.queen = 'board';
      say('The queen was not covered — back to the centre.');
    }
  }

  next.lastShot = {
    player, pocketed: kinds, strikerIn: false, contact: true, queenCovered,
    foul: null,
  };

  /* The queen rule that keeps the queen from being decoration: you cannot go out
     while she is still on the board. Your last coin comes back as a "due" and
     the turn passes, so the end of a game always involves her. */
  if (liveOf(next, player) === 0 && next.queen === 'board' && next.queenPending === null) {
    next = revive(next, colourOf(player));
    say('The queen is still on the board — the last coin comes back.');
    next.lastShot = { player, pocketed: kinds, strikerIn: false, contact: true, queenCovered, foul: 'queen_due' };
    return passTurn(next, player, false);
  }

  const sunkText = [
    own ? `${own} ${colourOf(player)}` : '',
    opp ? `${opp} ${colourOf((player === 0 ? 1 : 0) as Slot)}` : '',
    queenIn ? 'the queen' : '',
  ].filter(Boolean).join(', ');
  if (sunkText) say(`${player === 0 ? 'White' : 'Black'} sunk ${sunkText}.`);
  else say(`${player === 0 ? 'White' : 'Black'} shot — nothing sunk.`);

  const finish = checkOver(next);
  if (finish) return finish;

  // an own coin (or a covered queen with the shot that took it) earns another shot
  const again = own > 0 || (queenIn && queenCovered);
  return passTurn(next, player, again);
}

function passTurn(state: CarromState, player: Slot, again: boolean): CarromState {
  const turn: Slot = again ? player : ((player === 0 ? 1 : 0) as Slot);
  const next: CarromState = {
    ...state,
    turn,
    strikerX: legalStrikerX(state.coins, turn, 50),
  };
  const done = checkOver(next);
  return done ?? next;
}

function checkOver(state: CarromState): CarromState | null {
  for (const p of [0, 1] as Slot[]) {
    if (liveOf(state, p) === 0 && state.queen !== 'board') {
      const other: Slot = p === 0 ? 1 : 0;
      // a queen still owed to nobody cannot leave the board — that is the one
      // way a player can be "out" and still not win
      if (state.queenPending === p) {
        return { ...state, log: [...state.log, 'All coins down, but the queen is uncovered.'].slice(-14) };
      }
      return {
        ...state,
        over: true,
        winner: p,
        reason: `${p === 0 ? 'White' : 'Black'} cleared the board${state.queen === (p === 0 ? 'p0' : 'p1') ? ' and took the queen' : ''}. ${other === 0 ? 'White' : 'Black'} had ${pocketedOf(state, other)} down.`,
        log: [...state.log, `${p === 0 ? 'White' : 'Black'} wins.`].slice(-14),
      };
    }
  }
  /* A board that has taken 120 shots is finished in every sense that matters:
     nobody wants a room that cannot end. Most coins down wins. */
  if (state.shots >= 120) {
    const a = pocketedOf(state, 0), b = pocketedOf(state, 1);
    return {
      ...state, over: true, winner: a === b ? null : a > b ? 0 : 1,
      reason: a === b ? 'Level after 120 shots.' : `Out of shots — ${a > b ? 'white' : 'black'} had more down.`,
    };
  }
  return null;
}

/* ------------------------------------------------------------------ referee */

export interface CarromMove { x: number; angle: number; power: number }

export const carromRules: TurnGameRules<CarromState, CarromMove> = {
  id: 'carrom',
  createInitialState: () => createInitial(),
  currentPlayer: (s) => (s.over ? null : s.turn),
  legalMoves: (s, player) => {
    if (s.over || player !== s.turn) return [];
    const moves: CarromMove[] = [];
    // a honest spread of options: three placements, eight directions, three powers
    for (const fx of [0.28, 0.5, 0.72]) {
      const x = BASELINE_X[0] + (BASELINE_X[1] - BASELINE_X[0]) * fx;
      if (legalStrikerX(s.coins, player, x) !== x) continue;
      for (let i = 0; i < 8; i++) {
        const angle = player === 0 ? -Math.PI / 2 + (i - 3.5) * 0.22 : Math.PI / 2 + (i - 3.5) * 0.22;
        for (const power of [0.45, 0.7, 0.95]) moves.push({ x, angle, power });
      }
    }
    return moves;
  },
  isLegal: (s, player, move): move is CarromMove => {
    if (s.over || player !== s.turn) return false;
    if (!move || typeof move !== 'object') return false;
    const m = move as CarromMove;
    if (!Number.isFinite(m.x) || !Number.isFinite(m.angle) || !Number.isFinite(m.power)) return false;
    if (m.x < BASELINE_X[0] - 0.01 || m.x > BASELINE_X[1] + 0.01) return false;
    if (Math.abs(m.power) < 0.02 || m.power > 1) return false;
    return true;
  },
  /* An illegal move is a no-op, never a crash: the relay trusts `isLegal` first,
     but a referee that throws on junk takes the whole room down with it. */
  applyMove: (s, player, move) => (carromRules.isLegal(s, player, move) ? applyShot(s, player, move) : s),
  result: (s): Outcome => (s.over ? { over: true, winner: s.winner, reason: s.reason } : { over: false }),
  describeMove: (_s, _p, m) => {
    const deg = Math.round((m.angle * 180) / Math.PI);
    return `striker at ${Math.round(m.x)} · ${deg}° · ${Math.round(m.power * 100)}% power`;
  },
};
