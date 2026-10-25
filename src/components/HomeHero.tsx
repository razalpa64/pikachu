import { useNavigate } from 'react-router-dom';
import { GAMES } from '../games/registry';
import { useStore } from '../lib/store';
import { useRoom } from '../lib/useRoom';
import type { ConnState } from '../lib/net/relay';
import { levelFor } from '../lib/progress';
import { MASCOT_ART } from '../lib/identity';
import { Button, Icon } from './ui';
import { PikachuMascot } from '../mascot';

/**
 * The front door.
 *
 * This is one screen doing three jobs, in a deliberate order:
 *
 *   1. **Says what the place is** — a wordmark you can read from across the room,
 *      one sentence of plain English, no marketing fog.
 *   2. **Gives you the two ways in** — play now, or open a room — with the
 *      private-arena invitation sitting where the second question is asked
 *      ("how do I play with them?"), not three screens deep.
 *   3. **Ends on the horizon** — the picnic painting as a full-bleed band. It has
 *      no border, no mount and no rounded corners, because a framed picture in a
 *      landing page reads as decoration, while an edge-to-edge horizon reads as
 *      the place the arcade lives. Pikachu stands on it.
 *
 * What changed and why (the previous version was mocked up as one 820px column
 * with a picture underneath it, plus a trainer chip floating on the artwork):
 *
 *   • **Hierarchy.** Three actions were rendered at the same weight. Now "Play
 *     now" is the only filled volt button, "Play together" is a quieter blush
 *     outline, and "Solo & AI" is a text link — a reader can tell what to do
 *     first without reading.
 *   • **No duplicate profile.** The trainer name, level and progress bar already
 *     live in the top bar; on the hero they were a second card sitting on the
 *     grass and quietly arguing with the first. They are now one ticket stub at
 *     the bottom of the invitation, where the level bar has somewhere to point.
 *   • **The invitation is a real object.** The old page asked for a room code in
 *     a banner two sections down. The card here answers "how do we play
 *     together?" at the moment the question is formed, and the code field stays
 *     in the banner for anyone who kept scrolling.
 *   • **The column no longer runs out.** Copy was left-aligned in a wide empty
 *     page. On a large screen the right half now holds the invitation, so the
 *     eye has a second thing to land on and the horizon below is uninterrupted.
 *
 * Everything it claims is true and derived: the game count comes from the
 * registry, the online count is the number of server-refereed games, and the
 * personal figures only appear once there is a match to count.
 */
export function HomeHero() {
  const nav = useNavigate();
  const { identity, progress, sfx } = useStore();
  const { room, conn } = useRoom();

  const lvl = levelFor(progress.xp);
  const stats = Object.values(progress.stats);
  const played = stats.reduce((a, b) => a + b.played, 0);
  const wins = stats.reduce((a, b) => a + b.wins, 0);
  const trophies = Object.keys(progress.achievements).length;
  const hasHistory = played > 0;
  const name = identity.name.trim();
  const online = GAMES.filter((g) => g.serverRefereed).length;
  const go = (to: string) => { sfx('select'); nav(to); };

  const greet = identity.greeting
    || (name ? `Welcome back, ${name}` : 'A little arcade, built for two');

  return (
    <section className="relative overflow-hidden" aria-labelledby="hero-title">
      {/* Warm paper ground: two soft washes and a dot grain, no photograph behind
          the type. The washes sit left and right so the cream middle stays quiet
          under the sentence people actually have to read. */}
      <div aria-hidden className="absolute inset-0 pointer-events-none">
        <div className="absolute -top-32 -left-24 w-[44rem] h-[44rem] rounded-full opacity-60"
          style={{ background: 'radial-gradient(circle, rgba(255,233,170,.8), transparent 62%)' }} />
        <div className="absolute -top-10 right-0 w-[34rem] h-[34rem] rounded-full opacity-50"
          style={{ background: 'radial-gradient(circle, rgba(255,214,226,.75), transparent 64%)' }} />
        <div className="absolute inset-0 opacity-[.045]"
          style={{ backgroundImage: 'radial-gradient(rgba(90,63,52,.9) .5px, transparent .6px)', backgroundSize: '5px 5px' }} />
      </div>

      <div className="relative mx-auto max-w-[1340px] px-[var(--shell-pad)] pt-8 pb-9 sm:pt-10 lg:pt-12 lg:pb-11">
        <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_356px] lg:gap-12 lg:items-start">

          {/* ------------------------------- the words ------------------------------- */}
          <div className="max-w-[620px]">
            <p className="eyebrow text-volt-700 mb-3 flex items-center gap-2.5">
              <span aria-hidden className="w-6 h-[3px] rounded-full bg-blush-300" />
              <span className="min-w-0 truncate">{greet}</span>
            </p>

            {/* One h1, two lines: the name at display size, the word that says what
                kind of place it is underneath, tracked out to the same width. */}
            <h1 id="hero-title" className="mb-4" aria-label="Pikachu Arcade">
              <span className="wordmark block text-[clamp(52px,9.2vw,104px)] leading-[.84]">PIKACHU</span>
              <span className="mt-3 flex items-center gap-3">
                <span aria-hidden className="display text-[clamp(17px,3.4vw,26px)] text-cream-300 tracking-[.4em]">ARCADE</span>
                <svg aria-hidden width="64" height="12" viewBox="0 0 72 14" className="shrink-0 opacity-80">
                  <path d="M2 9c11-6 22-6 33-2s22 5 34-3" fill="none" stroke="#f2779a" strokeWidth="2.8" strokeLinecap="round" />
                </svg>
              </span>
            </h1>

            <p className="text-[15.5px] sm:text-[17px] text-cream-300 leading-[1.6] max-w-[48ch] mb-5">
              {GAMES.length} hand-built games for one or two people — a real chess engine, five AI
              temperaments, and private rooms you open with a five-letter code.
              <span className="block mt-2 text-cream-400 text-[14px] sm:text-[14.5px]">
                No account, no install, nothing to download.
              </span>
            </p>

            {/* One filled button, one outlined, one text link — three equal-weight
                CTAs is the classic landing-page tell. On a phone the two real
                actions stack full width, because a thumb should not have to aim at
                a wrapped row, and the text link centres underneath. */}
            <div className="flex flex-col sm:flex-row flex-wrap sm:items-center gap-2.5 sm:gap-3">
              <Button variant="primary" size="lg" className="w-full sm:w-auto justify-center"
                onClick={() => go('/library')} icon={<Icon name="play" size={16} />}>
                Play now
              </Button>
              <Button variant="ghost" size="lg" className="w-full sm:w-auto justify-center border-blush-400 text-[#8f1740] hover:bg-blush-100"
                onClick={() => go('/together')} icon={<Icon name="users" size={16} />}>
                Play together
              </Button>
              <button onClick={() => go('/solo')}
                className="group inline-flex items-center justify-center gap-1.5 px-1.5 min-h-11 text-[12.5px] font-extrabold uppercase tracking-wider text-cream-500 hover:text-volt-700 no-tap">
                Solo &amp; AI
                <span aria-hidden className="transition-transform group-hover:translate-x-0.5"><Icon name="chevron-right" size={14} /></span>
              </button>
            </div>

            {/* What is true about the place on a first visit; what is true about
                *you* once there is something to count. Never zeroes. */}
            <div className="mt-5 pt-4 border-t border-ink-600/80">
              {hasHistory ? (
                <dl className="flex flex-wrap items-center gap-x-5 gap-y-2">
                  <Figure label="Matches" value={played} />
                  <Figure label="Wins" value={wins} tone="leaf" />
                  <Figure label="Trophies" value={trophies} tone="sky" />
                  <Figure label="vs Rival" value={`${progress.versus.wins}–${progress.versus.losses}`} tone="blush" />
                  <Figure label="Level" value={lvl.level} tone="volt" />
                </dl>
              ) : (
                <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] font-extrabold uppercase tracking-wider text-cream-500">
                  <li className="flex items-center gap-1.5"><Icon name="grid" size={13} className="text-volt-700" />{GAMES.length} complete games</li>
                  <li aria-hidden className="text-ink-400">·</li>
                  <li className="flex items-center gap-1.5"><Icon name="users" size={13} className="text-blush-600" />{online} play online</li>
                  <li aria-hidden className="text-ink-400">·</li>
                  <li className="flex items-center gap-1.5"><Icon name="shield" size={13} className="text-leaf-700" />No account</li>
                  <li aria-hidden className="text-ink-400">·</li>
                  <li className="flex items-center gap-1.5"><Icon name="bolt" size={13} className="text-volt-700" />Works offline</li>
                </ul>
              )}
            </div>
          </div>

          {/* --------------------------- the invitation ---------------------------
              A ticket, not a dashboard card: the two ways into a private room, a
              perforation, and the trainer stub underneath. It answers "how do we
              actually play together?" where the question is asked rather than two
              sections down the page.

              On a phone the card steps aside entirely. The hero above it already
              offers "Play together" at full width, the drawer holds the trainer card
              with the same level bar, and a phone should reach the shelves rather
              than scroll past a second set of the same two buttons. */}
          <aside className="hidden sm:block relative panel panel-notch p-5 w-full max-w-[460px] lg:max-w-none" aria-labelledby="arena-h">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <h2 id="arena-h" className="eyebrow text-volt-700">Private arena</h2>
              <span className={`inline-flex items-center gap-1.5 text-[9.5px] font-extrabold uppercase tracking-[.12em] ${conn === 'online' ? 'text-leaf-700' : 'text-cream-500'}`}>
                <span aria-hidden className={`w-1.5 h-1.5 rounded-full ${conn === 'online' ? 'bg-leaf-400' : 'bg-ink-400'}`} />
                {RELAY_LABEL[conn]}
              </span>
            </div>
            <p className="text-[12.5px] text-cream-400 leading-snug mb-3">
              {room
                ? <>You are still in room <strong className="font-mono tracking-[.12em] text-cream-100">{room.code}</strong>. Jump back in before it expires.</>
                : <>Open a room, send the five-letter code. The match starts the moment you are both ready.</>}
            </p>

            {/* blush, not volt: the page keeps a single volt button ("Play now") so
                the eye has one first stop, and blush is already this site's colour
                for "together" everywhere else. */}
            <div className="flex flex-col gap-2">
              {room ? (
                <Button variant="blue" className="w-full justify-center h-11" onClick={() => go(`/room/${room.code}`)} icon={<Icon name="users" size={15} />}>
                  Back to room {room.code}
                </Button>
              ) : (
                <Button variant="blue" className="w-full justify-center h-11" onClick={() => go('/together')} icon={<Icon name="plus" size={15} />}>
                  Create a room
                </Button>
              )}
              <Button variant="ghost" className="w-full justify-center h-11" onClick={() => go('/together')} icon={<Icon name="link" size={15} />}>
                Join with a code
              </Button>
            </div>

            {/* perforation — the ticket stub, and the visual break between "open a
                room" and "who you are" */}
            <div aria-hidden className="my-3.5 border-t-2 border-dashed border-ink-500" />

            <button onClick={() => go('/profile')}
              className="w-full flex items-center gap-2.5 text-left group no-tap rounded-xl -m-0.5 p-0.5 hover:bg-blush-100 transition-colors">
              <img src={MASCOT_ART[identity.mascot] ?? MASCOT_ART.classic} alt="" width={32} height={32}
                className="w-8 h-8 object-contain shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-1.5">
                  <span className={`text-[12.5px] font-extrabold truncate ${name ? 'text-cream-100' : 'text-cream-500'}`}>
                    {name || 'Set your trainer name'}
                  </span>
                  <span className="text-[9.5px] font-extrabold uppercase tracking-wider text-blush-600 shrink-0">LV {lvl.level}</span>
                </span>
                <span className="mt-1 flex items-center gap-2">
                  <span className="flex-1 h-[5px] rounded-full bg-blush-100 border border-ink-400 overflow-hidden" role="progressbar"
                    aria-valuenow={Math.round(lvl.pct * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Level progress">
                    <span className="block h-full rounded-full bg-gradient-to-r from-volt-400 to-blush-300" style={{ width: `${Math.max(3, lvl.pct * 100)}%` }} />
                  </span>
                  <span className="text-[9.5px] font-bold text-cream-500 tabnum shrink-0">{Math.round(lvl.pct * 100)}%</span>
                </span>
              </span>
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-blush-600 group-hover:underline shrink-0">Edit</span>
            </button>
          </aside>
        </div>
      </div>

      {/* ------------------------------ the horizon ------------------------------
          Full-bleed and unframed: no border, no radius, no mount. The painting is
          the arcade's own horizon rather than a picture of one, so it runs to both
          edges of the screen and Pikachu stands on the grass. The top edge is
          feathered into the paper so there is no seam to see. */}
      <div className="relative">
        <img
          src="/art/scene/hero.webp"
          alt="A picnic laid out on a sunny hillside: a strawberry milkshake, a basket of berries, two cushions and a lantern"
          width={1568} height={652}
          fetchPriority="high" decoding="async" draggable={false}
          className="block w-full h-[210px] sm:h-[300px] lg:h-[380px] object-cover object-[center_62%] select-none"
          style={{
            WebkitMaskImage: 'linear-gradient(180deg, transparent 0%, #000 9%, #000 100%)',
            maskImage: 'linear-gradient(180deg, transparent 0%, #000 9%, #000 100%)',
          }}
        />

        {/* A caption, not a card: it says the one thing the painting cannot. */}
        <p className="absolute bottom-3 left-[var(--shell-pad)] sm:bottom-4 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#fffaf1]/92 border border-[#e2c6a6] text-[9.5px] font-extrabold uppercase tracking-[.14em] text-cream-400">
          <span aria-hidden className="text-blush-600">♥</span> Made for two
        </p>

        {/* Pikachu, standing in the meadow on the right of the frame, opposite the
            caption so the band has two things to hold it. `pointer-events-none` so
            it can never eat a tap; one image, not two, so a phone fetches it once. */}
        <div className="absolute -bottom-1.5 right-[4%] sm:right-[7%] pointer-events-none origin-bottom-right scale-[.8] sm:scale-100">
          <PikachuMascot state={room ? 'excited' : 'idle'} size={150} priority />
        </div>
      </div>
    </section>
  );
}

/** Honest words for the socket, in the order the socket reports them. */
const RELAY_LABEL: Record<ConnState, string> = {
  online: 'Relay live',
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  offline: 'Relay offline',
  idle: 'Relay idle',
};

/** A number with its label, set like a scorecard rather than a chip. */
function Figure({ label, value, tone = 'ink' }: { label: string; value: number | string; tone?: 'ink' | 'volt' | 'leaf' | 'sky' | 'blush' }) {
  const colour = tone === 'volt' ? 'var(--color-volt-700)'
    : tone === 'leaf' ? 'var(--color-leaf-700)'
    : tone === 'sky' ? '#1f6699'
    : tone === 'blush' ? 'var(--color-blush-600)'
    : 'var(--color-cream-100)';
  return (
    // dt before dd in the source so the term is announced with its number; the
    // order classes put the number first on screen.
    <div className="flex items-baseline gap-1.5">
      <dt className="order-2 text-[9.5px] font-extrabold uppercase tracking-[.12em] text-cream-500">{label}</dt>
      <dd className="order-1 display text-[19px] leading-none tabnum" style={{ color: colour }}>{value}</dd>
    </div>
  );
}

export default HomeHero;
