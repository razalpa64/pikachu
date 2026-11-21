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
  type CartridgeKind,
  type PlayerMessage,
  type PlayerStatus,
  type RetroGame,
} from '../lib/retro';
import { openRememberedCartridge } from '../lib/localCartridge';
import { Button, EmptyState, Icon } from '../components/ui';
import { useStore } from '../lib/store';

/**
 * `/retro/:id` — the console.
 *
 * The page *is* the device: a grey handheld that fills the viewport, with the
 * emulator living inside its screen and the plastic wired to the core. Three
 * decisions follow from that, and each was made against something real:
 *
 *   1. **The emulator stays an iframe.** EmulatorJS is a classic script bundle
 *      that measures the document on load, so it needs its own document — and
 *      the wasm VM, audio context and IndexedDB cache all leave with the frame
 *      when you do.
 *   2. **The screen is exactly 3:2**, which is the GBA's own ratio, so the
 *      canvas fills the LCD edge to edge instead of being letterboxed inside a
 *      hole the wrong shape.
 *   3. **The plastic works.** Every button on the shell is a real button wired
 *      to the core over the same `simulateInput` path a physical pad uses. The
 *      proportions come from the reference photograph (which is why the numbers
 *      below are odd); the touch targets do not: the D-pad reads a thumb
 *      anywhere along an arm, and A/B sit on a raised pad the size of a thumb.
 *
 * Everything the chrome can do is a command the player answers, and each one is
 * asserted in `scripts/e2e/retro.mjs` against a running cartridge.
 */

type Boot = { name?: string; file?: File; kind?: CartridgeKind } | undefined;

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

/* ------------------------------------------------------------- the shell */

/**
 * One button of the handheld.
 *
 * Pointer events rather than clicks: a game pad has to respond the frame a
 * thumb lands and release the frame it lifts. Pointer capture means a thumb
 * that slides off the button still releases it, so a D-pad arm can never stick
 * down and walk the player into a wall.
 */
/**
 * Every mounted pad button, so a page-level release can clear their local state.
 *
 * Without this the frame releases everything on blur while the buttons still
 * believe they are held — the next lift then sends a release for a press that no
 * longer exists, and the one after that is ignored. Same reasoning as the frame's
 * own `held` map, one layer up.
 */
const BUTTONS = new Set<{ holding: React.RefObject<number | null> }>();

function DeviceButton({
  index,
  send,
  label,
  className,
  style,
  children,
}: {
  index: number;
  send: (cmd: string, value?: unknown) => void;
  label: string;
  className: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}) {
  /* What this button is currently holding down.
     Up, cancel and leave all fire for one physical lift, so the core was getting
     the same release two or three times. The core survives it, but each duplicate
     is a frame's worth of work mid-game, and a second `pressed: true` (a pointer
     captured from another thumb) would double-press. One id is enough: this is a
     pad, and a button cannot be held by two thumbs at once in any useful way. */
  const holding = useRef<number | null>(null);

  useEffect(() => {
    const entry = { holding };
    BUTTONS.add(entry);
    return () => { BUTTONS.delete(entry); };
  }, []);

  const press = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (holding.current !== null && holding.current !== e.pointerId) return;
    // The press is sent first: capture is a nicety for thumbs that slide off,
    // and a synthetic pointer (a test, an assistive tool) has no id to capture.
    holding.current = e.pointerId;
    send('input', { index, pressed: true });
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* no live pointer */ }
  };
  const release = (e: React.PointerEvent<HTMLButtonElement>) => {
    /* `pointerleave` fires *before* `pointerup` when a thumb slides off, and it
       carries the same id — so the check is on the id, not on "has anything been
       released yet". */
    if (holding.current !== e.pointerId) return;
    e.preventDefault();
    holding.current = null;
    send('input', { index, pressed: false });
  };
  /* A pointer is not the only way to press a button. Space/Enter hold the
     button down for as long as the key repeats, which is what a keyboard player
     expects from the pad they can tab to. */
  const keyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    if (e.repeat || holding.current !== null) return;
    holding.current = -1;   // a key is not a pointer, and has no id
    send('input', { index, pressed: true });
  };
  const keyUp = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    if (holding.current !== -1) return;
    holding.current = null;
    send('input', { index, pressed: false });
  };

  return (
    <button
      type="button"
      aria-label={label}
      className={className}
      style={style}
      onPointerDown={press}
      onPointerUp={release}
      onPointerCancel={release}
      onPointerLeave={release}
      onKeyDown={keyDown}
      onKeyUp={keyUp}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </button>
  );
}

/** The six speaker slots, positioned the way the photograph staggers them: each
 *  one a little further right and a little higher than the last. */
const GRILLE = [0, 1, 2, 3, 4, 5];

export default function RetroPlayer() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const loc = useLocation();
  const { sfx, setInGame, settings } = useStore();
  const boot = (loc.state ?? undefined) as Boot;
  const isLocal = id === 'local';

  const [library, setLibrary] = useState<RetroGame[] | null>(null);
  const [libraryError, setLibraryError] = useState(false);
  const [status, setStatus] = useState<PlayerStatus>('booting');
  const [notice, setNotice] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [panel, setPanel] = useState<'none' | 'keys' | 'about'>('none');
  const [stalled, setStalled] = useState(false);
  /* Bumped by "Try again": it is the iframe's key, so a failed mount is thrown
     away and replaced rather than being poked at through postMessage. */
  const [attempt, setAttempt] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  /* `/retro/local` reached by a reload or a direct link has no route state. The
     cartridge is in this browser's own store, so it is recovered from there
     rather than given up on. */
  const [recovered, setRecovered] = useState<Boot>(undefined);
  const [recovering, setRecovering] = useState(isLocal && !boot?.file);
  /** Route state wins; otherwise the cartridge this browser kept, if any. */
  const cartridge = boot?.file ? boot : recovered;
  /* `full` is true for either kind of fullscreen: the browser's, or ours. Safari
     on iOS does not implement element fullscreen at all, and a phone is exactly
     the device where "the game covers the screen" matters most — so when the
     browser says no, the stage covers the viewport itself instead. */
  const [nativeFull, setNativeFull] = useState(false);
  const [inPageFull, setInPageFull] = useState(false);
  /* Which destructive action is waiting for a yes. One dialog for both, because
     they ask the same question: you are about to lose the last few minutes. */
  const [confirming, setConfirming] = useState<'restart' | 'exit' | null>(null);
  const full = nativeFull || inPageFull;
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const game = library ? retroGameById(library, id) : null;
  /* Nothing was mounted to play: the page shows a note instead of a console. */
  const blocked =
    (isLocal && !cartridge?.file) ||
    (!isLocal && libraryError) ||
    (!isLocal && !!library && !game);

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
        case 'saved': say('State saved to this browser'); break;
        case 'loaded': say('State loaded'); break;
        case 'shot': {
          if (!data.dataUrl) break;
          const a = document.createElement('a');
          a.href = data.dataUrl;
          a.download = `${(game?.title ?? cartridge?.name ?? 'retro').replace(/\s+/g, '-').toLowerCase()}-${Date.now()}.png`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          say('Screenshot saved');
          break;
        }
        case 'volume': setMuted((data.value ?? 1) === 0); break;
        case 'error': {
          const code = String(data.message ?? '');
          if (code === 'no-save') { say('No saved state for this cartridge yet'); break; }
          /* Two different failures wearing one label before: a ROM that will not
             boot, and a command the core refused. Only the first is worth a
             retry button. */
          if (/boot|load|rom|fetch|core/i.test(code) || code === '') {
            setFailure(
              /fetch|network|core/i.test(code)
                ? 'The emulator core could not be fetched. That is usually a dropped connection — try again.'
                : 'This cartridge would not start. The file may be damaged or not a Game Boy image at all.',
            );
            setStatus('error');
          } else {
            say('The emulator could not do that');
          }
          break;
        }
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [game?.title, cartridge?.name, say, sfx]);

  /* An honest signal while a big cartridge is still streaming. */
  useEffect(() => {
    if (status === 'running' || status === 'paused' || status === 'error') return;
    const t = window.setTimeout(() => setStalled(true), 9000);
    return () => window.clearTimeout(t);
  }, [status]);

  /* The "Game audio" fader reaches the emulator directly: the frame has its own
     audio graph, so no amount of Web Audio mixing here can touch it. Sent on
     every change and once the core reports itself running. */
  useEffect(() => {
    if (status !== 'running' && status !== 'paused') return;
    sendDirect({ channel: RETRO_CHANNEL, type: 'cmd', cmd: 'setVolume', value: settings.muted ? 0 : settings.gameAudio });
  }, [settings.gameAudio, settings.muted, status]);

  /* A running cartridge owns the speakers: the store fades the menu bed down and
     opens the emulator bus. Cleared on unmount as well as on error, so a back
     button never leaves the arcade silent. */
  useEffect(() => {
    if (blocked) return;
    setInGame(true);
    return () => setInGame(false);
  }, [blocked, setInGame]);

  /* No stuck inputs: a tab hidden mid-press, or the window losing focus while a
     thumb is on the D-pad, must release every held button. The frame cannot see
     the parent's blur, so it is told. */
  useEffect(() => {
    if (blocked) return;
    const release = () => {
      /* Reset every button's local "held" flag to match: the frame has just let
         everything go, so a lift that arrives afterwards must not send a release
         for a press that no longer exists. */
      BUTTONS.forEach((b) => { if (b.holding.current !== null) b.holding.current = null; });
      sendDirect({ channel: RETRO_CHANNEL, type: 'cmd', cmd: 'releaseAll' });
    };
    const onHide = () => { if (document.visibilityState === 'hidden') release(); };
    window.addEventListener('blur', release);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('blur', release);
      document.removeEventListener('visibilitychange', onHide);
      release();
    };
  }, [blocked]);

  /* The console owns the viewport: nothing behind it should scroll while you
     are three dungeons into a cartridge. The guard screens are ordinary pages,
     so they keep their own scrolling. */
  useEffect(() => {
    if (blocked) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [blocked]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPanel('none'); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const send = useCallback((cmd: string, value?: unknown) => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage({ channel: RETRO_CHANNEL, type: 'cmd', cmd, value }, window.location.origin);
  }, []);

  function sendDirect(msg: Record<string, unknown>) {
    iframeRef.current?.contentWindow?.postMessage(msg, window.location.origin);
  }

  useEffect(() => {
    if (!isLocal || boot?.file) { setRecovering(false); return; }
    let alive = true;
    openRememberedCartridge()
      .then((cart) => {
        if (!alive || !cart) return;
        setRecovered({
          name: cart.file.name.replace(/\.(gba|agb|bin|gb|gbc)$/i, ''),
          file: cart.file,
          kind: cart.kind,
        });
      })
      .finally(() => { if (alive) setRecovering(false); });
    return () => { alive = false; };
  }, [boot?.file, isLocal]);

  /* An uploaded cartridge is not in the committed manifest, so `?game=<id>`
     would come back "unknown game". The shelf already has the URL, so hand it
     over directly — the player accepts an https `.gba` and nothing else. */
  const remoteRom = game && /^https:\/\//i.test(game.rom) ? game.rom : null;

  const onFrameLoad = useCallback(() => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    if (remoteRom) {
      win.postMessage(
        {
          channel: RETRO_CHANNEL,
          type: 'boot',
          game: { name: game?.title, romUrl: remoteRom, numericId: 0, kind: 'gba' },
        },
        window.location.origin,
      );
      return;
    }
    if (!isLocal) return;
    const file = cartridge?.file;
    if (!file) return;
    win.postMessage(
      {
        channel: RETRO_CHANNEL,
        type: 'boot',
        game: { name: cartridge?.name ?? file.name, romFile: file, kind: cartridge?.kind ?? 'gba' },
      },
      window.location.origin,
    );
  }, [cartridge?.file, cartridge?.kind, cartridge?.name, game?.title, isLocal, remoteRom]);

  /* Fullscreen is requested on the *stage*, which is also where our own
     full-bleed mode lives. */
  const toggleFullscreen = useCallback(() => {
    const el = stageRef.current;
    if (!el) return;
    if (document.fullscreenElement) { void document.exitFullscreen?.(); return; }
    if (inPageFull) { setInPageFull(false); return; }
    let asked: Promise<void> | undefined;
    try { asked = el.requestFullscreen?.(); } catch { asked = undefined; }
    if (!asked) { setInPageFull(true); return; }
    void asked.then(() => {
      /* A browser that resolves without actually going fullscreen is still a no. */
      if (!document.fullscreenElement) setInPageFull(true);
    }, () => setInPageFull(true));
  }, [inPageFull]);

  useEffect(() => {
    const onChange = () => {
      const native = !!document.fullscreenElement;
      setNativeFull(native);
      if (native) setInPageFull(false);
    };
    document.addEventListener('fullscreenchange', onChange);
    onChange();
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  /* Esc is the browser's own way out of real fullscreen; our in-page mode owes
     the visitor the same key. */
  useEffect(() => {
    if (!inPageFull) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setInPageFull(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [inPageFull]);

  /* Plain array, rebuilt each render: its handlers post to the frame, and
     memoising it would only make React's lint wonder when those handlers were
     allowed to read a ref. */
  const started = status === 'running' || status === 'paused';
  const rail = [
    { id: 'pause', label: status === 'paused' ? 'Resume' : 'Pause', icon: status === 'paused' ? 'play' : 'pause', disabled: !started, run: () => { send('toggle'); sfx('click'); } },
    { id: 'save', label: 'Save', icon: 'save', disabled: !started, run: () => { send('saveState'); sfx('click'); } },
    { id: 'load', label: 'Load', icon: 'load', disabled: !started, run: () => { send('loadState'); sfx('click'); } },
    { id: 'restart', label: 'Restart', icon: 'rotate', disabled: !started, run: () => { setConfirming('restart'); sfx('click'); } },
    { id: 'mute', label: muted ? 'Unmute' : 'Mute', icon: muted ? 'mute' : 'volume', disabled: false, run: () => { send('mute', !muted); setMuted((m) => !m); sfx('toggle'); } },
    { id: 'shot', label: 'Capture', icon: 'camera', disabled: !started, run: () => { send('screenshot'); sfx('click'); } },
    { id: 'full', label: 'Fullscreen', icon: 'expand', disabled: false, run: toggleFullscreen },
  ];

  /* ---------------------------------------------------------------- guards */
  const notFound = (title: string, body: string) => (
    <div className="min-h-dvh grid place-items-center px-[var(--shell-pad)] py-10">
      <EmptyState
        mascot="waiting"
        title={title}
        body={body}
        action={<Button onClick={() => nav('/retro')} icon={<Icon name="back" size={14} />}>Back to the shelf</Button>}
      />
    </div>
  );

  if (isLocal && !boot?.file && recovering) {
    return (
      <div className="min-h-dvh grid place-items-center px-[var(--shell-pad)] py-10">
        <EmptyState mascot="waiting" title="Reading your cartridge" body="Looking for it in this browser's own store — nothing leaves the device." />
      </div>
    );
  }
  if (isLocal && !cartridge?.file) {
    return notFound(
      'No cartridge in the handheld',
      'Drop a ROM you own on the shelf and it stays in this browser, so this page can start it again. Nothing is uploaded, and Eject on the shelf removes it.',
    );
  }
  if (!isLocal && libraryError) {
    return notFound(
      'The shelf could not be read',
      'The cartridge manifest at /retro/roms.json did not load, so this page cannot verify which game to start.',
    );
  }
  if (!isLocal && library && !game) {
    return notFound('No such cartridge', `Nothing in the shelf matches “${id}”.`);
  }

  const title = game?.title ?? cartridge?.name ?? 'Your cartridge';
  const statusCopy = STATUS_COPY[status];
  const src = isLocal || remoteRom ? RETRO_PLAYER_URL : `${RETRO_PLAYER_URL}?game=${encodeURIComponent(id)}`;
  const lampState = status === 'running' ? 'on' : status === 'paused' ? 'paused' : status === 'error' ? 'off' : 'waiting';

  return (
    <div className="gb-stage" ref={stageRef} data-status={status} data-full={full ? 'on' : 'off'}>
      {/* ---------------- slim header: where you are, how to leave ---------------- */}
      <header className="gb-head">
        <button
          onClick={() => { sfx('click'); if (started) setConfirming('exit'); else nav('/retro'); }}
          className="gb-chip"
          aria-label="Back to the shelf"
        >
          <Icon name="back" size={14} />
          <span className="gb-chip-word">Shelf</span>
        </button>

        <div className="gb-head-title">
          <p className="gb-head-name">{title}</p>
          <p className="gb-head-meta">
            {game
              ? `Game Boy Advance · ${game.author}${game.year ? ` · ${game.year}` : ''}`
              : cartridge?.kind === 'gb'
                ? 'Game Boy · from your device'
                : 'Game Boy Advance · from your device'}
          </p>
        </div>

        <span className="gb-status" role="status" aria-live="polite">
          <span className="gb-status-dot" style={{ background: statusCopy.tone }} aria-hidden />
          <span className="gb-status-text">{statusCopy.label}</span>
        </span>

        <button
          onClick={() => { sfx('click'); setPanel((p) => (p === 'keys' ? 'none' : 'keys')); }}
          aria-expanded={panel === 'keys'}
          className="gb-chip"
          aria-label="Controls"
        >
          <Icon name="gamepad" size={15} /><span className="gb-chip-word">Keys</span>
        </button>
        <button
          onClick={() => { sfx('click'); setPanel((p) => (p === 'about' ? 'none' : 'about')); }}
          aria-expanded={panel === 'about'}
          className="gb-chip"
          aria-label="About this cartridge"
        >
          <Icon name="book" size={15} /><span className="gb-chip-word">Info</span>
        </button>
      </header>

      {/* ---------------- the device ---------------- */}
      <div className="gb-mid">
        <div className="gb-device" data-lamp={lampState} role="group" aria-label="Touch controls">
          <span className="gb-grain" aria-hidden />

          {/* power switch and the seam that runs under it: device detail, so it
              is decorative and silent */}
          <div className="gb-power" aria-hidden>
            <span className="gb-power-arrow">◄</span>
            <span className="gb-power-words"><b>OFF</b><i /><b>ON</b></span>
            <span className="gb-power-arrow">►</span>
          </div>
          <span className="gb-seam" aria-hidden />

          <div className="gb-bezel">
            <div className="gb-brand" aria-hidden>
              <span className="gb-brand-rule" />
              <span className="gb-brand-text">Dot Matrix With Stereo Sound</span>
              <span className="gb-brand-rule" />
            </div>

            <div className="gb-lamp" aria-hidden>
              <span className="gb-lamp-led" />
              <span className="gb-lamp-label">Battery</span>
            </div>

            {/* A Game Boy dump is 10:9, not the GBA's 3:2, so the iframe is
                narrowed inside the LCD instead of being stretched to fill it. */}
            <div className="gb-screen" data-system={cartridge?.kind === 'gb' && isLocal ? 'gb' : 'gba'}>
              <iframe
                key={attempt}
                ref={iframeRef}
                src={src}
                title={`${title} — Game Boy Advance emulator`}
                onLoad={onFrameLoad}
                allow="fullscreen; autoplay; gamepad"
                className="gb-iframe"
              />
              {(status === 'booting' || status === 'loading') && (
                <div className="gb-screen-note">
                  {stalled ? 'Fetching the GBA core — first launch only' : 'Starting the emulator'}
                  {stalled && (
                    <button
                      type="button"
                      className="gb-note-retry"
                      onClick={() => { sfx('click'); setAttempt((n) => n + 1); setStalled(false); setStatus('booting'); }}
                    >
                      Try again
                    </button>
                  )}
                </div>
              )}
              {failure && (
                <div className="gb-screen-note gb-screen-error" role="alert">
                  <strong>That cartridge did not start</strong>
                  <span>{failure}</span>
                  <span className="gb-note-actions">
                    <button
                      type="button"
                      className="gb-note-retry"
                      onClick={() => { sfx('click'); setFailure(null); setStatus('booting'); setStalled(false); setAttempt((n) => n + 1); }}
                    >
                      Try again
                    </button>
                    <button type="button" className="gb-note-retry" onClick={() => { sfx('click'); nav('/retro'); }}>
                      Back to shelf
                    </button>
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* ---------------- the plastic ----------------
              One wrapper, two layouts. Windowed it is a transparent overlay and
              the pieces sit exactly where the photograph puts them; fullscreen
              the same pieces are laid out as a deck under the screen (or beside
              it, on a screen wide enough to afford the room). Wrapping is what
              makes that possible without touching the iframe — remounting the
              emulator would end the game. */}
          <div className="gb-deck">
            <div className="gb-dpad">
              <span className="gb-dpad-shape" aria-hidden>
                <i className="gb-tri gb-tri-up" />
                <i className="gb-tri gb-tri-right" />
                <i className="gb-tri gb-tri-down" />
                <i className="gb-tri gb-tri-left" />
                <i className="gb-dpad-hub" />
              </span>
              {/* The hit areas are whole arms, not the engraved triangles: a thumb
                  presses the edge of a D-pad, and a 30px square is not a thumb. */}
              <DeviceButton index={RETRO_BUTTON.UP} send={send} label="Up" className="gb-hit gb-hit-up" />
              <DeviceButton index={RETRO_BUTTON.RIGHT} send={send} label="Right" className="gb-hit gb-hit-right" />
              <DeviceButton index={RETRO_BUTTON.DOWN} send={send} label="Down" className="gb-hit gb-hit-down" />
              <DeviceButton index={RETRO_BUTTON.LEFT} send={send} label="Left" className="gb-hit gb-hit-left" />
            </div>

            <span className="gb-ridge" aria-hidden />

            <div className="gb-face" role="group" aria-label="Action buttons">
              <DeviceButton index={RETRO_BUTTON.A} send={send} label="A" className="gb-face-btn gb-face-a">
                <span className="gb-face-gloss" aria-hidden />
              </DeviceButton>
              <DeviceButton index={RETRO_BUTTON.B} send={send} label="B" className="gb-face-btn gb-face-b">
                <span className="gb-face-gloss" aria-hidden />
              </DeviceButton>
              <span className="gb-face-letter gb-face-letter-a" aria-hidden>A</span>
              <span className="gb-face-letter gb-face-letter-b" aria-hidden>B</span>
            </div>

            <div className="gb-system" role="group" aria-label="System buttons">
              <DeviceButton index={RETRO_BUTTON.SELECT} send={send} label="Select" className="gb-system-btn gb-system-select">
                <span className="gb-system-cap" aria-hidden />
                <span className="gb-system-label" aria-hidden>Select</span>
              </DeviceButton>
              <DeviceButton index={RETRO_BUTTON.START} send={send} label="Start" className="gb-system-btn gb-system-start">
                <span className="gb-system-cap" aria-hidden />
                <span className="gb-system-label" aria-hidden>Start</span>
              </DeviceButton>
            </div>

            <div className="gb-grille" aria-hidden>
              {GRILLE.map((i) => (
                <i key={i} style={{ left: `${75.5 + 4.2 * i}cqw`, top: `${125.4 - 2.45 * i}cqw` }} />
              ))}
            </div>
          </div>

          {notice && <p className="gb-toast" role="status">{notice}</p>}
        </div>
      </div>

      {/* ---------------- rail: everything the shell can do ---------------- */}
      <footer className="gb-rail">
        <div className="gb-rail-inner">
          {rail.map((a) => (
            <button
              key={a.id}
              onClick={a.run}
              disabled={a.disabled}
              title={a.label}
              aria-label={a.label}
              className="gb-rail-btn"
            >
              <Icon name={a.icon} size={17} />
              <span>{a.label}</span>
            </button>
          ))}
        </div>
      </footer>

      {/* In fullscreen the rail is gone — the plastic is the only control
          surface — so leaving has to have its own way out that is not a guess
          about Esc. */}
      {/* The words are decoration on a wide screen and hidden on a narrow one,
          so the name lives on the button itself. */}
      {full && (
        <button onClick={toggleFullscreen} className="gb-fs-exit" aria-label="Exit fullscreen">
          <Icon name="expand" size={15} />
          <span aria-hidden>Exit fullscreen</span>
        </button>
      )}

      {/* ---------------- the one dialog ---------------- */}
      {confirming && (
        <div className="gb-plate-wrap" role="presentation" onClick={() => setConfirming(null)}>
          <div
            className="gb-plate gb-confirm"
            role="dialog"
            aria-modal="true"
            aria-label={confirming === 'restart' ? 'Restart the cartridge?' : 'Leave the game?'}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="gb-plate-head">
              <h2>{confirming === 'restart' ? 'Restart the cartridge?' : 'Leave the game?'}</h2>
              <button onClick={() => setConfirming(null)} aria-label="Cancel" className="gb-plate-x">
                <Icon name="x" size={16} />
              </button>
            </div>
            <p className="gb-plate-note">
              {confirming === 'restart'
                ? 'Anything since your last save state is lost. Battery saves already written to the cartridge are kept.'
                : 'Anything since your last save state is lost. The cartridge stays on the shelf.'}
            </p>
            <div className="gb-confirm-actions">
              <button type="button" className="gb-confirm-cancel" onClick={() => { sfx('click'); setConfirming(null); }} autoFocus>
                Keep playing
              </button>
              <button
                type="button"
                className="gb-confirm-go"
                onClick={() => {
                  sfx('toggle');
                  if (confirming === 'restart') {
                    setAttempt((n) => n + 1);
                    setFailure(null);
                    setStatus('booting');
                    say('Cartridge restarted');
                    setConfirming(null);
                  } else {
                    setConfirming(null);
                    nav('/retro');
                  }
                }}
              >
                {confirming === 'restart' ? 'Restart' : 'Leave'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- plates ---------------- */}
      {panel !== 'none' && (
        <div className="gb-plate-wrap" onClick={() => setPanel('none')}>
          <div
            className="gb-plate"
            role="dialog"
            aria-label={panel === 'keys' ? 'Controls' : 'About this cartridge'}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="gb-plate-head">
              <h2>{panel === 'keys' ? 'Controls' : title}</h2>
              <button onClick={() => setPanel('none')} aria-label="Close" className="gb-plate-x">
                <Icon name="x" size={16} />
              </button>
            </div>

            {panel === 'keys' ? (
              <>
                <dl className="gb-keys">
                  {RETRO_KEYBOARD.map((row) => (
                    <div key={row.action} className="gb-key-row">
                      <dt>{row.keys.map((k) => <kbd key={k}>{k}</kbd>)}</dt>
                      <dd>{row.action}</dd>
                    </div>
                  ))}
                </dl>
                <p className="gb-plate-note">
                  On a phone, press the buttons on the console itself — they are wired to the core, not
                  drawn on top of it. A controller is picked up automatically. Escape closes this panel.
                </p>
              </>
            ) : (
              <>
                <p className="gb-plate-note">
                  {game
                    ? game.description
                    : 'This ROM came from your own device. It was read into this tab, checked for a cartridge header, handed to the emulator as an in-memory blob, and is gone the moment you close the page.'}
                </p>
                {game && (
                  <dl className="gb-facts">
                    <div><dt>Licence</dt><dd>{game.license}</dd></div>
                    <div><dt>ROM</dt><dd>{formatBytes(game.bytes)}</dd></div>
                    <div><dt>Year</dt><dd>{game.year ?? '—'}</dd></div>
                    <div><dt>Players</dt><dd>{game.players === 2 ? '2' : '1'}</dd></div>
                  </dl>
                )}
                {game && (
                  <a href={game.sourceUrl} target="_blank" rel="noopener noreferrer" className="gb-plate-link">
                    <Icon name="external" size={13} /> Source &amp; licence
                  </a>
                )}
                {game && game.save === false && (
                  <p className="gb-plate-note">
                    {game.title} does not write battery saves, so progress lives in the save states on the
                    rail rather than in the cartridge.
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
