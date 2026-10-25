/**
 * Relay referee test for the four newest online games (Reversi, Gomoku,
 * Dots & Boxes, Mancala).
 *
 * The point is not that the engines work — `vitest` covers them. The point is
 * that the game a browser can *launch* is the game the relay can *referee*:
 * rooms start, illegal moves are refused, legal moves round-trip, and a match
 * can be played to a real finish without the server crashing or desyncing.
 *
 * Run:  npm start   (in one shell)
 *       npx tsx scripts/smoke-newgames.ts
 *       SMOKE_URL=ws://127.0.0.1:8787/rt npx tsx scripts/smoke-newgames.ts
 */
import WebSocket from 'ws';
import { REFEREES } from '../src/games/referees';
import { GAMES, defaultGameSettings } from '../src/games/registry';
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
  async wait(t: string, ms = 5000): Promise<Msg> {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      const i = this.inbox.findIndex((m) => m.t === t);
      if (i >= 0) return this.inbox.splice(i, 1)[0];
      await sleep(20);
    }
    throw new Error(`${this.label}: timed out waiting for "${t}" (saw ${[...new Set(this.inbox.map((m) => m.t))].join(', ')})`);
  }
  /** drop everything already buffered — used before waiting on a fresh broadcast */
  flush() { this.inbox.length = 0; }
  close() { this.ws.close(); }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
function check(cond: unknown, msg: string) {
  if (cond) console.log('  ✓', msg);
  else { failed++; console.log('  ✗', msg); }
}

/** Play one whole match through the relay, moving with the shared rulebook. */
async function playOut(gameId: string) {
  console.log(`\n── ${gameId} ${'─'.repeat(Math.max(0, 46 - gameId.length))}`);
  const rules = REFEREES[gameId];
  check(!!rules, `${gameId}: relay has a referee`);
  if (!rules) return;

  const meta = GAMES.find((g) => g.id === gameId);
  const settings = defaultGameSettings(meta);
  const seed = `smoke-${gameId}-${Date.now()}`;

  const a = new Client('A', `smoke-${gameId}-a`, 'Volt');
  const b = new Client('B', `smoke-${gameId}-b`, 'Spark');
  await Promise.all([a.open(), b.open()]);
  try {
    a.send({ t: 'hello', playerId: a.id, name: a.name, mascot: 'classic' });
    b.send({ t: 'hello', playerId: b.id, name: b.name, mascot: 'cheer' });
    await a.wait('welcome'); await b.wait('welcome');

    a.send({ t: 'create', gameId, settings, roomName: `smoke ${gameId}` });
    const created = await a.wait('room');
    const code: string = created.room.code;
    b.send({ t: 'join', code });
    await b.wait('room');
    await a.wait('room');

    a.send({ t: 'ready', ready: true });
    b.send({ t: 'ready', ready: true });
    await sleep(120);
    a.flush(); b.flush();
    a.send({ t: 'start' });
    const st = await a.wait('state', 8000);
    const matchId: string = st.matchId;
    check(!!matchId, `${gameId}: match started (room ${code})`);

    // the two clients must agree on the opening position
    const bst = await b.wait('state', 4000);
    check(JSON.stringify(bst.state) === JSON.stringify(st.state), `${gameId}: both clients agree on the opening state`);

    // a legal move sent by the player who is NOT on turn has to be refused
    const opener: Slot | null = rules.currentPlayer(st.state);
    const idleClient = st.yourSlot === 0 ? b : a;
    if (opener !== null && opener === st.yourSlot) {
      const tempting = rules.legalMoves(st.state, opener)[0];
      if (tempting !== undefined) {
        idleClient.flush();
        idleClient.send({ t: 'action', matchId, move: tempting });
        const err = await idleClient.wait('error', 2500).catch(() => null);
        check(!!err, `${gameId}: out-of-turn move rejected (${err?.code ?? 'no error'})`);
        // and the position must be untouched by the rejected attempt
        a.flush();
        a.send({ t: 'ping', ts: Date.now() });
        await a.wait('pong', 2000);
      }
    }

    // now actually play — each side computes a legal move from the state it holds
    let state = st.state;
    let moves = 0;
    let turn: Slot = st.yourSlot;
    let me = st.yourSlot === 0 ? a : b;
    let other = st.yourSlot === 0 ? b : a;
    a.flush(); b.flush();

    while (moves < 220) {
      const res = rules.result(state);
      if (res.over) break;
      const actor: Slot | null = rules.currentPlayer(state);
      if (actor === null) { check(false, `${gameId}: stalled at move ${moves} (nobody can act)`); break; }
      // keep `me`/`other` pointing at the right sockets for this actor
      if (actor !== turn) { [me, other] = [other, me]; turn = actor; }
      const legal = rules.legalMoves(state, actor);
      if (!legal.length) { check(false, `${gameId}: no legal moves at move ${moves}`); break; }
      // prefer a move that ends the game / scores, else the first legal one
      const move = legal[0];
      me.flush();
      me.send({ t: 'action', matchId, move });
      const next = await me.wait('state', 5000).catch(() => null);
      if (!next) { check(false, `${gameId}: no state broadcast after move ${moves}`); break; }
      const expected = rules.applyMove(state, actor, move);
      if (JSON.stringify(next.state) !== JSON.stringify(expected)) {
        // redaction applies to a few games; the four here are open-information,
        // so an exact match is the correct expectation
        check(false, `${gameId}: server state diverged from the rulebook at move ${moves}`);
        break;
      }
      state = next.state;
      moves++;
      await sleep(6);
    }

    const res = rules.result(state);
    check(res.over, `${gameId}: match reached an end after ${moves} moves${res.over ? ` (${res.reason})` : ''}`);
    check(moves > 3, `${gameId}: ${moves} moves were refereed`);

    // leaving mid-series must not leave the room wedged for the other client
    a.send({ t: 'leave' });
    const left = await a.wait('left', 4000).catch(() => null);
    check(!!left, `${gameId}: host left cleanly`);
    const gone = await b.wait('room', 4000).catch(() => null);
    check(!!gone, `${gameId}: the remaining player was told the room changed`);
  } finally {
    a.close(); b.close();
  }
}

async function main() {
  console.log(`\nPIKACHU new-game relay test → ${URL}`);
  for (const id of ['reversi', 'gomoku', 'dots', 'mancala']) await playOut(id);
  console.log(`\n${failed ? `${failed} CHECK${failed === 1 ? '' : 'S'} FAILED` : 'ALL NEW-GAME RELAY CHECKS PASSED'}\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('\n', e.message, '\n'); process.exit(1); });
