import { useMemo, useState, type ReactNode } from 'react';
import { useStore } from '../lib/store';
import { ACHIEVEMENTS, levelFor } from '../lib/progress';
import { Panel, SectionTitle, Segmented, Stat } from '../components/ui';
import { PikachuMascot, PikaScene } from '../mascot';

/** Original badge glyphs — one small inline SVG per achievement, no icon font, no emoji. */
function Badge({ icon, unlocked, size = 34 }: { icon: string; unlocked: boolean; size?: number }) {
  const c = unlocked ? '#5a3f34' : '#b49a86';
  const paths: Record<string, ReactNode> = {
    bolt: <path d="M13 2 4 14h6l-1 8 9-12h-6z" />,
    door: <path d="M5 3h10v18H5zM15 11h4M15 3h4v18h-4z" />,
    heart: <path d="M12 21s-7-4.6-9.3-9A5.3 5.3 0 0 1 12 6.6 5.3 5.3 0 0 1 21.3 12C19 16.4 12 21 12 21z" />,
    crown: <path d="m3 7 4 4 5-7 5 7 4-4-2 12H5z" />,
    shield: <path d="M12 2 4 5v7c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V5z" />,
    diagonal: <path d="M4 20 20 4M7 4h13v13" />,
    brain: <path d="M9 3a3 3 0 0 0-3 3 3 3 0 0 0-1 5.8V15a3 3 0 0 0 4 2.8V21h2V3zM15 3a3 3 0 0 1 3 3 3 3 0 0 1 1 5.8V15a3 3 0 0 1-4 2.8V21h-2V3z" />,
    flash: <path d="M12 2v8h5l-7 12v-8H5z" />,
    anchor: <path d="M12 7v14M12 7a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM4 14a8 8 0 0 0 16 0M4 14h3M17 14h3" />,
    king: <path d="M12 3v4M10 5h4M5 21h14l1-9-4 3-4-6-4 6-4-3z" />,
    snake: <path d="M4 7h8a3 3 0 0 1 0 6H8a3 3 0 0 0 0 6h10M18 4l2 2-2 2" />,
    key: <path d="M14 7a4 4 0 1 1-4 4l-7 7v3h3l7-7a4 4 0 0 1 1-7zM17 7h.01" />,
    run: <path d="M13 4a2 2 0 1 0 0-.01zM7 21l3-6-2-4 4-3 3 3 3 1M8 11 5 9" />,
    swords: <path d="m5 3 9 9-3 3-9-9zM19 3l-9 9 3 3 9-9zM4 20l4-4M20 20l-4-4" />,
    moon: <path d="M20 13A8 8 0 0 1 11 4a8 8 0 1 0 9 9z" />,
    rotate: <path d="M20 12a8 8 0 1 1-2.6-5.9M20 4v5h-5" />,
  };
  return (
    <span className="grid place-items-center notch-sm shrink-0" style={{
      width: size + 14, height: size + 14,
      background: unlocked ? 'linear-gradient(135deg,#ffe08a,#ffd24d)' : '#fdf1e2',
      border: unlocked ? '2px solid #e8a21c' : '2px solid #ecd9c2',
      boxShadow: unlocked ? '0 4px 12px -4px rgba(232,162,28,.55)' : 'none',
    }}>
      <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {paths[icon] ?? paths.bolt}
      </svg>
    </span>
  );
}

export default function Achievements() {
  const { progress } = useStore();
  const [filter, setFilter] = useState<'all' | 'unlocked' | 'locked'>('all');
  const lvl = levelFor(progress.xp);

  const rows = useMemo(() => ACHIEVEMENTS.map((a) => ({ ...a, at: progress.achievements[a.slug] ?? 0 })), [progress.achievements]);
  const unlocked = rows.filter((r) => r.at > 0);
  const shown = filter === 'all' ? rows : filter === 'unlocked' ? unlocked : rows.filter((r) => !r.at);
  const pct = Math.round((unlocked.length / rows.length) * 100);

  return (
    <div className="mx-auto max-w-[1140px] px-[var(--shell-pad)] py-7">
      <section className="panel panel-notch p-6 sm:p-7 mb-7 flex items-center gap-6 flex-wrap">
        <div className="relative shrink-0" style={{ width: 118, height: 118 }}>
          <svg width="118" height="118" viewBox="0 0 118 118" className="absolute inset-0 -rotate-90">
            <circle cx="59" cy="59" r="52" fill="none" stroke="#ffe3ec" strokeWidth="9" />
            <circle cx="59" cy="59" r="52" fill="none" stroke="#ffadc6" strokeWidth="9" strokeLinecap="round"
              strokeDasharray={`${(pct / 100) * 2 * Math.PI * 52} ${2 * Math.PI * 52}`} />
          </svg>
          <div className="absolute inset-0 grid place-items-center">
            <span className="display text-[27px] text-cream-100 tabnum">{pct}%</span>
          </div>
        </div>
        <div className="min-w-[220px] flex-1">
          <p className="eyebrow text-blush-600 mb-1.5">Trophy cabinet</p>
          <h1 className="display text-[clamp(24px,4vw,36px)] text-cream-100 leading-[1]">Achievements</h1>
          <p className="text-[13px] text-cream-400 mt-2 max-w-[460px]">
            {unlocked.length} of {rows.length} unlocked. Each one is awarded by the match recorder when the condition actually happens — never by visiting a page.
          </p>
          <div className="flex gap-3 mt-3.5 flex-wrap">
            <Stat label="Level" value={lvl.level} accent="#f0b429" />
            <Stat label="XP" value={progress.xp.toLocaleString()} />
            <Stat label="Next level" value={`${Math.max(0, lvl.ceil - progress.xp)} XP`} />
          </div>
        </div>
        <div className="hidden md:flex shrink-0 items-center gap-4">
          <PikachuMascot state={pct >= 75 ? 'victory' : pct > 0 ? 'excited' : 'waiting'} size={132} />
          <PikaScene clip="storm" className="hidden xl:block w-[132px]" rounded={18} tilt={2.5} />
        </div>
      </section>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <SectionTitle eyebrow={`${unlocked.length} earned`} title="All badges" />
        <Segmented value={filter} onChange={(v) => setFilter(v as any)} label="Filter achievements"
          options={[{ value: 'all', label: 'All' }, { value: 'unlocked', label: 'Earned' }, { value: 'locked', label: 'Locked' }]} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 mt-3.5">
        {shown.map((a) => (
          <Panel key={a.slug} className={`p-3.5 flex items-start gap-3 ${a.at ? '' : 'opacity-72'}`}>
            <Badge icon={a.icon} unlocked={!!a.at} />
            <div className="min-w-0">
              <h3 className={`display text-[14.5px] leading-tight ${a.at ? 'text-cream-100' : 'text-cream-400'}`}>{a.name}</h3>
              <p className="text-[12px] text-cream-500 mt-0.5">{a.description}</p>
              <p className="text-[10.5px] uppercase tracking-wider font-bold mt-1.5" style={{ color: a.at ? '#3fae82' : '#5a5a50' }}>
                {a.at ? `Earned ${new Date(a.at).toLocaleDateString()}` : 'Locked'}
              </p>
            </div>
          </Panel>
        ))}
      </div>

      {shown.length === 0 && (
        <Panel className="p-8 text-center mt-3.5">
          <p className="text-cream-400 text-[13px]">Nothing in this filter yet.</p>
        </Panel>
      )}
    </div>
  );
}
