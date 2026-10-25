import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  RETRO_KEYBOARD,
  LOCAL_CARTRIDGE_MESSAGE,
  coverUrlFor,
  formatBytes,
  cartridgeKind,
  inspectLocalCartridge,
  loadRetroLibrary,
  marqueeUrlFor,
  type RetroGame,
  type RetroLibrary,
} from '../lib/retro';
import {
  describeCartridge,
  forgetCartridge,
  openRememberedCartridge,
  rememberCartridge,
  rememberedCartridge,
  type RememberedCartridge,
} from '../lib/localCartridge';
import { Button, ErrorState, Icon, Panel, Segmented } from '../components/ui';
import { useStore } from '../lib/store';

/**
 * `/retro` — the Game Boy Advance shelf.
 *
 * The emulator itself lives on its own route and is never part of this page's
 * bundle: nothing here imports EmulatorJS, nothing here fetches the 1 MB core,
 * and `retro/data/` is only touched once a cartridge is launched. This page is
 * HTML, one 240×160 PNG per game, and a manifest.
 */

type Lens = 'all' | 'arcade' | 'action' | 'shooter' | 'puzzle';

/** Why a cartridge could not be kept in this browser. Never blocks playing it. */
const STORAGE_NOTE: Record<'too-big' | 'empty' | 'storage', string> = {
  'too-big': 'That cartridge is too big to keep in this browser, so it will play once and then be gone on reload.',
  empty: 'That file is empty, so there is nothing to keep.',
  storage: 'This browser refused to store the cartridge (private mode, or no space left), so it plays now but will not survive a reload.',
};

const LENSES: { value: Lens; label: string }[] = [
  { value: 'all', label: 'All carts' },
  { value: 'arcade', label: 'Arcade' },
  { value: 'action', label: 'Action' },
  { value: 'shooter', label: 'Shooters' },
  { value: 'puzzle', label: 'Puzzles' },
];

/* ------------------------------------------------------------------ cart */

function CartridgeCard({ game, onPlay }: { game: RetroGame; onPlay: (g: RetroGame) => void }) {
  const [hovered, setHovered] = useState(false);
  const marquee = marqueeUrlFor(game);
  const showMarquee = hovered && !!marquee;

  return (
    <article
      className="group relative flex flex-col panel overflow-hidden"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* cover: the real 240×160 frame the emulator produced, never a mock-up */}
      <button
        type="button"
        onClick={() => onPlay(game)}
        className="relative block w-full text-left no-tap"
        aria-label={`Launch ${game.title}`}
        style={{ background: '#221a15' }}
      >
        <span className="relative block w-full overflow-hidden" style={{ aspectRatio: '3 / 2' }}>
          <img
            src={coverUrlFor(game)}
            alt={`${game.title} gameplay screen`}
            width={240}
            height={160}
            loading="lazy"
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover pixelated transition-opacity duration-300"
            style={{ opacity: showMarquee ? 0 : 1 }}
          />
          {marquee && (
            <img
              src={marquee}
              alt=""
              aria-hidden
              width={240}
              height={160}
              loading="lazy"
              decoding="async"
              className="absolute inset-0 h-full w-full object-cover pixelated transition-opacity duration-300"
              style={{ opacity: showMarquee ? 1 : 0 }}
            />
          )}
          {/* a thin glass edge, not a glow: keeps pixel art crisp against the card */}
          <span aria-hidden className="absolute inset-0 pointer-events-none" style={{ boxShadow: 'inset 0 0 0 1px rgba(255,246,232,.12), inset 0 -18px 24px -18px rgba(0,0,0,.65)' }} />
        </span>
      </button>

      <div className="flex flex-1 flex-col p-3.5 pt-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="display text-[17px] leading-tight text-cream-100 truncate">{game.title}</h3>
            <p className="text-[11px] font-bold uppercase tracking-wider text-cream-400 mt-0.5 truncate">
              {game.tagline || game.tags[0] || 'Homebrew'}
            </p>
          </div>
          <span
            aria-hidden
            className="mt-1 w-2 h-2 rounded-full shrink-0"
            style={{ background: game.accent, boxShadow: `0 0 0 3px ${game.accent}22` }}
          />
        </div>

        <p className="text-[12px] text-cream-400 leading-snug mt-2 line-clamp-2">{game.description}</p>

        <div className="flex flex-wrap gap-1.5 mt-2.5" aria-hidden>
          {game.tags.slice(0, 2).map((t) => (
            <span key={t} className="text-[9.5px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-ink-500 text-cream-500">
              {t}
            </span>
          ))}
          <span className="text-[9.5px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-ink-500 text-cream-500">
            {formatBytes(game.bytes)}
          </span>
        </div>

        <div className="flex items-center justify-between gap-2 mt-3 pt-2.5 border-t border-ink-600/70">
          <span className="text-[10.5px] text-cream-500 font-bold truncate">
            {game.author}
            {game.year ? ` · ${game.year}` : ''}
          </span>
          <Button size="sm" onClick={() => onPlay(game)} icon={<Icon name="play" size={12} />}>
            Insert
          </Button>
        </div>
      </div>
    </article>
  );
}

/* --------------------------------------------------------------- console */

/** The hardware frame the shelf is presented in. Drawn with borders and real
 *  type — no illustration standing in for the emulator itself. */
function HandheldFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative rounded-[26px] border-2 border-[#4b352a] bg-[#2b1f19] p-3 sm:p-4 shadow-[0_2px_0_0_#4b352a,0_26px_50px_-30px_rgba(90,58,18,.85)]">
      <div className="flex items-center justify-between px-1 pb-2.5">
        <span className="text-[9.5px] font-extrabold uppercase tracking-[0.18em] text-[#c9a888]">Dot Matrix Advance</span>
        <span className="flex items-center gap-1.5 text-[9.5px] font-extrabold uppercase tracking-[0.18em] text-[#c9a888]">
          <span className="w-1.5 h-1.5 rounded-full bg-leaf-400" aria-hidden /> Power
        </span>
      </div>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ page */

export default function Retro() {
  const nav = useNavigate();
  const { sfx } = useStore();
  const [library, setLibrary] = useState<RetroLibrary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [lens, setLens] = useState<Lens>('all');
  const [localProblem, setLocalProblem] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [remembered, setRemembered] = useState<RememberedCartridge | null>(null);
  const [storageNote, setStorageNote] = useState<string | null>(null);
  const deferred = useDeferredValue(query);
  const searchRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    loadRetroLibrary()
      .then((lib) => { if (alive) setLibrary(lib); })
      .catch(() => { if (alive) setError('The cartridge shelf could not be loaded.'); });
    rememberedCartridge().then((cart) => { if (alive) setRemembered(cart); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const games = library?.games;

  const results = useMemo(() => {
    const q = deferred.trim().toLowerCase();
    return (games ?? []).filter((g) => {
      if (lens !== 'all' && !g.tags.includes(lens)) return false;
      if (!q) return true;
      return (
        g.title.toLowerCase().includes(q) ||
        g.author.toLowerCase().includes(q) ||
        g.description.toLowerCase().includes(q) ||
        g.tags.some((t) => t.includes(q))
      );
    });
  }, [games, deferred, lens]);

  const play = (game: RetroGame) => {
    sfx('select');
    nav(`/retro/${game.id}`);
  };

  const onPickCartridge = async (file: File | undefined) => {
    if (!file) return;
    setLocalProblem(null);
    setStorageNote(null);
    setChecking(true);
    const problem = await inspectLocalCartridge(file);
    const kind = problem ? null : await cartridgeKind(file);
    if (problem) {
      setChecking(false);
      setLocalProblem(LOCAL_CARTRIDGE_MESSAGE[problem]);
      return;
    }
    /* Keep a copy in this browser so a reload does not eject the cartridge —
       and so its save file has something to belong to. Failure is not fatal:
       the cartridge still plays, this browser just will not remember it. */
    const stored = await rememberCartridge(file, kind ?? 'gba');
    setChecking(false);
    setRemembered(stored.ok ? stored.cartridge : null);
    if (!stored.ok) setStorageNote(STORAGE_NOTE[stored.reason]);
    sfx('select');
    // The File stays in this tab's memory: a route-state hand-off, not an upload.
    nav('/retro/local', {
      state: { name: file.name.replace(/\.(gba|agb|bin|gb|gbc)$/i, ''), file, kind: kind ?? 'gba' },
    });
  };

  const continueRemembered = async () => {
    const cart = await openRememberedCartridge();
    if (!cart) {
      setRemembered(null);
      setLocalProblem(
        'This browser no longer has that cartridge stored — it may have been cleared, or the file was too big for the space left. Drop it in again.',
      );
      return;
    }
    sfx('select');
    nav('/retro/local', {
      state: { name: cart.file.name.replace(/\.(gba|agb|bin|gb|gbc)$/i, ''), file: cart.file, kind: cart.kind },
    });
  };

  const eject = async () => {
    await forgetCartridge();
    setRemembered(null);
    setStorageNote(null);
  };

  return (
    <div className="mx-auto max-w-[1340px] px-[var(--shell-pad)] py-7">
      {/* ---------------- header ---------------- */}
      <header className="mb-6">
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <p className="eyebrow text-blush-600 mb-1.5">Game Boy Advance · 240 × 160</p>
            <h1 className="display text-[32px] sm:text-[42px] leading-[1.02] text-cream-100">
              Retro <span className="text-blush-600">Arcade</span>
            </h1>
            <p className="text-[13.5px] text-cream-500 mt-2 max-w-[64ch]">
              A shelf of real Game Boy Advance cartridges, running on the original hardware timings inside your
              browser. Every title here is freely redistributable homebrew — nothing commercial, nothing borrowed
              from a ROM site — and the emulator is only downloaded the moment you insert a cartridge.
            </p>
          </div>
          <div className="hidden lg:block shrink-0 w-[248px]">
            <HandheldFrame>
              <div className="rounded-[16px] overflow-hidden border-2 border-[#14100d] bg-[#0b0d12]">
                <img src="/retro/covers/cyber-citadel.png" alt="" width={240} height={160} className="w-full pixelated" style={{ display: 'block' }} />
              </div>
              <div className="flex items-center justify-between mt-2.5 px-1">
                <span className="text-[9px] font-extrabold uppercase tracking-[0.16em] text-[#8b7565]">Save states</span>
                <span className="text-[9px] font-extrabold uppercase tracking-[0.16em] text-[#8b7565]">Fullscreen</span>
              </div>
            </HandheldFrame>
          </div>
        </div>
      </header>

      {/* ---------------- controls ---------------- */}
      <div className="sticky top-[58px] z-20 -mx-[var(--shell-pad)] px-[var(--shell-pad)] py-2 mb-4 bg-ink-900/92 backdrop-blur-md blur-heavy border-b border-ink-600/70">
        <div className="flex flex-col sm:flex-row gap-2.5 sm:items-center">
          <div className="relative flex-1 min-w-0">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-cream-500"><Icon name="search" size={16} /></span>
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              type="search"
              placeholder="Search cartridges, genres, authors…"
              aria-label="Search retro cartridges"
              className="w-full bg-ink-800 border-2 border-ink-500 pl-9 pr-3 py-2.5 text-[13.5px] text-cream-100 placeholder:text-cream-400 notch-sm focus:border-volt-500 outline-none"
            />
          </div>
          <Segmented value={lens} onChange={(v) => setLens(v as Lens)} size="sm" label="Filter cartridges" options={LENSES} />
        </div>
      </div>

      {/* ---------------- cards ---------------- */}
      {error ? (
        <Panel>
          <ErrorState
            title="The shelf is empty"
            body={error}
            recovery="The cartridge manifest lives at /retro/roms.json — if you are running the dev server, check that public/retro is intact."
            onRetry={() => { setError(null); loadRetroLibrary().then(setLibrary).catch(() => setError('Still no manifest.')); }}
          />
        </Panel>
      ) : !library ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="panel overflow-hidden animate-pulse">
              <div className="bg-ink-600/40" style={{ aspectRatio: '3 / 2' }} />
              <div className="p-3.5 space-y-2">
                <div className="h-3 w-2/3 bg-ink-600/60 rounded" />
                <div className="h-2.5 w-full bg-ink-600/40 rounded" />
                <div className="h-2.5 w-4/5 bg-ink-600/40 rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : results.length === 0 ? (
        <Panel>
          <div className="p-6 text-center">
            <p className="display text-[20px] text-cream-100">No cartridge matches that</p>
            <p className="text-[13px] text-cream-400 mt-1">Try a shorter search, or clear the filter.</p>
            <Button className="mt-4" size="sm" onClick={() => { setQuery(''); setLens('all'); }}>Show all cartridges</Button>
          </div>
        </Panel>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {results.map((g) => <CartridgeCard key={g.id} game={g} onPlay={play} />)}
        </div>
      )}

      {/* ---------------- your own cartridge ---------------- */}
      <section aria-labelledby="own-cart-h" className="mt-9 grid gap-4 lg:grid-cols-[1.15fr_1fr]">
        {/* The copy says "drop a file here", so dropping has to work. Files never
            leave the tab: the drop handler hands the File to the same header
            check the picker uses. */}
        <Panel
          className="p-5 sm:p-6 transition-colors"
          style={dragging ? { borderColor: 'var(--color-volt-400)', background: '#fffbe6', boxShadow: 'inset 0 0 0 3px rgba(255, 210, 77, .35)' } : undefined}
          onDragOver={(e: React.DragEvent) => { e.preventDefault(); if (!dragging) setDragging(true); }}
          onDragLeave={(e: React.DragEvent) => {
            const next = e.relatedTarget;
            if (next instanceof Node && e.currentTarget.contains(next)) return;
            setDragging(false);
          }}
          onDrop={(e: React.DragEvent) => {
            e.preventDefault();
            setDragging(false);
            void onPickCartridge(e.dataTransfer.files?.[0]);
          }}
        >
          <p className="eyebrow text-volt-700 mb-1.5">Your own cartridge</p>
          <h2 id="own-cart-h" className="display text-[23px] text-cream-100 leading-tight">Play a ROM you already own</h2>
          <p className="text-[13px] text-cream-400 mt-2 max-w-[52ch]">
            {dragging ? (
              'Let go and the cartridge drops straight into the emulator.'
            ) : (
              <>
                Drop a <code className="font-mono text-[12px] px-1 rounded bg-ink-850 border border-ink-600">.gba</code>,{' '}
                <code className="font-mono text-[12px] px-1 rounded bg-ink-850 border border-ink-600">.gb</code> or{' '}
                <code className="font-mono text-[12px] px-1 rounded bg-ink-850 border border-ink-600">.gbc</code> file on
                this card — or pick one — and it runs in this tab. The file is read by your browser, checked for a real
                cartridge header, and kept in <em>this</em> browser so a reload does not eject it, along with its save.
                It is never uploaded anywhere, and Eject removes it.
              </>
            )}
          </p>
          {remembered && (
            <div className="mt-3.5 rounded-lg border border-ink-600 bg-ink-900/60 px-3 py-2.5">
              <p className="text-[11px] font-bold uppercase tracking-[.07em] text-cream-500">In the handheld</p>
              <p className="text-[12.5px] text-cream-200 mt-0.5 break-words">{describeCartridge(remembered)}</p>
              <div className="flex flex-wrap items-center gap-2 mt-2.5">
                <Button size="sm" onClick={() => { void continueRemembered(); }} icon={<Icon name="play" size={12} />}>
                  Continue
                </Button>
                <button
                  type="button"
                  onClick={() => { void eject(); }}
                  className="text-[11.5px] font-bold text-cream-500 hover:text-blush-600 underline underline-offset-2"
                >
                  Eject cartridge
                </button>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2.5 mt-4">
            <input
              ref={fileRef}
              type="file"
              accept=".gba,.agb,.bin,.gb,.gbc"
              className="sr-only"
              onChange={(e) => { void onPickCartridge(e.target.files?.[0]); e.currentTarget.value = ''; }}
            />
            <Button onClick={() => fileRef.current?.click()} icon={<Icon name="plus" size={14} />} disabled={checking}>
              {checking ? 'Checking cartridge…' : remembered ? 'Choose another' : 'Choose a ROM'}
            </Button>
            <span className="text-[11.5px] text-cream-500">GBA · GB · GBC · up to 32 MB · stays in this browser</span>
          </div>
          {localProblem && (
            <p role="alert" className="mt-3 text-[12.5px] font-bold text-blush-600">{localProblem}</p>
          )}
          {storageNote && (
            <p role="status" className="mt-3 text-[12px] text-cream-400">{storageNote}</p>
          )}
          <p className="text-[11px] text-cream-500 mt-3">
            Please only load ROMs you are legally allowed to play. This site hosts none of them for you.
          </p>
        </Panel>

        <Panel className="p-5 sm:p-6 bg-ink-850">
          <p className="eyebrow text-blush-600 mb-1.5">Controls, as tested</p>
          <h2 className="display text-[20px] text-cream-100 leading-tight">What the buttons do</h2>
          <dl className="mt-3 space-y-1.5">
            {RETRO_KEYBOARD.map((row) => (
              <div key={row.action} className="flex items-center justify-between gap-3">
                <dt className="flex gap-1">
                  {row.keys.map((k) => (
                    <kbd key={k} className="min-w-[24px] text-center px-1.5 py-0.5 rounded border border-ink-400 bg-ink-700 text-[11px] font-bold text-cream-300 shadow-[0_2px_0_0_var(--line-strong)]">{k}</kbd>
                  ))}
                </dt>
                <dd className="text-[12px] font-extrabold uppercase tracking-wider text-cream-500">{row.action}</dd>
              </div>
            ))}
          </dl>
          <p className="text-[11.5px] text-cream-400 mt-3 leading-snug">
            On a phone the emulator draws its own on-screen pad. A connected controller is picked up by the browser’s
            gamepad API and mapped the way EmulatorJS maps it — remapping lives in the emulator’s own settings panel.
          </p>
        </Panel>
      </section>

      {/* ---------------- honesty block ---------------- */}
      <section aria-labelledby="retro-faq" className="mt-10 pt-7 border-t-2 border-ink-600">
        <p className="eyebrow text-volt-700 mb-2">Under the hood</p>
        <h2 id="retro-faq" className="display text-[24px] sm:text-[28px] text-cream-100 leading-tight">How this shelf works</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 mt-4">
          {([
            {
              t: 'Nothing loads until you press Insert',
              d: 'The GBA core (a 1 MB WebAssembly build of mGBA) and the emulator runtime are fetched only when a cartridge launches. Browsing this page downloads the manifest and one small PNG per card.',
            },
            {
              t: 'Every ROM is open source',
              d: 'Each cartridge links to the repository it was built from and the licence it ships under. Covers are frames captured from the running emulator, not artwork we invented.',
              href: '/retro/licenses/NOTICE.txt',
            },
            {
              t: 'Isolated on purpose',
              d: 'The emulator runs in its own document, so a misbehaving core cannot touch the rest of the arcade — and closing the player frees the whole VM.',
            },
            {
              t: 'Save states in your browser',
              d: 'Save and load live in your browser’s own storage, per cartridge. Battery-backed in-game saves depend on the ROM itself; every title here was tested for save states, not for battery saves.',
            },
            {
              t: 'No BIOS required',
              d: 'The mGBA core runs these cartridges without a GBA BIOS dump, so there is no copyrighted firmware to provide. Some commercial games are stricter; these are not.',
            },
            {
              t: 'Audio needs one click',
              d: 'Browsers refuse to start audio before a gesture, which is why the player shows a Start button over the screen. Press it once and sound runs for the rest of the session.',
            },
          ] as { t: string; d: string; href?: string }[]).map((item) => (
            <div key={item.t} className="p-4 rounded-2xl border-2 border-ink-600 bg-ink-800">
              <h3 className="text-[13px] font-extrabold text-cream-100">{item.t}</h3>
              <p className="text-[12px] text-cream-400 mt-1 leading-snug">{item.d}</p>
              {item.href && (
                <a
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1.5 inline-flex items-center gap-1 text-[11.5px] font-bold text-volt-700 hover:text-volt-600 underline decoration-volt-700/40 underline-offset-2"
                >
                  Full licence notices <Icon name="external" size={11} />
                </a>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
