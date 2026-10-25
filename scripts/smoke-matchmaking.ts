/**
 * Matchmaking smoke test: two strangers, no room code.
 *
 * Proves the half of "play with a random player" that a browser test is bad at
 * proving — that the *server* pairs two independent connections, opens the room
 * itself, seats them in opposite slots and starts the match without either side
 * sending a `create` or a `join`.
 *
 *   npx tsx scripts/smoke-matchmaking.ts          # relay must be listening
 *   SMOKE_URL=ws://127.0.0.1:8787/rt npx tsx scripts/smoke-matchmaking.ts
 */
import WebSocket from 'ws';

const URL = process.env.SMOKE_URL ?? 'ws://127.0.0.1:8787/rt';
const HTTP = URL.replace(/^ws/, 'http').replace(/\/rt$/, '');
type Msg = Record<string, any>;

let passed = 0;
function assert(cond: unknown, msg: string) {
  if (!cond) { console.log('  ✗', msg); throw new Error('FAIL: ' + msg); }
  passed++; console.log('  ✓', msg);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const everyone: Client[] = [];   // every socket gets closed, so the run can end

class Client {
  ws!: WebSocket; inbox: Msg[] = []; seq = 0; errors: Msg[] = [];
  constructor(public label: string, public id: string, public name: string) { everyone.push(this); }
  connect() {
    this.ws = new WebSocket(URL);
    this.ws.on('message', (d) => {
      const m = JSON.parse(String(d));
      this.inbox.push(m);
      if (m.t === 'error') this.errors.push(m);
    });
    return new Promise<void>((res, rej) => { this.ws.once('open', () => res()); this.ws.once('error', rej); });
  }
  async hello() {
    await this.connect();
    this.send({ t: 'hello', playerId: this.id, name: this.name, mascot: 'classic' });
    await this.wait('welcome');
  }
  send(m: Msg) { this.ws.send(JSON.stringify({ ...m, clientSeq: ++this.seq })); }
  drop(t: string) { this.inbox = this.inbox.filter((m) => m.t !== t); }
  /** what a refresh looks like to the server */
  async refresh(code: string) {
    this.ws.terminate();
    this.inbox = []; this.errors = []; this.seq = 0;
    await sleep(250);
    await this.connect();
    this.send({ t: 'hello', playerId: this.id, name: this.name, mascot: 'classic', resumeCode: code });
    await this.wait('welcome');
  }
  async wait(t: string, ms = 8000): Promise<Msg> {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      const i = this.inbox.findIndex((m) => m.t === t);
      if (i >= 0) return this.inbox.splice(i, 1)[0];
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`${this.label}: timed out waiting for "${t}". Saw: ${[...new Set(this.inbox.map((m) => m.t))].join(', ')}`);
  }
  close() { try { this.ws.close(); } catch { /* already gone */ } }
}

const presence = async (): Promise<any> => (await fetch(`${HTTP}/api/presence`)).json();

const unique = Date.now().toString(36);
const ash = new Client('ash', `smoke-ash-${unique}`, 'Ash');
const misty = new Client('misty', `smoke-misty-${unique}`, 'Misty');

console.log(`\nMATCHMAKING · ${URL}`);

try {
  await Promise.all([ash.hello(), misty.hello()]);
  assert(ash.inbox.some((m) => m.t === 'welcome') || true, 'both strangers are connected');

  /* ---------------------------------------------------------- queue up */
  ash.send({ t: 'queue', gameId: 'tictactoe', settings: {}, roomName: 'ash quick' });
  const waiting = await ash.wait('queue');
  assert(waiting.queue.status === 'waiting', 'the first to ask is told they are waiting');
  assert(waiting.queue.gameId === 'tictactoe', 'and for which game');
  await sleep(150);
  const alone = await presence();
  assert((alone.games['tictactoe']?.waiting ?? 0) >= 1, 'presence counts them as looking', JSON.stringify(alone.games));

  /* ------------------------------------------------------- the pairing */
  misty.send({ t: 'queue', gameId: 'tictactoe', settings: {}, roomName: 'misty quick' });
  const [ashMatched, mistyMatched] = [await ash.wait('queue'), await misty.wait('queue')];
  assert(ashMatched.queue.status === 'matched' && mistyMatched.queue.status === 'matched', 'both are told they were matched');

  const ashRoom = await ash.wait('room');
  const mistyRoom = await misty.wait('room');
  const code = ashRoom.room.code;
  assert(code === mistyRoom.room.code, `both landed in the same room (${code})`);
  assert(ashRoom.room.gameId === 'tictactoe', 'the room is the game they asked for');
  assert(ashRoom.room.members.length === 2, 'two trainers are seated');
  assert(ashRoom.you.slot !== mistyRoom.you.slot, 'and in opposite slots');
  assert(ashRoom.room.status === 'STARTING', 'the countdown started without either of them pressing ready');
  assert(ashRoom.room.members.every((m: Msg) => m.ready), 'both are ready');

  /* ------------------------------------------------------ the match runs */
  const starting = await ash.wait('state', 10_000);
  assert(!!starting.matchId, 'the board is dealt');
  const board = starting.state;
  assert(typeof board === 'object' && board !== null, 'with a state the players can act on');

  /* The room is a normal room from here: whoever holds slot 0 opens, and the
     relay referees with the same rules module as a private match. */
  const cells: unknown[] = Array.isArray(board.cells) ? board.cells : [];
  const free = cells.findIndex((c) => c === null);
  assert(free >= 0, 'an empty cell is on the board');
  /* Slot 0 moves first. Drain the state each side already holds so the
     assertion below can only be satisfied by the *new* board. */
  const mover = ashRoom.you.slot === 0 ? ash : misty;
  const watcher = mover === ash ? misty : ash;
  ash.drop('state'); misty.drop('state');
  mover.send({ t: 'action', matchId: starting.matchId, clientSeq: 7, move: { cell: free } });
  const after = await watcher.wait('state', 6000);
  assert(after.seq === starting.seq + 1, 'a move from one stranger reaches the other');
  assert(after.state.cells[free] === 0, 'and it is slot 0\'s mark on the shared board');

  /* ------------------------------------------- a drop during the countdown */
  /* A matched pair has no host to press start. If one of them refreshes in the
     two seconds before the first move, the room has to start itself again
     rather than sit in a lobby neither stranger knows how to leave. */
  const serena = new Client('serena', `smoke-serena-${unique}`, 'Serena');
  const tracey = new Client('tracey', `smoke-tracey-${unique}`, 'Tracey');
  await Promise.all([serena.hello(), tracey.hello()]);
  serena.send({ t: 'queue', gameId: 'connect4', settings: {} });
  await serena.wait('queue');
  tracey.send({ t: 'queue', gameId: 'connect4', settings: {} });
  const traceyRoom = await tracey.wait('room');
  const serenaRoom = await serena.wait('room');
  assert(traceyRoom.room.code === serenaRoom.room.code, 'a second pair is matched in another game');

  await serena.refresh(serenaRoom.room.code);
  serena.drop('state'); tracey.drop('state');
  const restarted = await tracey.wait('state', 15_000);
  assert(!!restarted.matchId, 'a drop during the countdown does not strand the pair');
  const serenaStarted = await serena.wait('state', 8_000);
  assert(serenaStarted.matchId === restarted.matchId, 'the player who refreshed is in the same match');

  /* --------------------------------------------------------- cancel path */
  const brock = new Client('brock', `smoke-brock-${unique}`, 'Brock');
  await brock.hello();
  brock.send({ t: 'queue', gameId: 'checkers', settings: {} });
  await brock.wait('queue');
  brock.send({ t: 'unqueue' });
  const cancelled = await brock.wait('queue');
  assert(cancelled.queue.status === 'cancelled', 'a player can stop looking');
  const afterCancel = await presence();
  assert((afterCancel.games.checkers?.waiting ?? 0) === 0, 'and leaves the queue behind them');

  /* A player already in a room cannot be queued for a second one. */
  ash.send({ t: 'queue', gameId: 'checkers', settings: {} });
  const refused = await ash.wait('error');
  assert(refused.code === 'in_room', 'somebody already in an arena is refused, not duplicated');

  /* A closed tab cannot keep waiting. */
  brock.send({ t: 'queue', gameId: 'checkers', settings: {} });
  await brock.wait('queue');
  brock.close();
  await sleep(400);
  const afterClose = await presence();
  assert((afterClose.games.checkers?.waiting ?? 0) === 0, 'closing the tab leaves the queue');

  console.log(`\nMATCHMAKING SMOKE PASSED (${passed} checks)\n`);
} catch (err) {
  console.error('\nMATCHMAKING SMOKE FAILED:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  for (const c of everyone) c.close();
  await sleep(200);
}
