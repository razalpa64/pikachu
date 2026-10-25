import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { offlineGames } from '../games/registry';
import { GameCard } from '../components/GameCard';
import { GameArtwork } from '../components/GameArtwork';
import { Button, Icon, Panel, SectionTitle, Segmented, Stat } from '../components/ui';
import { PikachuMascot, PikaScene } from '../mascot';
import { useStore, useAmbience } from '../lib/store';
import type {} from '../games/types';

/** Games that genuinely ship a single-player view (see src/screens/Solo.tsx VIEWS). */


type Lens = 'all' | 'ai' | 'score' | 'quick';

export default function SoloHub() {
  const nav = useNavigate();
  const { progress, sfx } = useStore();
  useAmbience('hub');
  const [lens, setLens] = useState<Lens>('all');

  const games = useMemo(() => offlineGames(), []);
  const shown = useMemo(() => games.filter((g) => {
    if (lens === 'ai') return g.modes.includes('ai');
    if (lens === 'score') return ['snake', 'arcade', 'memory', 'puzzle', 'reaction'].includes(g.id);
    if (lens === 'quick') return g.duration <= 5;
    return true;
  }), [games, lens]);

  const played = games.filter((g) => (progress.stats[g.id]?.played ?? 0) > 0);
  const soloIds = useMemo(() => new Set(games.map((g) => g.id)), [games]);
  const lastPlayed = progress.recents.find((r) => soloIds.has(r.gameId));
  const resume = lastPlayed ? games.find((g) => g.id === lastPlayed.gameId) : undefined;
  const totalSolo = games.reduce((a, g) => a + (progress.stats[g.id]?.played ?? 0), 0);

  return (
    <div className="mx-auto max-w-[1340px] px-[var(--shell-pad)] py-7">
      {/* ------------- banner ------------- */}
      <section className="relative overflow-hidden panel panel-notch mb-7">
        <div className="absolute inset-0 opacity-[0.38]" aria-hidden><GameArtwork artKey={resume?.artKey ?? 'snake'} /></div>
        <div className="absolute inset-0 bg-gradient-to-r from-[#fff8ec] via-[#fff8ec]/90 to-[#fff8ec]/40" aria-hidden />
        <div className="relative p-6 sm:p-8 flex items-center gap-7 flex-wrap">
          <div className="min-w-[260px] flex-1">
            <p className="eyebrow text-blush-600 mb-1.5">Just you · {games.length} games</p>
            <h1 className="display text-[clamp(27px,5vw,46px)] text-cream-100 leading-[1.02]">
              Solo<br /><span className="text-blush-600">adventures</span>
            </h1>
            <p className="text-[13px] text-cream-400 mt-3 max-w-[470px]">
              Every opponent here is a real algorithm running on your own machine — alpha-beta search, probability targeting, pathfinding — never a scripted pretend player. Five difficulty tiers, all offline, all instant.
            </p>
            <div className="flex gap-3 mt-4 flex-wrap items-center">
              {resume && (
                <Button onClick={() => { sfx('select'); nav(`/solo/${resume.slug}`); }} icon={<Icon name="play" size={14} />}>
                  Continue {resume.title}
                </Button>
              )}
              <Button variant={resume ? 'ghost' : 'primary'} onClick={() => { sfx('select'); nav(`/solo/${games[Math.floor(Math.random() * games.length)].slug}`); }} icon={<Icon name="sparkle" size={14} />}>
                Surprise me
              </Button>
            </div>
            <div className="flex gap-3 mt-4 flex-wrap">
              <Stat label="Solo matches" value={totalSolo} accent="#8d5a05" />
              <Stat label="Games tried" value={`${played.length}/${games.length}`} />
              <Stat label="Favourites" value={progress.favourites.length} accent="#17795a" />
            </div>
          </div>
          <div className="hidden lg:block shrink-0">
            <PikaScene clip="curious" className="w-[300px]" rounded={24} tilt={-2} />
          </div>
        </div>
      </section>

      {/* ------------- lenses ------------- */}
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <SectionTitle eyebrow={`${shown.length} available`} title="Pick your opponent" />
        <Segmented value={lens} onChange={(v) => setLens(v as Lens)} label="Filter solo games"
          options={[
            { value: 'all', label: 'All' },
            { value: 'ai', label: 'Vs AI' },
            { value: 'score', label: 'High score' },
            { value: 'quick', label: 'Under 5 min' },
          ]} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {shown.map((g) => <GameCard key={g.id} game={g} />)}
      </div>

      {/* ------------- how the AI works ------------- */}
      <SectionTitle eyebrow="Under the hood" title="What you are actually playing against" />
      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4 mt-3.5">
        {[
          { t: 'Chess Arena', d: 'Alpha-beta negamax with quiescence search, killer moves and piece-square tables — in a Web Worker so the board never freezes.', c: '#f0b429' },
          { t: 'Four in a Row & Checkers', d: 'Iterative-deepening minimax with a time budget; difficulty changes real search depth, not reaction scripting.', c: '#e05a74' },
          { t: 'Paper Fleet', d: 'Hunt/target AI with parity sweeping and a live probability density map of where your ships can still fit.', c: '#4a9fd8' },
          { t: 'Snake Arena', d: 'Breadth-first pursuit with a flood-fill survivability guard so the rival serpent avoids trapping itself.', c: '#3fae82' },
        ].map((x) => (
          <Panel key={x.t} className="p-4">
            <span className="block w-7 h-[3px] mb-2.5" style={{ background: x.c }} />
            <h3 className="display text-[14.5px] text-cream-100">{x.t}</h3>
            <p className="text-[12px] text-cream-400 mt-1.5 leading-relaxed">{x.d}</p>
          </Panel>
        ))}
      </div>

      <Panel className="p-4 mt-5 flex items-center gap-4 flex-wrap">
        <PikachuMascot state="waiting" size={62} />
        <p className="text-[13px] text-cream-300 flex-1 min-w-[220px]">
          Prefer a real rival? Every strategy game here also runs refereed online in a private room.
        </p>
        <Button variant="ghost" onClick={() => nav('/together')} icon={<Icon name="users" size={14} />}>Play together</Button>
      </Panel>
    </div>
  );
}
