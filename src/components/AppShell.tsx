import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { prefetchRoute } from '../lib/prefetch';
import { useStore } from '../lib/store';
import { useRoom } from '../lib/useRoom';
import { Icon, ConnectionIndicator } from './ui';
import { SupportLink } from './Support';
import { PikachuMascot } from '../mascot';
import { levelFor } from '../lib/progress';
import { MASCOT_ART } from '../lib/identity';

/**
 * `short` is what the mobile bottom bar shows. Splitting the full label on a
 * space used to produce "Our" for Our Music and "Play" for Play Together, and
 * the bar's column count has to match the number of entries it renders.
 */
const NAV = [
  { to: '/', label: 'Home', short: 'Home', icon: 'home', end: true },
  { to: '/library', label: 'Library', short: 'Games', icon: 'grid' },
  { to: '/together', label: 'Play Together', short: 'Together', icon: 'users' },
  { to: '/solo', label: 'Solo', short: 'Solo', icon: 'sword', end: true },
  { to: '/challenges', label: 'Challenges', short: 'Daily', icon: 'target' },
  { to: '/music', label: 'Our Music', short: 'Music', icon: 'volume' },
  { to: '/achievements', label: 'Achievements', short: 'Cups', icon: 'trophy' },
  { to: '/profile', label: 'Profile', short: 'You', icon: 'user' },
  { to: '/settings', label: 'Settings', short: 'Setup', icon: 'gear' },
];

/** How many of those appear in the bottom bar. The grid below must match. */
const BAR_COUNT = 6;

export default function AppShell({ children }: { children: ReactNode }) {
  const { identity, progress, settings, setSettings, sfx } = useStore();
  const { conn, rtt, room } = useRoom();
  const [menuOpen, setMenuOpen] = useState(false);
  const nav = useNavigate();
  const loc = useLocation();
  const lvl = levelFor(progress.xp);
  const immersive = loc.pathname.startsWith('/solo/') || loc.pathname.startsWith('/room/');

  useEffect(() => { setMenuOpen(false); }, [loc.pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  return (
    <div className="min-h-full flex flex-col bg-ink-900">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-[120] focus:top-2 focus:left-2 focus:px-4 focus:py-2 focus:bg-volt-400 focus:text-[#5a3a12] focus:font-bold">
        Skip to content
      </a>

      {/* ---------------- top bar ---------------- */}
      <header className="sticky top-0 z-50 safe-t bg-[#fffaf1]/92 border-b-2 border-ink-600 backdrop-blur-md blur-heavy">
        <div className="mx-auto max-w-[1340px] px-[var(--shell-pad)] h-[58px] flex items-center gap-3">
          <button onClick={() => { sfx('click'); nav('/'); }} className="flex items-center gap-2 shrink-0 no-tap group" aria-label="PIKACHU home">
            <span className="relative w-[36px] h-[36px] grid place-items-center transition-transform duration-300 group-hover:-rotate-6">
              <svg viewBox="0 0 40 40" className="absolute inset-0 w-full h-full">
                <rect x="2.4" y="2.4" width="35.2" height="35.2" rx="13" fill="#FFD95A" stroke="#5A3F34" strokeWidth="2.6" />
                <path d="M9 27c3-2.5 6-3.4 11-3.4s8 .9 11 3.4" stroke="#F7C948" strokeWidth="2.2" fill="none" strokeLinecap="round" />
              </svg>
              <svg width="13" height="17" viewBox="0 0 14 18" className="relative -translate-x-[1px]">
                <path d="M8,0 L0,10 H5 L4,18 L14,7 H8.5 Z" fill="#5A3F34" />
              </svg>
              <svg width="12" height="11" viewBox="0 0 18 16" className="absolute -right-[3px] -bottom-[3px]">
                <path d="M9 15S1 10.2 1 5.6A4.2 4.2 0 0 1 9 3.4 4.2 4.2 0 0 1 17 5.6C17 10.2 9 15 9 15Z" fill="#FFADC6" stroke="#5A3F34" strokeWidth="2" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="wordmark text-[19px] hidden xs:inline sm:inline">PIKACHU</span>
          </button>

          <nav className="hidden lg:flex items-center gap-0.5 ml-3" aria-label="Primary">
            {NAV.slice(0, 6).map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} onMouseEnter={() => prefetchRoute(n.to.replace(/^\//, '') || 'home')} onFocus={() => prefetchRoute(n.to.replace(/^\//, '') || 'home')}
                className={({ isActive }) => `relative px-3 py-[7px] rounded-full text-[12px] font-extrabold uppercase tracking-wider transition-colors no-tap
                  ${isActive ? 'text-[#5a3a12] bg-volt-200 border-2 border-ink-500' : 'border-2 border-transparent text-cream-500 hover:text-cream-100 hover:bg-blush-100'}`}>
                {({ isActive }) => (
                  <span className="flex items-center gap-1.5">
                    <Icon name={n.icon} size={15} />{n.label}
                  </span>
                )}
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
            className="w-10 h-10 grid place-items-center rounded-full text-cream-500 hover:text-blush-600 hover:bg-blush-100 no-tap">
            <Icon name={settings.muted ? 'mute' : 'volume'} size={18} />
          </button>

          <button onClick={() => { sfx('click'); nav('/profile'); }} className="hidden sm:flex items-center gap-2 pl-1.5 pr-3 py-1 rounded-full border-2 border-ink-500 bg-white hover:border-blush-300 hover:bg-blush-100 no-tap">
            <img src={MASCOT_ART[identity.mascot] ?? MASCOT_ART.classic} alt="" width={24} height={24} className="w-6 h-6 object-contain" />
            <span className="text-left leading-none">
              <span className="block text-[11.5px] font-extrabold text-cream-100 max-w-[90px] truncate">{identity.name || 'Trainer'}</span>
              <span className="block text-[9.5px] text-blush-600 font-bold tracking-wider">LV {lvl.level}</span>
            </span>
          </button>

          <button onClick={() => { sfx('click'); setMenuOpen((v) => !v); }} aria-expanded={menuOpen} aria-label="Menu"
            className="lg:hidden w-10 h-10 grid place-items-center rounded-full text-cream-100 hover:bg-blush-100 no-tap"><Icon name={menuOpen ? 'x' : 'menu'} size={21} /></button>
        </div>

        {/* level bar */}
        <div className="h-[3px] bg-blush-100">
          <div className="h-full bg-gradient-to-r from-volt-300 via-volt-400 to-blush-300 transition-[width] duration-700" style={{ width: `${lvl.pct * 100}%` }} />
        </div>
      </header>

      {/* ---------------- mobile drawer ---------------- */}
      {menuOpen && (
        <div className="lg:hidden fixed inset-0 z-40 bg-[#5c4035]/45" onClick={() => setMenuOpen(false)}>
          <nav className="absolute right-0 top-[58px] bottom-0 w-[min(84vw,310px)] bg-[#fffaf1] border-l-2 border-ink-500 p-4 flex flex-col gap-1 a-slide-up overflow-y-auto"
            onClick={(e) => e.stopPropagation()} aria-label="Mobile">
            <div className="flex items-center gap-3 p-3 mb-2 rounded-2xl bg-blush-100 border-2 border-ink-500">
              <PikachuMascot state="waiting" size={56} />
              <div className="min-w-0">
                <p className="text-[13.5px] font-extrabold text-cream-100 truncate">{identity.name || 'Trainer'}</p>
                <p className="text-[11px] text-blush-600 font-bold">Level {lvl.level} · {progress.xp} XP</p>
              </div>
            </div>
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} onTouchStart={() => prefetchRoute(n.to.replace(/^\//, '') || 'home')}
                className={({ isActive }) => `flex items-center gap-3 px-3 py-3 rounded-2xl text-[13px] font-extrabold uppercase tracking-wider border-2 transition-colors
                  ${isActive ? 'bg-volt-200 border-ink-500 text-[#5a3a12]' : 'border-transparent text-cream-300 hover:bg-blush-100'}`}>
                <Icon name={n.icon} size={17} />{n.label}
              </NavLink>
            ))}
            <div className="mt-3"><ConnectionIndicator state={conn} rtt={rtt} /></div>
          </nav>
        </div>
      )}

      {/* ---------------- content ---------------- */}
      <main id="main" tabIndex={-1} className={`flex-1 outline-none ${immersive ? '' : 'pb-[76px] lg:pb-10'}`}>{children}</main>

      {/* ---------------- bottom nav (mobile) ---------------- */}
      {!immersive && (
        <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-[#fffaf1]/97 border-t-2 border-ink-500 backdrop-blur-md blur-heavy safe-b" aria-label="Quick">
          {/* grid-cols must equal BAR_COUNT — a 6th item in a 5-column grid wrapped
              onto a second row, doubling the bar's height and stranding the active
              underline below the wrong row. */}
          <div className="grid" style={{ gridTemplateColumns: `repeat(${BAR_COUNT}, minmax(0, 1fr))` }}>
            {NAV.slice(0, BAR_COUNT).map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end}
                onTouchStart={() => prefetchRoute(n.to.replace(/^\//, '') || 'home')}
                className={({ isActive }) => `relative flex flex-col items-center gap-0.5 pt-2.5 pb-3 px-0.5 text-[10px] font-extrabold uppercase tracking-tight no-tap
                  ${isActive ? 'text-blush-600' : 'text-cream-500'}`}>
                {({ isActive }) => (<>
                  <Icon name={n.icon} size={19} />
                  <span className="w-full text-center leading-none truncate">{n.short}</span>
                  {/* `relative` on the link above is what keeps this under the right item */}
                  {isActive && <span className="absolute bottom-[3px] left-1/2 -translate-x-1/2 w-7 h-[3px] rounded-full bg-blush-300" />}
                </>)}
              </NavLink>
            ))}
          </div>
        </nav>
      )}

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
