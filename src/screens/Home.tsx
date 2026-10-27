import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore, useAmbience } from '../lib/store';
import { useRoom } from '../lib/useRoom';
import { GAMES, gameById, liveGames, GENRE_LABEL } from '../games/registry';
import { GameCard } from '../components/GameCard';
import { GameArtwork } from '../components/GameArtwork';
import { GameRail, Spotlight } from '../components/GameRail';
import { JoinCode } from '../components/JoinCode';
import { HomeHero } from '../components/HomeHero';
import { AdSlot } from '../components/AdSlot';
import { Button, Icon, Panel, SectionTitle } from '../components/ui';
import { SupportCard } from '../components/Support';
import { PikachuMascot, BoltRule } from '../mascot';
import { dailyChallenges } from '../lib/progress';
import { readRecord, solvedToday } from '../games/daily/streak';
import { DAILY_VERSION, dateKey } from '../games/daily/puzzle';
import { dayHash, railPicks } from '../lib/rails';

/**
 * The front page.
 *
 * Structure, top to bottom, and why:
 *
 *   hero        <HomeHero/> — the wordmark, the two ways in, the private-arena
 *               ticket, and the picnic painting as an unframed, full-bleed
 *               horizon with Pikachu standing on it
 *   your table  only when there is a room or a match history — a returning
 *               visitor's fastest route back in
 *   spotlight   one real game, chosen by the daily seed: the visual anchor
 *   shelves     four horizontal rails (quick, together, party, solo) instead of
 *               one grid, so the page has rhythm and each row answers a question;
 *               they rotate with the date, so no game is stuck in the library
 *   daily       three goals, resetting at midnight
 *   together    the private-room pitch, with the code field right there
 *   library     six covers for browsing, then the tip jar and the sign-off
 *
 * What is deliberately absent: invented player counts, fake reviews, and a hero
 * that promises more than the real games behind it.
 */
export default function Home() {
  const nav = useNavigate();
  const { progress, sfx } = useStore();
  const { room, conn } = useRoom();
  useAmbience('hub');

  const challenges = useMemo(() => dailyChallenges(progress.dailySeed), [progress.dailySeed]);
  const recents = progress.recents.map((r) => ({ ...r, game: gameById(r.gameId) })).filter((r) => r.game).slice(0, 4);

  const live = useMemo(() => liveGames(), []);
  /**
   * Everything on this page that chooses a game is seeded from the date: the
   * spotlight and the five rails. Two people opening the arcade on the same
   * evening see the same page, it changes without a deploy, and — because each
   * rail rotates — every game in the catalogue gets its turn in front instead of
   * the same nine early entries filling the window forever. `lib/rails.ts` holds
   * the selection rules and the tests that keep that promise.
   */
  const day = useMemo(() => dayHash(progress.dailySeed), [progress.dailySeed]);
  const { quick, together, solo, party, featured } = useMemo(() => railPicks(live, day), [live, day]);
  const pick = live[day % live.length] ?? live[0];

  return (
    <div>
      <HomeHero />

      {/* A phone gets tighter rhythm (5/6 instead of 8/10): the gaps between
          shelves were 40 px of nothing on a screen 844 px tall. */}
      <div className="mx-auto max-w-[1340px] px-[var(--shell-pad)] py-5 sm:py-8 flex flex-col gap-6 sm:gap-10">
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

        {/* ================================ RETRO ================================ */}
        {/* One wide band instead of a whole shelf: the Game Boy Advance section is a
            different kind of thing (real cartridges, real emulator) and it deserves a
            doorway, not a sixth row of the same card. */}
        <section aria-labelledby="retro-h" className="mb-7">
          <SectionTitle id="retro-h" eyebrow="Game Boy Advance · homebrew only"
            title="The retro shelf"
            action={<Button variant="ghost" size="sm" onClick={() => { sfx('select'); nav('/retro'); }} icon={<Icon name="gamepad" size={14} />}>Open the arcade</Button>} />
          <Panel className="overflow-hidden">
            <div className="flex flex-col sm:flex-row items-stretch">
              <div className="relative shrink-0 sm:w-[300px] bg-[#2b1f19] p-3 flex items-center justify-center">
                <div className="w-full max-w-[260px] rounded-[12px] border-4 border-[#14100d] bg-[#0b0d12] overflow-hidden">
                  <img src="/retro/covers/alien-invasion.png" alt="Alien Invasion running on a Game Boy Advance" width={240} height={160} className="w-full pixelated" loading="lazy" />
                </div>
              </div>
              <div className="p-4 sm:p-5 flex-1 min-w-0">
                <h3 className="display text-[19px] text-cream-100 leading-tight">Three cartridges, one emulator, zero downloads</h3>
                <p className="text-[12.5px] text-cream-400 mt-1.5 max-w-[54ch]">
                  Alien Invasion, Cyber Citadel and Simple Frogger — open-source GBA builds that run in the browser
                  with sound, save states and fullscreen. The emulator itself only loads when you insert a cartridge,
                  so the rest of the arcade stays fast.
                </p>
                <div className="flex flex-wrap items-center gap-2 mt-3">
                  <Button size="sm" onClick={() => { sfx('select'); nav('/retro'); }} icon={<Icon name="play" size={12} />}>Insert a cartridge</Button>
                  <span className="text-[11px] text-cream-500">Bring your own ROM too — it never leaves your device.</span>
                </div>
              </div>
            </div>
          </Panel>
        </section>

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
