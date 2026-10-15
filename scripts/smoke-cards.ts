/**
 * Online Wild Eights, against the real relay through the Vite proxy.
 *
 * What this proves, which the unit tests cannot: the *server* is the referee.
 * It checks that a client is never sent the other hand or the stock, that
 * out-of-turn and forged actions are rejected over the wire, and that two
 * clients can play a whole hand to a verdict.
 *
 *   npx tsx scripts/smoke-cards.ts
 */
import WebSocket from 'ws';
import { canPlay, playable, type EightsState } from '../src/games/cards/rules';

const URL = process.env.SMOKE_URL ?? 'ws://127.0.0.1:5173/rt';
type Msg = Record<string, any>;

class Client {
  ws: WebSocket; inbox: Msg[] = []; seq = 0; errors: Msg[] = [];
  constructor(public label: string, public id: string, public name: string) {
    this.ws = new WebSocket(URL);
    this.ws.on('message', (d) => {
      const m = JSON.parse(String(d));
      this.inbox.push(m);
      if (m.t === 'error') this.errors.push(m);
    });
  }
  open() { return new Promise<void>((res, rej) => { this.ws.once('open', () => res()); this.ws.once('error', rej); }); }
  send(m: Msg) { this.ws.send(JSON.stringify({ ...m, clientSeq: ++this.seq })); }
  drain(t?: string) { this.inbox = t ? this.inbox.filter((m) => m.t !== t) : []; }
  async wait(t: string, ms = 5000): Promise<Msg> {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      const i = this.inbox.findIndex((m) => m.t === t);
      if (i >= 0) return this.inbox.splice(i, 1)[0];
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`${this.label}: timed out waiting for "${t}". Saw: ${[...new Set(this.inbox.map((m) => m.t))].join(', ')}`);
  }
  close() { this.ws.close(); }
}

let passed = 0;
function assert(cond: unknown, msg: string) {
  if (!cond) { console.log('  ✗', msg); throw new Error('FAIL: ' + msg); }
  passed++; console.log('  ✓', msg);
}

async function main() {
  console.log('\nWILD EIGHTS — authoritative relay smoke test →', URL, '\n');
  const a = new Client('A', 'cards-a', 'Volt');
  const b = new Client('B', 'cards-b', 'Spark');
  await Promise.all([a.open(), b.open()]);
  a.send({ t: 'hello', playerId: a.id, name: a.name, mascot: 'classic' });
  b.send({ t: 'hello', playerId: b.id, name: b.name, mascot: 'cheer' });
  await a.wait('welcome'); await b.wait('welcome');

  a.send({ t: 'create', gameId: 'cards', settings: { handSize: 7, actionCards: true } });
  const created = await a.wait('room');
  const code: string = created.room.code;
  assert(/^[A-Z2-9]{5}$/.test(code), `room ${code} created for a game of cards`);

  b.send({ t: 'join', code });
  await b.wait('room'); await a.wait('room');
  a.send({ t: 'ready', ready: true });
  b.send({ t: 'ready', ready: true });
  await a.wait('room'); await a.wait('room');          // one broadcast per ready

  a.errors = [];
  a.send({ t: 'start' });
  let roomMsg = await a.wait('room');
  while (roomMsg.room.status !== 'STARTING' && roomMsg.room.status !== 'IN_GAME') roomMsg = await a.wait('room');
  assert(['STARTING', 'IN_GAME'].includes(roomMsg.room.status), `room entered ${roomMsg.room.status}`);

  const stA = await a.wait('state', 8000);
  const stB = await b.wait('state', 8000);
  const matchIdA = stA.matchId as string;
  let sa = stA.state as EightsState;
  let sb = stB.state as EightsState;
  assert(sa.hands[0].length === 7 && sa.hands[1].length === 7, 'both players were dealt seven cards');

  /* ---- the thing that matters most: no hidden information on the wire ---- */
  assert(sa.hands[0].every((c) => c >= 0), 'A can see its own hand');
  assert(sa.hands[1].every((c) => c === -1), 'A is NOT sent B\u2019s hand');
  assert(sb.hands[1].every((c) => c >= 0), 'B can see its own hand');
  assert(sb.hands[0].every((c) => c === -1), 'B is NOT sent A\u2019s hand');
  assert(sa.stock.every((c) => c === -1) && sb.stock.every((c) => c === -1), 'neither client is sent the stock');
  const aCards = new Set(sa.hands[0]);
  assert(sb.hands[1].every((c) => !aCards.has(c)), 'the two visible hands do not overlap');

  /* ---- the match id lives on the state message, not on the room ---- */
  assert(!!matchIdA, `the state message carries a match id (${String(matchIdA).slice(0, 14)}…)`);
  assert(!created.room.matchId, 'the room had no match id before the match began — the id must come from `state`');
  const MID = matchIdA;

  /* ---- positive control: a legal action MUST be accepted ------------------
     without this, every rejection test below could pass for the wrong reason
     (e.g. a bad match id) and prove nothing at all.                        */
  {
    const turn = sa.turn as 0 | 1;
    const me = turn === 0 ? a : b;
    const view = turn === 0 ? sa : sb;
    const opts = playable(view, turn);
    const move = opts.length ? { type: 'play', card: opts[0] }
      : view.drawnThisTurn < view.config.drawLimit ? { type: 'draw' } : { type: 'pass' };
    me.errors = [];
    me.send({ t: 'action', matchId: MID, move });
    const got = await a.wait('state', 4000);
    sa = got.state as EightsState;
    sb = (await b.wait('state', 4000)).state as EightsState;
    assert(me.errors.length === 0, 'a legal action is accepted and broadcast to both clients');
  }

  /* ---- the server rejects what the client has no right to do ---- */
  const offTurn = sa.turn === 0 ? b : a;
  const offSeat = (sa.turn === 0 ? 1 : 0) as 0 | 1;
  const offView = sa.turn === 0 ? sb : sa;
  offTurn.errors = [];
  offTurn.send({ t: 'action', matchId: MID, move: { type: 'play', card: offView.hands[offSeat][0] } });
  await new Promise((r) => setTimeout(r, 500));
  assert(offTurn.errors.length > 0, 'the server rejects a move made out of turn');

  const onTurn = sa.turn === 0 ? a : b;
  onTurn.errors = [];
  onTurn.send({ t: 'action', matchId: MID, move: { type: 'play', card: 999 } });
  await new Promise((r) => setTimeout(r, 450));
  assert(onTurn.errors.length > 0, 'the server rejects a card index that does not exist');

  onTurn.errors = [];
  const onSeat = sa.turn as 0 | 1;
  const theirView = onSeat === 0 ? sb : sa;
  const theirSeat = (onSeat === 0 ? 1 : 0) as 0 | 1;
  const theirs = theirView.hands[theirSeat].find((c) => c >= 0)!;
  onTurn.send({ t: 'action', matchId: MID, move: { type: 'play', card: theirs } });
  await new Promise((r) => setTimeout(r, 450));
  assert(onTurn.errors.length > 0, 'the server rejects playing a card you do not hold');

  onTurn.errors = [];
  onTurn.send({ t: 'action', matchId: 'not-a-real-match', move: { type: 'draw' } });
  await new Promise((r) => setTimeout(r, 450));
  assert(onTurn.errors.some((e) => e.code === 'stale_match'), 'the server rejects an action aimed at a stale match');

  /* ---- play the hand out ---- */
  const clients = [a, b] as const;
  const latest: [EightsState, EightsState] = [sa, sb];
  let finished: Msg | null = null;
  let plays = 0;

  for (let step = 0; step < 500; step++) {
    const fin = a.inbox.find((m) => m.t === 'finished') ?? b.inbox.find((m) => m.t === 'finished');
    if (fin) { finished = fin; break; }

    const turn = latest[0].turn as 0 | 1;
    const me = clients[turn];
    const view = latest[turn];

    let move: Record<string, unknown>;
    if (view.awaitingSuit) move = { type: 'suit', suit: 'hearts' };
    else if (view.pendingDraw > 0) {
      const counter = view.hands[turn].filter((c) => c >= 0 && canPlay(view, c));
      move = counter.length ? { type: 'play', card: counter[0] } : { type: 'take' };
    } else {
      const opts = playable(view, turn);
      if (opts.length) move = { type: 'play', card: opts[0] };
      else if (view.drawnThisTurn < view.config.drawLimit) move = { type: 'draw' };
      else move = { type: 'pass' };
    }

    me.errors = [];
    me.send({ t: 'action', matchId: MID, move });
    plays++;
    try {
      latest[0] = (await a.wait('state', 3000)).state as EightsState;
      latest[1] = (await b.wait('state', 3000)).state as EightsState;
    } catch {
      const fin2 = a.inbox.find((m) => m.t === 'finished') ?? b.inbox.find((m) => m.t === 'finished');
      if (fin2) { finished = fin2; break; }
      throw new Error(`no state after ${JSON.stringify(move)} by seat ${turn}` +
        (me.errors.length ? ` — server said: ${me.errors.map((e) => e.code + '/' + e.message).join(', ')}` : ' — and no error either'));
    }
  }

  assert(finished !== null, `a full hand played to a verdict over the wire (${plays} actions)`);
  assert(finished!.winnerSlot === 0 || finished!.winnerSlot === 1, `the relay named a winner (slot ${finished!.winnerSlot})`);
  assert(typeof finished!.reason === 'string' && finished!.reason.length > 0, `the relay gave a reason: "${finished!.reason}"`);

  a.close(); b.close();
  console.log(`\n  ALL ${passed} CHECKS PASSED\n`);
}

main().catch((e) => { console.error('\n  ' + e.message + '\n'); process.exit(1); });
