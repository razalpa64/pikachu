/**
 * Online Spark Quiz against the live relay.
 *
 * The property that matters here is different from a turn-based game: both
 * players answer at once, so the risk is that one client can see the other's
 * pick before committing its own. This asserts it cannot, over the wire, and
 * that the server's own clock — not a client-reported time — closes a question.
 *
 *   npx tsx scripts/smoke-quiz.ts
 */
import WebSocket from 'ws';

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
  /** newest state message, without consuming the queue */
  peekState(): Msg | undefined { return [...this.inbox].reverse().find((m) => m.t === 'state'); }
  async wait(t: string, ms = 6000): Promise<Msg> {
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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('\nSPARK QUIZ — authoritative relay smoke test →', URL, '\n');
  const a = new Client('A', 'quiz-a', 'Volt');
  const b = new Client('B', 'quiz-b', 'Spark');
  await Promise.all([a.open(), b.open()]);
  a.send({ t: 'hello', playerId: a.id, name: a.name, mascot: 'classic' });
  b.send({ t: 'hello', playerId: b.id, name: b.name, mascot: 'cheer' });
  await a.wait('welcome'); await b.wait('welcome');

  a.send({ t: 'create', gameId: 'trivia', settings: { rounds: 3, perQuestion: 6 } });
  const created = await a.wait('room');
  const code: string = created.room.code;
  assert(/^[A-Z2-9]{5}$/.test(code), `room ${code} created for a quiz`);

  b.send({ t: 'join', code });
  await b.wait('room'); await a.wait('room');
  a.send({ t: 'ready', ready: true });
  b.send({ t: 'ready', ready: true });
  await a.wait('room'); await a.wait('room');
  a.send({ t: 'start' });
  let rm = await a.wait('room');
  while (rm.room.status !== 'STARTING' && rm.room.status !== 'IN_GAME') rm = await a.wait('room');

  const stA = await a.wait('state', 9000);
  const stB = await b.wait('state', 9000);
  const MID = stA.matchId as string;
  let sa = stA.state, sb = stB.state;
  assert(!!MID, 'the match started and carries an id');
  assert(sa.phase === 'question', `the first question is already open (phase ${sa.phase})`);
  assert(sa.queue[0].q === sb.queue[0].q, 'both players were sent the same question');
  assert(Array.isArray(sa.queue) && sa.queue.length === 1,
    `only the asked question is sent — a client cannot read ahead (queue ${sa.queue.length})`);
  assert(JSON.stringify(sa.order) === JSON.stringify(sb.order), 'both see the options in the same order');

  /* ---- A answers; B must NOT be able to see what A picked ---- */
  const rightSlot = sa.order.indexOf(0);
  const wrongSlot = sa.order.indexOf(1);
  a.inbox = a.inbox.filter((m) => m.t !== 'state');
  b.inbox = b.inbox.filter((m) => m.t !== 'state');
  a.send({ t: 'action', matchId: MID, move: { type: 'answer', option: rightSlot } });
  await sleep(700);

  const bView = b.peekState()?.state;
  assert(!!bView, 'B received a state update when A answered');
  assert(bView.picked[0] === null, 'B is NOT told which option A picked');
  assert(bView.answered?.[0] === true, 'B IS told that A has locked in');
  assert(bView.answered?.[1] === false, 'and that B itself has not');
  const aView = a.peekState()?.state;
  assert(aView.picked[0] === rightSlot, 'A can still see its own answer');

  /* ---- the server rejects a second answer and junk ---- */
  a.errors = [];
  a.send({ t: 'action', matchId: MID, move: { type: 'answer', option: wrongSlot } });
  await sleep(450);
  assert(a.errors.length > 0, 'the server refuses to let a player change their answer');

  b.errors = [];
  b.send({ t: 'action', matchId: MID, move: { type: 'answer', option: 9 } });
  await sleep(450);
  assert(b.errors.length > 0, 'the server rejects an option index out of range');

  /* ---- B answers: the question closes and both see both picks ---- */
  b.errors = [];
  b.send({ t: 'action', matchId: MID, move: { type: 'answer', option: wrongSlot } });
  await sleep(800);
  const closed = b.peekState()?.state;
  assert(closed.phase === 'reveal', `the question closed once both answered (phase ${closed.phase})`);
  assert(closed.picked[0] === rightSlot && closed.picked[1] === wrongSlot, 'after closing, both picks are revealed');
  assert(closed.score[0] > 0 && closed.score[1] === 0, `the server scored it (${closed.score[0]} vs ${closed.score[1]})`);

  /* ---- the server's own clock advances the round with nobody acting ---- */
  const beforeIdx = closed.index;
  await sleep(3600);                                   // REVEAL_MS is 2600
  const advanced = a.peekState()?.state;
  assert(advanced.index === beforeIdx + 1 && advanced.phase === 'question',
    `the server ticked to the next question unprompted (${beforeIdx} → ${advanced.index})`);

  /* ---- let a question time out with nobody answering ---- */
  const idx = advanced.index;
  await sleep(7800);                                   // perQuestion is 6s, + reveal
  const timedOut = a.peekState()?.state ?? advanced;
  const fin0 = a.inbox.find((m) => m.t === 'finished');
  assert(fin0 || timedOut.index > idx || timedOut.history.length > 1,
    'an unanswered question closed on the server clock alone');

  /* ---- play out whatever is left ---- */
  let finished: Msg | null = fin0 ?? null;
  for (let i = 0; i < 60 && !finished; i++) {
    finished = a.inbox.find((m) => m.t === 'finished') ?? b.inbox.find((m) => m.t === 'finished') ?? null;
    if (finished) break;
    const s = a.peekState()?.state;
    if (s && s.phase === 'question') {
      const r = s.order.indexOf(0);
      if (s.picked[0] === null) a.send({ t: 'action', matchId: MID, move: { type: 'answer', option: r } });
      const sB = b.peekState()?.state;
      if (sB && sB.picked[1] === null) b.send({ t: 'action', matchId: MID, move: { type: 'answer', option: r } });
    }
    await sleep(700);
  }

  assert(finished !== null, 'the quiz reached a verdict');
  assert(typeof finished!.reason === 'string' && finished!.reason.length > 0, `the relay gave a reason: "${finished!.reason}"`);
  assert([0, 1, null].includes(finished!.winnerSlot), `winner slot is ${finished!.winnerSlot}`);

  a.close(); b.close();
  console.log(`\n  ALL ${passed} CHECKS PASSED\n`);
}

main().catch((e) => { console.error('\n  ' + e.message + '\n'); process.exit(1); });
