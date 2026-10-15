/**
 * Lifecycle checks for the two newest online games (Wild Eights, Spark Quiz).
 *
 * A game can play one clean match and still be broken afterwards:
 *   - a mid-match refresh must restore the board *without* handing the
 *     reconnecting client the other player's hidden information;
 *   - a rematch must deal a genuinely fresh game and swap seats, not replay
 *     the old one.
 * Neither was covered by the existing suites.
 *
 *   npx tsx scripts/smoke-online-lifecycle.ts
 */
import WebSocket from 'ws';

const URL = process.env.SMOKE_URL ?? 'ws://127.0.0.1:5173/rt';
type Msg = Record<string, any>;

class Client {
  ws!: WebSocket; inbox: Msg[] = []; seq = 0; errors: Msg[] = [];
  constructor(public label: string, public id: string, public name: string) {}
  connect() {
    this.ws = new WebSocket(URL);
    this.ws.on('message', (d) => {
      const m = JSON.parse(String(d));
      this.inbox.push(m);
      if (m.t === 'error') this.errors.push(m);
    });
    return new Promise<void>((res, rej) => { this.ws.once('open', () => res()); this.ws.once('error', rej); });
  }
  send(m: Msg) { this.ws.send(JSON.stringify({ ...m, clientSeq: ++this.seq })); }
  peek(t: string): Msg | undefined { return [...this.inbox].reverse().find((m) => m.t === t); }
  drop(t: string) { this.inbox = this.inbox.filter((m) => m.t !== t); }
  async wait(t: string, ms = 8000): Promise<Msg> {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      const i = this.inbox.findIndex((m) => m.t === t);
      if (i >= 0) return this.inbox.splice(i, 1)[0];
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`${this.label}: timed out waiting for "${t}". Saw: ${[...new Set(this.inbox.map((m) => m.t))].join(', ')}`);
  }
  /** what a browser refresh looks like to the server */
  async hardRefresh(code: string) {
    this.ws.terminate();
    this.inbox = []; this.errors = []; this.seq = 0;
    await sleep(300);
    await this.connect();
    this.send({ t: 'hello', playerId: this.id, name: this.name, mascot: 'classic', resumeCode: code });
  }
  close() { try { this.ws.close(); } catch { /* already gone */ } }
}

let passed = 0;
function assert(cond: unknown, msg: string) {
  if (!cond) { console.log('  ✗', msg); throw new Error('FAIL: ' + msg); }
  passed++; console.log('  ✓', msg);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function openMatch(gameId: string, settings: Msg, tag: string) {
  const a = new Client('A', `lc-a-${tag}`, 'Volt');
  const b = new Client('B', `lc-b-${tag}`, 'Spark');
  await a.connect(); await b.connect();
  a.send({ t: 'hello', playerId: a.id, name: a.name, mascot: 'classic' });
  b.send({ t: 'hello', playerId: b.id, name: b.name, mascot: 'cheer' });
  await a.wait('welcome'); await b.wait('welcome');
  a.send({ t: 'create', gameId, settings });
  const created = await a.wait('room');
  const code = created.room.code as string;
  b.send({ t: 'join', code });
  await b.wait('room'); await a.wait('room');
  a.send({ t: 'ready', ready: true });
  b.send({ t: 'ready', ready: true });
  await a.wait('room'); await a.wait('room');
  a.send({ t: 'start' });
  let rm = await a.wait('room');
  while (!['STARTING', 'IN_GAME'].includes(rm.room.status)) rm = await a.wait('room');
  const stA = await a.wait('state', 10_000);
  const stB = await b.wait('state', 10_000);
  return { a, b, code, matchId: stA.matchId as string, sa: stA.state, sb: stB.state, slotA: stA.yourSlot as 0 | 1 };
}

/* ══════════════════════════════ Wild Eights ══════════════════════════════ */
async function wildEights() {
  console.log('  — Wild Eights —');
  const { a, b, code, matchId, sa } = await openMatch('cards', { handSize: 7, actionCards: true }, 'cards');
  const handBefore = [...sa.hands[0]].sort((x: number, y: number) => x - y);
  assert(handBefore.length === 7, 'A holds seven cards');

  /* ---- mid-match refresh ---- */
  await a.hardRefresh(code);
  const resumed = await a.wait('state', 8000);
  const after = [...resumed.state.hands[0]].sort((x: number, y: number) => x - y);
  assert(JSON.stringify(after) === JSON.stringify(handBefore), 'a refresh restores A\u2019s exact hand');
  assert(resumed.matchId === matchId, 'and reattaches to the same match');
  assert(resumed.state.hands[1].every((c: number) => c === -1),
    'the reconnecting client is STILL not shown the opponent hand');
  assert(resumed.state.stock.every((c: number) => c === -1), 'nor the stock');

  /* ---- play it out ---- */
  const { canPlay, playable } = await import('../src/games/cards/rules');
  const cl = [a, b] as const;
  let sa2 = resumed.state, sb2 = (b.peek('state') ?? { state: null }).state;
  if (!sb2) { sb2 = (await b.wait('state', 4000)).state; }
  let finished: Msg | null = null;
  for (let i = 0; i < 400 && !finished; i++) {
    finished = a.peek('finished') ?? b.peek('finished') ?? null;
    if (finished) break;
    const latest = [a.peek('state')?.state ?? sa2, b.peek('state')?.state ?? sb2];
    const turn = latest[0].turn as 0 | 1;
    const view = latest[turn];
    let move: Msg;
    if (view.awaitingSuit) move = { type: 'suit', suit: 'hearts' };
    else if (view.pendingDraw > 0) {
      const c = view.hands[turn].filter((x: number) => x >= 0 && canPlay(view, x));
      move = c.length ? { type: 'play', card: c[0] } : { type: 'take' };
    } else {
      const o = playable(view, turn);
      if (o.length) move = { type: 'play', card: o[0] };
      else if (view.drawnThisTurn < view.config.drawLimit) move = { type: 'draw' };
      else move = { type: 'pass' };
    }
    cl[turn].send({ t: 'action', matchId, move });
    await sleep(70);
  }
  assert(!!finished, 'the hand reached a verdict after the refresh');

  /* ---- rematch ---- */
  a.drop('state'); b.drop('state');
  a.send({ t: 'rematch', vote: true }); b.send({ t: 'rematch', vote: true });
  const n1 = await a.wait('state', 9000);
  const n2 = await b.wait('state', 9000);
  assert(n1.matchId !== matchId, 'a rematch starts a NEW match id');
  const fresh = [...n1.state.hands[n1.yourSlot]].sort((x: number, y: number) => x - y);
  assert(n1.state.hands[n1.yourSlot].length === 7, 'the rematch deals a full fresh hand');
  assert(JSON.stringify(fresh) !== JSON.stringify(handBefore), 'and it is not the same hand again');
  assert(n1.yourSlot !== undefined && n2.yourSlot !== undefined && n1.yourSlot !== n2.yourSlot,
    `the two players hold different seats (${n1.yourSlot}/${n2.yourSlot})`);
  assert(n1.state.hands[n1.yourSlot === 0 ? 1 : 0].every((c: number) => c === -1),
    'the rematch still redacts the opponent hand');
  a.close(); b.close();
}

/* ═══════════════════════════════ Spark Quiz ═══════════════════════════════ */
async function sparkQuiz() {
  console.log('\n  — Spark Quiz —');
  const { a, b, code, matchId, sa } = await openMatch('trivia', { rounds: 3, perQuestion: 25 }, 'quiz');
  const q0 = sa.queue[0].q as string;
  assert(sa.phase === 'question', 'the first question is open');

  /* answer as A, then refresh A before the question closes */
  const right = sa.order.indexOf(0);
  a.send({ t: 'action', matchId, move: { type: 'answer', option: right } });
  await sleep(500);
  await a.hardRefresh(code);
  const resumed = await a.wait('state', 8000);
  assert(resumed.matchId === matchId, 'a refresh reattaches to the same quiz');
  assert(resumed.state.queue[resumed.state.index].q === q0, 'and restores the same question');
  assert(resumed.state.picked[resumed.yourSlot] === right, 'A\u2019s own answer survived the refresh');
  assert(resumed.state.picked[resumed.yourSlot === 0 ? 1 : 0] === null,
    'and A still cannot see what B picked');
  assert(resumed.state.queue.length === resumed.state.index + 1,
    'the reconnecting client still cannot read ahead');
  assert(typeof resumed.state.total === 'number' && resumed.state.total === 3,
    `the honest question total survives the refresh (${resumed.state.total})`);

  /* the server must not let a reconnected client answer twice */
  a.errors = [];
  a.send({ t: 'action', matchId, move: { type: 'answer', option: (right + 1) % 4 } });
  await sleep(450);
  assert(a.errors.length > 0, 'a reconnected client cannot re-answer the question it already answered');

  /* play to the end */
  let finished: Msg | null = null;
  for (let i = 0; i < 90 && !finished; i++) {
    finished = a.peek('finished') ?? b.peek('finished') ?? null;
    if (finished) break;
    const sA = a.peek('state')?.state, sB = b.peek('state')?.state;
    if (sA?.phase === 'question') {
      const slotA = a.peek('state')!.yourSlot as 0 | 1;
      const slotB = b.peek('state')!.yourSlot as 0 | 1;
      if (sA.picked[slotA] === null) a.send({ t: 'action', matchId, move: { type: 'answer', option: sA.order.indexOf(0) } });
      if (sB && sB.picked[slotB] === null) b.send({ t: 'action', matchId, move: { type: 'answer', option: sB.order.indexOf(1) } });
    }
    await sleep(400);
  }
  assert(!!finished, 'the quiz reached a verdict after the refresh');

  /* rematch */
  a.drop('state'); b.drop('state');
  a.send({ t: 'rematch', vote: true }); b.send({ t: 'rematch', vote: true });
  const n1 = await a.wait('state', 9000);
  const n2 = await b.wait('state', 9000);
  assert(n1.matchId !== matchId, 'a rematch starts a NEW quiz');
  assert(n1.state.index === 0 && n1.state.score[0] === 0 && n1.state.score[1] === 0, 'scores reset to zero');
  assert(n1.state.phase === 'question', 'and the first question is already open');
  assert(n1.yourSlot !== n2.yourSlot, `seats swapped (${n1.yourSlot}/${n2.yourSlot})`);
  assert(n1.state.queue.length === 1, 'the new quiz still withholds the unasked questions');
  a.close(); b.close();
}

async function main() {
  console.log('\nONLINE LIFECYCLE — refresh + rematch →', URL, '\n');
  await wildEights();
  await sparkQuiz();
  console.log(`\n  ALL ${passed} CHECKS PASSED\n`);
}

main().catch((e) => { console.error('\n  ' + e.message + '\n'); process.exit(1); });
