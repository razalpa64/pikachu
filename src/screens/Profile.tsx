import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../lib/store';
import { ACHIEVEMENTS, levelFor } from '../lib/progress';
import { MASCOT_ART, MASCOT_KEYS, MASCOT_LABEL } from '../lib/identity';
import { gameById } from '../games/registry';
import { Button, ConfirmDialog, Icon, Panel, SectionTitle, Stat } from '../components/ui';
import { PikachuMascot, PikaScene } from '../mascot';

export default function Profile() {
  const { identity, setIdentity, progress, toast, cloud } = useStore();
  const [name, setName] = useState(identity.name);
  const [greeting, setGreeting] = useState(identity.greeting);
  const [resetOpen, setResetOpen] = useState(false);

  const lvl = levelFor(progress.xp);
  const totals = useMemo(() => {
    const v = Object.values(progress.stats);
    return {
      played: v.reduce((a, s) => a + s.played, 0),
      wins: v.reduce((a, s) => a + s.wins, 0),
      losses: v.reduce((a, s) => a + s.losses, 0),
      draws: v.reduce((a, s) => a + s.draws, 0),
    };
  }, [progress.stats]);
  const unlocked = ACHIEVEMENTS.filter((a) => progress.achievements[a.slug]);
  const favourite = useMemo(() => {
    const best = Object.entries(progress.stats).sort((a, b) => b[1].played - a[1].played)[0];
    return best && best[1].played > 0 ? gameById(best[0]) : null;
  }, [progress.stats]);

  const dirty = name.trim() !== identity.name || greeting !== identity.greeting;
  const save = () => {
    const n = name.trim().slice(0, 18) || identity.name || 'Trainer';
    setIdentity({ name: n, greeting: greeting.slice(0, 60) });
    setName(n);
    toast({ kind: 'success', title: 'Profile saved', body: 'Your rival will see the new name in the lobby.' });
  };

  return (
    <div className="mx-auto max-w-[1140px] px-[var(--shell-pad)] py-7">
      {/* identity card */}
      <section className="panel panel-notch overflow-hidden mb-7">
        <div className="h-[86px] relative" style={{ background: 'linear-gradient(110deg,#ffe08a 0%,#ffd24d 38%,#ffc3d5 38.4%,#ffadc6 100%)' }}>
          <div className="absolute inset-0 scanlines opacity-25" aria-hidden />
        </div>
        <div className="p-5 sm:p-6 -mt-12 relative flex gap-5 flex-wrap items-end">
          <div className="w-[108px] h-[108px] bg-ink-850 border-2 border-ink-600 notch-sm grid place-items-center overflow-hidden shrink-0">
            <img src={MASCOT_ART[identity.mascot] ?? MASCOT_ART.classic} alt="" className="w-[88%] h-[88%] object-contain" />
          </div>
          <div className="flex-1 min-w-[220px]">
            <p className="eyebrow mb-1">Level {lvl.level} · {progress.xp.toLocaleString()} XP</p>
            <h1 className="display text-[clamp(22px,4vw,34px)] text-cream-100 leading-none">
              {identity.name || 'Unnamed Trainer'}
            </h1>
            {identity.greeting
              ? <p className="text-[12.5px] text-cream-400 mt-1.5 italic">“{identity.greeting}”</p>
              : <p className="text-[12.5px] text-cream-400 mt-1.5">Add a name and a lobby tagline on the right — they are what your rival sees.</p>}
            <div className="mt-3 max-w-[420px]">
              <div className="flex justify-between text-[10px] uppercase tracking-wider font-bold text-cream-400 mb-1">
                <span>Level {lvl.level}</span><span className="tabnum">{progress.xp - lvl.floor} / {lvl.ceil - lvl.floor}</span>
              </div>
              <div className="h-2 bg-blush-100 overflow-hidden">
                <div className="h-full rounded-full bg-gradient-to-r from-volt-300 via-volt-400 to-blush-300 transition-[width] duration-700" style={{ width: `${lvl.pct * 100}%` }} />
              </div>
            </div>
          </div>
          <div className="hidden lg:flex shrink-0 items-end gap-4">
            <PikaScene clip="goldenhour" className="w-[150px]" rounded={18} tilt={-2} />
            <PikachuMascot state={totals.wins > totals.losses ? 'victory' : 'idle'} size={118} />
          </div>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[1.25fr_1fr]">
        {/* stats */}
        <div className="space-y-5">
          <div>
            <SectionTitle eyebrow="Career" title="Lifetime record" />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3.5">
              <Panel className="p-3.5"><Stat label="Matches" value={totals.played} accent="#f0b429" /></Panel>
              <Panel className="p-3.5"><Stat label="Wins" value={totals.wins} accent="#3fae82" /></Panel>
              <Panel className="p-3.5"><Stat label="Draws" value={totals.draws} /></Panel>
              <Panel className="p-3.5"><Stat label="Losses" value={totals.losses} accent="#e05a74" /></Panel>
            </div>
          </div>

          <div>
            <SectionTitle eyebrow="Head to head" title="Online versus record" />
            <Panel className="p-4 mt-3.5">
              <div className="flex items-center gap-3">
                <span className="display text-[30px] text-volt-700 tabnum">{progress.versus.wins}</span>
                <div className="flex-1 h-3 bg-blush-100 overflow-hidden flex">
                  <div style={{ width: `${bar(progress.versus.wins, progress.versus)}%`, background: '#f0b429' }} />
                  <div style={{ width: `${bar(progress.versus.draws, progress.versus)}%`, background: '#5a5a50' }} />
                  <div style={{ width: `${bar(progress.versus.losses, progress.versus)}%`, background: '#e05a74' }} />
                </div>
                <span className="display text-[30px] text-ember-600 tabnum">{progress.versus.losses}</span>
              </div>
              <p className="text-[11.5px] text-cream-500 mt-2.5 text-center">
                {progress.versus.wins + progress.versus.losses + progress.versus.draws === 0
                  ? 'No online matches recorded yet. Open a room and settle it.'
                  : `${progress.versus.draws} draw${progress.versus.draws === 1 ? '' : 's'} across ${progress.versus.wins + progress.versus.losses + progress.versus.draws} online matches.`}
              </p>
            </Panel>
          </div>

          <div>
            <SectionTitle eyebrow="Recently played" title="Session history"
              action={<Link to="/library" className="text-[12px] text-volt-700 hover:underline">Library →</Link>} />
            <Panel className="mt-3.5 divide-y divide-ink-700">
              {progress.recents.slice(0, 8).map((r, i) => {
                const g = gameById(r.gameId);
                if (!g) return null;
                return (
                  <Link key={i} to={`/solo/${g.slug}`} className="flex items-center gap-3 p-3 hover:bg-ink-800/60">
                    <span className="w-1.5 h-7" style={{ background: g.accent }} />
                    <span className="text-[13px] text-cream-100 font-semibold flex-1 truncate">{g.title}</span>
                    <span className="text-[11px] text-cream-400 uppercase tracking-wider">{r.mode}</span>
                    <span className="text-[11px] text-cream-400 tabnum">{rel(r.at)}</span>
                  </Link>
                );
              })}
              {progress.recents.length === 0 && <p className="p-5 text-center text-[12.5px] text-cream-500">Nothing played yet.</p>}
            </Panel>
          </div>
        </div>

        {/* editor */}
        <div className="space-y-5">
          <div>
            <SectionTitle eyebrow="Edit" title="Your card" />
            <Panel className="p-4 mt-3.5 space-y-4">
              <label className="block">
                <span className="eyebrow block mb-1.5">Display name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} maxLength={18}
                  className="w-full bg-ink-800 border border-ink-600 px-3 py-2 text-[14px] text-cream-100 focus:border-volt-400 outline-none notch-sm" />
              </label>
              <label className="block">
                <span className="eyebrow block mb-1.5">Lobby tagline</span>
                <input value={greeting} onChange={(e) => setGreeting(e.target.value)} maxLength={60}
                  className="w-full bg-ink-800 border border-ink-600 px-3 py-2 text-[13px] text-cream-200 focus:border-volt-400 outline-none notch-sm" />
              </label>
              <div>
                <span className="eyebrow block mb-2">Avatar</span>
                <div className="flex gap-2 flex-wrap">
                  {MASCOT_KEYS.map((k) => (
                    <button key={k} onClick={() => setIdentity({ mascot: k })} aria-pressed={identity.mascot === k}
                      className={`w-[62px] h-[62px] grid place-items-center notch-sm border-2 no-tap transition-colors ${identity.mascot === k ? 'border-volt-400 bg-blush-100' : 'border-ink-600 bg-ink-800 hover:border-ink-500'}`}
                      title={MASCOT_LABEL[k]}>
                      <img src={MASCOT_ART[k]} alt={MASCOT_LABEL[k]} className="w-[84%] h-[84%] object-contain" loading="lazy" />
                    </button>
                  ))}
                </div>
              </div>
              <Button className="w-full" onClick={save} disabled={!dirty} icon={<Icon name="check" size={14} />}>
                {dirty ? 'Save profile' : 'Saved'}
              </Button>
              <p className="text-[11px] text-cream-400">
                Player ID <span className="font-mono text-cream-500">{identity.playerId.slice(0, 8)}</span> — generated on this device, used to hold your seat if you reconnect.
              </p>
            </Panel>
          </div>

          <div>
            <SectionTitle eyebrow={`${unlocked.length} of ${ACHIEVEMENTS.length}`} title="Latest badges"
              action={<Link to="/achievements" className="text-[12px] text-volt-700 hover:underline">All →</Link>} />
            <Panel className="p-4 mt-3.5">
              {unlocked.length === 0
                ? <p className="text-[12.5px] text-cream-500 text-center py-2">Finish a match to earn your first badge.</p>
                : (
                  <ul className="space-y-2.5">
                    {unlocked.sort((a, b) => progress.achievements[b.slug] - progress.achievements[a.slug]).slice(0, 5).map((a) => (
                      <li key={a.slug} className="flex items-center gap-2.5">
                        <span className="w-7 h-7 grid place-items-center rounded-full border-2 border-ink-500 bg-gradient-to-br from-volt-200 to-volt-400 text-[#5a3a12] shrink-0"><Icon name="bolt" size={14} /></span>
                        <span className="text-[13px] text-cream-100 font-semibold flex-1 truncate">{a.name}</span>
                        <span className="text-[10.5px] text-cream-400 tabnum">{new Date(progress.achievements[a.slug]).toLocaleDateString()}</span>
                      </li>
                    ))}
                  </ul>
                )}
            </Panel>
          </div>

          {favourite && (
            <Panel className="p-4">
              <p className="eyebrow mb-1">Most played</p>
              <p className="display text-[18px] text-cream-100">{favourite.title}</p>
              <p className="text-[12px] text-cream-500 mt-0.5">{progress.stats[favourite.id].played} matches · {progress.stats[favourite.id].wins} wins</p>
            </Panel>
          )}

          <Panel className="p-4">
            <p className="eyebrow mb-1.5">Trainer Account</p>
            <p className="text-[12.5px] text-cream-400">
              {cloud
                ? 'Create a trainer account with username & password in Settings to sync your badges and career stats.'
                : 'Running locally on this device. Configure your Supabase project in Settings to sync your account.'}
            </p>
            <Link to="/settings" className="inline-block mt-2.5 text-[12px] text-volt-700 font-bold hover:underline">Manage account & sync →</Link>
          </Panel>

          <Panel className="p-4">
            <p className="eyebrow mb-1.5">Reviews &amp; ideas</p>
            <p className="text-[12.5px] text-cream-400">
              Tell me what to build next — a review, a game you want, or the thing that annoyed you.
              No account needed.
            </p>
            <Link to="/feedback" className="inline-block mt-2.5 text-[12px] text-volt-700 font-bold hover:underline">Open the suggestion box →</Link>
          </Panel>

          <Button variant="ghost" className="w-full" onClick={() => setResetOpen(true)} icon={<Icon name="rotate" size={14} />}>
            Reset local progress
          </Button>
        </div>
      </div>

      <ConfirmDialog open={resetOpen} title="Erase local progress?" danger confirmLabel="Erase everything"
        body="XP, stats, badges, favourites and challenge progress stored on this device will be deleted. Your name and avatar stay."
        onConfirm={() => {
          try { localStorage.removeItem('pikachu.progress.v1'); } catch { /* ignore */ }
          setResetOpen(false);
          window.location.reload();
        }}
        onCancel={() => setResetOpen(false)} />
    </div>
  );
}

const bar = (n: number, v: { wins: number; losses: number; draws: number }) => {
  const t = v.wins + v.losses + v.draws;
  return t ? (n / t) * 100 : n === 0 ? 33.33 : 0;
};
function rel(at: number) {
  const d = Date.now() - at;
  if (d < 60_000) return 'just now';
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return `${Math.floor(d / 86_400_000)}d ago`;
}
