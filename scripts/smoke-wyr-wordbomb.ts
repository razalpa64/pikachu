/**
 * Relay test for the two games added in this pass: Would You Rather and Word Bomb.
 *
 * These two are *not* turn-taking in the usual sense — Would You Rather is
 * simultaneous (both seats act in the same window, then a timer reveals), and
 * Word Bomb is turn-taking against a server clock — so the generic smoke harness
 * cannot drive them. What is checked here is the part only the live server can
 * prove:
 *
 *   • a real room is created, joined by code, and started;
 *   • a bad code is refused with a usable error;
 *   • an out-of-turn action is refused and changes nothing;
 *   • the state the server broadcasts matches the rulebook (with redaction
 *     applied per seat — a guesser never receives the chooser's answer);
 *   • the match reaches a genuine ending;
 *   • the host can leave mid-series and the other client is told.
 *
 * Run:  npm start  (or npx tsx server/index.ts)
 *       npx tsx scripts/smoke-wyr-wordbomb.ts
 *       SMOKE_URL=ws://127.0.0.1:8787/rt npx tsx scripts/smoke-wyr-wordbomb.ts
 */
import WebSocket from 'ws';
import { REFEREES } from '../src/games/referees';
import { defaultGameSettings, gameById } from '../src/games/registry';
import type { Slot } from '../src/games/types';

const URL = process.env.SMOKE_URL ?? 'ws://127.0.0.1:8787/rt';
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
      if (m.t === 'error') console.log(`     · ${this.label} error`, m.code);
    });
  }
  open() { return new Promise<void>((res, rej) => { this.ws.once('open', () => res()); this.ws.once('error', rej); }); }
  send(m: Msg) { this.ws.send(JSON.stringify({ ...m, clientSeq: ++this.seq })); }
  async wait(t: string, ms = 6000): Promise<Msg> {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      const i = this.inbox.findIndex((m) => m.t === t);
      if (i >= 0) return this.inbox.splice(i, 1)[0];
      await sleep(20);
    }
    throw new Error(`${this.label}: timed out waiting for "${t}" (saw ${[...new Set(this.inbox.map((m) => m.t))].join(', ')})`);
  }
  flush() { this.inbox.length = 0; }
  close() { this.ws.close(); }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
function check(cond: unknown, msg: string) {
  if (cond) console.log('  ✓', msg);
  else { failed++; console.log('  ✗', msg); }
}

async function openRoom(gameId: string, settings: Record<string, unknown>) {
  const a = new Client('A', `smoke-${gameId}-a-${Date.now()}`, 'Volt');
  const b = new Client('B', `smoke-${gameId}-b-${Date.now()}`, 'Spark');
  await Promise.all([a.open(), b.open()]);
  a.send({ t: 'hello', playerId: a.id, name: a.name, mascot: 'classic' });
  b.send({ t: 'hello', playerId: b.id, name: b.name, mascot: 'cheer' });
  await a.wait('welcome'); await b.wait('welcome');

  // a code that cannot exist must be refused, not silently opened
  b.send({ t: 'join', code: 'ZZZZZ' });
  const bad = await b.wait('error', 3000).catch(() => null);
  check(!!bad, `${gameId}: a nonexistent room code is refused (${bad?.code ?? 'no error'})`);

  a.send({ t: 'create', gameId, settings, roomName: `smoke ${gameId}` });
  const created = await a.wait('room');
  const code: string = created.room.code;
  b.send({ t: 'join', code });
  await b.wait('room');
  await a.wait('room');

  a.send({ t: 'ready', ready: true });
  b.send({ t: 'ready', ready: true });
  await sleep(150);
  a.flush(); b.flush();
  a.send({ t: 'start' });
  const stA = await a.wait('state', 8000);
  const stB = await b.wait('state', 4000);
  return { a, b, code, matchId: stA.matchId as string, stA, stB };
}

/**
 * Nobody touches anything. The server must still reveal the round and move on.
 * This is the difference between a real deadline and a decorative one.
 */
async function silentWindow() {
  const settings = { ...defaultGameSettings(gameById('wyr')), rounds: 4, turnMs: 8000 };
  const { a, b, matchId, stA } = await openRoom('wyr', settings);
  try {
    check(stA.state.phase === 'choose', 'wyr: the round opens in the choosing phase');
    const firstDilemma = stA.state.index;
    const revealed = await a.wait('state', 12_000).catch(() => null);
    check(!!revealed && revealed.state.phase !== 'choose',
      'wyr: the server closes the window with nobody acting (deadline is real)');
    const movedOn = await a.wait('state', 12_000).catch(() => null);
    check(!!movedOn && movedOn.state.index === firstDilemma + 1,
      'wyr: the reveal ends on its own and the next round opens');
    check(!rulesLeak(movedOn?.state), 'wyr: an untouched round leaks no hidden pick');
    a.send({ t: 'leave' });
    await b.wait('room', 4000).catch(() => null);
  } finally {
    a.close(); b.close();
  }
}

/** nothing that identifies the other side's answer should be in an open state */
function rulesLeak(state: any): boolean {
  if (!state || state.phase !== 'choose') return false;
  const picks = state.picked ?? [];
  return !(picks[0] === null || picks[0] === undefined || picks[1] === null || picks[1] === undefined);
}

/** ---- Would You Rather: simultaneous, both seats act in the same window ---- */
async function wyr() {
  console.log('\n── Would You Rather ─────────────────────────────');
  const rules = REFEREES.wyr;
  check(!!rules, 'wyr: relay has a referee');

  // A window that only closes when somebody clicks is not a window: a silent
  // opponent would stall the match forever. Prove the relay itself closes it.
  await silentWindow();

  const settings = { ...defaultGameSettings(gameById('wyr')), rounds: 4, turnMs: 8000 };
  const { a, b, code, matchId, stA } = await openRoom('wyr', settings);
  try {
    check(!!matchId, `wyr: match started (room ${code})`);
    check(Array.isArray(stA.state.order), 'wyr: the opening state carries the dilemma script');
    check(stA.state.order.length === 1, 'wyr: only the current round is sent, not the script');

    let state = stA.state;
    let guard = 0;

    while (!rules.result(state).over && guard++ < 40) {
      const phase = state.phase;
      if (phase === 'choose') {
        const mineA = rules.legalMoves(state, 0);
        const mineB = rules.legalMoves(state, 1);
        if (mineA.length) { a.flush(); a.send({ t: 'action', matchId, move: mineA[0] }); }
        if (mineB.length) { b.flush(); b.send({ t: 'action', matchId, move: mineB[0] }); }
        await sleep(220);
        // whoever still has the message in its inbox tells us the new state
        const nextA = await a.wait('state', 5000).catch(() => null);
        const nextB = nextA ? await b.wait('state', 5000).catch(() => null) : null;

        if (nextA) {
          // redaction: seat 1 must never be handed seat 0's pick while the round is open
          const openNow = nextA.state.phase === 'choose';
          if (openNow) {
            const leaked = nextB?.state?.picked?.[0];
            check(leaked === null || leaked === undefined, 'wyr: the guesser is never sent the chooser’s answer');
          }
          state = nextA.state;
          if (nextA.state.phase === 'choose' && nextA.state.picked?.[0] !== null) {
            // one seat is in; the other still has to act
            const remaining = nextA.state.picked?.[0] === null ? 0 : 1;
            const owner = remaining === 0 ? a : b;
            const legal = rules.legalMoves(state, remaining as Slot);
            if (legal.length && nextB) {
              owner.flush(); owner.send({ t: 'action', matchId, move: legal[0] });
              await sleep(200);
              const after = await owner.wait('state', 5000).catch(() => null);
              if (after) state = after.state;
            }
          }
        }
      } else if (phase === 'reveal') {
        // the server's tick closes the reveal; nothing to send
        await sleep(3400);
        a.flush(); b.flush();
        a.send({ t: 'ping', ts: Date.now() });
        await a.wait('pong', 3000);
      } else {
        break;
      }
    }

    const res = rules.result(state);
    check(res.over, `wyr: match reached an ending${res.over ? ` (${res.reason})` : ''}`);
    check(state.history.length > 0, 'wyr: rounds were recorded by the server');

    a.send({ t: 'leave' });
    const left = await a.wait('left', 4000).catch(() => null);
    check(!!left, 'wyr: host left cleanly');
    const gone = await b.wait('room', 4000).catch(() => null);
    check(!!gone, 'wyr: the remaining player was told the room changed');
  } finally {
    a.close(); b.close();
  }
}

/** ---- Word Bomb: turn-taking against the server's clock ---- */
async function wordbomb() {
  console.log('\n── Word Bomb ────────────────────────────────────');
  const rules = REFEREES.wordbomb;
  check(!!rules, 'wordbomb: relay has a referee');
  const settings = defaultGameSettings(gameById('wordbomb'));
  const { a, b, code, matchId, stA } = await openRoom('wordbomb', settings);
  try {
    check(!!matchId, `wordbomb: match started (room ${code})`);
    const opening = rules.currentPlayer(stA.state) as Slot | null;
    check(opening !== null, 'wordbomb: somebody has the turn');

    // the seat that is not on turn cannot play
    const idle = opening === 0 ? b : a;
    const idleSlot: Slot = opening === 0 ? 1 : 0;
    const tempting = rules.legalMoves(stA.state, idleSlot)[0];
    if (tempting) {
      idle.flush();
      idle.send({ t: 'action', matchId, move: tempting });
      const err = await idle.wait('error', 3000).catch(() => null);
      check(!!err, `wordbomb: out-of-turn word rejected (${err?.code ?? 'no error'})`);
    }

    let state = stA.state;
    let moves = 0;
    while (!rules.result(state).over && moves < 40) {
      const actor = rules.currentPlayer(state) as Slot | null;
      if (actor === null) break;
      const legal = rules.legalMoves(state, actor);
      if (!legal.length) { check(false, `wordbomb: no legal word at move ${moves}`); break; }
      const client = actor === 0 ? a : b;
      client.flush();
      client.send({ t: 'action', matchId, move: legal[0] });
      const next = await client.wait('state', 5000).catch(() => null);
      if (!next) { check(false, `wordbomb: no broadcast after move ${moves}`); break; }
      const expected = rules.applyMove(state, actor, legal[0]);
      if (JSON.stringify(next.state.used) !== JSON.stringify((expected as any).used)) {
        check(false, `wordbomb: server chain diverged at move ${moves}`);
        break;
      }
      state = next.state;
      moves++;
      await sleep(10);
    }

    const res = rules.result(state);
    check(res.over, `wordbomb: match reached an ending after ${moves} words${res.over ? ` (${res.reason})` : ''}`);
    check(state.used.length >= 3, `wordbomb: ${state.used.length} words were refereed`);

    a.send({ t: 'leave' });
    const left = await a.wait('left', 4000).catch(() => null);
    check(!!left, 'wordbomb: host left cleanly');
    const gone = await b.wait('room', 4000).catch(() => null);
    check(!!gone, 'wordbomb: the remaining player was told the room changed');
  } finally {
    a.close(); b.close();
  }
}

/**
 * The fuse is the game. If the relay does not own it, a player who simply never
 * types cannot lose — so this room is set to a single strike and left alone.
 */
async function wordbombFuse() {
  console.log('\n── Word Bomb · the fuse ─────────────────────────');
  const settings = { ...defaultGameSettings(gameById('wordbomb')), turnMs: 8000, strikes: 1, rounds: 20 };
  const { a, b, stA } = await openRoom('wordbomb', settings);
  try {
    check(stA.state.turn !== undefined, 'wordbomb: a seat holds the bomb at the start');
    const struck = await a.wait('state', 14_000).catch(() => null);
    check(!!struck && struck.state.strikes[0] === 1,
      'wordbomb: the server strikes a player who never answers');
    // the strike and the explosion can arrive in one broadcast — the referee is
    // allowed to skip the intermediate position, so accept either shape
    const st = struck?.state.over ? struck.state : (await a.wait('state', 14_000).catch(() => null))?.state;
    check(!!st && st.over,
      'wordbomb: with one strike allowed, the silent player loses on the fuse alone');
    check(st?.winner === 1, 'wordbomb: the bomb goes off for the seat holding it, not the idle one');
    a.send({ t: 'leave' });
    await b.wait('room', 4000).catch(() => null);
  } finally {
    a.close(); b.close();
  }
}

async function main() {
  console.log(`\nPIKACHU new-game relay test (Would You Rather · Word Bomb) → ${URL}`);
  await wyr();
  await wordbomb();
  await wordbombFuse();
  console.log(`\n${failed ? `${failed} CHECK${failed === 1 ? '' : 'S'} FAILED` : 'ALL CHECKS PASSED'}\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('\n', e.message, '\n'); process.exit(1); });
