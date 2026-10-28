import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Relay } from '../relay';

/**
 * The relay says hello before it does anything else, and nothing that needs an
 * identity may go out before the relay has said `welcome`.
 *
 * This is a regression suite for a real report: pressing "Create private room"
 * produced a stack of "Say hello first." toasts and never opened a room. The
 * socket was open, so the old client sent `create` straight away — but `open`
 * only means the TCP handshake finished. Worse, when the client presented a
 * dead access token the relay refused the hello outright and the socket was
 * left with no identity at all, so every later attempt failed the same way.
 */

class FakeSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static last: FakeSocket | null = null;

  readyState = FakeSocket.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;

  url: string;
  constructor(url: string) { this.url = url; FakeSocket.last = this; }

  send(raw: string) { this.sent.push(raw); }
  close() { this.readyState = FakeSocket.CLOSED; this.onclose?.(); }

  /** test helpers */
  open() { this.readyState = FakeSocket.OPEN; this.onopen?.(); }
  receive(msg: unknown) { this.onmessage?.({ data: JSON.stringify(msg) }); }
  get parsed() { return this.sent.map((s) => JSON.parse(s)); }
}

const messages = (sock: FakeSocket) => sock.parsed.map((m) => m.t as string);

let relay: Relay;
let welcome: ReturnType<typeof vi.fn>;
let error: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal('WebSocket', FakeSocket as unknown as typeof WebSocket);
  vi.useFakeTimers();
  /* The relay is a browser module: it reads `window` for its timers and
     `location` to work out the socket URL. Node has neither, so give it the two
     globals it actually touches rather than pulling in a DOM. */
  vi.stubGlobal('window', { setTimeout, clearTimeout, setInterval, clearInterval });
  vi.stubGlobal('location', { protocol: 'http:', host: 'localhost' });
  welcome = vi.fn();
  error = vi.fn();
  relay = new Relay(
    { playerId: 'p-1', name: 'Trainer', mascot: 'classic' },
    { welcome, error } as never,
  );
});

afterEach(() => {
  relay.close();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const connect = () => {
  relay.connect();
  const sock = FakeSocket.last!;
  sock.open();
  return sock;
};

describe('the outbox waits for an identity', () => {
  it('asks hello first, and holds a create until the welcome lands', () => {
    const sock = connect();
    expect(messages(sock)).toEqual(['hello']);

    relay.send({ t: 'create', gameId: 'chess', settings: {}, roomName: 'Arena' } as never);
    expect(messages(sock), 'nothing may be sent before the relay has answered').toEqual(['hello']);

    sock.receive({ t: 'welcome', playerId: 'p-1', verified: false, handle: null });
    expect(messages(sock)).toEqual(['hello', 'create']);
    expect(welcome).toHaveBeenCalledTimes(1);
  });

  it('sends held messages in the order they were tapped', () => {
    const sock = connect();
    relay.send({ t: 'join', code: 'ABCDE' } as never);
    relay.send({ t: 'chat', text: 'hi' } as never);
    sock.receive({ t: 'welcome', playerId: 'p-1', verified: false, handle: null });
    expect(messages(sock)).toEqual(['hello', 'join', 'chat']);
  });

  it('never sends a ping before the welcome either', () => {
    const sock = connect();
    vi.advanceTimersByTime(9000);
    expect(messages(sock)).toEqual(['hello']);
    sock.receive({ t: 'welcome', playerId: 'p-1', verified: false, handle: null });
    vi.advanceTimersByTime(8000);
    expect(messages(sock).filter((t) => t === 'ping').length).toBe(1);
  });

  it('resets between sockets: a reconnect re-hellos and does not replay the old queue', () => {
    const first = connect();
    relay.send({ t: 'create', gameId: 'chess', settings: {}, roomName: 'A' } as never);
    first.close();
    const second = connect();
    expect(messages(second), 'a dead socket’s outbox must not follow us').toEqual(['hello']);
  });
});

describe('a dead token heals itself', () => {
  it('drops the token and asks again, so the next tap works', () => {
    relay.updateAuth('dead.token.value', []);
    const sock = connect();
    expect((sock.parsed[0] as { token?: string }).token).toBe('dead.token.value');

    // the relay refuses the token but (now) still welcomes us as a guest
    sock.receive({ t: 'error', code: 'auth_invalid', message: 'Your session has expired.' });
    expect(messages(sock)).toEqual(['hello', 'hello']);
    expect((sock.parsed[1] as { token?: string }).token, 'the dead token is not repeated').toBeUndefined();
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('holds the tap until the guest welcome arrives, then sends it', () => {
    relay.updateAuth('dead.token.value', []);
    const sock = connect();
    sock.receive({ t: 'error', code: 'auth_invalid', message: 'Your session has expired.' });
    relay.send({ t: 'join', code: 'ABCDE' } as never);
    expect(messages(sock)).toEqual(['hello', 'hello']);

    sock.receive({ t: 'welcome', playerId: 'p-1', verified: false, handle: null });
    expect(messages(sock)).toEqual(['hello', 'hello', 'join']);
  });
});

describe('transient auth outages are retried, not looped', () => {
  it('asks again on a backoff, then gives up after three tries', () => {
    relay.updateAuth('good.token.value', []);
    const sock = connect();
    for (let i = 0; i < 6; i++) {
      sock.receive({ t: 'error', code: 'auth_unavailable', message: 'Could not confirm your account.' });
      vi.advanceTimersByTime(30000);
    }
    const hellos = messages(sock).filter((t) => t === 'hello').length;
    expect(hellos).toBe(1 + 3);
  });
});

describe('a lost identity is re-announced', () => {
  it('says hello again when the relay answers no_identity', () => {
    const sock = connect();
    sock.receive({ t: 'welcome', playerId: 'p-1', verified: false, handle: null });
    relay.send({ t: 'create', gameId: 'chess', settings: {}, roomName: 'A' } as never);
    sock.receive({ t: 'error', code: 'no_identity', message: 'Say hello first.' });
    expect(messages(sock)).toEqual(['hello', 'create', 'hello']);
  });
});
