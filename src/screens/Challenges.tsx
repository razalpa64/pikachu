import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore } from '../lib/store';
import { dailyChallenges, levelFor, todaySeed } from '../lib/progress';
import { GAMES, gameById } from '../games/registry';
import { Button, Icon, Panel, SectionTitle, Stat } from '../components/ui';
import { GameArtwork } from '../components/GameArtwork';
import { PikaScene } from '../mascot';

function msToMidnight() {
  const n = new Date();
  const m = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1, 0, 0, 0, 0);
  return m.getTime() - n.getTime();
}
function hms(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
}

export default function Challenges() {
  const { progress } = useStore();
  const nav = useNavigate();
  const list = useMemo(() => dailyChallenges(todaySeed()), []);
  const lvl = levelFor(progress.xp);
  const done = list.filter((c) => (progress.dailyProgress[c.id] ?? 0) >= c.goal).length;
  const totalXp = list.reduce((a, c) => a + c.xp, 0);
  const earned = list.reduce((a, c) => a + ((progress.dailyProgress[c.id] ?? 0) >= c.goal ? c.xp : 0), 0);

  return (
    <div className="mx-auto max-w-[1140px] px-[var(--shell-pad)] py-7">
      {/* banner */}
      <section className="relative overflow-hidden panel panel-notch mb-7">
        <div className="absolute inset-0 opacity-45" aria-hidden><GameArtwork artKey="memory" /></div>
        <div className="absolute inset-0 bg-gradient-to-r from-[#fff8ec] via-[#fff8ec]/90 to-[#fff8ec]/45" aria-hidden />
        <div className="relative p-6 sm:p-8 flex items-center gap-6 flex-wrap">
          <div className="min-w-[240px] flex-1">
            <p className="eyebrow mb-1.5">Resets in {hms(msToMidnight())}</p>
            <h1 className="display text-[clamp(26px,4.6vw,42px)] text-cream-100 leading-[1.02]">Today&rsquo;s little<br /><span className="text-blush-600">challenges</span></h1>
            <p className="text-[13px] text-cream-400 mt-2.5 max-w-[440px]">
              Three small goals, drawn from today&rsquo;s date so you both get exactly the same set. Progress only moves when a real match finishes — nothing here can be clicked to completion.
            </p>
            <div className="flex gap-3 mt-4 flex-wrap">
              <Stat label="Completed" value={`${done}/${list.length}`} accent="#f0b429" />
              <Stat label="XP banked" value={`${earned}/${totalXp}`} accent="#3fae82" />
              <Stat label="Level" value={lvl.level} />
            </div>
          </div>
          <div className="hidden sm:block shrink-0">
            <PikaScene clip="gift" className="w-[260px]" rounded={24} tilt={2} />
          </div>
        </div>
      </section>

      <SectionTitle eyebrow="Today" title="Objectives" />
      <div className="grid gap-3.5 md:grid-cols-3 mt-3.5">
        {list.map((c) => {
          const have = progress.dailyProgress[c.id] ?? 0;
          const pct = Math.min(1, have / c.goal);
          const complete = have >= c.goal;
          const g = c.gameId === 'any' ? null : gameById(c.gameId);
          return (
            <Panel key={c.id} className={`p-4 flex flex-col ${complete ? 'border-leaf-500/60' : ''}`}>
              <div className="flex items-start gap-2.5">
                <span className={`w-9 h-9 grid place-items-center notch-sm shrink-0 ${complete ? 'bg-leaf-500 text-[#5a3a12]' : 'bg-blush-100 text-volt-700'}`}>
                  <Icon name={complete ? 'check' : 'bolt'} size={17} />
                </span>
                <div className="min-w-0">
                  <h3 className="display text-[15.5px] text-cream-100 leading-tight">{c.title}</h3>
                  <p className="text-[12.5px] text-cream-400 mt-1">{c.detail}</p>
                </div>
              </div>

              <div className="mt-3.5">
                <div className="flex justify-between text-[10.5px] font-bold uppercase tracking-wider text-cream-400 mb-1">
                  <span>{complete ? 'Complete' : 'Progress'}</span>
                  <span className="tabnum">{Math.min(have, c.goal)} / {c.goal}</span>
                </div>
                <div className="h-1.5 bg-blush-100 overflow-hidden">
                  <div className="h-full transition-[width] duration-500" style={{ width: `${pct * 100}%`, background: complete ? '#3fae82' : '#f0b429' }} />
                </div>
              </div>

              <div className="flex-1" />
              <div className="flex items-center justify-between mt-4 pt-3 border-t border-ink-600">
                <span className="text-[11px] font-extrabold uppercase tracking-wider" style={{ color: complete ? '#3fae82' : '#f0b429' }}>+{c.xp} XP</span>
                {g ? (
                  <Button size="sm" variant={complete ? 'ghost' : 'primary'} onClick={() => nav(g.modes.includes('solo') || g.modes.includes('ai') ? `/solo/${g.slug}` : '/together')}>
                    {complete ? 'Play again' : `Open ${g.title}`}
                  </Button>
                ) : (
                  <Button size="sm" variant={complete ? 'ghost' : 'primary'} onClick={() => nav('/library')}>
                    {complete ? 'Done' : 'Choose a game'}
                  </Button>
                )}
              </div>
            </Panel>
          );
        })}
      </div>

      <SectionTitle eyebrow="Long game" title="Per-game records" />
      <Panel className="mt-3.5 overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-left text-cream-400 uppercase text-[10px] tracking-wider border-b border-ink-600">
              <th className="p-2.5 font-bold">Game</th>
              <th className="p-2.5 font-bold text-right">Played</th>
              <th className="p-2.5 font-bold text-right">W</th>
              <th className="p-2.5 font-bold text-right">D</th>
              <th className="p-2.5 font-bold text-right">L</th>
              <th className="p-2.5 font-bold text-right">Best</th>
              <th className="p-2.5 font-bold text-right">Win rate</th>
            </tr>
          </thead>
          <tbody>
            {GAMES.filter((g) => g.status === 'live').map((g) => {
              const s = progress.stats[g.id] ?? { played: 0, wins: 0, draws: 0, losses: 0, best: 0 };
              const rate = s.played ? Math.round((s.wins / s.played) * 100) : 0;
              return (
                <tr key={g.id} className="border-b border-ink-700/70 last:border-0 hover:bg-ink-800/50">
                  <td className="p-2.5">
                    <Link to={`/solo/${g.slug}`} className="flex items-center gap-2 text-cream-100 hover:text-volt-700">
                      <span className="w-1.5 h-5" style={{ background: g.accent }} />{g.title}
                    </Link>
                  </td>
                  <td className="p-2.5 text-right tabnum text-cream-300">{s.played}</td>
                  <td className="p-2.5 text-right tabnum text-leaf-700">{s.wins}</td>
                  <td className="p-2.5 text-right tabnum text-cream-400">{s.draws}</td>
                  <td className="p-2.5 text-right tabnum text-ember-600">{s.losses}</td>
                  <td className="p-2.5 text-right tabnum text-cream-300">{s.best || '—'}</td>
                  <td className="p-2.5 text-right tabnum" style={{ color: rate >= 50 ? '#3fae82' : '#b9b2a0' }}>{s.played ? `${rate}%` : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
