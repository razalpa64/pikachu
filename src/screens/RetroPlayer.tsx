import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  RETRO_BUTTON,
  RETRO_CHANNEL,
  RETRO_KEYBOARD,
  RETRO_PLAYER_URL,
  formatBytes,
  loadRetroLibrary,
  retroGameById,
  type PlayerMessage,
  type PlayerStatus,
  type RetroGame,
} from '../lib/retro';
import { Button, EmptyState, Icon, Panel } from '../components/ui';
import { useStore } from '../lib/store';

/**
 * `/retro/:id` — the console.
 *
 * The emulator is an iframe and nothing else: EmulatorJS is a classic script
 * bundle that measures the whole document on load, and the React tree should not
 * be inside the element it treats as its viewport. The iframe also means the
 * wasm VM, the audio context and the IndexedDB cache all disappear with it when
 * you leave.
 *
 * Everything the chrome can do is a message the player answers — no action here
 * is decorative. Each one below was verified against a running cartridge; the
 * keys in RETRO_KEYBOARD were pressed in a real browser, see `npm run e2e:retro`.
 */

type Boot = { name?: string; file?: File } | undefined;

interface ChromeAction {
  id: string;
  label: string;
  icon: string;
  /** Tone: ghost actions sit on the dark console body. */
  run: () => void;
  disabled?: boolean;
  active?: boolean;
  title?: string;
}

/** One notice at a time, across mounts: a stale timer must not clear the next
 *  page's message. A module-scope handle is fine here — it is not React state. */
let noticeTimer: number | undefined;

const STATUS_COPY: Record<PlayerStatus, { label: string; tone: string }> = {
  booting: { label: 'Warming up', tone: '#f2b23c' },
  loading: { label: 'Loading cartridge', tone: '#f2b23c' },
  ready: { label: 'Press start', tone: '#8ec8f6' },
  running: { label: 'Running', tone: '#6fcfa6' },
  paused: { label: 'Paused', tone: '#ffadc6' },
  error: { label: 'Stopped', tone: '#ef6a7f' },
};

/* ------------------------------------------------------------- touch pad */

/**
 * The handheld's own buttons.
 *
 * EmulatorJS can draw a pad, but it floats over the middle of the screen at a
 * fixed size and covers the game. Drawing our own means the controls live where
 * the plastic would be — under the screen — and can be laid out for the thumb.
 * Every press is a `simulateInput` message, so this pad and a real controller go
 * through exactly the same path into the core.
 */
function TouchPad({ send }: { send: (cmd: string, value?: unknown) => void }) {
  const press = (index: number) => (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    send('input', { index, pressed: true });
  };
  const release = (index: number) => (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    send('input', { index, pressed: false });
  };

  const btn = (index: number, label: string, extra = '') => (
    <button
      type="button"
      aria-label={label}
      onPointerDown={press(index)}
      onPointerUp={release(index)}
      onPointerCancel={release(index)}
      onPointerLeave={release(index)}
      onContextMenu={(e) => e.preventDefault()}
      className={`retro-pad-btn ${extra}`}
    >
      <span aria-hidden>{label}</span>
    </button>
  );

  return (
    <div className="retro-pad" role="group" aria-label="Touch controls">
      <div className="retro-dpad" aria-label="D-pad">
        {btn(RETRO_BUTTON.UP, '▲', 'retro-dpad-up')}
        {btn(RETRO_BUTTON.LEFT, '◀', 'retro-dpad-left')}
        <span className="retro-dpad-hub" aria-hidden />
        {btn(RETRO_BUTTON.RIGHT, '▶', 'retro-dpad-right')}
        {btn(RETRO_BUTTON.DOWN, '▼', 'retro-dpad-down')}
      </div>
      <div className="retro-pad-mid">
        {btn(RETRO_BUTTON.SELECT, 'SELECT', 'retro-pad-pill')}
        {btn(RETRO_BUTTON.START, 'START', 'retro-pad-pill')}
      </div>
      <div className="retro-pad-face">
        {btn(RETRO_BUTTON.B, 'B')}
        {btn(RETRO_BUTTON.A, 'A')}
      </div>
    </div>
  );
}

export default function RetroPlayer() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const loc = useLocation();
  const { sfx } = useStore();
  const boot = (loc.state ?? undefined) as Boot;
  const isLocal = id === 'local';

  const [library, setLibrary] = useState<RetroGame[] | null>(null);
  const [libraryError, setLibraryError] = useState(false);
  const [status, setStatus] = useState<PlayerStatus>('booting');
  const [notice, setNotice] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const [touch, setTouch] = useState(false);
  const [stalled, setStalled] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);

  const game = useMemo(() => (isLocal ? null : retroGameById(library, id)), [isLocal, library, id]);

  /* ------------------------------------------------------------ manifest */
  useEffect(() => {
    if (isLocal) return;
    let alive = true;
    loadRetroLibrary()
      .then((lib) => { if (alive) setLibrary(lib.games); })
      .catch(() => { if (alive) { setLibrary([]); setLibraryError(true); } });
    return () => { alive = false; };
  }, [isLocal]);

  const say = useCallback((text: string) => {
    setNotice(text);
    if (noticeTimer) window.clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(() => setNotice(null), 2400);
  }, []);

  /* ------------------------------------------------------------- messages */
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      // Same-origin only: the player is served from this origin, and an
      // unrelated window must not be able to drive the console.
      if (event.origin !== window.location.origin) return;
      const data = event.data as PlayerMessage | undefined;
      if (!data || data.channel !== RETRO_CHANNEL) return;

      switch (data.type) {
        case 'ready':
          setStatus((s) => (s === 'running' || s === 'paused' ? s : 'ready'));
          break;
        case 'start':
          sfx('open');
          setStalled(false);
          setStatus('running');
          break;
        case 'state':
          if (data.status) setStatus(data.status);
          break;
        case 'saved':
          say('State saved to this browser');
          break;
        case 'loaded':
          say('State loaded');
          break;
        case 'shot': {
          if (!data.dataUrl) break;
          const a = document.createElement('a');
          a.href = data.dataUrl;
          a.download = `${(game?.title ?? boot?.name ?? 'retro').replace(/\s+/g, '-').toLowerCase()}-${Date.now()}.png`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          say('Screenshot saved');
          break;
        }
        case 'volume':
          setMuted((data.value ?? 1) === 0);
          break;
        case 'error':
          if (data.message === 'no-save') say('No saved state for this cartridge yet');
          else say('The emulator could not do that');
          break;
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [game?.title, boot?.name, say, sfx]);

  /* Touch is a hardware question, not a user-agent one: a tablet reporting a
     desktop UA still has fingers. */
  useEffect(() => {
    const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    setTouch(coarse || (navigator.maxTouchPoints ?? 0) > 0);
  }, []);

  /* Give the visitor an honest signal when a big cartridge is still streaming. */
  useEffect(() => {
    if (status === 'running' || status === 'paused' || status === 'error') return;
    const t = window.setTimeout(() => setStalled(true), 9000);
    return () => window.clearTimeout(t);
  }, [status]);

  const send = useCallback((cmd: string, value?: unknown) => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage({ channel: RETRO_CHANNEL, type: 'cmd', cmd, value }, window.location.origin);
  }, []);

  const onFrameLoad = useCallback(() => {
    if (!isLocal) return;
    const file = boot?.file;
    const win = iframeRef.current?.contentWindow;
    if (!file || !win) return;
    win.postMessage(
      { channel: RETRO_CHANNEL, type: 'boot', game: { name: boot?.name ?? file.name, romFile: file } },
      window.location.origin,
    );
  }, [boot?.file, boot?.name, isLocal]);

  /* ------------------------------------------------------------ fullscreen */
  const toggleFullscreen = useCallback(() => {
    const el = frameRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen?.();
    else void el.requestFullscreen?.().catch(() => say('This browser refused fullscreen'));
  }, [say]);

  /* Escaping fullscreen with the keyboard must not leave a stale layout. */
  useEffect(() => {
    const onChange = () => setShowControls(false);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const started = status === 'running' || status === 'paused';
  const src = isLocal ? RETRO_PLAYER_URL : `${RETRO_PLAYER_URL}?game=${encodeURIComponent(id)}`;

  /* ---------------------------------------------------------------- guards */
  if (isLocal && !boot?.file) {
    return (
      <div className="mx-auto max-w-[760px] px-[var(--shell-pad)] py-14">
        <EmptyState
          mascot="waiting"
          title="That cartridge is no longer in memory"
          body="A ROM you open from your device is never stored, so reloading the page forgets it. Pick the file again and it will start from the top."
          action={<Button onClick={() => nav('/retro')} icon={<Icon name="back" size={14} />}>Back to the shelf</Button>}
        />
      </div>
    );
  }

  if (!isLocal && libraryError) {
    return (
      <div className="mx-auto max-w-[760px] px-[var(--shell-pad)] py-14">
        <EmptyState
          mascot="error"
          title="The shelf could not be read"
          body="The cartridge manifest at /retro/roms.json did not load, so this page cannot verify which game to start."
          action={<Button onClick={() => nav('/retro')} icon={<Icon name="back" size={14} />}>Back to the shelf</Button>}
        />
      </div>
    );
  }

  if (!isLocal && library && !game) {
    return (
      <div className="mx-auto max-w-[760px] px-[var(--shell-pad)] py-14">
        <EmptyState
          mascot="waiting"
          title="No such cartridge"
          body={`Nothing in the shelf matches “${id}”.`}
          action={<Button onClick={() => nav('/retro')} icon={<Icon name="back" size={14} />}>Back to the shelf</Button>}
        />
      </div>
    );
  }

  const title = game?.title ?? boot?.name ?? 'Your cartridge';
  const statusCopy = STATUS_COPY[status];

  const actions: ChromeAction[] = [
    { id: 'pause', label: status === 'paused' ? 'Resume' : 'Pause', icon: status === 'paused' ? 'play' : 'pause', disabled: !started, run: () => { send('toggle'); sfx('click'); } },
    { id: 'restart', label: 'Restart', icon: 'rotate', disabled: !started, run: () => { send('restart'); say('Cartridge restarted'); sfx('toggle'); }, title: 'Restart from the title screen' },
    { id: 'save', label: 'Save', icon: 'save', disabled: !started, run: () => { send('saveState'); sfx('click'); }, title: 'Save a state in this browser' },
    { id: 'load', label: 'Load', icon: 'load', disabled: !started, run: () => { send('loadState'); sfx('click'); }, title: 'Load the last saved state' },
    { id: 'mute', label: muted ? 'Unmute' : 'Mute', icon: muted ? 'mute' : 'volume', run: () => { send('mute', !muted); setMuted((m) => !m); sfx('toggle'); } },
    { id: 'shot', label: 'Capture', icon: 'camera', disabled: !started, run: () => { send('screenshot'); sfx('click'); }, title: 'Save a PNG of the screen' },
    { id: 'full', label: 'Fullscreen', icon: 'expand', run: toggleFullscreen, title: 'Fill the screen (Esc exits)' },
  ];

  return (
    <div className="mx-auto max-w-[1180px] px-[var(--shell-pad)] py-4 sm:py-6">
      {/* ---------------- title row ---------------- */}
      <div className="flex items-center gap-2 sm:gap-3 mb-2.5 sm:mb-3">
        <button
          onClick={() => { sfx('click'); nav('/retro'); }}
          aria-label="Back to the shelf"
          className="shrink-0 flex items-center gap-1.5 px-2.5 sm:px-3 py-2 rounded-full border-2 border-ink-500 bg-ink-800 text-[11.5px] font-extrabold uppercase tracking-wider text-cream-500 hover:text-cream-100 hover:border-ink-400 no-tap"
        >
          <Icon name="back" size={13} /> <span className="hidden xs:inline sm:inline">Shelf</span>
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="display text-[18px] sm:text-[26px] leading-tight text-cream-100 truncate">{title}</h1>
          <p className="hidden sm:block text-[11px] font-bold uppercase tracking-wider text-cream-500 mt-1">
            Game Boy Advance{game ? ` · ${game.author} · ${game.year}` : ' · from your device'}
          </p>
        </div>
        <span
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border-2 bg-[#2b1f19] text-[10.5px] font-extrabold uppercase tracking-wider"
          style={{ borderColor: '#4b352a', color: statusCopy.tone }}
          role="status"
          aria-live="polite"
        >
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: statusCopy.tone }} aria-hidden />
          {statusCopy.label}
        </span>
        <button
          onClick={() => setShowControls((v) => !v)}
          aria-expanded={showControls}
          className="flex items-center gap-1.5 px-3 py-2 rounded-full border-2 border-ink-500 bg-ink-800 text-[11.5px] font-extrabold uppercase tracking-wider text-cream-500 hover:text-cream-100 hover:border-ink-400 no-tap"
        >
          <Icon name="gamepad" size={15} /> Keys
        </button>
      </div>

      <p className="sm:hidden text-[10px] font-bold uppercase tracking-wider text-cream-500 mb-2.5">
        Game Boy Advance{game ? ` · ${game.author} · ${game.year}` : ' · from your device'}
      </p>

      {/* ---------------- the console ---------------- */}
      <div
        ref={frameRef}
        className="retro-console relative rounded-[24px] border-2 border-[#4b352a] bg-[#2b1f19] p-2.5 sm:p-4 shadow-[0_2px_0_0_#4b352a,0_30px_60px_-34px_rgba(90,58,18,.9)]"
      >
        <div className="flex items-center justify-between px-1 pb-2">
          <span className="text-[9px] font-extrabold uppercase tracking-[0.2em] text-[#a98d78]">Dot Matrix Advance</span>
          <span className="flex items-center gap-2 text-[9px] font-extrabold uppercase tracking-[0.2em] text-[#a98d78]">
            {stalled && status !== 'running' && status !== 'paused' ? 'Streaming cartridge…' : 'GBA · 240 × 160'}
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: status === 'running' ? '#6fcfa6' : statusCopy.tone }} aria-hidden />
          </span>
        </div>

        <div className="relative rounded-[14px] border-4 border-[#14100d] bg-[#0b0d12] overflow-hidden">
          <div className="relative w-full" style={{ aspectRatio: '3 / 2' }}>
            <iframe
              ref={iframeRef}
              src={src}
              title={`${title} — Game Boy Advance emulator`}
              onLoad={onFrameLoad}
              allow="fullscreen; autoplay; gamepad"
              className="absolute inset-0 w-full h-full border-0"
            />
            {(status === 'booting' || status === 'loading') && (
              <div className="absolute inset-x-0 top-0 flex justify-center pt-4 pointer-events-none">
                <span className="px-3 py-1.5 rounded-full bg-[#161a24]/90 border border-[#2a3140] text-[10.5px] font-extrabold uppercase tracking-wider text-[#8b93a7]">
                  {stalled ? 'Fetching the GBA core — first launch only' : 'Starting the emulator'}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* On a touch device the plastic comes alive: real buttons under the
            screen, in the console body, not floating over the game. */}
        {touch && <TouchPad send={send} />}

        {/* physical control strip — every button here is wired to the player */}
        <div className="retro-controls flex items-center gap-1.5 sm:gap-2 mt-2.5 sm:mt-3 overflow-x-auto no-scrollbar pb-0.5">
          {actions.map((a) => (
            <button
              key={a.id}
              onClick={a.run}
              disabled={a.disabled}
              title={a.title ?? a.label}
              aria-label={a.label}
              className={`shrink-0 flex items-center gap-1.5 px-2.5 sm:px-3 h-9 rounded-full border-2 text-[10.5px] font-extrabold uppercase tracking-wider transition-colors no-tap
                ${a.disabled
                  ? 'border-[#3d2c23] text-[#6d584c] cursor-not-allowed'
                  : 'border-[#5d4636] text-[#ffe27a] hover:border-[#ffd24d] hover:bg-[#3a2a21] active:translate-y-[1px]'}`}
            >
              <Icon name={a.icon} size={14} />
              <span className="hidden sm:inline">{a.label}</span>
            </button>
          ))}
          <span className="flex-1" />
          {notice && (
            <span className="shrink-0 pr-1 text-[10.5px] font-extrabold uppercase tracking-wider text-[#c9a888]" role="status">
              {notice}
            </span>
          )}
        </div>

        {showControls && (
          <div className="mt-2.5 rounded-2xl border-2 border-[#5d4636] bg-[#221a15] p-3 a-slide-up">
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {RETRO_KEYBOARD.map((row) => (
                <span key={row.action} className="flex items-center gap-1.5">
                  {row.keys.map((k) => (
                    <kbd key={k} className="min-w-[22px] text-center px-1.5 py-0.5 rounded border border-[#5d4636] bg-[#2b1f19] text-[11px] font-bold text-[#ffe27a]">{k}</kbd>
                  ))}
                  <span className="text-[10.5px] font-extrabold uppercase tracking-wider text-[#a98d78]">{row.action}</span>
                </span>
              ))}
            </div>
            <p className="text-[11px] text-[#8b7565] mt-2">
              Click the screen once if the keys stop responding — the emulator only listens while it has focus.
              On a phone, use the on-screen pad the emulator draws. Esc leaves fullscreen.
            </p>
          </div>
        )}
      </div>

      {/* ---------------- about the cartridge ---------------- */}
      <div className="grid gap-4 sm:grid-cols-[1.4fr_1fr] mt-5">
        <Panel className="p-5">
          <p className="eyebrow text-volt-700 mb-1.5">{game ? 'About this cartridge' : 'Your cartridge'}</p>
          <h2 className="display text-[19px] text-cream-100 leading-tight">{title}</h2>
          <p className="text-[13px] text-cream-400 mt-2 leading-relaxed">
            {game
              ? game.description
              : 'This ROM came from your own device. It was read into this tab, checked for a GBA cartridge header, handed to the emulator as an in-memory blob, and will be gone the moment you close the page.'}
          </p>
          {game && (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 mt-3.5 text-[12px]">
              <div className="flex justify-between gap-2 border-b border-ink-600/60 pb-1"><dt className="text-cream-500 font-bold">Licence</dt><dd className="text-cream-300 font-extrabold">{game.license}</dd></div>
              <div className="flex justify-between gap-2 border-b border-ink-600/60 pb-1"><dt className="text-cream-500 font-bold">ROM</dt><dd className="text-cream-300 font-extrabold">{formatBytes(game.bytes)}</dd></div>
              <div className="flex justify-between gap-2 border-b border-ink-600/60 pb-1"><dt className="text-cream-500 font-bold">Year</dt><dd className="text-cream-300 font-extrabold">{game.year}</dd></div>
              <div className="flex justify-between gap-2 border-b border-ink-600/60 pb-1"><dt className="text-cream-500 font-bold">Players</dt><dd className="text-cream-300 font-extrabold">{game.players === 2 ? '2' : '1'}</dd></div>
            </dl>
          )}
          <div className="flex flex-wrap items-center gap-3 mt-3.5">
            {game && (
              <a href={game.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-[11.5px] font-extrabold text-volt-700 hover:underline inline-flex items-center gap-1">
                <Icon name="external" size={12} /> Source &amp; licence
              </a>
            )}
            <button onClick={() => { sfx('click'); nav('/retro'); }} className="text-[11.5px] font-extrabold text-cream-500 hover:text-cream-100">
              Back to the shelf
            </button>
          </div>
        </Panel>

        <Panel className="p-5 bg-ink-850">
          <p className="eyebrow text-blush-600 mb-1.5">Verified in this player</p>
          <ul className="space-y-1.5 mt-2">
            {[
              'Keyboard input reaches the game',
              'Audio runs after the start press',
              'Fullscreen fills the screen',
              'Save / load states in this browser',
              'Screenshots download as PNG',
              'Touch pad appears on phones',
            ].map((line) => (
              <li key={line} className="flex items-start gap-2 text-[12px] text-cream-400">
                <span className="mt-0.5 text-leaf-700" aria-hidden><Icon name="check" size={13} /></span>
                {line}
              </li>
            ))}
          </ul>
          {game && !game.save && (
            <p className="text-[11px] text-cream-500 mt-3 leading-snug">
              {game.title} does not write battery saves, so progress lives in the save states above rather than in the
              cartridge.
            </p>
          )}
        </Panel>
      </div>
    </div>
  );
}
