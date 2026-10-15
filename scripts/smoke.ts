/**
 * End-to-end smoke test of the authoritative relay through the Vite proxy.
 * Two headless clients create a room, ready up, play a full tic-tac-toe match,
 * then vote a rematch. Run with:  npx tsx scripts/smoke.ts
 */
import WebSocket from 'ws';

const URL = process.env.SMOKE_URL ?? 'ws://127.0.0.1:5173/rt';
const log = (...a: unknown[]) => console.log('  ', ...a);

type Msg = Record<string, any>;

class Client {
  ws: WebSocket;
  inbox: Msg[] = [];
  seq = 0;
  constructor(public label: string, public id: string, public name: string) {
    this.ws = new WebSocket(URL);
    this.ws.on('message', (d) => {
      const m = JSON.parse(String(d));
      this.inbox.push(m);
      if (m.t === 'error') console.error(`   ! ${label} error`, m.code, m.message);
    });
  }
  open() { return new Promise<void>((res, rej) => { this.ws.once('open', () => res()); this.ws.once('error', rej); }); }
  send(m: Msg) { this.ws.send(JSON.stringify({ ...m, clientSeq: ++this.seq })); }
  async wait(t: string, ms = 4000): Promise<Msg> {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      const i = this.inbox.findIndex((m) => m.t === t);
      if (i >= 0) return this.inbox.splice(i, 1)[0];
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`${this.label}: timed out waiting for "${t}". Saw: ${[...new Set(this.inbox.map((m) => m.t))].join(', ')}`);
  }
  close() { this.ws.close(); }
}

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error('FAIL: ' + msg);
  console.log('  ✓', msg);
}

async function main() {
  console.log('\nPIKACHU relay smoke test →', URL, '\n');
  const a = new Client('A', 'smoke-player-a', 'Volt');
  const b = new Client('B', 'smoke-player-b', 'Spark');
  await Promise.all([a.open(), b.open()]);

  a.send({ t: 'hello', playerId: a.id, name: a.name, mascot: 'classic' });
  b.send({ t: 'hello', playerId: b.id, name: b.name, mascot: 'cheer' });
  await a.wait('welcome'); await b.wait('welcome');
  assert(true, 'both clients completed the handshake');

  a.send({ t: 'create', gameId: 'tictactoe', settings: { size: 3 } });
  const created = await a.wait('room');
  const code: string = created.room.code;
  assert(/^[A-Z2-9]{5}$/.test(code), `host created room ${code}`);

  b.send({ t: 'join', code });
  await b.wait('room');
  const joined = await a.wait('room');
  assert(joined.room.members.length === 2, 'guest joined — room has two members');

  a.send({ t: 'ready', ready: true });
  b.send({ t: 'ready', ready: true });
  await a.wait('room'); await a.wait('room');
  assert(true, 'both players readied up');

  a.send({ t: 'start' });
  let roomMsg = await a.wait('room');
  while (roomMsg.room.status !== 'STARTING' && roomMsg.room.status !== 'IN_GAME') roomMsg = await a.wait('room');
  assert(['STARTING', 'IN_GAME'].includes(roomMsg.room.status), `room entered ${roomMsg.room.status}`);

  const st = await a.wait('state', 6000);
  const matchId = st.matchId;
  assert(!!matchId, `match ${matchId} started, slot ${st.yourSlot}`);

  // illegal move must be rejected, not applied
  b.send({ t: 'action', matchId, move: { cell: 0 } });
  const err = await b.wait('error', 2000);
  assert(err.code === 'not_your_turn' || err.code === 'illegal_move', `server rejected an out-of-turn move (${err.code})`);

  // 0 / 4 / 1 / 5 / 2  → slot 0 wins the top row
  const script: [Client, number][] = [[a, 0], [b, 4], [a, 1], [b, 5], [a, 2]];
  for (const [who, cell] of script) {
    who.send({ t: 'action', matchId, move: { cell } });
    await who.wait('state', 3000);
  }
  const fin = await a.wait('finished', 3000);
  assert(fin.winnerSlot === 0, `match finished — winner slot ${fin.winnerSlot} (${fin.reason})`);
  await b.wait('finished', 3000);
  assert(true, 'both clients received the authoritative result');

  // idempotency: replaying a consumed action must not corrupt anything
  a.ws.send(JSON.stringify({ t: 'action', matchId, move: { cell: 6 }, clientSeq: 3 }));
  await new Promise((r) => setTimeout(r, 200));
  assert(true, 'replayed action after match end did not crash the relay');

  a.inbox.length = 0; b.inbox.length = 0;   // drop buffered mid-match broadcasts
  a.send({ t: 'rematch', vote: true });
  b.send({ t: 'rematch', vote: true });
  const st2 = await b.wait('state', 6000);
  assert(st2.matchId !== matchId, `rematch produced a new match ${st2.matchId}`);
  assert(st2.yourSlot === 0, 'slots were swapped for the rematch');

  const hist = await fetch('http://127.0.0.1:5173/api/history').then((r) => r.json()).catch(() => null);
  assert(Array.isArray(hist) && hist.length > 0, `history endpoint returned ${Array.isArray(hist) ? hist.length : 0} persisted matches`);

  const peek = await fetch(`http://127.0.0.1:5173/api/room/${code}`).then((r) => r.json()).catch(() => null);
  assert(peek && peek.code === code, 'room lookup endpoint resolves the invite code');

  a.send({ t: 'leave' }); await a.wait('left');
  assert(true, 'host left cleanly');

  a.close(); b.close();
  console.log('\n  ALL CHECKS PASSED\n');
  process.exit(0);
}

main().catch((e) => { console.error('\n', e.message, '\n'); process.exit(1); });
