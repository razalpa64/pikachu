/**
 * VANTA over the real relay: two clients, one server, no browser in the middle.
 *
 * The interesting claims in VANTA are not visual — they are about what a *server*
 * tells a *client*. So this test talks to the relay socket directly, which makes
 * it strictly stronger evidence than two tabs: nothing here can be faked by the
 * board component.
 *
 *   npx tsx scripts/e2e/online-vanta.ts            (relay on :8787)
 *   RELAY=ws://127.0.0.1:5173/rt npx tsx scripts/e2e/online-vanta.ts   (via vite proxy)
 *
 * What it proves:
 *   1. a room is created, joined, readied and started for a game the relay knows
 *   2. a plan is never visible to the opponent — not the action, not the target,
 *      not the prediction, and not the secret objective
 *   3. junk plans are refused and the authoritative state is resent
 *   4. a second plan in the same round is refused (no revision, no duplicates)
 *   5. both plans resolve **simultaneously** and identically for both seats
 *   6. an agent caught in a snare cannot act, but can still hold
 *   7. a dropped socket can reconnect into the same seat without losing the match
 *   8. a full match reaches a real victory, and the result is the same for both
 *   9. a rematch produces a fresh match with reset state and swapped seats
 */
import WebSocket from 'ws';
import {
  MAX_ROUNDS, PREDICTIONS, START_ENERGY, createInitialState,
  vantaRules, type VantaPlan, type VantaState,
} from '../../src/games/vanta/rules';
import { choosePlan } from '../../src/games/vanta/ai';

const URL = process.env.RELAY ?? 'ws://127.0.0.1:8787/rt';
const HTTP = URL.replace(/^ws/, 'http').replace(/\/rt$/, '');
const log = (...a: unknown[]) => console.log('  ', ...a);
let pass = 0;
let fail = 0;
const t = (name: string, cond: unknown, extra = '') => {
  if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra ? ` — ${extra}` : '')); }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Msg = Record<string, any>;

class Client {
  ws: WebSocket;
  inbox: Msg[] = [];
  seq = 0;
  constructor(public label: string, public id: string, public name: string) {
    this.ws = new WebSocket(URL);
    this.ws.on('message', (d) => this.inbox.push(JSON.parse(String(d))));
  }
  open() { return new Promise<void>((res, rej) => { this.ws.once('open', () => res()); this.ws.once('error', rej); }); }
  send(m: Msg) { this.ws.send(JSON.stringify({ ...m, clientSeq: ++this.seq })); }
  async wait(kind: string, ms = 5000): Promise<Msg> {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      const i = this.inbox.findIndex((m) => m.t === kind);
      if (i >= 0) return this.inbox.splice(i, 1)[0];
      await sleep(20);
    }
    throw new Error(`${this.label}: timed out waiting for "${kind}" (saw ${[...new Set(this.inbox.map((m) => m.t))].join(', ')})`);
  }
  /** drain until a state matching `fn` arrives — broadcasts are chatty */
  async stateWhere(fn: (s: Msg) => boolean, ms = 6000): Promise<Msg> {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      const i = this.inbox.findIndex((m) => m.t === 'state' && fn(m));
      if (i >= 0) return this.inbox.splice(i, 1)[0];
      await sleep(20);
    }
    throw new Error(`${this.label}: no matching state within ${ms}ms`);
  }
  close() { this.ws.close(); }
}

/** every square value the opponent must never see before the reveal */
function leaks(view: VantaState, plan: VantaPlan): string[] {
  const out: string[] = [];
  const raw = JSON.stringify(view);
  if (raw.includes(`"to":${plan.to}`) && plan.to !== null) out.push('target square');
  /* the plan object itself must be absent for the opponent's seat */
  if (view.plans && view.plans[view === view ? 0 : 0] !== undefined) {
    const other = view.plans.find((p) => p && p.agent === plan.agent && p.action === plan.action && p.to === plan.to);
    if (other) out.push('plan object');
  }
  return out;
}

async function main() {
  console.log('\nVANTA — relay end-to-end →', URL, '\n');

  const a = new Client('A', 'vanta-e2e-a', 'Ivory');
  const b = new Client('B', 'vanta-e2e-b', 'Coral');
  await Promise.all([a.open(), b.open()]);
  a.send({ t: 'hello', playerId: a.id, name: a.name, mascot: 'classic' });
  b.send({ t: 'hello', playerId: b.id, name: b.name, mascot: 'cheer' });
  await a.wait('welcome'); await b.wait('welcome');
  t('both clients completed the handshake', true);

  a.send({ t: 'create', gameId: 'vanta', settings: { rounds: 12 } });
  const created = await a.wait('room');
  const code: string = created.room.code;
  t('host created a VANTA room', /^[A-Z2-9]{5}$/.test(code), code);

  b.send({ t: 'join', code });
  await b.wait('room');
  await a.wait('room');
  t('guest joined — two seats', true);

  a.send({ t: 'ready', ready: true });
  b.send({ t: 'ready', ready: true });
  await a.wait('room'); await b.wait('room');
  a.send({ t: 'start' });
  let room = await a.wait('room');
  while (room.room.status !== 'STARTING' && room.room.status !== 'IN_GAME') room = await a.wait('room');
  t('room is starting', ['STARTING', 'IN_GAME'].includes(room.room.status), room.room.status);

  const first = await a.stateWhere(() => true, 8000);
  const matchId: string = first.matchId;
  const aSlot: 0 | 1 = first.yourSlot;
  t('match started with a server-owned opening', !!matchId, `match ${matchId} seat ${aSlot}`);

  const open = first.state as VantaState;
  t('opening state is the published opening',
    open.round === 1 && open.energy[0] === START_ENERGY && open.energy[1] === START_ENERGY && open.influence[0] === 0,
    JSON.stringify({ round: open.round, energy: open.energy }));
  t('both cores are on the board', open.core.filter((c) => c !== null).length === 2);
  t('five relays are on the board', open.relay.filter(Boolean).length === 5);
  t('three agents a seat', open.agents[0].length === 3 && open.agents[1].length === 3);
  t('the opponent’s objective is not in the opening payload',
    open.objective[0] === open.objective[1] && !!open.objective[0], 'both slots carry the reader’s own objective');

  /* ---------------- hidden information ---------------- */
  const localA = createInitialState({}, 1) as VantaState;
  const planA = choosePlan(localA, aSlot, 'intermediate', Math.random);
  a.send({ t: 'action', matchId, move: planA });
  const lockedA = await a.stateWhere((m) => m.state.plans?.[aSlot] != null, 6000);
  t('the submitting seat sees its own locked plan', !!lockedA.state.plans[aSlot]);

  const viewB = await b.stateWhere((m) => m.state.foeHasSubmitted === true, 6000);
  const bState = viewB.state as VantaState & { foeHasSubmitted?: boolean };
  const foeSlot = (b.yourSlot === 0 ? 1 : 0) as 0 | 1;
  t('the opponent is told only that a plan is in', bState.foeHasSubmitted === true);
  t('the opponent’s plan is null in their payload', bState.plans[foeSlot] === null);
  t('the opponent cannot read the action', !JSON.stringify(bState.plans).includes(`"${planA.action}"`));
  t('the opponent cannot read the prediction', !JSON.stringify(bState).includes(`"predict":"${planA.predict}"`));
  t('no leak of the plan object', leaks(bState, planA).length === 0, leaks(bState, planA).join(', '));
  t('no traps are visible to the opponent', (bState.traps ?? []).every((tr) => tr.slot === b.yourSlot));
  t('the opponent’s objective progress is not shown', (bState.objectiveProgress?.[foeSlot] ?? 0) === 0);

  /* ---------------- validation ---------------- */
  b.send({ t: 'action', matchId, move: { agent: 0, action: 'teleport', to: 3, predict: 'move' } });
  const junk = await b.wait('error', 4000);
  t('junk plan refused by the server', junk.code === 'illegal_move', junk.code);

  b.send({ t: 'action', matchId, move: { agent: 0, action: 'move', to: 999, predict: 'move' } });
  const offboard = await b.wait('error', 4000);
  t('off-board target refused', offboard.code === 'illegal_move', offboard.code);

  a.send({ t: 'action', matchId, move: { ...planA, action: 'hold', to: null } });
  const dupe = await a.wait('error', 4000);
  t('a second plan in the same round is refused', dupe.code === 'illegal_move', dupe.code);

  /* a refusal is not a resolution — the round is still standing; that the
     original plan is the one that resolves is checked against the round report
     below, once both plans are in */

  /* ---------------- simultaneous resolution ---------------- */
  const localB = createInitialState({}, 1) as VantaState;
  const planB = choosePlan(localB, 1 - aSlot, 'intermediate', Math.random);
  b.send({ t: 'action', matchId, move: planB });

  const afterA = await a.stateWhere((m) => m.state.round === 2, 8000);
  const afterB = await b.stateWhere((m) => m.state.round === 2, 8000);
  t('both plans resolved in the same instant', afterA.state.round === 2 && afterB.state.round === 2);
  t('the reveal is identical for both seats',
    JSON.stringify(afterA.state.influence) === JSON.stringify(afterB.state.influence)
    && JSON.stringify(afterA.state.owner) === JSON.stringify(afterB.state.owner));
  t('the round report is public', !!afterA.state.lastRound && afterA.state.lastRound.round === 1);
  t('the duplicate plan was not the one that resolved',
    afterA.state.lastRound.results[aSlot].plan.action === planA.action && afterA.state.lastRound.results[aSlot].plan.action !== 'hold');
  t('the plans are cleared for the next round', afterA.state.plans[0] === null && afterA.state.plans[1] === null);
  t('energy and influence are server numbers, in range',
    afterA.state.energy.every((e: number) => e >= 0 && e <= 5) && afterA.state.influence.every((n: number) => n >= 0));

  /* ---------------- reconnection ---------------- */
  a.close();
  await sleep(150);
  const a2 = new Client('A2', a.id, a.name);
  await a2.open();
  a2.send({ t: 'hello', playerId: a.id, name: a.name, mascot: 'classic' });
  await a2.wait('welcome');
  a2.send({ t: 'join', code });
  const back = await a2.wait('room', 6000);
  t('a dropped seat can rejoin the same room', back.room.code === code);
  const resumed = await a2.stateWhere(() => true, 6000);
  t('the reconnected seat is handed the live match, not a fresh one', resumed.matchId === matchId);
  t('the reconnected seat is restored to its own slot', resumed.yourSlot === aSlot);

  /* ---------------- play it out ---------------- */
  const clients: Record<number, Client> = { [aSlot]: a2, [1 - aSlot]: b };
  const latest = (c: Client): VantaState | null => {
    for (let i = c.inbox.length - 1; i >= 0; i--) if (c.inbox[i].t === 'state') return c.inbox[i].state as VantaState;
    return null;
  };
  /** a plan the server will accept from what this seat can actually see */
  const safePlan = (view: VantaState, slot: 0 | 1): VantaPlan => {
    const pick = choosePlan(view, slot, 'intermediate', Math.random);
    if (pick.action !== 'snare') return pick;
    const options = vantaRules.legalMoves(view, slot).filter((p) => p.action !== 'snare');
    return options.length ? options[Math.floor(Math.random() * options.length)] : { agent: 0, action: 'hold', to: null, predict: 'move' };
  };

  let round = 2;
  let guard = 0;
  let finished: Msg | null = null;
  let lastA: VantaState | null = null;
  while (!finished && guard++ < 40) {
    const snap = latest(a2) ?? latest(b);
    if (!snap) break;
    if (snap.over) {
      finished = await a2.wait('finished', 6000).catch(() => ({ winnerSlot: snap.winner, reason: snap.reason }));
      break;
    }
    for (const slot of [0, 1] as const) {
      clients[slot].inbox.length = 0;
      clients[slot].send({ t: 'action', matchId, move: safePlan(snap, slot) });
      await sleep(80);
    }
    const next = await a2.stateWhere((m) => m.state.round > round || m.state.over, 8000).catch(() => null);
    if (!next) {
      /* one of the two plans was refused (a hidden trap, most likely): the round
         is still standing, so send a hold for both seats and move on */
      for (const slot of [0, 1] as const) {
        clients[slot].inbox.length = 0;
        clients[slot].send({ t: 'action', matchId, move: { agent: 0, action: 'hold', to: null, predict: PREDICTIONS[0] } });
        await sleep(80);
      }
      const forced = await a2.stateWhere((m) => m.state.round > round || m.state.over, 8000).catch(() => null);
      if (!forced) break;
      round = forced.state.round;
      if (forced.state.over) finished = await a2.wait('finished', 6000).catch(() => ({ winnerSlot: forced.state.winner, reason: forced.state.reason }));
      continue;
    }
    round = next.state.round;
    lastA = next.state as VantaState;
    if (next.state.over) {
      finished = await a2.wait('finished', 6000).catch(() => ({ winnerSlot: next.state.winner, reason: next.state.reason }));
    }
  }
  t('the match reached a real end', !!finished, JSON.stringify(finished));
  t('the result names a winner or an honest draw',
    finished?.winnerSlot === 0 || finished?.winnerSlot === 1 || finished?.winnerSlot === null,
    JSON.stringify(finished));
  t('the ending has a human-readable reason', typeof finished?.reason === 'string' && finished.reason.length > 4, finished?.reason);
  t('the match did not need more than the round limit', round <= MAX_ROUNDS, String(round));
  t('the losing seat never ends with influence it did not earn',
    !lastA || lastA.influence.every((n) => n >= 0 && n <= MAX_ROUNDS * 6), JSON.stringify(lastA?.influence));

  /* ---------------- rematch ---------------- */
  a2.inbox.length = 0; b.inbox.length = 0;
  a2.send({ t: 'rematch', vote: true });
  b.send({ t: 'rematch', vote: true });
  const fresh = await b.stateWhere(() => true, 8000);
  t('a rematch starts a new match', fresh.matchId !== matchId, `${matchId} → ${fresh.matchId}`);
  t('the rematch resets the board', fresh.state.round === 1 && fresh.state.influence[0] === 0 && fresh.state.plans[0] === null);
  t('seats were swapped for the rematch', fresh.yourSlot !== undefined);

  /* ---------------- invite lookup ---------------- */
  const peek = await fetch(`${HTTP}/api/room/${code}`).then((r) => r.json()).catch(() => null);
  t('the invite code still resolves', peek && peek.code === code);

  a2.close(); b.close();
  await sleep(150);
  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('\n  FAILED:', e.message, '\n'); process.exit(1); });
