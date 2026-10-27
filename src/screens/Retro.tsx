import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
import {
  DOS_KEYBOARD,
  coverUrlForDos,
  dosGameById,
  loadDosShelf,
  type DosGame,
  type DosShelf,
} from '../lib/dos';
import { Button, ErrorState, Icon, Panel, Segmented } from '../components/ui';
import { useStore } from '../lib/store';
import { useSiteContent } from '../lib/content';
import { RETRO_HEADING, RETRO_LEDE } from '../lib/copy';

/**
 * `/retro` — the Game Boy Advance shelf.
 *
 * The emulator itself lives on its own route and is never part of this page's
 * bundle: nothing here imports EmulatorJS, nothing here fetches the 1 MB core,
 * and `retro/data/` is only touched once a cartridge is launched. This page is
 * HTML, one 240×160 PNG per game, and a manifest.
 */

type Lens = 'all' | 'arcade' | 'action' | 'shooter' | 'puzzle';
/** Which machine the shelf is showing. Two platforms, one page: they are the
 *  same idea (a legal library you can press Play in), so they belong together. */
type Platform = 'gba' | 'dos';

const PLATFORMS: { value: Platform; label: string }[] = [
  { value: 'gba', label: 'GBA carts' },
  { value: 'dos', label: 'DOS games' },
];

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
  /* An uploaded cartridge has its cover in storage. If that one request fails —
     a deleted object, a blocked host — the card still has to look deliberate
     rather than like a hole in the shelf. */
  const [coverBroken, setCoverBroken] = useState(false);
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
          {!coverBroken && (
            <img
              src={coverUrlFor(game)}
              alt={`${game.title} gameplay screen`}
              width={240}
              height={160}
              loading="lazy"
              decoding="async"
              onError={() => setCoverBroken(true)}
              className="absolute inset-0 h-full w-full object-cover pixelated transition-opacity duration-300"
              style={{ opacity: showMarquee ? 0 : 1 }}
            />
          )}
          {coverBroken && (
            <span
              aria-hidden
              className="absolute inset-0 grid place-items-center px-3 text-center"
              style={{ background: `linear-gradient(140deg, #161310 0%, ${game.accent} 100%)` }}
            >
              <span className="display text-[15px] leading-tight text-white/90">{game.title}</span>
            </span>
          )}
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

/**
 * A DOS game on the shelf.
 *
 * DOS has no 240×160 frame to capture and no cover art we are allowed to
 * invent, so a card without a real screenshot shows a typographic plate: the
 * title set as the thing itself, on the same flat panel as the rest of the
 * site. That is a deliberate placeholder — not a fake screenshot.
 */
function DosCard({ game, onPlay }: { game: DosGame; onPlay: (g: DosGame) => void }) {
  const cover = coverUrlForDos(game);
  const [coverBroken, setCoverBroken] = useState(false);
  const showCover = !!cover && !coverBroken;

  return (
    <article className="group relative flex flex-col panel overflow-hidden">
      <button
        type="button"
        onClick={() => onPlay(game)}
        className="relative block w-full text-left no-tap"
        aria-label={`Play ${game.title}`}
      >
        <span className="relative block w-full overflow-hidden" style={{ aspectRatio: '4 / 3', background: '#16130f' }}>
          {showCover ? (
            <img
              src={cover}
              alt={`${game.title} title screen`}
              width={320}
              height={240}
              loading="lazy"
              decoding="async"
              onError={() => setCoverBroken(true)}
              className="absolute inset-0 h-full w-full object-cover pixelated"
            />
          ) : (
            <span aria-hidden className="absolute inset-0 flex flex-col justify-between p-3.5">
              <span
                className="text-[9.5px] font-extrabold uppercase tracking-[0.22em]"
                style={{ color: game.accent }}
              >
                MS-DOS{game.year ? ` · ${game.year}` : ''}
              </span>
              <span className="display text-[22px] sm:text-[24px] leading-[1.05] text-cream-100 break-words">
                {game.title}
              </span>
              <span className="h-[3px] w-14" style={{ background: game.accent, opacity: .7 }} />
            </span>
          )}
          <span aria-hidden className="absolute inset-0 pointer-events-none" style={{ boxShadow: 'inset 0 0 0 1px rgba(255,246,232,.12), inset 0 -18px 24px -18px rgba(0,0,0,.65)' }} />
        </span>
      </button>

      <div className="flex flex-1 flex-col p-3.5 pt-3">
        <h3 className="display text-[17px] leading-tight text-cream-100 truncate">{game.title}</h3>
        <p className="text-[11px] font-bold uppercase tracking-wider text-cream-400 mt-0.5 truncate">
          {game.tagline || 'DOS'}
        </p>
        <p className="text-[12px] text-cream-400 leading-snug mt-2 line-clamp-2">{game.description}</p>

        <div className="flex flex-wrap gap-1.5 mt-2.5">
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
            {game.author} · {game.license}
          </span>
          <Button size="sm" onClick={() => onPlay(game)} icon={<Icon name="play" size={12} />}>
            Play
          </Button>
        </div>
      </div>
    </article>
  );
}

/* Two answer sets for the "under the hood" block. The GBA shelf and the DOS desk
   are different machines with different promises, and a note that is true of one
   and false of the other is worse than no note at all. */
type FaqItem = { t: string; d: string; href?: string };

const DOS_FAQ: FaqItem[] = [
            {
              t: 'A label is not a licence',
              d: '“Freeware” and “Shareware” describe how a game was sold. Neither is a grant to redistribute it, so neither is treated as one: every record in the discovery index stays unplayable until a person records the evidence.',
            },
            {
              t: 'The emulator is js-dos, unmodified',
              d: 'js-dos 8.5.3 with its own DOSBox core, served from this site under GPL-2.0 — no third-party frame, no remote script, no account. It is fetched only after you press Play.',
            },
            {
              t: 'One file, one machine',
              d: 'A bundle is a ZIP of a whole DOS installation. Every one is checked before it is hosted — is it a ZIP, does it have .jsdos/dosbox.conf, does any path escape the archive — and only then does it get a row.',
            },
            {
              t: 'Isolated on purpose',
              d: 'The emulator runs in its own document, so a misbehaving core cannot reach the rest of the arcade. Leaving the page ends the machine and frees its memory.',
            },
            {
              t: 'Your keyboard, not a mapping',
              d: 'A DOS program reads the keyboard directly. Pause, mute and fullscreen are the only things this site sends; the arrows and Ctrl are whatever the game itself expects.',
            },
            {
              t: 'Saves live in this browser',
              d: 'js-dos keeps its save files in your browser’s own storage, per bundle. Nothing is uploaded, and clearing site data takes them with it.',
            },
  ];

const GBA_FAQ: FaqItem[] = [
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
  ];

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
  const copy = useSiteContent();
  const [params, setParams] = useSearchParams();
  /* The URL is the switch: `/retro?platform=dos` survives a reload, a shared
     link and the back button, which a piece of component state does not. */
  const platform: Platform = params.get('platform') === 'dos' ? 'dos' : 'gba';
  const [library, setLibrary] = useState<RetroLibrary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dosShelf, setDosShelf] = useState<DosShelf | null>(null);
  const [dosError, setDosError] = useState<string | null>(null);
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

  /* The DOS manifest is a separate, small file and is only fetched once someone
     actually asks for the DOS shelf — the 536 KB discovery index behind it is
     never loaded for a visitor at all. */
  useEffect(() => {
    if (platform !== 'dos' || dosShelf || dosError) return;
    let alive = true;
    loadDosShelf()
      .then((shelf) => { if (alive) setDosShelf(shelf); })
      .catch(() => { if (alive) setDosError('The DOS shelf could not be loaded.'); });
    return () => { alive = false; };
  }, [platform, dosShelf, dosError]);

  const setPlatform = (next: Platform) => {
    sfx('toggle');
    setParams(next === 'dos' ? { platform: 'dos' } : {}, { replace: true });
  };

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

  const dosResults = useMemo(() => {
    const q = deferred.trim().toLowerCase();
    return (dosShelf?.games ?? []).filter((g) => {
      if (!q) return true;
      return (
        g.title.toLowerCase().includes(q) ||
        g.author.toLowerCase().includes(q) ||
        g.description.toLowerCase().includes(q) ||
        (g.tagline || '').toLowerCase().includes(q) ||
        g.tags.some((t) => t.includes(q))
      );
    });
  }, [dosShelf, deferred]);

  const play = (game: RetroGame) => {
    sfx('select');
    nav(`/retro/${game.id}`);
  };

  const playDos = (game: DosGame) => {
    sfx('select');
    // The id is re-resolved on the player page against the same shelf; a hand
    // typed id for a game that is not there gets an honest "no such game".
    if (!dosGameById(dosShelf?.games ?? [], game.id)) return;
    nav(`/retro/dos/${game.id}`);
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
            <p className="eyebrow text-blush-600 mb-1.5">
              {platform === 'dos' ? 'MS-DOS · 320 × 200 · js-dos' : 'Game Boy Advance · 240 × 160'}
            </p>
            <h1 className="display text-[32px] sm:text-[42px] leading-[1.02] text-cream-100">
              {copy('retro.title', RETRO_HEADING)} <span className="text-blush-600">Arcade</span>
            </h1>
            <p className="text-[13.5px] text-cream-500 mt-2 max-w-[64ch]">
              {platform === 'dos'
                ? 'MS-DOS games running in your browser on js-dos, with the same rule as the cartridge shelf: a title is here only because the right to host that build was recorded. Pending titles stay on the desk, never behind a Play button.'
                : copy('retro.lede', RETRO_LEDE)}
            </p>
          </div>
          {platform === 'gba' && (
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
          )}
        </div>
      </header>

      {/* ---------------- controls ---------------- */}
      <div className="sticky top-[58px] z-20 -mx-[var(--shell-pad)] px-[var(--shell-pad)] py-2 mb-4 bg-ink-900/92 backdrop-blur-md blur-heavy border-b border-ink-600/70">
        <div className="flex flex-col sm:flex-row gap-2.5 sm:items-center">
          <Segmented
            value={platform}
            onChange={(v) => setPlatform(v as Platform)}
            size="sm"
            label="Choose a platform"
            options={PLATFORMS}
          />
          <div className="relative flex-1 min-w-0">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-cream-500"><Icon name="search" size={16} /></span>
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              type="search"
              placeholder={platform === 'dos' ? 'Search DOS games, tags…' : 'Search cartridges, genres, authors…'}
              aria-label={platform === 'dos' ? 'Search DOS games' : 'Search retro cartridges'}
              className="w-full bg-ink-800 border-2 border-ink-500 pl-9 pr-3 py-2.5 text-[13.5px] text-cream-100 placeholder:text-cream-400 notch-sm focus:border-volt-500 outline-none"
            />
          </div>
          {/* The genre lenses are the GBA shelf's own tags. DOS entries carry the
              source repo's genre, which is a different vocabulary, so the row is
              not reused where it would be a lie. */}
          {platform === 'gba' && (
            <Segmented value={lens} onChange={(v) => setLens(v as Lens)} size="sm" label="Filter cartridges" options={LENSES} />
          )}
        </div>
      </div>

      {/* ---------------- cards ---------------- */}
      {platform === 'dos' ? (
        dosError ? (
          <Panel>
            <ErrorState
              title="The DOS shelf is empty"
              body={dosError}
              recovery="The manifest lives at /retro/dos/shelf.json. It lists only the games this site may host, so an empty shelf means an empty shelf — not a broken emulator."
              onRetry={() => { setDosError(null); loadDosShelf().then(setDosShelf).catch(() => setDosError('Still no manifest.')); }}
            />
          </Panel>
        ) : !dosShelf ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="panel overflow-hidden animate-pulse">
                <div className="bg-ink-600/40" style={{ aspectRatio: '4 / 3' }} />
                <div className="p-3.5 space-y-2">
                  <div className="h-3 w-2/3 bg-ink-600/60 rounded" />
                  <div className="h-2.5 w-full bg-ink-600/40 rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : dosResults.length === 0 ? (
          <Panel>
            <div className="p-6 text-center">
              <p className="display text-[20px] text-cream-100">
                {dosShelf.games.length === 0 ? 'No DOS game has been cleared to host yet' : 'No DOS game matches that'}
              </p>
              <p className="text-[13px] text-cream-400 mt-1 max-w-[62ch] mx-auto">
                {dosShelf.games.length === 0
                  ? 'A title reaches this shelf only after its bundle was checked and the right to host it was written down. That is why the shelf is short.'
                  : 'Try a shorter search, or clear it.'}
              </p>
              {dosResults.length === 0 && dosShelf.games.length > 0 && (
                <Button className="mt-4" size="sm" onClick={() => setQuery('')}>Show every DOS game</Button>
              )}
            </div>
          </Panel>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {dosResults.map((g) => <DosCard key={g.id} game={g} onPlay={playDos} />)}
          </div>
        )
      ) : error ? (
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

      {platform === 'gba' ? (
        <>
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

        </>
      ) : (
        <section aria-labelledby="dos-notes" className="mt-9 grid gap-4 lg:grid-cols-[1.15fr_1fr]">
          <Panel className="p-5 sm:p-6">
            <p className="eyebrow text-volt-700 mb-1.5">The short shelf</p>
            <h2 id="dos-notes" className="display text-[23px] text-cream-100 leading-tight">
              Why five games, and not fifteen hundred
            </h2>
            <p className="text-[13px] text-cream-400 mt-2 max-w-[56ch] leading-relaxed">
              A catalogue of 1,499 DOS titles is easy to find. A right to redistribute them is not: the labels on
              those listings (“freeware”, “shareware”) describe how the game was sold in 1993, not who may serve it
              today. So every one of those titles sits in a review queue with its original source recorded, and a
              title only appears above once a person has written down the evidence and the bundle has been checked.
            </p>
            <p className="text-[13px] text-cream-400 mt-2 max-w-[56ch] leading-relaxed">
              The games that are here were published as free software by the people who made them — two Polish DOS
              games and a Spanish point-and-click adventure under the GPL, plus a 508-byte arcade game under the MIT
              licence. Each bundle was assembled from its own author’s repository at the commit printed on its card,
              with the licence text inside the archive. Doom and Grand Theft Auto: Vice City are not here and will
              not be: both are still sold, their data files were never freely licensed, and the second one never had
              a DOS release at all.
            </p>
            <p className="text-[13px] text-cream-400 mt-2 max-w-[56ch] leading-relaxed">
              The fifth card is ours: a 179-byte calibration program released CC0, whose whole job is to prove the
              DOS player really boots. It prints a banner, paints four colour bars, and exits.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2.5">
              <Button
                size="sm"
                onClick={() => { const g = dosShelf?.games.find((game) => game.id === 'pikachu-calibration'); if (g) playDos(g); }}
                disabled={!dosShelf || !dosShelf.games.some((game) => game.id === 'pikachu-calibration')}
                icon={<Icon name="play" size={12} />}
              >
                Play the test card
              </Button>
              <span className="text-[11.5px] text-cream-500">
                Runs in your browser ·{' '}
                {formatBytes(dosShelf?.games.find((game) => game.id === 'pikachu-calibration')?.bytes ?? 0)} download
              </span>
            </div>
            <p className="text-[11px] text-cream-500 mt-3">
              There is no “drop your own DOS game” box: a `.jsdos` bundle is a whole installation, and a file dropped
              here could not be verified the way a cartridge header can.
            </p>
          </Panel>

          <Panel className="p-5 sm:p-6 bg-ink-850">
            <p className="eyebrow text-blush-600 mb-1.5">Controls</p>
            <h2 className="display text-[20px] text-cream-100 leading-tight">Your keyboard is the joystick</h2>
            <dl className="mt-3 space-y-1.5">
              {DOS_KEYBOARD.slice(0, 5).map((row) => (
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
              Pause, mute and fullscreen are buttons on the monitor, and they are the only things this site sends to
              the emulator — everything else is the game reading your keyboard, exactly as it did on the machine.
            </p>
          </Panel>
        </section>
      )}

      {/* ---------------- honesty block ---------------- */}
      <section aria-labelledby="retro-faq" className="mt-10 pt-7 border-t-2 border-ink-600">
        <p className="eyebrow text-volt-700 mb-2">Under the hood</p>
        <h2 id="retro-faq" className="display text-[24px] sm:text-[28px] text-cream-100 leading-tight">
          {platform === 'dos' ? 'How the DOS shelf works' : 'How this shelf works'}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 mt-4">
          {(platform === 'dos' ? DOS_FAQ : GBA_FAQ).map((item) => (
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
