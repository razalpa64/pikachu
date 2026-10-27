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
  booting: { label: 'Opening the desk', tone: '#f2b23c' },
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
  const [muted, setMuted] = useState(false);
  const [stalled, setStalled] = useState(false);
  const [nativeFull, setNativeFull] = useState(false);
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
        setProblem('The player stopped. Its own message is on the screen below the monitor.');
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  /* A bundle is a zip of an installation, not a cartridge: on a cold cache the
     core alone is 1.4 MB, so silence is expected for a few seconds. Past the
     player's own 25-second watchdog we stop promising it is coming. */
  useEffect(() => {
    if (phase === 'running' || phase === 'paused' || phase === 'error') return;
    const t = window.setTimeout(() => setStalled(true), 20000);
    return () => window.clearTimeout(t);
  }, [phase]);

  const send = useCallback((cmd: string, value?: unknown) => {
    iframeRef.current?.contentWindow?.postMessage(
      { channel: RETRO_CHANNEL, type: 'cmd', cmd, value },
      window.location.origin,
    );
  }, []);

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
            <iframe
              ref={iframeRef}
              src={src}
              title={`${game.title} — DOS emulator`}
              onLoad={onFrameLoad}
              allow="fullscreen; autoplay; gamepad"
              className="dos-iframe"
            />
            {phase !== 'running' && phase !== 'paused' && (
              <p className="dos-screen-note" role="status">
                {phase === 'error'
                  ? 'The emulator stopped — see the note under the monitor'
                  : stalled
                    ? 'Still fetching the emulator core — it is 1.4 MB on a cold cache'
                    : phaseCopy.label}
              </p>
            )}
          </div>

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
              On a phone, tap the screen once to give it the keyboard focus, then use the on-screen controls js-dos
              draws. There is no touch gamepad for arbitrary DOS titles — a program that needs a mouse expects a
              mouse.
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

        {problem && (
          <p role="alert" className="mt-4 rounded-lg border-2 border-blush-600/60 bg-ink-850 px-3.5 py-2.5 text-[12.5px] font-bold text-blush-600">
            {problem}
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
