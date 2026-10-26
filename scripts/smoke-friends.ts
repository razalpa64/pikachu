/**
 * Friends and safety, against a real relay and a stubbed auth server.
 *
 * This one starts its own relay, because the thing under test is what the relay
 * does with a *token*: the sign-in service is stubbed on a local port so the run
 * needs no Supabase project, no network and no secrets. Everything after the
 * handshake — pairing, blocking, chat gating, invitations — goes through the real
 * socket protocol on a real port.
 *
 * Run with:  npm run smoke   (or `tsx scripts/smoke-friends.ts`)
 */
import http from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import WebSocket from 'ws';

const AUTH_PORT = 8899;
const RELAY_PORT = 8898;
const URL = `ws://127.0.0.1:${RELAY_PORT}/rt`;

/* --------------------------------------------------------------- accounts */
const ASH = '11111111-1111-1111-1111-111111111111';
const MISTY = '22222222-2222-2222-2222-222222222222';
const BROCK = '33333333-3333-3333-3333-333333333333';

/** Tokens are just strings here: the stub decides what each one means. */
const token = (id: string) => `good.${id}.token`;

let passed = 0;
let failed = 0;
function check(ok: boolean, what: string, detail?: unknown) {
  if (ok) { passed++; console.log(`  ✓ ${what}`); }
  else { failed++; console.log(`  ✗ ${what}`, detail === undefined ? '' : detail); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ----------------------------------------------------------------- client */
type Msg = any;

class Client {
  ws!: WebSocket;
  inbox: Msg[] = [];
  errors: Msg[] = [];
  name: string;
  constructor(public label: string, public playerId: string, name?: string) { this.name = name ?? label; }

  connect() {
    this.ws = new WebSocket(URL);
    this.ws.on('message', (d) => {
      const m = JSON.parse(String(d));
      this.inbox.push(m);
      if (m.t === 'error') this.errors.push(m);
    });
    return new Promise<void>((res, rej) => { this.ws.once('open', () => res()); this.ws.once('error', rej); });
  }

  async hello(opts: { token?: string; blocks?: string[] } = {}) {
    await this.connect();
    this.send({ t: 'hello', playerId: this.playerId, name: this.name, mascot: 'classic', ...opts });
    return this.wait('welcome');
  }

  send(msg: Msg) { if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg)); }

  /** Wait for the next message of a type, optionally matching a predicate. */
  async wait(type: string, timeout = 6000, match: (m: Msg) => boolean = () => true): Promise<Msg> {
    const started = Date.now();
    for (;;) {
      const at = this.inbox.findIndex((m) => m.t === type && match(m));
      if (at >= 0) return this.inbox.splice(at, 1)[0];
      if (Date.now() - started > timeout) throw new Error(`${this.label}: timed out waiting for "${type}"`);
      await sleep(20);
    }
  }

  /** Everything received so far of a type, without waiting. */
  seen(type: string) { return this.inbox.filter((m) => m.t === type); }

  clear() { this.inbox = []; this.errors = []; }
  close() { try { this.ws.close(); } catch { /* already shut */ } }
}

/* ------------------------------------------------------------------ stubs */

/** The smallest possible Supabase auth endpoint: one route, three answers. */
function startAuthStub(): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    if (!req.url?.startsWith('/auth/v1/user')) { res.writeHead(404).end(); return; }
    const auth = String(req.headers.authorization ?? '');
    const id = auth.replace(/^Bearer\s+/, '').split('.')[1] ?? '';
    if (!id) { res.writeHead(401, { 'content-type': 'application/json' }).end('{"message":"no token"}'); return; }
    if (id === 'expired') { res.writeHead(401).end('{"message":"token expired"}'); return; }
    const names: Record<string, string> = { [ASH]: 'Ash', [MISTY]: 'Misty', [BROCK]: 'Brock' };
    if (!names[id]) { res.writeHead(404).end('{"message":"no user"}'); return; }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
      id,
      email: `${names[id].toLowerCase()}@pallet.town`,
      user_metadata: { display_name: names[id], username: names[id].toLowerCase() },
    }));
  });
  return new Promise((res) => server.listen(AUTH_PORT, '127.0.0.1', () => res(server)));
}

let relay: ChildProcess | null = null;

async function startRelay(): Promise<void> {
  relay = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(RELAY_PORT),
      SUPABASE_URL: `http://127.0.0.1:${AUTH_PORT}`,
      SUPABASE_ANON_KEY: 'stub-publishable-key',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  const ready = new Promise<void>((res, rej) => {
    const timer = setTimeout(() => rej(new Error(`relay did not start:\n${out}`)), 20_000);
    relay!.stdout!.on('data', (b) => {
      out += String(b);
      if (out.includes('listening on')) { clearTimeout(timer); res(); }
    });
    relay!.stderr!.on('data', (b) => { out += String(b); });
  });
  await ready;
}

/* -------------------------------------------------------------------- run */

async function main() {
  console.log('\nFRIENDS + SAFETY — real relay, stubbed auth →', URL, '\n');
  const authServer = await startAuthStub();
  await startRelay();

  /* ------------------------------------------------------- who is verified */
  const guest = new Client('guest', `guest-${Date.now()}`.slice(0, 24), 'Guest');
  const welcome = await guest.hello();
  check(welcome.verified === false, 'a browser that never signed in is a guest', welcome);
  check(welcome.playerId === guest.playerId, 'and keeps the id it chose');

  const ash = new Client('ash', 'ignored-by-the-relay', 'Ash');
  const ashWelcome = await ash.hello({ token: token(ASH) });
  check(ashWelcome.verified === true, 'a real token is verified');
  check(ashWelcome.playerId === `u:${ASH}`, 'and the relay uses the account id, not the one claimed', ashWelcome.playerId);
  check(ashWelcome.handle === 'ash', 'the handle comes from the account, not the socket');

  const fake = new Client('fake', 'someone-else', 'Totally Ash');
  await fake.connect();
  fake.send({ t: 'hello', playerId: `u:${ASH}`, name: 'Totally Ash', mascot: 'classic', token: 'good.expired.token' });
  const refused = await fake.wait('error');
  check(refused.code === 'auth_invalid', 'a token the auth server rejects is refused, not downgraded to a guest', refused.code);
  check(fake.seen('welcome').length === 0, 'and that socket gets no identity at all');
  await fake.connect();
  fake.send({ t: 'hello', playerId: 'x', name: 'x', mascot: 'classic', token: token('00000000-0000-0000-0000-000000000000') });
  check((await fake.wait('error')).code === 'auth_invalid', 'a token for an account that does not exist is refused');
  fake.close();

  /* ------------------------------------------------------- blocking in the queue */
  const misty = new Client('misty', 'ignored', 'Misty');
  await misty.hello({ token: token(MISTY) });
  const brock = new Client('brock', 'ignored', 'Brock');
  await brock.hello({ token: token(BROCK) });

  misty.clear();
  misty.send({ t: 'queue', gameId: 'connect4', settings: {} });
  await misty.wait('queue', 4000, (m) => m.queue.status === 'waiting');
  check(true, 'Misty is waiting for any opponent');

  ash.clear();
  ash.send({ t: 'queue', gameId: 'connect4', settings: {} });
  /* Ash is matched immediately, so what arrives is 'matched' rather than
     'waiting' — the pair, not the wait, is the point of the check. */
  const ashQueue = await ash.wait('queue', 4000);
  check(ashQueue.queue.status === 'matched', 'Ash, whom Misty has not blocked, is paired with her at once');

  const ashRoom = await ash.wait('room', 8000);
  const mistyRoom = await misty.wait('room', 4000);
  check(ashRoom.room.code === mistyRoom.room.code, 'the two who may meet are matched together');
  check(ashRoom.room.members.every((m: Msg) => m.accountId), 'and both seats carry a verified account id');

  /* ------------------------------------ a block keeps two people apart, quietly */
  const brockWaiter = new Client('brock-waiter', 'ignored', 'Brock');
  await brockWaiter.hello({ token: token(BROCK), blocks: [MISTY] });
  const misty2 = new Client('misty2', 'ignored', 'Misty');
  await misty2.hello({ token: token(MISTY) });

  /* Brock has blocked Misty; Misty has blocked nobody. Misty waits first. */
  misty2.clear();
  misty2.send({ t: 'queue', gameId: 'checkers', settings: {} });
  const mistyQueue = await misty2.wait('queue', 4000, (m) => m.queue.status === 'waiting');
  brockWaiter.clear();
  brockWaiter.send({ t: 'queue', gameId: 'checkers', settings: {} });
  const brockQueue = await brockWaiter.wait('queue', 4000);
  check(brockQueue.queue.status === 'waiting', 'Brock waits rather than meeting somebody he blocked');
  check(brockQueue.queue.note === 'blocked', 'and is told the waiting players are ones he blocked', brockQueue.queue);
  check(mistyQueue.queue.note === undefined, 'Misty, who has blocked nobody, is told nothing at all', mistyQueue.queue);
  check(brockQueue.queue.waiting === 2, 'the count is still honest about how many are waiting');
  brockWaiter.send({ t: 'unqueue' });
  misty2.send({ t: 'unqueue' });
  await brockWaiter.wait('queue', 4000, (m) => m.queue.status === 'cancelled');
  /* These two Brock/Misty sockets have done their job. Leaving them open would
     make the later "is Brock online?" check a lie — the account is online as long
     as any of its tabs is. */
  brock.close();
  brockWaiter.close();
  misty2.close();
  await sleep(300);

  /* ---------------------------------------------------------- chat before a round */
  check(ashRoom.room.chatOpen === false, 'a matchmade room starts with chat closed');
  ash.clear();
  ash.send({ t: 'chat', text: 'hello stranger' });
  const locked = await ash.wait('error', 4000);
  check(locked.code === 'chat_locked', 'so the relay refuses the first message', locked.code);

  const state = await ash.wait('state', 15_000);
  check(Boolean(state.matchId), 'the board still arrives on its own');
  const openRoom = await ash.wait('room', 8000, (m) => m.room.chatOpen === true);
  check(openRoom.room.chatOpen === true, 'chat opens once the round has started');
  misty.clear();
  ash.send({ t: 'chat', text: 'good luck' });
  const said = await misty.wait('chat', 4000);
  check(said.text === 'good luck', 'and a message reaches the other board');

  /* ------------------------------------------------------------- invitations */
  const invitee = new Client('invitee', 'ignored', 'Brock');
  await invitee.hello({ token: token(BROCK) });

  /* Ash is still in a matchmade room. An invitation would open a second room,
     so it is refused rather than silently moving them. */
  ash.clear();
  ash.send({ t: 'invite', to: BROCK, gameId: 'chess', settings: {} });
  check((await ash.wait('error', 4000)).code === 'in_room', 'you cannot invite a friend while you are in an arena');

  ash.send({ t: 'leave' });
  await ash.wait('left', 6000);
  await sleep(300);

  ash.clear();
  ash.send({ t: 'invite', to: BROCK, gameId: 'chess', settings: { clock: '5' } });
  const invitation = await invitee.wait('invite', 4000);
  check(invitation.fromAccountId === ASH && invitation.gameId === 'chess',
    'a friend invitation arrives with its game', invitation);
  check(invitation.fromName === 'Ash', 'and the name they play under');

  /* Only the person invited can answer it. */
  const outsider = new Client('outsider', 'ignored', 'Misty');
  await outsider.hello({ token: token(MISTY) });
  outsider.send({ t: 'inviteReply', inviteId: invitation.inviteId, accept: true });
  check((await outsider.wait('error', 4000)).code === 'invite_gone', 'a third party cannot accept somebody else’s invitation');
  outsider.close();

  invitee.clear();
  invitee.send({ t: 'inviteReply', inviteId: invitation.inviteId, accept: true });
  const inviterRoom = await ash.wait('room', 8000);
  const inviteeRoom = await invitee.wait('room', 4000);
  check(inviterRoom.room.code === inviteeRoom.room.code, 'accepting opens one room for both of them');
  check(inviterRoom.room.members.length === 2, 'with both seats filled');
  check(inviterRoom.room.hostId === `u:${ASH}`, 'the person who invited is the host');
  check(inviterRoom.room.chatOpen === true, 'and a private room keeps its lobby chat');
  check(inviterRoom.room.members.every((m: Msg) => m.accountId),
    'both seats are verified accounts, so either can add the other as a friend');

  /* The same invitation cannot be answered twice. */
  invitee.send({ t: 'inviteReply', inviteId: invitation.inviteId, accept: true });
  check((await invitee.wait('error', 4000)).code === 'invite_gone', 'the same invitation cannot seat somebody twice');

  /* A decline comes back to the sender. */
  ash.send({ t: 'leave' });
  await ash.wait('left', 6000);
  invitee.send({ t: 'leave' });
  await invitee.wait('left', 6000);
  await sleep(300);
  invitee.clear();
  ash.clear();
  ash.send({ t: 'invite', to: BROCK, gameId: 'chess', settings: {} });
  const offer = await invitee.wait('invite', 4000);
  invitee.send({ t: 'inviteReply', inviteId: offer.inviteId, accept: false });
  const closed = await ash.wait('inviteClosed', 4000);
  check(closed.reason === 'declined', 'a decline comes back to the sender as a decline', closed.reason);

  /* A guest cannot invite: friends are an account thing. */
  guest.clear();
  guest.send({ t: 'invite', to: BROCK, gameId: 'chess', settings: {} });
  check((await guest.wait('error', 4000)).code === 'not_signed_in', 'a guest cannot invite a friend');

  /* Nor can you invite somebody who is not connected. */
  invitee.close();
  await sleep(400);
  ash.clear();
  ash.send({ t: 'invite', to: BROCK, gameId: 'chess', settings: {} });
  const offline = await ash.wait('error', 4000).catch(() => null);
  check(offline?.code === 'not_online', 'inviting an offline friend says so', offline ?? ash.inbox);

  /* ------------------------------------- a private room still has lobby chat */
  const guestRoom = new Client('guest-room', `guest-room-${Date.now()}`.slice(0, 24), 'Guest');
  await guestRoom.hello();
  guestRoom.send({ t: 'create', gameId: 'tictactoe', settings: {}, roomName: 'Guests' });
  const created = await guestRoom.wait('room', 6000);
  check(created.room.chatOpen === true, 'a room you opened has chat from the start, because you invited who is in it');
  guestRoom.send({ t: 'chat', text: 'hi there' });
  const own = await guestRoom.wait('chat', 4000);
  check(own.text === 'hi there', 'and that message is accepted');
  guestRoom.close();

  console.log(`\nFRIENDS + SAFETY SMOKE ${failed ? 'FAILED' : 'PASSED'} (${passed} checks${failed ? `, ${failed} failed` : ''})\n`);
  if (failed) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error('\nFRIENDS + SAFETY SMOKE FAILED:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    relay?.kill('SIGTERM');
    await sleep(200);
    process.exit(process.exitCode ?? 0);
  });
