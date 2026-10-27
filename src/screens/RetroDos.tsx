import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  DOS_KEYBOARD,
  DOS_PLAYER_URL,
  bundleUrlFor,
  coverUrlForDos,
  dosGameById,
  formatBytes,
  loadDosShelf,
  type DosGame,
} from '../lib/dos';
import { RETRO_CHANNEL, type PlayerMessage } from '../lib/retro';
import { Button, EmptyState, Icon } from '../components/ui';
import DosPad, { type DosKey } from '../components/DosPad';
import { useStore } from '../lib/store';

/**
 * `/retro/dos/:id` — the DOS desk.
 *
 * The GBA page is a handheld you hold; a DOS game is a machine you sit at, so
 * this page is a monitor on a desk instead of a remake of the cartridge shell.
 * The rules are the same ones the GBA page learned the hard way:
 *
 *   1. **The emulator is an iframe.** js-dos installs a global, owns an audio
 *      context and a wasm machine, and measures its host element on start —
 *      all of which belong to one document. Leaving the page takes the whole
 *      VM with it, which is what "release on exit" actually means in practice.
 *   2. **Nothing is downloaded until you sit down.** `js-dos.js`, the DOSBox
 *      core and the game bundle are fetched by `/retro/dos.html` after this
 *      page has decided the game exists; the shelf page itself only reads JSON.
 *   3. **The screen is 4:3.** DOS ran at 320×200 in a 4:3 frame, and the VGA
 *      modes a bundle can boot into are all that shape, so the opening is 4:3
 *      and the emulator is never stretched to fill something else.
 *
 * Every control here is one of the four commands the player document answers
 * (`pause`, `resume`, `fullscreen`, `mute`) — no invented API, and no control
 * that silently does nothing.
 */

type Phase = 'booting' | 'loading' | 'running' | 'paused' | 'error';

const PHASE_COPY: Record<Phase, { label: string; tone: string }> = {
  booting: { label: 'Warming up the monitor', tone: '#f2b23c' },
  loading: { label: 'Mounting the drive', tone: '#f2b23c' },
  running: { label: 'Running', tone: '#6fcfa6' },
  paused: { label: 'Paused', tone: '#ffadc6' },
  error: { label: 'Stopped', tone: '#ef6a7f' },
};

/** The rail: one row of real commands, each a message the player answers. */
function DeskButton({
  label,
  icon,
  onClick,
  disabled,
  active,
}: {
  label: string;
  icon: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className="inline-flex items-center gap-1.5 rounded-md border-2 px-2.5 py-1.5 text-[11.5px] font-extrabold uppercase tracking-wider transition-colors disabled:opacity-40"
      style={{
        borderColor: active ? 'var(--color-volt-500)' : 'var(--color-ink-500)',
        background: active ? 'rgba(255,210,77,.14)' : 'var(--color-ink-800)',
        color: active ? 'var(--color-volt-300)' : 'var(--color-cream-300)',
      }}
    >
      <Icon name={icon} size={13} />
      {label}
    </button>
  );
}

export default function RetroDosPlayer() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const { sfx } = useStore();

  const [games, setGames] = useState<DosGame[] | null>(null);
  const [shelfError, setShelfError] = useState(false);
  const [phase, setPhase] = useState<Phase>('booting');
  const [problem, setProblem] = useState<string | null>(null);
  /* The player document's own words, when it has any. A generic "it stopped" is
     the least useful thing this page could say. */
  const [detail, setDetail] = useState<string | null>(null);
  /** Bumped by Retry: it remounts the iframe, which restarts the machine. */
  const [attempt, setAttempt] = useState(0);
  const [muted, setMuted] = useState(false);
  const [stalled, setStalled] = useState(false);
  const [nativeFull, setNativeFull] = useState(false);
  /* The pad starts open on anything that has no keyboard under it — a phone or a
     tablet — and closed on a desktop, where the keyboard is right there. It can
     be toggled either way. */
  const [padOpen, setPadOpen] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      /* A narrow window is as good a signal as a coarse pointer: whatever you
         are holding, there is no room for a keyboard under a 820 px screen. */
      return window.matchMedia('(pointer: coarse)').matches
        || navigator.maxTouchPoints > 0
        || window.innerWidth <= 820;
    } catch {
      return false;
    }
  });
  const [inPageFull, setInPageFull] = useState(false);
  /* A row that exists but is still a draft. Only an admin can read it at all —
     `listAllGames` is gated by row-level security — so this branch is a preview
     on the desk, and a visitor never sees it. */
  const [draft, setDraft] = useState<DosGame | null>(null);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const game = useMemo(() => dosGameById(games, id) ?? draft, [games, id, draft]);
  const full = nativeFull || inPageFull;

  /* ------------------------------------------------------------- the shelf */
  useEffect(() => {
    let alive = true;
    loadDosShelf()
      .then((shelf) => { if (alive) setGames(shelf.games); })
      .catch(() => { if (alive) { setGames([]); setShelfError(true); } });
    return () => { alive = false; };
  }, []);

  /* -------------------------------------------------- an unpublished draft */
  useEffect(() => {
    if (shelfError || games === null || dosGameById(games, id)) return;
    let alive = true;
    void (async () => {
      try {
        const admin = await import('../lib/admin');
        const rows = await admin.listAllGames();
        const row = rows.find((r) => r.id === id && r.platform === 'dos');
        if (alive && row) setDraft(admin.retroRowToDosGame(row, admin.publicUrlFor));
      } catch {
        /* Not an admin, or no cloud project: the honest refusal below stands. */
      }
    })();
    return () => { alive = false; };
  }, [games, id, shelfError]);

  /* ----------------------------------------------------------- the player */
  /* A bundle we host ourselves is named in the shelf, so the player document can
     resolve it from `?game=` alone. A bundle an admin published lives in storage
     under an https URL that the shelf cannot derive, so that one is handed over
     in a boot message instead. Both paths end in the same preflight. */
  const remoteBundle = game && /^https:\/\//i.test(game.bundle) ? bundleUrlFor(game) : null;
  const src = remoteBundle || !game ? DOS_PLAYER_URL : `${DOS_PLAYER_URL}?game=${encodeURIComponent(game.id)}`;

  /* Retry re-mounts the player document. Keyed on `attempt`, so the iframe is
     torn down (taking its wasm machine with it) and a fresh one boots. */
  const retry = useCallback(() => {
    setPhase('booting');
    setProblem(null);
    setDetail(null);
    setStalled(false);
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as PlayerMessage | undefined;
      if (!data || data.channel !== RETRO_CHANNEL) return;

      if (data.type === 'status' && data.status) {
        setPhase(data.status as Phase);
        if (data.status !== 'error') setStalled(false);
        return;
      }
      if (data.type === 'error') {
        setPhase('error');
        setProblem((data.message as string | undefined) ?? 'The emulator stopped.');
        setDetail((data.detail as string | undefined) ?? null);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  /* A bundle is a zip of an installation, not a cartridge: on a cold cache the
     core alone is 1.4 MB, and an 8 MB game then has to be unpacked inside
     WebAssembly. Silence for half a minute is normal, so the first hint that
     this is taking a while waits 22 s, and the player's own watchdog is the one
     that calls it a failure at 45 s. */
  useEffect(() => {
    if (phase === 'running' || phase === 'paused' || phase === 'error') return;
    const t = window.setTimeout(() => setStalled(true), 22000);
    return () => window.clearTimeout(t);
  }, [phase]);

  const send = useCallback((cmd: string, value?: unknown, action?: string) => {
    iframeRef.current?.contentWindow?.postMessage(
      { channel: RETRO_CHANNEL, type: 'cmd', cmd, value, action },
      window.location.origin,
    );
  }, []);

  /* One key, down or up, for the on-screen pad. It goes through the same channel
     as pause/mute: the player document owns the keyboard, this page owns the
     buttons. */
  const pressKey = useCallback((spec: DosKey, action: 'down' | 'up' | 'tap') => {
    send('key', { key: spec.key, code: spec.code, keyCode: spec.keyCode }, action);
  }, [send]);

  const onFrameLoad = useCallback(() => {
    if (!remoteBundle || !iframeRef.current?.contentWindow) return;
    iframeRef.current.contentWindow.postMessage(
      {
        channel: RETRO_CHANNEL,
        type: 'boot',
        game: { name: game?.title ?? 'DOS', url: remoteBundle },
      },
      window.location.origin,
    );
  }, [game?.title, remoteBundle]);

  /* --------------------------------------------------------- fullscreen */
  const toggleFullscreen = useCallback(() => {
    const el = stageRef.current;
    if (!el) return;
    if (document.fullscreenElement) { void document.exitFullscreen?.(); return; }
    if (inPageFull) { setInPageFull(false); return; }
    let asked: Promise<void> | undefined;
    try { asked = el.requestFullscreen?.(); } catch { asked = undefined; }
    if (!asked) { setInPageFull(true); return; }
    void asked.then(() => {
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

  useEffect(() => {
    if (!inPageFull) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setInPageFull(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [inPageFull]);

  /* The machine owns the viewport while it runs — a text-mode screen inside a
     scrolling page is a trap for the arrow keys. The guard screens below are
     ordinary pages and keep their own scrolling. */
  const blocked = shelfError || (games !== null && !game && !draft);
  useEffect(() => {
    if (blocked) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [blocked]);

  /* --------------------------------------------------------------- guards */
  const guard = (title: string, body: string) => (
    <div className="min-h-dvh grid place-items-center px-[var(--shell-pad)] py-10">
      <EmptyState
        mascot="waiting"
        title={title}
        body={body}
        action={<Button onClick={() => nav('/retro')} icon={<Icon name="back" size={14} />}>Back to the shelf</Button>}
      />
    </div>
  );

  if (shelfError) {
    return guard(
      'The DOS shelf could not be read',
      'The manifest at /retro/dos/shelf.json did not load, so this page cannot verify which game to start — and will not start one it cannot verify.',
    );
  }
  if (games === null) {
    return (
      <div className="min-h-dvh grid place-items-center px-[var(--shell-pad)] py-10">
        <EmptyState mascot="waiting" title="Reading the shelf" body="One small JSON file — no emulator, no bundle, you have not downloaded the game yet." />
      </div>
    );
  }
  if (!game) {
    return guard(
      'No such game on the DOS shelf',
      `Nothing here matches “${id}”. A game appears on this shelf only after its bundle was checked and the right to host it was recorded, so the address may be one that was never published.`,
    );
  }

  const phaseCopy = PHASE_COPY[phase];
  const draftPreview = !!draft && !(games ?? []).some((g) => g.id === id);
  const started = phase === 'running' || phase === 'paused';
  const cover = coverUrlForDos(game);

  return (
    <div
      ref={stageRef}
      className="dos-stage"
      data-full={full ? 'on' : 'off'}
      style={full ? { background: '#0a0908' } : undefined}
    >
      <div className="dos-desk mx-auto max-w-[1180px] px-[var(--shell-pad)] py-5">
        {/* ---------------- the monitor ---------------- */}
        <section aria-label={`${game.title} — DOS emulator`} className="dos-monitor">
          <div className="dos-monitor-top">
            {/* This page hides the site chrome (a text-mode screen inside a
                scrolling page is a trap for the arrow keys), which left a phone
                player with no way out but "Stop" — a button that sounds like it
                throws the game away. One labelled way back, on the bezel. */}
            <button
              type="button"
              className="dos-back"
              onClick={() => { sfx('back'); nav('/retro?platform=dos'); }}
              aria-label="Back to the DOS shelf"
            >
              <Icon name="back" size={12} />
              <span className="hidden sm:inline">Shelf</span>
            </button>
            <div className="flex items-baseline gap-2.5 min-w-0">
              <span className="dos-monitor-mark" aria-hidden>•</span>
              <h1 className="display text-[15px] sm:text-[17px] text-[#e7dcc8] truncate">{game.title}</h1>
              {game.year && <span className="dos-monitor-sub">{game.year}</span>}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {draftPreview && (
                <span
                  className="rounded-full border px-2 py-0.5 text-[9.5px] font-extrabold uppercase tracking-[0.12em]"
                  style={{ borderColor: '#f2b23c', color: '#f2b23c' }}
                  title="This row is not published: only an administrator can open it."
                >
                  Draft preview
                </span>
              )}
              <span className="dos-monitor-sub hidden sm:inline">MS-DOS · js-dos</span>
              <span className="dos-led" data-state={phase} aria-hidden />
              <span className="sr-only">{phaseCopy.label}</span>
            </div>
          </div>

          {/* 4:3, the shape DOS actually ran in. The player document pads its own
              canvas inside this box; it is never stretched to fit. */}
          <div className="dos-screen">
            {/* A DOS program reads the keyboard directly, so the frame takes
                focus once it boots: the first arrow key then reaches the game
                instead of being eaten by the desk page. */}
            <iframe
              key={attempt}
              ref={iframeRef}
              src={src}
              title={`${game.title} — DOS emulator`}
              onLoad={onFrameLoad}
              allow="fullscreen; autoplay; gamepad"
              className="dos-iframe"
            />
            {/* One card, three honest states: warming up, still working, failed.
                The failed state carries the player's own words and a Retry, so a
                dead screen is never a dead end. */}
            {!started && (
              <div
                className="dos-screen-panel"
                data-state={phase === 'error' ? 'error' : 'busy'}
                role={phase === 'error' ? 'alert' : 'status'}
              >
                {phase === 'error' ? (
                  <>
                    <p className="dos-screen-panel-title">{problem ?? 'The emulator stopped'}</p>
                    <p className="dos-screen-panel-line">
                      {detail
                        ?? 'The player document stopped before it drew a screen. Reloading usually clears it.'}
                    </p>
                    <div className="dos-screen-panel-actions">
                      <button type="button" className="dos-screen-panel-btn" onClick={() => { retry(); sfx('click'); }}>
                        <Icon name="play" size={12} /> Try again
                      </button>
                      <button type="button" className="dos-screen-panel-btn ghost" onClick={() => nav('/retro')}>
                        <Icon name="back" size={12} /> Back to the shelf
                      </button>
                      {/* The player document also runs on its own. Opening it in
                          a tab is the quickest way to see what it says in full —
                          its console and js-dos's own error window included. */}
                      <a
                        className="dos-screen-panel-btn ghost"
                        href={src}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Icon name="expand" size={12} /> Open alone
                      </a>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="dos-screen-panel-spinner" aria-hidden />
                    <p className="dos-screen-panel-title">
                      {stalled ? 'Still working…' : phaseCopy.label}
                    </p>
                    <p className="dos-screen-panel-line">
                      {phase === 'booting'
                        ? 'Fetching the emulator and the bundle — 1.4 MB of core on a cold cache, then the game.'
                        : stalled
                          ? 'The DOSBox core and the bundle are large; an 8 MB game can take a while to unpack in the browser.'
                          : 'Unpacking the bundle and mounting it as C:.'}
                    </p>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Below the picture, in the flow: the pad can never cover a game's
              own HUD, and it survives fullscreen because it lives in the same
              element that goes fullscreen. */}
          {started && padOpen && (
            <DosPad onKey={pressKey} disabled={phase !== 'running' && phase !== 'paused'} />
          )}

          <div className="dos-monitor-bottom">
            <div className="flex flex-wrap items-center gap-1.5">
              <DeskButton
                label={phase === 'paused' ? 'Resume' : 'Pause'}
                icon={phase === 'paused' ? 'play' : 'pause'}
                disabled={!started}
                onClick={() => {
                  const next = phase === 'paused' ? 'resume' : 'pause';
                  send(next);
                  setPhase(next === 'pause' ? 'paused' : 'running');
                  sfx('click');
                }}
              />
              <DeskButton
                label={muted ? 'Unmute' : 'Mute'}
                icon={muted ? 'mute' : 'volume'}
                active={muted}
                onClick={() => {
                  send('mute', !muted);
                  setMuted((m) => !m);
                  sfx('toggle');
                }}
              />
              <DeskButton
                label={padOpen ? 'Hide pad' : 'Gamepad'}
                icon="gamepad"
                active={padOpen}
                disabled={!started}
                onClick={() => { setPadOpen((v) => !v); sfx('toggle'); }}
              />
              <DeskButton
                label="Fullscreen"
                icon="expand"
                active={full}
                onClick={() => { toggleFullscreen(); sfx('click'); }}
              />
              <DeskButton
                label="Stop"
                icon="x"
                onClick={() => { send('stop'); sfx('back'); nav('/retro'); }}
              />
            </div>
            <p className="dos-monitor-hint">
              {formatBytes(game.bytes)} bundle · {phaseCopy.label}
            </p>
          </div>
        </section>

        {/* ---------------- the paperwork ---------------- */}
        <div className={`dos-papers ${full ? 'dos-papers-hidden' : ''}`}>
          <section aria-labelledby="dos-keys" className="panel p-5">
            <h2 id="dos-keys" className="display text-[18px] text-cream-100 leading-tight">Keys the games expect</h2>
            <p className="text-[12px] text-cream-400 mt-1">
              A DOS program reads the keyboard directly, so these are the keys it waits for — not a mapping this page
              invented.
            </p>
            <dl className="mt-3 grid gap-1.5 sm:grid-cols-2">
              {DOS_KEYBOARD.map((row) => (
                <div key={row.action} className="flex items-center justify-between gap-3">
                  <dt className="flex flex-wrap gap-1">
                    {row.keys.map((k) => (
                      <kbd key={k} className="min-w-[24px] text-center px-1.5 py-0.5 rounded border border-ink-400 bg-ink-700 text-[11px] font-bold text-cream-300 shadow-[0_2px_0_0_var(--line-strong)]">{k}</kbd>
                    ))}
                  </dt>
                  <dd className="text-[11.5px] font-extrabold uppercase tracking-wider text-cream-500 text-right">{row.action}</dd>
                </div>
              ))}
            </dl>
            <p className="text-[11.5px] text-cream-500 mt-3">
              On a phone, the <strong className="text-cream-300">Gamepad</strong> under the picture sends the arrow
              keys, Space, Enter, Esc, Ctrl, Shift and Tab straight to the program — hold an arrow to keep moving.
              What a pad cannot do is type: a text adventure still needs a keyboard, and a game that wants a mouse
              still wants a mouse.
            </p>
          </section>

          <section aria-labelledby="dos-about" className="panel p-5">
            <p className="eyebrow text-volt-700 mb-1.5">About this one</p>
            <h2 id="dos-about" className="display text-[18px] text-cream-100 leading-tight">
              {game.tagline || 'DOS'}
            </h2>
            <p className="text-[12.5px] text-cream-400 mt-2 leading-relaxed">{game.description}</p>

            {cover && (
              <img
                src={cover}
                alt={`${game.title} title screen`}
                width={320}
                height={200}
                className="mt-3 w-full max-w-[320px] rounded border border-ink-600 pixelated"
                loading="lazy"
                decoding="async"
              />
            )}

            <dl className="mt-3.5 space-y-1.5 text-[12px]">
              <div className="flex gap-2">
                <dt className="text-cream-500 w-[74px] shrink-0">Author</dt>
                <dd className="text-cream-200 min-w-0 break-words">{game.author}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-cream-500 w-[74px] shrink-0">Licence</dt>
                <dd className="text-cream-200 min-w-0 break-words">
                  {/^https:\/\//i.test(game.licenseUrl) ? (
                    <a
                      href={game.licenseUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline decoration-cream-500/40 underline-offset-2 hover:text-volt-700"
                    >
                      {game.license}
                    </a>
                  ) : game.license}
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-cream-500 w-[74px] shrink-0">Why it is here</dt>
                <dd className="text-cream-200 min-w-0 break-words">{game.rights}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-cream-500 w-[74px] shrink-0">Source</dt>
                <dd className="text-cream-200 min-w-0 truncate">
                  {/^https:\/\//i.test(game.sourceUrl) ? (
                    <a
                      href={game.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline decoration-cream-500/40 underline-offset-2 hover:text-volt-700"
                    >
                      {game.sourceUrl.replace(/^https:\/\//, '')}
                    </a>
                  ) : game.sourceUrl}
                </dd>
              </div>
            </dl>
          </section>
        </div>

        {phase === 'error' && problem && (
          <p role="alert" className="mt-4 rounded-lg border-2 border-blush-600/60 bg-ink-850 px-3.5 py-2.5 text-[12.5px] font-bold text-blush-600">
            {problem}
            {detail ? <span className="block font-normal text-cream-400 mt-1">{detail}</span> : null}
          </p>
        )}

        <p className="dos-footnote">
          The emulator is js-dos 8.5.3 (GPL-2.0) with its DOSBox core, served from this site — no third-party frame, no
          remote script. Leaving this page ends the machine and frees its memory; nothing about the session is kept
          except the save files js-dos writes into this browser's own storage.
        </p>
      </div>
    </div>
  );
}
