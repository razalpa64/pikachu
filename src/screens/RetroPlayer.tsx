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

type Boot = { name?: string; file?: File } | undefined;

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
  const press = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    // The press is sent first: capture is a nicety for thumbs that slide off,
    // and a synthetic pointer (a test, an assistive tool) has no id to capture.
    send('input', { index, pressed: true });
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* no live pointer */ }
  };
  const release = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    send('input', { index, pressed: false });
  };
  /* A pointer is not the only way to press a button. Space/Enter hold the
     button down for as long as the key repeats, which is what a keyboard player
     expects from the pad they can tab to. */
  const keyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    if (e.repeat) return;
    send('input', { index, pressed: true });
  };
  const keyUp = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
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
  const { sfx } = useStore();
  const boot = (loc.state ?? undefined) as Boot;
  const isLocal = id === 'local';

  const [library, setLibrary] = useState<RetroGame[] | null>(null);
  const [libraryError, setLibraryError] = useState(false);
  const [status, setStatus] = useState<PlayerStatus>('booting');
  const [notice, setNotice] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [panel, setPanel] = useState<'none' | 'keys' | 'about'>('none');
  const [stalled, setStalled] = useState(false);
  const [full, setFull] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const game = library ? retroGameById(library, id) : null;
  /* Nothing was mounted to play: the page shows a note instead of a console. */
  const blocked =
    (isLocal && !boot?.file) ||
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
          a.download = `${(game?.title ?? boot?.name ?? 'retro').replace(/\s+/g, '-').toLowerCase()}-${Date.now()}.png`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          say('Screenshot saved');
          break;
        }
        case 'volume': setMuted((data.value ?? 1) === 0); break;
        case 'error':
          if (data.message === 'no-save') say('No saved state for this cartridge yet');
          else say('The emulator could not do that');
          break;
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [game?.title, boot?.name, say, sfx]);

  /* An honest signal while a big cartridge is still streaming. */
  useEffect(() => {
    if (status === 'running' || status === 'paused' || status === 'error') return;
    const t = window.setTimeout(() => setStalled(true), 9000);
    return () => window.clearTimeout(t);
  }, [status]);

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

  /* Fullscreen is requested on the *stage*, not the shell, so the rail stays
     reachable — the same reason a handheld keeps its power switch next to its
     screen. */
  const toggleFullscreen = useCallback(() => {
    const el = stageRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen?.();
    else void el.requestFullscreen?.().catch(() => say('This browser refused fullscreen'));
  }, [say]);

  /* Fullscreen drops the page chrome and hands the extra height to the shell,
     which is the whole point of asking for the screen: the device grows from
     ~535px to ~640px wide because the header and rail stop taking 120px of it. */
  useEffect(() => {
    const onChange = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    onChange();
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  /* Plain array, rebuilt each render: its handlers post to the frame, and
     memoising it would only make React's lint wonder when those handlers were
     allowed to read a ref. */
  const started = status === 'running' || status === 'paused';
  const rail = [
    { id: 'pause', label: status === 'paused' ? 'Resume' : 'Pause', icon: status === 'paused' ? 'play' : 'pause', disabled: !started, run: () => { send('toggle'); sfx('click'); } },
    { id: 'save', label: 'Save', icon: 'save', disabled: !started, run: () => { send('saveState'); sfx('click'); } },
    { id: 'load', label: 'Load', icon: 'load', disabled: !started, run: () => { send('loadState'); sfx('click'); } },
    { id: 'restart', label: 'Restart', icon: 'rotate', disabled: !started, run: () => { send('restart'); say('Cartridge restarted'); sfx('toggle'); } },
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

  if (isLocal && !boot?.file) {
    return notFound(
      'That cartridge is no longer in memory',
      'A ROM you open from your device is never stored, so reloading the page forgets it. Pick the file again and it starts from the top.',
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

  const title = game?.title ?? boot?.name ?? 'Your cartridge';
  const statusCopy = STATUS_COPY[status];
  const src = isLocal ? RETRO_PLAYER_URL : `${RETRO_PLAYER_URL}?game=${encodeURIComponent(id)}`;
  const lampState = status === 'running' ? 'on' : status === 'paused' ? 'paused' : status === 'error' ? 'off' : 'waiting';

  return (
    <div className="gb-stage" ref={stageRef} data-status={status} data-full={full ? 'on' : 'off'}>
      {/* ---------------- slim header: where you are, how to leave ---------------- */}
      <header className="gb-head">
        <button onClick={() => { sfx('click'); nav('/retro'); }} className="gb-chip" aria-label="Back to the shelf">
          <Icon name="back" size={14} />
          <span className="gb-chip-word">Shelf</span>
        </button>

        <div className="gb-head-title">
          <p className="gb-head-name">{title}</p>
          <p className="gb-head-meta">
            Game Boy Advance{game ? ` · ${game.author} · ${game.year}` : ' · from your device'}
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

            <div className="gb-screen">
              <iframe
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
                </div>
              )}
            </div>
          </div>

          {/* ---------------- the plastic ---------------- */}
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
          about Esc. It floats over the top-right corner of the shell. */}
      {full && (
        <button onClick={toggleFullscreen} className="gb-fs-exit">
          <Icon name="expand" size={15} />
          <span>Exit fullscreen</span>
        </button>
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
                    : 'This ROM came from your own device. It was read into this tab, checked for a GBA cartridge header, handed to the emulator as an in-memory blob, and is gone the moment you close the page.'}
                </p>
                {game && (
                  <dl className="gb-facts">
                    <div><dt>Licence</dt><dd>{game.license}</dd></div>
                    <div><dt>ROM</dt><dd>{formatBytes(game.bytes)}</dd></div>
                    <div><dt>Year</dt><dd>{game.year}</dd></div>
                    <div><dt>Players</dt><dd>{game.players === 2 ? '2' : '1'}</dd></div>
                  </dl>
                )}
                {game && (
                  <a href={game.sourceUrl} target="_blank" rel="noopener noreferrer" className="gb-plate-link">
                    <Icon name="external" size={13} /> Source &amp; licence
                  </a>
                )}
                {game && !game.save && (
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
