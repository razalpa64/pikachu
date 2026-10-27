import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { prefetchRoute } from '../lib/prefetch';
import { useStore } from '../lib/store';
import { useRoom } from '../lib/useRoom';
import { Icon, ConnectionIndicator } from './ui';
import { SupportLink } from './Support';
import { Sheet } from './Sheet';
import { PikachuMascot } from '../mascot';
import { levelFor } from '../lib/progress';
import { MASCOT_ART } from '../lib/identity';
import { haptic } from '../lib/haptics';

/**
 * `short` is what the mobile bottom bar shows. Splitting the full label on a
 * space used to produce "Our" for Our Music and "Play" for Play Together, and
 * the bar's column count has to match the number of entries it renders.
 */
const NAV = [
  { to: '/', label: 'Home', short: 'Home', top: 'Home', icon: 'home', end: true },
  { to: '/library', label: 'Library', short: 'Games', top: 'Library', icon: 'grid' },
  { to: '/together', label: 'Play Together', short: 'Together', top: 'Together', icon: 'users' },
  { to: '/solo', label: 'Solo', short: 'Solo', top: 'Solo', icon: 'sword', end: true },
  { to: '/retro', label: 'Retro Arcade', short: 'Retro', top: 'Retro', icon: 'gamepad' },
  { to: '/challenges', label: 'Challenges', short: 'Daily', top: 'Challenges', icon: 'target' },
  { to: '/music', label: 'Our Music', short: 'Music', top: 'Music', icon: 'volume' },
  { to: '/achievements', label: 'Achievements', short: 'Cups', top: 'Achievements', icon: 'trophy' },
  { to: '/profile', label: 'Profile', short: 'You', top: 'Profile', icon: 'user' },
  { to: '/settings', label: 'Settings', short: 'Setup', top: 'Settings', icon: 'gear' },
];

/** How many of those appear in the top bar on a wide screen. */
const TOP_COUNT = 7;

/**
 * The bottom tab bar on a phone.
 *
 * Five, not six. A 390 px screen gives five tabs 78 px each — a comfortable
 * thumb target with room for a real label — where six gives 65 px and a row of
 * 10 px words that read as a menu, not as navigation. The five that stay are
 * the five you *play*: Home, Games, Together, Solo, Retro. Everything about
 * *you* — challenges, music, cups, profile, settings — lives behind the avatar
 * in the title bar, which is where every phone OS puts it.
 */
const TABS = NAV.slice(0, 5);

/** What the account sheet holds: the destinations that are about the person. */
const ACCOUNT = NAV.slice(5);

/**
 * The title bar names the screen you are on.
 *
 * An app's title bar is context ("Library"), not a logo repeated at you — and on
 * a phone the page's own `<h1>` is usually scrolled away. This is the cheapest
 * way to always know where you are.
 */
const TITLES: Record<string, string> = {
  '/': 'Arcade',
  '/library': 'Games',
  '/together': 'Play Together',
  '/solo': 'Solo',
  '/retro': 'Retro Arcade',
  '/challenges': 'Daily Challenges',
  '/music': 'Our Music',
  '/achievements': 'Achievements',
  '/profile': 'Profile',
  '/settings': 'Settings',
  '/feedback': 'Reviews & ideas',
  '/privacy': 'Privacy',
};

function titleFor(pathname: string): string {
  if (TITLES[pathname]) return TITLES[pathname];
  const base = `/${pathname.split('/')[1] ?? ''}`;
  if (TITLES[base]) return TITLES[base];
  if (/^\/(solo|room|retro)\//.test(pathname)) return 'Playing';
  return 'Pikachu';
}

export default function AppShell({ children }: { children: ReactNode }) {
  const { identity, progress, settings, setSettings, sfx } = useStore();
  const { conn, rtt, room } = useRoom();
  const [sheetOpen, setSheetOpen] = useState(false);
  const nav = useNavigate();
  const loc = useLocation();
  const lvl = levelFor(progress.xp);
  /* The retro player owns the whole viewport: a bottom bar and a footer under a
     running emulator is chrome competing with the console. The shelf itself
     (`/retro`) stays a normal page. */
  const immersive = loc.pathname.startsWith('/solo/') || loc.pathname.startsWith('/room/') || /^\/retro\/.+/.test(loc.pathname);
  /* The retro *player* is a device, not a page: it draws its own header and owns
     the whole viewport. Leaving the site header above it would both eat 58px of
     the console and leave a row of links behind it that keyboard users could
     tab into without being able to see where they were. The shelf (`/retro`) is
     untouched. */
  const consolePage = /^\/retro\/.+/.test(loc.pathname);
  /**
   * Screens that push their own app bar.
   *
   * A game and an online room each draw a bar with a back button, the name of
   * the thing and its own actions, and that bar sticks to the top. Stacking the
   * site header above it put two title bars on a 390 px screen and spent 63 px
   * of a game board on the word "SOLO". On a phone the screen's own bar *is* the
   * app bar; on a wide screen the site nav is still needed, so it stays there.
   */
  const ownBar = /^\/(solo|room)\/./.test(loc.pathname);
  const title = titleFor(loc.pathname);

  /* Any navigation closes the sheet — including a back gesture, which is the
     commonest way a sheet is left open behind the page. */
  useEffect(() => { setSheetOpen(false); }, [loc.pathname]);

  const go = (to: string) => {
    haptic('select');
    nav(to);
  };

  return (
    <div className="min-h-full flex flex-col bg-ink-900">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-[120] focus:top-2 focus:left-2 focus:px-4 focus:py-2 focus:bg-volt-400 focus:text-[#5a3a12] focus:font-bold">
        Skip to content
      </a>

      {/* ---------------- top bar ---------------- */}
      {!consolePage && (
      <header className={`sticky top-0 z-50 safe-t bg-[#fffaf1]/92 border-b-2 border-ink-600 backdrop-blur-md blur-heavy ${ownBar ? 'max-lg:hidden' : ''}`}>
        <div className="mx-auto max-w-[1340px] px-[var(--shell-pad)] h-[58px] lg:h-[58px] h-[52px] flex items-center gap-3">
          <button onClick={() => { sfx('click'); haptic('tap'); nav('/'); }} className="flex items-center gap-2 shrink-0 no-tap group" aria-label="PIKACHU home">
            <span className="relative w-[36px] h-[36px] max-lg:w-[30px] max-lg:h-[30px] grid place-items-center transition-transform duration-300 group-hover:-rotate-6">
              <svg viewBox="0 0 40 40" className="absolute inset-0 w-full h-full">
                <rect x="2.4" y="2.4" width="35.2" height="35.2" rx="13" fill="#FFD95A" stroke="#5A3F34" strokeWidth="2.6" />
                <path d="M9 27c3-2.5 6-3.4 11-3.4s8 .9 11 3.4" stroke="#F7C948" strokeWidth="2.2" fill="none" strokeLinecap="round" />
              </svg>
              <svg width="13" height="17" viewBox="0 0 14 18" className="relative -translate-x-[1px] max-lg:w-[11px] max-lg:h-[15px]">
                <path d="M8,0 L0,10 H5 L4,18 L14,7 H8.5 Z" fill="#5A3F34" />
              </svg>
              <svg width="12" height="11" viewBox="0 0 18 16" className="absolute -right-[3px] -bottom-[3px]">
                <path d="M9 15S1 10.2 1 5.6A4.2 4.2 0 0 1 9 3.4 4.2 4.2 0 0 1 17 5.6C17 10.2 9 15 9 15Z" fill="#FFADC6" stroke="#5A3F34" strokeWidth="2" strokeLinejoin="round" />
              </svg>
            </span>
            {/* The wordmark is the brand on a wide screen; on a phone the space
                is better spent on the name of the screen you are looking at. */}
            <span className="wordmark text-[19px] hidden sm:inline">PIKACHU</span>
          </button>

          {/* The title bar's job on a phone: say where you are. */}
          <p aria-hidden className="lg:hidden min-w-0 truncate text-[13.5px] font-extrabold uppercase tracking-[0.08em] text-cream-100">
            {title}
          </p>

          <nav className="hidden lg:flex items-center gap-0.5 ml-3" aria-label="Primary">
            {NAV.slice(0, TOP_COUNT).map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} aria-label={n.label}
                onMouseEnter={() => prefetchRoute(n.to.replace(/^\//, '') || 'home')} onFocus={() => prefetchRoute(n.to.replace(/^\//, '') || 'home')}
                className={({ isActive }) => `relative shrink-0 px-2 xl:px-2.5 py-[7px] rounded-full text-[11.5px] xl:text-[12px] font-extrabold uppercase tracking-wider transition-colors no-tap
                  ${isActive ? 'text-[#5a3a12] bg-volt-200 border-2 border-ink-500' : 'border-2 border-transparent text-cream-500 hover:text-cream-100 hover:bg-blush-100'}`}>
                <span className="flex items-center gap-1.5 whitespace-nowrap">
                  <Icon name={n.icon} size={15} />
                  {/* One line, always. Multi-word names ("Play Together") used to
                      wrap inside the pill, which made three items twice as tall as
                      the rest and turned the active pill into an oval. The bar now
                      shows the single-word name up to 2xl and the full name only
                      where there is room to guarantee it fits. */}
                  <span aria-hidden className="2xl:hidden">{n.top}</span>
                  <span aria-hidden className="hidden 2xl:inline">{n.label}</span>
                </span>
              </NavLink>
            ))}
          </nav>

          <div className="flex-1" />

          {room && (
            <button onClick={() => nav(`/room/${room.code}`)}
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full border-2 border-blush-600 bg-blush-600 text-[11px] font-extrabold uppercase tracking-wider text-white hover:bg-[#a81f47] hover:border-[#a81f47] no-tap">
              <Icon name="users" size={14} /> {room.code}
            </button>
          )}
          <div className="hidden sm:block"><ConnectionIndicator state={conn} rtt={rtt} /></div>

          <button onClick={() => { sfx('toggle'); setSettings({ muted: !settings.muted }); }}
            aria-label={settings.muted ? 'Unmute audio' : 'Mute audio'} aria-pressed={settings.muted}
            /* The account sheet carries sound on a phone, so this button is for
               the wide bar only — two controls for one setting in the same
               header is the sort of thing that makes an app feel unfinished. */
            className="hidden lg:grid w-10 h-10 place-items-center rounded-full text-cream-500 hover:text-blush-600 hover:bg-blush-100 no-tap active:scale-90 transition-transform">
            <Icon name={settings.muted ? 'mute' : 'volume'} size={18} />
          </button>

          <button onClick={() => { sfx('click'); nav('/profile'); }} className="hidden xl:flex items-center gap-2 pl-1.5 pr-3 py-1 rounded-full border-2 border-ink-500 bg-white hover:border-blush-300 hover:bg-blush-100 no-tap">
            <img src={MASCOT_ART[identity.mascot] ?? MASCOT_ART.classic} alt="" width={24} height={24} className="w-6 h-6 object-contain" />
            <span className="text-left leading-none">
              <span className="block text-[11.5px] font-extrabold text-cream-100 max-w-[90px] truncate">{identity.name || 'Trainer'}</span>
              <span className="block text-[9.5px] text-blush-600 font-bold tracking-wider">LV {lvl.level}</span>
            </span>
          </button>

          {/* The account button. It replaces the hamburger: the drawer used to
              repeat the bottom bar item for item, so the menu was two ways to do
              the same nine things. Now the bar is the app, and this is you. */}
          <button
            onClick={() => { sfx('click'); haptic('tap'); setSheetOpen(true); }}
            aria-expanded={sheetOpen}
            aria-haspopup="dialog"
            aria-label="You — profile, challenges and settings"
            className="lg:hidden relative w-10 h-10 shrink-0 grid place-items-center rounded-full no-tap active:scale-90 transition-transform"
          >
            <img src={MASCOT_ART[identity.mascot] ?? MASCOT_ART.classic} alt="" width={32} height={32}
              className="w-8 h-8 object-contain rounded-full border-2 border-ink-500 bg-white p-0.5" />
            <span aria-hidden className="absolute -bottom-0.5 -right-0.5 min-w-[16px] h-[16px] px-1 grid place-items-center rounded-full bg-blush-600 text-white text-[9px] font-extrabold leading-none border border-[#fffaf1]">
              {lvl.level}
            </span>
          </button>
        </div>

        {/* level bar */}
        <div className="h-[3px] bg-blush-100">
          <div className="h-full bg-gradient-to-r from-volt-300 via-volt-400 to-blush-300 transition-[width] duration-700" style={{ width: `${lvl.pct * 100}%` }} />
        </div>
      </header>
      )}

      {/* ---------------- content ---------------- */}
      <main id="main" tabIndex={-1} className={`flex-1 outline-none ${immersive ? '' : 'pb-[calc(70px+env(safe-area-inset-bottom))] lg:pb-10'}`}>{children}</main>

      {/* ---------------- bottom tab bar (mobile) ---------------- */}
      {!immersive && (
        <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-[#fffaf1]/97 border-t-2 border-ink-500 backdrop-blur-md blur-heavy safe-b" aria-label="Quick">
          {/* The grid must equal TABS.length: a sixth item in a five-column grid
              wrapped onto a second row, doubling the bar's height and stranding
              the active underline below the wrong row. */}
          <div className="grid" style={{ gridTemplateColumns: `repeat(${TABS.length}, minmax(0, 1fr))` }}>
            {TABS.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end}
                onTouchStart={() => prefetchRoute(n.to.replace(/^\//, '') || 'home')}
                onClick={() => haptic('tap')}
                className={({ isActive }) => `relative flex flex-col items-center gap-1 pt-2 pb-2.5 text-[10px] font-extrabold uppercase tracking-tight no-tap transition-colors
                  ${isActive ? 'text-blush-600' : 'text-cream-500'}`}>
                {({ isActive }) => (<>
                  {/* The active tab gets a filled pill behind its icon, the way a
                      native tab bar marks the current screen. */}
                  <span className={`grid place-items-center w-11 h-[26px] rounded-full transition-colors duration-200 ${isActive ? 'bg-blush-100' : ''}`}>
                    <Icon name={n.icon} size={19} />
                  </span>
                  <span className="w-full text-center leading-none truncate">{n.short}</span>
                </>)}
              </NavLink>
            ))}
          </div>
        </nav>
      )}

      {/* ---------------- the account sheet ---------------- */}
      <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="You" label="You">
        <button
          onClick={() => go('/profile')}
          className="w-full flex items-center gap-3 p-3 rounded-2xl bg-blush-100 border-2 border-ink-500 text-left active:scale-[.99] transition-transform no-tap"
        >
          <img src={MASCOT_ART[identity.mascot] ?? MASCOT_ART.classic} alt="" width={44} height={44} className="w-11 h-11 object-contain" />
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-extrabold text-cream-100 truncate">{identity.name || 'Trainer'}</span>
            <span className="block text-[11px] text-blush-600 font-bold">Level {lvl.level} · {progress.xp} XP</span>
          </span>
          <Icon name="back" size={16} className="rotate-180 text-cream-400" />
        </button>

        <div className="mt-3 grid grid-cols-3 gap-2">
          {ACCOUNT.map((n) => (
            <button
              key={n.to}
              onClick={() => go(n.to)}
              className="flex flex-col items-center justify-center gap-1.5 py-3 rounded-2xl border-2 border-ink-500 bg-white text-cream-100 active:scale-95 active:bg-volt-50 transition-transform no-tap"
            >
              <Icon name={n.icon} size={20} />
              <span className="text-[10.5px] font-extrabold uppercase tracking-wider">{n.short}</span>
            </button>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between gap-3 px-3 py-2.5 rounded-2xl border-2 border-ink-600 bg-white">
          <ConnectionIndicator state={conn} rtt={rtt} />
          <button
            onClick={() => { sfx('toggle'); haptic('tap'); setSettings({ muted: !settings.muted }); }}
            aria-pressed={settings.muted}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border-2 border-ink-500 text-[11px] font-extrabold uppercase tracking-wider text-cream-100 active:scale-95 transition-transform no-tap"
          >
            <Icon name={settings.muted ? 'mute' : 'volume'} size={14} />
            {settings.muted ? 'Muted' : 'Sound'}
          </button>
        </div>

        <div className="mt-3 flex items-center justify-center gap-4 pb-1 text-[11px] font-bold text-cream-400">
          <NavLink to="/feedback" onClick={() => haptic('tap')} className="hover:text-volt-700">Reviews &amp; ideas</NavLink>
          <NavLink to="/privacy" onClick={() => haptic('tap')} className="hover:text-volt-700">Privacy</NavLink>
          <SupportLink />
        </div>
      </Sheet>

      {/* ---------------- footer ---------------- */}
      {!immersive && (
        <footer className="hidden lg:block border-t-2 border-ink-500 bg-[#fdf2e3]">
          <div className="mx-auto max-w-[1340px] px-[var(--shell-pad)] py-4 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[11.5px] text-cream-500">
                <span className="wordmark text-[13px] mr-2">PIKACHU</span>
                A little arcade built for two. Original artwork, original engines, made with love.
              </p>
              <p className="text-[11px] text-cream-400 mt-0.5">
                Pikachu is a trademark of Nintendo / Creatures Inc. / GAME FREAK. This is a personal, non-commercial project.
              </p>
            </div>
            <div className="flex items-center gap-4 shrink-0">
              <NavLink to="/feedback" className="text-[11.5px] font-bold text-cream-300 hover:text-volt-700 hover:underline">
                Reviews &amp; ideas
              </NavLink>
              <NavLink to="/privacy" className="text-[11.5px] font-bold text-cream-300 hover:text-volt-700 hover:underline">
                Privacy
              </NavLink>
              <SupportLink />
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}
