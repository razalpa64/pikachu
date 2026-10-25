import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore, useAmbience } from '../lib/store';
import { useRoom } from '../lib/useRoom';
import { GAMES, gameById, liveGames, onlineGames, GENRE_LABEL } from '../games/registry';
import { GameCard } from '../components/GameCard';
import { GameArtwork } from '../components/GameArtwork';
import { GameRail, Spotlight } from '../components/GameRail';
import { JoinCode } from '../components/JoinCode';
import { AdSlot } from '../components/AdSlot';
import { Button, Icon, Panel, SectionTitle, Stat } from '../components/ui';
import { SupportCard } from '../components/Support';
import { PikachuMascot, BoltRule } from '../mascot';
import { dailyChallenges, levelFor } from '../lib/progress';
import { readRecord, solvedToday } from '../games/daily/streak';
import { DAILY_VERSION, dateKey } from '../games/daily/puzzle';
import { MASCOT_ART } from '../lib/identity';

/**
 * The front page.
 *
 * Structure, top to bottom, and why:
 *
 *   hero        what this is, in one look, with the picnic scene as a framed
 *               postcard rather than a full-bleed wash behind the type
 *   your table  only when there is a room or a match history — a returning
 *               visitor's fastest route back in
 *   spotlight   one real game, chosen by the daily seed: the visual anchor
 *   shelves     three horizontal rails (quick, together, solo) instead of one
 *               grid, so the page has rhythm and each row answers a question
 *   daily       three goals, resetting at midnight
 *   together    the private-room pitch, with the code field right there
 *   library     six covers for browsing, then the tip jar and the sign-off
 *
 * What is deliberately absent: invented player counts, fake reviews, and a hero
 * that promises more than the 20 real games behind it.
 */
export default function Home() {
  const nav = useNavigate();
  const { identity, progress, sfx } = useStore();
  const { room, conn } = useRoom();
  useAmbience('hub');

  const lvl = levelFor(progress.xp);
  const challenges = useMemo(() => dailyChallenges(progress.dailySeed), [progress.dailySeed]);
  const recents = progress.recents.map((r) => ({ ...r, game: gameById(r.gameId) })).filter((r) => r.game).slice(0, 4);

  const live = useMemo(() => liveGames(), []);
  /* The pick is deterministic per day: both people opening the arcade on the same
     evening see the same suggestion, and it changes without a deploy. */
  const pick = useMemo(() => {
    // hash the date string, so the pick is stable for the day and different tomorrow
    let h = 0;
    for (const ch of progress.dailySeed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return live[h % live.length] ?? live[0];
  }, [live, progress.dailySeed]);

  const quick = useMemo(() => live.filter((g) => g.duration <= 6).slice(0, 9), [live]);
  const together = useMemo(() => onlineGames().filter((g) => g.players[1] >= 2).slice(0, 9), []);
  const solo = useMemo(() => live.filter((g) => g.modes.includes('ai') || g.modes.includes('solo')).slice(0, 9), [live]);
  /* Party and trivia — games you put in the middle of the table. A different
     question from "something to play with someone far away", so its own row. */
  const party = useMemo(() => live.filter((g) => g.genre === 'party' || g.modes.includes('local')).slice(0, 9), [live]);

  const featured = useMemo(() => {
    // one from each genre first, then fill — the front page should not be six
    // strategy boards with every puzzle invisible until the library
    const byGenre = ['strategy', 'party', 'puzzle', 'arcade'].map((genre) => live.find((g) => g.genre === genre));
    const chosen = byGenre.filter((g): g is NonNullable<typeof g> => !!g);
    for (const g of live) {
      if (chosen.length >= 6) break;
      if (!chosen.includes(g)) chosen.push(g);
    }
    return chosen.slice(0, 6);
  }, [live]);

  const totals = useMemo(() => {
    const v = Object.values(progress.stats);
    return {
      played: v.reduce((a, b) => a + b.played, 0),
      wins: v.reduce((a, b) => a + b.wins, 0),
      ach: Object.keys(progress.achievements).length,
    };
  }, [progress]);

  const hasHistory = totals.played > 0;
  const name = identity.name.trim();
  const greet = identity.greeting || (name ? `Welcome back, ${name}` : 'A little arcade, built for two');

  return (
    <div>
      {/* ================================ HERO ================================ */}
      <section className="relative overflow-hidden border-b border-ink-600" aria-labelledby="hero-title">
        {/* warm paper ground with two soft washes; no full-screen photo behind the type */}
        <div aria-hidden className="absolute inset-0 pointer-events-none">
          <div className="absolute -top-24 -left-20 w-[46rem] h-[46rem] rounded-full opacity-70"
            style={{ background: 'radial-gradient(circle, rgba(255,233,170,.75), transparent 62%)' }} />
          <div className="absolute top-24 right-0 w-[38rem] h-[38rem] rounded-full opacity-60"
            style={{ background: 'radial-gradient(circle, rgba(255,214,226,.7), transparent 64%)' }} />
          <div className="absolute inset-0 opacity-[.05]"
            style={{ backgroundImage: 'radial-gradient(rgba(90,63,52,.9) .5px, transparent .6px)', backgroundSize: '5px 5px' }} />
        </div>

        <div className="relative mx-auto max-w-[1340px] px-[var(--shell-pad)] pt-9 pb-8 lg:pt-12 lg:pb-10">
          {/* --------------------------- words first ---------------------------
              Copy on top, the painted scene beneath it: this is the composition
              the page had before, and it earns its keep. The headline, the promise
              and both primary buttons are visible without scrolling on a phone,
              and the picture arrives as a wide band rather than competing with the
              type for the same row. */}
          <div className="max-w-[820px]">
            <p className="eyebrow text-volt-700 mb-3 flex items-center gap-2">
              <span aria-hidden className="w-7 h-[3px] rounded-full bg-blush-300" />{greet}
            </p>

            <h1 id="hero-title" className="mb-3.5" aria-label="Pikachu Arcade">
              <span className="wordmark block text-[clamp(46px,10vw,96px)] leading-[.85]">PIKACHU</span>
              <span className="mt-1.5 flex items-center gap-3">
                <span aria-hidden className="display text-[clamp(19px,4vw,30px)] text-cream-300 tracking-[.34em]">ARCADE</span>
                <svg aria-hidden width="72" height="14" viewBox="0 0 72 14" className="opacity-80">
                  <path d="M2 9c11-6 22-6 33-2s22 5 34-3" fill="none" stroke="#f2779a" strokeWidth="2.6" strokeLinecap="round" />
                </svg>
              </span>
            </h1>

            <p className="text-[15.5px] sm:text-[17px] text-cream-300 leading-relaxed max-w-[52ch] mb-6">
              {GAMES.length} hand-built games for one or two people — a real chess engine, five AI
              temperaments, and private rooms you open with a five-letter code. No account, no install,
              nothing to download.
            </p>

            <div className="flex flex-wrap items-center gap-2.5 mb-6">
              <Button variant="primary" size="lg" onClick={() => nav('/library')} icon={<Icon name="play" size={16} />}>Play now</Button>
              <Button variant="blue" size="lg" onClick={() => nav('/together')} icon={<Icon name="users" size={16} />}>Play together</Button>
              <button onClick={() => { sfx('select'); nav('/solo'); }}
                className="group inline-flex items-center gap-1.5 px-2 h-11 text-[12.5px] font-extrabold uppercase tracking-wider text-cream-500 hover:text-volt-700 no-tap">
                Solo &amp; AI
                <span aria-hidden className="transition-transform group-hover:translate-x-0.5"><Icon name="chevron-right" size={14} /></span>
              </button>
            </div>

            {/* What is actually true about the place, instead of a row of zeroes on
                a first visit. Personal stats replace this once there is history. */}
            {hasHistory ? (
              <div className="flex flex-wrap gap-2">
                <Stat label="Level" value={lvl.level} accent="var(--color-volt-700)" />
                <Stat label="Matches" value={totals.played} />
                <Stat label="Wins" value={totals.wins} accent="var(--color-leaf-700)" />
                <Stat label="Trophies" value={totals.ach} accent="#1f6699" />
                <Stat label="vs Rival" value={`${progress.versus.wins}–${progress.versus.losses}`} accent="var(--color-blush-600)" />
              </div>
            ) : (
              <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px] font-extrabold uppercase tracking-wider text-cream-500">
                <li className="flex items-center gap-1.5"><Icon name="grid" size={13} className="text-volt-700" />{GAMES.length} complete games</li>
                <li className="flex items-center gap-1.5"><Icon name="users" size={13} className="text-blush-600" />1–2 players</li>
                <li className="flex items-center gap-1.5"><Icon name="shield" size={13} className="text-leaf-700" />No account</li>
                <li className="flex items-center gap-1.5"><Icon name="bolt" size={13} className="text-volt-700" />Works offline</li>
              </ul>
            )}
          </div>

          {/* ------------------------------ the scene ------------------------------ */}
          <div className="relative mt-9 lg:mt-11">
            <div className="relative rounded-[26px] p-2.5 border-[3px] border-[#d8b18d] bg-[#fffaf1] rotate-[-.5deg]"
              style={{ boxShadow: '0 30px 64px -38px rgba(120,80,55,.8), inset 0 2px 0 rgba(255,255,255,.9)' }}>
              <div className="relative overflow-hidden rounded-[18px] border-2 border-[#e9c7a6]">
                <img
                  src="/art/scene/hero.webp"
                  alt="A picnic laid out on a sunny hillside: a strawberry milkshake, a basket of berries, two cushions and a lantern"
                  width={1568} height={652}
                  fetchPriority="high" decoding="async"
                  className="block w-full h-[214px] sm:h-[300px] lg:h-[396px] object-cover object-[center_58%] select-none"
                />
                <div aria-hidden className="absolute inset-0 ring-1 ring-inset ring-white/40 rounded-[18px]" />

                {/* trainer strip, sitting on the picture rather than under it, so the
                    hero costs one block of height instead of three */}
                <div className="absolute bottom-2.5 left-2.5 sm:right-auto right-2.5 flex items-center gap-2.5 px-2.5 py-1.5 rounded-2xl bg-[#fffaf1]/95 border-2 border-[#d8b18d] max-w-[340px]">
                  <img src={MASCOT_ART[identity.mascot] ?? MASCOT_ART.classic} alt="" width={26} height={26} className="w-[26px] h-[26px] object-contain shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[11.5px] font-extrabold text-cream-100 truncate leading-tight">
                      {name || 'Set your trainer name'}
                      <span className="ml-1.5 font-bold text-cream-400 text-[10px] uppercase tracking-wider">LV {lvl.level}</span>
                    </p>
                    <div className="h-[5px] rounded-full bg-blush-100 border border-ink-400 mt-1 overflow-hidden" role="progressbar"
                      aria-valuenow={Math.round(lvl.pct * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Level progress">
                      <div className="h-full rounded-full bg-gradient-to-r from-volt-400 to-blush-300" style={{ width: `${lvl.pct * 100}%` }} />
                    </div>
                  </div>
                  <button onClick={() => { sfx('click'); nav('/profile'); }}
                    className="text-[10px] font-extrabold uppercase tracking-wider text-blush-600 hover:text-[#8f1740] hover:underline shrink-0">
                    Edit
                  </button>
                </div>

                <span className="absolute bottom-2.5 right-2.5 hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#fffaf1]/94 border-2 border-[#d8b18d] text-[9.5px] font-extrabold uppercase tracking-[.14em] text-cream-300">
                  <span aria-hidden className="text-blush-600">♥</span> Made for two
                </span>
              </div>
            </div>

            {/* The mascot stands on the top edge of the print. */}
            <div className="absolute -top-9 right-4 sm:-top-[74px] sm:right-10 pointer-events-none origin-bottom-right scale-[.66] sm:scale-100">
              <PikachuMascot state={room ? 'excited' : 'idle'} size={140} priority />
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-[1340px] px-[var(--shell-pad)] py-8 flex flex-col gap-10">
        {/* ============================ YOUR TABLE ============================ */}
        {(room || recents.length > 0) && (
          <section aria-labelledby="table-h">
            <SectionTitle id="table-h" eyebrow="Where you left off" title={room ? 'Your table is still open' : 'Jump back in'}
              action={<Button variant="ghost" size="sm" onClick={() => nav('/library')}>All games</Button>} />
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
              {room && (
                <button onClick={() => { sfx('select'); nav(`/room/${room.code}`); }}
                  className="group relative panel notch-sm p-3.5 text-left overflow-hidden md:col-span-2 lg:col-span-2 border-blush-300 hover:border-blush-600 transition-colors no-tap">
                  <span aria-hidden className="absolute inset-0 opacity-30"><GameArtwork artKey={gameById(room.gameId)?.artKey ?? 'cards'} /></span>
                  <span aria-hidden className="absolute inset-0 bg-gradient-to-r from-[#fffdf7] via-[#fffdf7]/92 to-[#fffdf7]/40" />
                  <span className="relative flex items-center gap-3">
                    <span className="w-11 h-11 grid place-items-center rounded-2xl bg-blush-100 border-2 border-blush-600 text-blush-600 shrink-0">
                      <Icon name="users" size={19} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block eyebrow text-[9px]">{room.members.length}/2 in the room</span>
                      <span className="block display text-[15px] text-cream-100 truncate">{gameById(room.gameId)?.title ?? room.roomName}</span>
                      <span className="block text-[11px] text-cream-500">Code <strong className="font-mono text-cream-100 tracking-[.15em]">{room.code}</strong> · {conn === 'online' ? 'relay live' : 'reconnecting'}</span>
                    </span>
                    <span className="btn btn-sm btn-primary shrink-0">Return</span>
                  </span>
                </button>
              )}
              {recents.slice(0, room ? 2 : 4).map((r) => (
                <button key={r.gameId} onClick={() => { sfx('select'); nav(`/solo/${r.game!.slug}`); }}
                  className="group relative h-[96px] panel notch-sm overflow-hidden text-left no-tap hover:border-volt-600/70 transition-colors">
                  <GameArtwork artKey={r.game!.artKey} className="opacity-55 group-hover:opacity-80 transition-opacity" />
                  <div className="absolute inset-0 bg-gradient-to-r from-ink-900/95 via-ink-900/70 to-transparent" />
                  <div className="relative p-3 h-full flex flex-col justify-between">
                    <p className="eyebrow text-[9px]">{r.mode === 'online' ? 'Online match' : r.mode === 'ai' ? 'vs AI' : 'Solo run'}</p>
                    <div>
                      <p className="display text-[14.5px] text-cream-100">{r.game!.title}</p>
                      <p className="text-[10.5px] text-volt-700 font-bold flex items-center gap-1"><Icon name="play" size={10} />Resume</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* ============================== SPOTLIGHT ============================== */}
        <Spotlight
          game={pick}
          label="Tonight's pick"
          blurb={`${pick.description} ${GENRE_LABEL[pick.genre]} · ${pick.modes.includes('online') ? 'works on two devices or against the AI' : 'solo or same-device'}.`}
        />

        <DailyStrip />

        {/* ================================ SHELVES ================================ */}
        <GameRail id="quick-h" eyebrow="Short sessions" title="Ready in five minutes"
          note="A full round while the kettle boils." games={quick}
          action={<Button variant="ghost" size="sm" onClick={() => nav('/library?mode=all')}>Browse</Button>} />

        <GameRail id="together-h" eyebrow="Two devices, one board" title="Best with two"
          note="Private rooms, refereed by the server, resume after a dropped connection." games={together}
          action={<Button variant="ghost" size="sm" onClick={() => nav('/together')}>Open a room</Button>} />

        <GameRail id="party-h" eyebrow="Same table, one phone" title="Party & trivia"
          note="Quiz nights, dares, word games and a room full of suspects." games={party}
          action={<Button variant="ghost" size="sm" onClick={() => nav('/library')}>More</Button>} />

        <GameRail id="solo-h" eyebrow="Just you" title="Against the machine"
          note="Five AI levels, from forgiving to merciless." games={solo}
          action={<Button variant="ghost" size="sm" onClick={() => nav('/solo')}>See all</Button>} />

        {/* ================================ DAILY ================================ */}
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
        <section className="relative panel panel-notch overflow-hidden" aria-labelledby="together-h2">
          <div aria-hidden className="absolute inset-0 opacity-35">
            <img src="/art/scene/hero.webp" alt="" width={1568} height={652} className="w-full h-full object-cover object-top" loading="lazy" decoding="async" />
          </div>
          <div aria-hidden className="absolute inset-0 bg-gradient-to-r from-ink-900 via-ink-900/92 to-ink-900/30" />
          <div className="relative p-6 sm:p-8 grid md:grid-cols-[1fr_320px] gap-6 items-center">
            <div className="max-w-[54ch]">
              <p className="eyebrow text-volt-700 mb-1.5">The point of all this</p>
              <h2 id="together-h2" className="display text-[26px] sm:text-[32px] text-cream-100 mb-2">Play together, from anywhere</h2>
              <p className="text-[13.5px] text-cream-300 leading-relaxed">
                Private rooms with a five-letter code. The server referees every move, so a dropped
                connection never costs you a match — reconnect and the board is exactly where you left it.
              </p>
            </div>
            <div className="flex flex-col gap-2.5">
              <JoinCode />
              <div className="flex gap-2">
                <Button variant="primary" className="flex-1" onClick={() => nav('/together')} icon={<Icon name="plus" size={14} />}>Create a room</Button>
                <Button variant="ghost" onClick={() => nav('/together')} icon={<Icon name="users" size={14} />}>How it works</Button>
              </div>
            </div>
          </div>
        </section>

        {/* ============================== LIBRARY ============================== */}
        <section aria-labelledby="games-h">
          <SectionTitle id="games-h" eyebrow={`${GAMES.length} complete games`} title="The game library"
            action={<Button variant="ghost" size="sm" onClick={() => nav('/library')} icon={<Icon name="grid" size={14} />}>Browse all</Button>} />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((g) => <GameCard key={g.id} game={g} />)}
          </div>
        </section>

        {/* Advertising lives here, below every bit of real content, and renders
            nothing at all until a publisher id exists and a visitor opts in. */}
        <AdSlot placement="home-foot" />

        <SupportCard />

        {/* ============================== SIGN-OFF ============================== */}
        <section aria-label="Pikachu and a friend waving goodbye" className="pt-1">
          <BoltRule />
          <div className="mt-6 pb-3 flex flex-col items-center text-center gap-2">
            <div className="flex items-end gap-1">
              <PikachuMascot state="excited" size={78} />
              <PikachuMascot state="idle" size={78} flip />
            </div>
            <p className="text-[11.5px] text-cream-400 max-w-[44ch]">
              Everything here was drawn, written and built for this arcade — and it is free to play,
              forever.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

/**
 * One strip, once a day.
 *
 * A daily puzzle is worthless if nobody can find it, but a whole shelf for it
 * would out-shout the games people actually came for — so it is a single warm
 * band: what it is, whether today is still open, and the streak *you* earned.
 * No invented "12,481 players solved this" — the number on the right is the
 * only one this app can know.
 */
function DailyStrip() {
  const nav = useNavigate();
  const rec = useMemo(() => readRecord(), []);
  const today = dateKey();
  const done = solvedToday(rec, today);

  return (
    <section aria-labelledby="daily-h"
      className="relative panel panel-notch overflow-hidden flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-5 px-4 py-3.5 sm:px-5">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {/* a tiny nonogram, drawn from the same picture the game is: squares, not an icon font */}
        <div className="shrink-0 grid grid-cols-3 gap-[3px] p-1.5 rounded-lg border-2 border-ink-500 bg-ink-800" aria-hidden>
          {[1, 0, 1, 0, 1, 0, 1, 1, 1].map((on, i) => (
            <span key={i} className="w-[7px] h-[7px] rounded-[1.5px]"
              style={{ background: on ? '#e8a21c' : '#f0dcc2' }} />
          ))}
        </div>
        <div className="min-w-0">
          <p className="eyebrow text-volt-700">Daily puzzle · edition {DAILY_VERSION}</p>
          <h2 id="daily-h" className="display text-[17px] sm:text-[19px] text-cream-100 leading-tight mt-0.5">
            {done ? 'Today’s grid is already solved' : 'Today’s grid is open'}
          </h2>
          <p className="text-[12px] text-cream-500 leading-snug mt-0.5">
            A 5×5 nonogram, the same one for everyone, generated from the date — no server, nothing to sign up for.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0 sm:pl-2">
        {rec.streak > 0 && (
          <div className="text-right">
            <p className="display text-[19px] text-leaf-700 leading-none tabnum">{rec.streak}</p>
            <p className="text-[9px] font-extrabold uppercase tracking-wider text-cream-400">day streak</p>
          </div>
        )}
        <Button variant={done ? 'ghost' : 'primary'} onClick={() => nav('/solo/daily-puzzle')}>
          {done ? 'Play again' : 'Open today’s'}
        </Button>
      </div>
    </section>
  );
}
