import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore, useAmbience } from '../lib/store';
import { useRoom } from '../lib/useRoom';
import { GAMES, gameById, liveGames } from '../games/registry';
import { GameCard } from '../components/GameCard';
import { GameArtwork } from '../components/GameArtwork';
import { Button, Icon, Panel, SectionTitle, Stat } from '../components/ui';
import { SupportCard } from '../components/Support';
import { PikachuMascot, BoltRule } from '../mascot';
import { dailyChallenges, levelFor } from '../lib/progress';
import { MASCOT_ART } from '../lib/identity';

export default function Home() {
  const nav = useNavigate();
  const { identity, progress, sfx } = useStore();
  const { room, conn } = useRoom();
  useAmbience('hub');

  const lvl = levelFor(progress.xp);
  const challenges = useMemo(() => dailyChallenges(progress.dailySeed), [progress.dailySeed]);
  const recents = progress.recents.map((r) => ({ ...r, game: gameById(r.gameId) })).filter((r) => r.game).slice(0, 4);
  /* One from each genre first, then fill — otherwise the front page is six
     strategy boards and every puzzle and party game is invisible until you
     open the library. */
  const featured = useMemo(() => {
    const live = liveGames();
    const byGenre = ['strategy', 'party', 'puzzle', 'arcade'].map((genre) => live.find((g) => g.genre === genre));
    const picked = byGenre.filter((g): g is NonNullable<typeof g> => !!g);
    for (const g of live) {
      if (picked.length >= 6) break;
      if (!picked.includes(g)) picked.push(g);
    }
    return picked.slice(0, 6);
  }, []);
  const totals = useMemo(() => {
    const v = Object.values(progress.stats);
    return {
      played: v.reduce((a, b) => a + b.played, 0),
      wins: v.reduce((a, b) => a + b.wins, 0),
      ach: Object.keys(progress.achievements).length,
    };
  }, [progress]);

  const greet = identity.greeting || (identity.name ? `Welcome back, ${identity.name}` : 'Welcome to our little arcade');

  return (
    <div>
      {/* ============================ HERO ============================ */}
      <section className="relative overflow-hidden border-b border-ink-600" aria-labelledby="hero-title">
        <div className="absolute inset-0">
          <img src="/art/scene/hero.webp" alt="" className="w-full h-full object-cover object-[center_38%]"
            fetchPriority="high" decoding="async" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#fff8ec] via-[#fff8ec]/72 to-[#fff8ec]/10" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#fff8ec] via-transparent to-[#fff8ec]/20" />
        </div>

        {/* drifting motes — few, cheap, and dropped entirely on performance mode */}
        <div className="absolute inset-0 pointer-events-none fx-heavy" aria-hidden>
          {[...Array(12)].map((_, i) => (
            <span key={i}
              style={{
                position: 'absolute',
                left: `${(i * 8.3 + 5) % 96}%`, top: `${(i * 17 + 12) % 86}%`,
                fontSize: 10 + (i % 4) * 5, opacity: 0.3 + (i % 4) * 0.14,
                color: i % 3 === 0 ? '#ffd24d' : '#ffadc6',
                animation: `pk-float ${4 + (i % 5)}s ease-in-out ${i * 0.4}s infinite`,
              }}>{i % 3 === 0 ? '✦' : '♥'}</span>
          ))}
        </div>

        <div className="relative mx-auto max-w-[1340px] px-[var(--shell-pad)] pt-10 pb-12 lg:pt-16 lg:pb-16
                        grid lg:grid-cols-[minmax(0,1fr)_380px] gap-8 items-center">
          {/* left */}
          <div className="max-w-[640px]">
            <p className="eyebrow text-volt-700 mb-2.5 flex items-center gap-2">
              <span className="w-6 h-[3px] rounded-full bg-blush-300" />{greet}
            </p>
            <h1 id="hero-title" className="wordmark text-[clamp(42px,8.4vw,92px)] leading-[.86] mb-3">PIKACHU</h1>
            <p className="text-[14.5px] sm:text-[16px] text-cream-300 leading-relaxed max-w-[52ch] mb-6">
              {GAMES.length} finished games, five AI moods, and private rooms with a five-letter code —
              a cosy little arcade built for exactly two people.
            </p>

            <div className="flex flex-wrap gap-2.5 mb-7">
              <Button variant="primary" size="lg" onClick={() => nav('/library')} icon={<Icon name="play" size={16} />}>Play now</Button>
              <Button variant="blue" size="lg" onClick={() => nav('/together')} icon={<Icon name="users" size={16} />}>Play together</Button>
              <Button variant="ghost" size="lg" onClick={() => nav('/library?mode=solo')} icon={<Icon name="user" size={16} />}>Play solo</Button>
            </div>

            <div className="flex flex-wrap gap-2">
              <Stat label="Level" value={lvl.level} accent="var(--color-volt-700)" />
              <Stat label="Matches" value={totals.played} />
              <Stat label="Wins" value={totals.wins} accent="var(--color-leaf-700)" />
              <Stat label="Trophies" value={totals.ach} accent="#1f6699" />
              <Stat label="vs Rival" value={`${progress.versus.wins}–${progress.versus.losses}`} accent="var(--color-blush-600)" />
            </div>
          </div>

          {/* right: live room panel + mascot */}
          <div className="relative">
            <div className="absolute -top-[72px] right-0 hidden lg:block pointer-events-none z-10">
              <PikachuMascot state={room ? 'excited' : 'idle'} size={300} priority />
            </div>
            <Panel className="relative p-4 mt-24 lg:mt-[120px]">
              <div className="flex items-center justify-between mb-3">
                <p className="eyebrow">Private arena</p>
                <span className={`text-[10px] font-extrabold uppercase tracking-wider ${conn === 'online' ? 'text-leaf-700' : 'text-cream-500'}`}>
                  {conn === 'online' ? '● Relay live' : '○ Relay idle'}
                </span>
              </div>

              {room ? (
                <>
                  <p className="display text-[20px] text-volt-700 mb-1">{room.roomName}</p>
                  <p className="text-[12px] text-cream-500 mb-3">
                    {gameById(room.gameId)?.title} · {room.members.length}/2 trainers · code <span className="font-mono text-cream-100">{room.code}</span>
                  </p>
                  <Button variant="primary" className="w-full" onClick={() => nav(`/room/${room.code}`)}>Return to room</Button>
                </>
              ) : (
                <>
                  <p className="text-[13px] text-cream-300 leading-relaxed mb-3">
                    Open a room, send the five-letter code, and the match starts the moment you both ready up.
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="primary" onClick={() => nav('/together')} icon={<Icon name="plus" size={14} />}>Create</Button>
                    <Button variant="ghost" onClick={() => nav('/together?join=1')} icon={<Icon name="link" size={14} />}>Join</Button>
                  </div>
                </>
              )}

              <div className="mt-3.5 pt-3 border-t border-ink-600 flex items-center gap-2.5">
                <img src={MASCOT_ART[identity.mascot] ?? MASCOT_ART.classic} alt="" width={34} height={34} className="w-[34px] h-[34px] object-contain" />
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] font-extrabold text-cream-100 truncate">{identity.name || 'Set your trainer name'}</p>
                  <div className="h-[7px] rounded-full bg-blush-100 border border-ink-500 mt-1 overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-to-r from-volt-400 to-blush-300" style={{ width: `${lvl.pct * 100}%` }} />
                  </div>
                </div>
                <button onClick={() => { sfx('click'); nav('/profile'); }} className="text-[10.5px] font-extrabold uppercase tracking-wider text-blush-600 hover:text-[#8f1740] hover:underline shrink-0">Edit</button>
              </div>
            </Panel>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-[1340px] px-[var(--shell-pad)] py-9 flex flex-col gap-11">
        {/* ============================ CONTINUE ============================ */}
        {recents.length > 0 && (
          <section aria-labelledby="continue-h">
            <SectionTitle id="continue-h" eyebrow="Jump back in" title="Continue playing"
              action={<Button variant="ghost" size="sm" onClick={() => nav('/library')}>All games</Button>} />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {recents.map((r) => (
                <button key={r.gameId} onClick={() => { sfx('select'); nav(`/solo/${r.game!.slug}`); }}
                  className="group relative h-[104px] panel notch-sm overflow-hidden text-left no-tap hover:border-volt-600/70 transition-colors">
                  <GameArtwork artKey={r.game!.artKey} className="opacity-55 group-hover:opacity-80 transition-opacity" />
                  <div className="absolute inset-0 bg-gradient-to-r from-ink-900/95 via-ink-900/70 to-transparent" />
                  <div className="relative p-3 h-full flex flex-col justify-between">
                    <p className="eyebrow text-[9px]">{r.mode === 'online' ? 'Online match' : r.mode === 'ai' ? 'vs AI' : 'Solo run'}</p>
                    <div>
                      <p className="display text-[15px] text-cream-100">{r.game!.title}</p>
                      <p className="text-[10.5px] text-volt-700 font-bold flex items-center gap-1"><Icon name="play" size={10} />Resume</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* ============================ DAILY ============================ */}
        <section aria-labelledby="daily-h">
          <SectionTitle id="daily-h" eyebrow="Resets at midnight" title="Daily challenges"
            action={<Button variant="ghost" size="sm" onClick={() => nav('/challenges')}>View all</Button>} />
          <div className="grid gap-3 md:grid-cols-3">
            {challenges.map((c) => {
              const done = (progress.dailyProgress[c.id] ?? 0) >= c.goal;
              const pct = Math.min(1, (progress.dailyProgress[c.id] ?? 0) / c.goal);
              return (
                <Panel key={c.id} className={`p-3.5 flex gap-3 ${done ? 'border-leaf-400/60' : ''}`}>
                  <div className={`w-9 h-9 shrink-0 grid place-items-center border notch-sm ${done ? 'bg-leaf-400 text-[#5a3a12] border-leaf-400' : 'bg-blush-100 text-volt-700 border-ink-500'}`}>
                    <Icon name={done ? 'check' : 'target'} size={17} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-[13.5px] font-extrabold text-cream-100">{c.title}</p>
                      <span className="text-[10.5px] font-extrabold text-volt-700 shrink-0">+{c.xp} XP</span>
                    </div>
                    <p className="text-[11.5px] text-cream-500 leading-snug mt-0.5">{c.detail}</p>
                    <div className="h-[5px] bg-blush-100 mt-2 overflow-hidden">
                      <div className={`h-full transition-[width] duration-500 ${done ? 'bg-leaf-400' : 'bg-gradient-to-r from-volt-600 to-volt-300'}`} style={{ width: `${pct * 100}%` }} />
                    </div>
                  </div>
                </Panel>
              );
            })}
          </div>
        </section>

        {/* ============================ TOGETHER BANNER ============================ */}
        <section className="relative panel panel-notch overflow-hidden">
          <div className="absolute inset-0 opacity-45">
            <img src="/art/scene/hero.webp" alt="" className="w-full h-full object-cover object-top" loading="lazy" decoding="async" />
          </div>
          <div className="absolute inset-0 bg-gradient-to-r from-ink-900 via-ink-900/90 to-ink-900/40" />
          <div className="relative p-6 sm:p-8 grid md:grid-cols-[1fr_auto] gap-6 items-center">
            <div className="max-w-[56ch]">
              <p className="eyebrow text-volt-700 mb-1.5">The point of all this</p>
              <h2 className="display text-[26px] sm:text-[32px] text-cream-100 mb-2">Play together, from anywhere</h2>
              <p className="text-[13.5px] text-cream-300 leading-relaxed mb-4">
                Private rooms with a five-letter code. The server referees every move, so a dropped
                connection never costs you a match — reconnect and the board is exactly where you left it.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" onClick={() => nav('/together')} icon={<Icon name="users" size={15} />}>Open a room</Button>
                <Button variant="ghost" onClick={() => nav('/together?join=1')} icon={<Icon name="link" size={15} />}>I have a code</Button>
              </div>
            </div>
            <div className="hidden md:flex items-end gap-1 pr-4">
              <PikachuMascot state="waiting" size={120} />
              <PikachuMascot state="excited" size={120} flip />
            </div>
          </div>
        </section>

        {/* ============================ LIBRARY PREVIEW ============================ */}
        <section aria-labelledby="games-h">
          <SectionTitle id="games-h" eyebrow={`${GAMES.length} complete games`} title="The game library"
            action={<Button variant="ghost" size="sm" onClick={() => nav('/library')} icon={<Icon name="grid" size={14} />}>Browse all</Button>} />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((g) => <GameCard key={g.id} game={g} />)}
          </div>
        </section>

        {/* ============================ TIP JAR ============================ */}
        <SupportCard />

        {/* ============================ CLOSING ILLUSTRATION ============================ */}
        <section aria-label="Pikachu and a friend waving goodbye" className="pt-1">
          <BoltRule />
          <div className="mt-6 pb-3 flex flex-col items-center text-center">
            <div className="flex items-end gap-1">
              <PikachuMascot state="excited" size={78} />
              <PikachuMascot state="idle" size={78} flip />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
