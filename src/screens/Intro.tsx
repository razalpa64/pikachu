import { useEffect, useRef, useState } from 'react';
import { useStore } from '../lib/store';
import { wantOpeningCry } from '../lib/audio';

/**
 * The cold open.
 *
 * It is shown **only on the front page, once per session** — a link to a game, a
 * search result or a shared room code now lands straight on the board instead of
 * behind a three-second curtain. It has one job: make the first second feel like
 * something, then get out of the way.
 *
 * The staging is a lit table, not a flat gradient: a warm pool of light from
 * above, a horizon where the paper meets the floor, and out-of-focus game covers
 * drifting at the back of the room. That depth is what lets the one thing in
 * focus read as a character rather than as a sticker on a colour, and it is the
 * difference between this and the flat pink-to-yellow wash it replaced.
 *
 *   0.00  the room, lights down, grain and vignette only
 *   0.25  the house lights come up, the covers drift into the back of shot
 *   0.60  Pikachu runs in from the left, still a silhouette
 *   1.10  the strike — flash, bolt, a ring of static, the zap, and he lands
 *   1.45  colour, the grit settles, the floor starts moving under him
 *   1.90  the wordmark, letter by letter, and the opening cry
 *   2.20  the rule, the tagline, and what is inside
 *   2.95  fade out, hand over to the app
 *
 * Everything is mounted from the first frame and revealed by opacity, so the
 * column never changes height mid-sequence: reserving the space up front is what
 * stops a splash from *jumping*, which is the single cheapest way to make one
 * look unfinished.
 *
 * There is no Skip button: this splash was asked for without one, and at 3.2 s
 * from a cold start it is short enough that dismissing it is not worth a
 * control. What replaces the skip button is the thing a skip button was really
 * for — the intro never appears again in the session, and it never appears at all
 * unless you arrived at the front page, so no deep link or room code ever waits
 * behind it. Anyone who has turned motion off gets a one-second static card.
 */
const BEATS = [
  { at: 0,    name: 'dark' },
  { at: 250,  name: 'pulse' },
  { at: 600,  name: 'silhouette' },
  { at: 1100, name: 'strike' },
  { at: 1450, name: 'reveal' },
  { at: 1900, name: 'title' },
  { at: 2200, name: 'signature' },
  { at: 2950, name: 'leaving' },
  { at: 3220, name: 'done' },
] as const;

const WORDMARK = 'PIKACHU';

/**
 * Six covers thrown right out of focus behind the mascot. They are the only claim
 * the splash makes about what is inside, and at 7px of blur they read as a shelf
 * of games in the back of the room rather than as six more things to look at.
 * Half of them are dropped on a phone, where they would crowd the headline.
 */
const BOKEH = [
  { src: '/art/game/chess.webp',      x: 11, y: 14, w: 92, r: -13, d: 0.00, both: true },
  { src: '/art/game/cards.webp',      x: 19, y: 57, w: 72, r: 9,   d: 0.90, both: false },
  { src: '/art/game/reversi.webp',    x: 85, y: 19, w: 84, r: 11,  d: 0.45, both: false },
  { src: '/art/game/battleship.webp', x: 82, y: 62, w: 76, r: -8,  d: 1.35, both: true },
  { src: '/art/game/gomoku.webp',     x: 4,  y: 37, w: 58, r: 17,  d: 0.60, both: false },
  { src: '/art/game/mancala.webp',    x: 93, y: 40, w: 54, r: -17, d: 0.20, both: false },
];

export default function Intro({ onDone }: { onDone: () => void }) {
  const { sfx, audioReady } = useStore();
  const [beat, setBeat] = useState<string>('dark');
  const timers = useRef<number[]>([]);
  const done = useRef(false);

  /* Idempotent: both natural ends (full sequence, and the reduced-motion card)
     funnel through here, and the unmount cleanup clears the same list, so a tab
     that is hidden mid-intro cannot fire onDone twice. */
  const finish = () => {
    if (done.current) return;
    done.current = true;
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setBeat('leaving');
    window.setTimeout(onDone, 260);
  };

  const reduce = typeof window !== 'undefined'
    && (window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'off');

  /* The light drifts toward the pointer so the room feels real.
     It is written straight onto the element as CSS custom properties inside a
     requestAnimationFrame, NOT held in React state: a re-render per mousemove
     during a three-second animation is exactly how a splash starts to feel cheap
     on a phone. One frame, one style write, zero renders. */
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (reduce) {
      setBeat('title');
      const t = window.setTimeout(finish, 1000);
      return () => clearTimeout(t);
    }
    for (const b of BEATS) {
      timers.current.push(window.setTimeout(() => {
        if (b.name === 'done') finish();
        else setBeat(b.name);
      }, b.at));
    }
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const el = stage.current;
        if (!el) return;
        el.style.setProperty('--gx', `${((e.clientX / window.innerWidth) * 100).toFixed(1)}%`);
        el.style.setProperty('--gy', `${((e.clientY / window.innerHeight) * 100).toFixed(1)}%`);
      });
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
    };
  }, [onDone, reduce]);

  /* The voice. `zap` is the strike; `boot` is the arcade's own opening cry.
     Browsers will not let Web Audio speak before a gesture, so on a cold load the
     cry is *asked for* here and replayed the instant the page is first touched —
     otherwise a visitor who watches without tapping never hears Pikachu at all,
     and one who taps after the title beat has already passed misses him too. */
  useEffect(() => {
    if (beat === 'strike') sfx('zap');
    if (beat === 'title') {
      if (audioReady) sfx('boot');
      else wantOpeningCry();
    }
  }, [beat, audioReady, sfx]);

  const show = (n: string) => {
    if (reduce) return true;
    return BEATS.findIndex((b) => b.name === beat) >= BEATS.findIndex((b) => b.name === n);
  };
  /** An inline animation that only exists once its beat has arrived. */
  const anim = (on: boolean, css: string) => (on && !reduce ? css : undefined);
  const leaving = beat === 'leaving';

  return (
    <div
      className={`fixed inset-0 z-[200] overflow-hidden select-none transition-opacity duration-300 ${leaving ? 'opacity-0' : 'opacity-100'}`}
      aria-label="Welcome to Pikachu"
    >
      {/* Screen readers get the same promise the app is about to make, instead of
          "the arcade is opening". It is also the only sentence a crawler that
          snapshots the intro (rather than waiting out its 3.7s) can read, so it
          states plainly what the site is rather than teasing it. */}
      <p className="sr-only">
        Welcome to Pikachu Arcade — twenty-six free browser games for one or two people, including chess,
        checkers, battleship, Wild Eights and a picture quiz. Open a private room, share the five-letter
        code, and play from anywhere. The arcade is opening.
      </p>

      {/* ------------------------------------------------------------- the room */}
      <div ref={stage} aria-hidden className={`absolute inset-0 intro-stage ${show('pulse') ? 'is-lit' : ''}`} />

      {/* the shelf of games, out of focus at the back of the room */}
      <div aria-hidden className="absolute inset-0 overflow-hidden">
        {BOKEH.map((b, i) => (
          <span
            key={b.src}
            className={`absolute ${b.both ? '' : 'hidden sm:block'}`}
            style={{ left: `${b.x}%`, top: `${b.y}%`, width: b.w, transform: `rotate(${b.r}deg)` }}
          >
            <img
              src={b.src}
              alt=""
              decoding="async"
              className="block w-full h-auto rounded-[18px]"
              style={{
                filter: 'blur(7px) saturate(.92) brightness(1.04)',
                boxShadow: '0 18px 34px -20px rgba(120,84,60,.55)',
                animation: anim(true, `inBokeh .9s ease-out ${b.d}s both, inDrift ${11 + i}s ease-in-out ${b.d}s infinite`),
              }}
            />
          </span>
        ))}
      </div>

      {/* vignette and house lights */}
      <div aria-hidden className="absolute inset-0 intro-vignette" />
      <div aria-hidden className="absolute inset-0" style={{
        background: 'radial-gradient(90% 80% at 50% 40%, #2f1e18, #1c1110 78%)',
        opacity: show('pulse') ? 0 : 0.62,
        transition: 'opacity .8s ease-out',
      }} />

      {/* ---------------------------------------------------------------- strike */}
      {!reduce && beat === 'strike' && (
        <div aria-hidden className="absolute inset-0 overflow-hidden">
          <div className="absolute inset-0" style={{ background: '#fff6e6', animation: 'inFlash .55s ease-out forwards' }} />
          <svg className="absolute left-1/2 top-[3%] h-[58%] -translate-x-1/2" viewBox="0 0 100 160" fill="none"
            style={{ animation: 'inBolt .7s steps(3) forwards' }}>
            <path d="M61 2 24 86h23l-9 72 41-90H57l13-66Z" fill="#ffd24d" stroke="#6b4b3e" strokeWidth="5" strokeLinejoin="round" />
          </svg>
        </div>
      )}

      {/* --------------------------------------------------------------- content
          Two rows, not one centred column: the sky above and the floor below meet
          exactly at the mascot's feet, so he is standing on the horizon instead of
          floating above it. The seam is derived from the text block's own height,
          so it holds at 360px and at 2560px without a breakpoint to tune. */}
      <div
        className="absolute inset-0 flex flex-col transition-transform duration-300"
        style={{ transform: leaving ? 'translateY(-14px) scale(.99)' : undefined }}
      >
        <div className="relative flex flex-1 items-end justify-center min-h-0">
          {/* a shockwave along the floor, thrown by the strike — centred on his
              feet, so it is anchored to the horizon at every viewport size */}
          {!reduce && beat === 'strike' && (
            <div aria-hidden className="absolute bottom-0 left-1/2 w-[220px] h-[220px] rounded-full pointer-events-none"
              style={{
                border: '3px solid #ffd24d', boxShadow: '0 0 26px rgba(255,210,77,.85)',
                animation: 'inRing .85s cubic-bezier(.2,.7,.3,1) forwards',
              }} />
          )}
          {/* --------------------------------------------------------- the run
              He sprints in from the left along the floor and skids to a stop on
              the horizon exactly as the wordmark lands.
              The raw clip is used rather than <PikachuMascot>: every mascot look
              adds a rotation and a breathing scale, and rotating pixel art puts its
              stair-stepped edges on a diagonal where they should be on the grid. */}
          <div
            className={`relative ${!reduce && show('reveal') ? 'is-moving' : ''}`}
            role="img"
            aria-label="Pikachu sprinting in, then running on the spot"
            style={{ opacity: show('silhouette') ? 1 : 0 }}
          >
            {/* the ground rushing under him, on the horizon line itself */}
            <span aria-hidden className="intro-ground" />
            {show('silhouette') && (
              <div
                className="relative"
                style={{
                  filter: show('reveal') ? 'none' : 'brightness(.32) saturate(.18)',
                  transition: 'filter .35s ease-out',
                  animation: anim(!reduce, 'inRun .92s cubic-bezier(.16,.74,.2,1) both'),
                  // only while it is actually animating: a permanent will-change
                  // keeps a compositor layer alive for the whole session
                  willChange: show('reveal') ? undefined : 'transform',
                }}
              >
                {/* No added bounce: the clip's own four frames already carry a ~6px
                    vertical shift at 110ms a frame, so a second bob on a different
                    period would beat against it and read as a stutter. */}
                <div>
                  <img
                    src="/art/pika/run.webp"
                    alt=""
                    width={300}
                    height={199}
                    draggable={false}
                    decoding="async"
                    fetchPriority="high"
                    /* the clip's legs are cut at the frame bottom, so the cut edge is
                       dropped a few px under the floor's own opaque top edge: the
                       horizon crops him, instead of a straight line through his shins */
                    className="pixelated block h-auto w-[clamp(196px,29vw,320px)] -mb-[6px]"
                  />
                </div>

                {/* grit thrown up behind his feet while he is still running in —
                    it travels with him, so the puff never detaches from the step */}
                {!reduce && !show('reveal') && (
                  <span aria-hidden className="absolute bottom-1 left-1 block">
                    {[0, 1, 2].map((i) => (
                      <span
                        key={i}
                        className="absolute block rounded-full"
                        style={{
                          width: 9 + i * 3, height: 7 + i * 2,
                          background: 'rgba(196,155,118,.55)',
                          animation: `inDust .52s linear ${i * 0.17}s infinite`,
                        }}
                      />
                    ))}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="relative flex flex-col items-center px-6 pt-2 pb-[clamp(34px,11vh,120px)] intro-floor">
          <h1
            className="wordmark flex leading-none text-[clamp(46px,14vw,104px)]"
            aria-label="PIKACHU"
            style={{ opacity: show('title') ? 1 : 0 }}
          >
            {WORDMARK.split('').map((ch, i) => (
              <span
                key={i}
                aria-hidden
                className="inline-block"
                style={{ animation: anim(show('title'), `inLetter .58s cubic-bezier(.2,.9,.25,1) ${i * 0.045}s both`) }}
              >
                {ch}
              </span>
            ))}
          </h1>

          {/* the rule under the wordmark draws outward from the middle */}
          <div aria-hidden className="mt-1 flex items-center gap-2" style={{ width: 'min(76%, 300px)', opacity: show('title') ? 1 : 0 }}>
            <span className="h-[3px] flex-1 rounded-full intro-rule" style={{ animation: anim(show('title'), 'inRule .5s cubic-bezier(.2,.9,.3,1) .1s both') }} />
            <svg width="15" height="17" viewBox="0 0 100 160" className="shrink-0" style={{ animation: anim(show('title'), 'inFade .45s ease-out .18s both') }}>
              <path d="M61 2 24 86h23l-9 72 41-90H57l13-66Z" fill="#ffd24d" stroke="#6b4b3e" strokeWidth="12" strokeLinejoin="round" />
            </svg>
            <span className="h-[3px] flex-1 rounded-full intro-rule" style={{ animation: anim(show('title'), 'inRule .5s cubic-bezier(.2,.9,.3,1) .1s both') }} />
          </div>

          <div className="mt-2.5 flex flex-col items-center gap-1.5" style={{ opacity: show('signature') ? 1 : 0 }}>
            <p className="eyebrow text-blush-600" style={{ animation: anim(show('signature'), 'inFade .5s ease-out .05s both') }}>
              A little arcade for two
            </p>
            <p className="text-[11.5px] font-bold text-cream-300 tabnum" style={{ animation: anim(show('signature'), 'inFade .5s ease-out .2s both') }}>
              26 games · one screen or two · no sign-up
            </p>
          </div>
        </div>
      </div>

      <style>{`
        .intro-stage {
          --gx: 50%; --gy: 30%;
          background:
            radial-gradient(58% 46% at var(--gx) var(--gy), rgba(255,255,255,.9), rgba(255,246,224,.5) 46%, transparent 74%),
            radial-gradient(120% 96% at 50% 8%, #fffaef 0%, #fff1dc 42%, #ffe6dd 74%, #ffdbe8 100%);
        }
        /* the light comes up a beat after the room does */
        .intro-stage::after {
          content: ""; position: absolute; inset: 0; pointer-events: none;
          background: radial-gradient(34% 30% at 50% 38%, rgba(255,255,255,.95), transparent 70%);
          opacity: 0; transition: opacity 700ms ease-out;
        }
        .intro-stage.is-lit::after { opacity: 1; }
        /* the floor is the bottom row's own background, so its top edge is exactly
           the horizon the character stands on — no second element to keep in sync */
        .intro-floor {
          background: linear-gradient(180deg, #ffeeda 0%, #ffe9d0 46%, #ffe0bf 100%);
          border-top: 1px solid rgba(190,146,110,.3);
          box-shadow: 0 -2px 0 rgba(255,252,244,.7), 0 26px 40px -30px rgba(140,94,70,.5) inset;
        }
        /* The ground moves, not the character.
           His clip has no idle, so a runner who arrives and keeps cycling on the
           spot has to be given somewhere to run. The ground streams backwards under
           him instead — the trick every side-scroller uses — which is what turns a
           four-frame loop into "he is running".
           It sits on the horizon line itself and fades out horizontally well before
           it reaches the wordmark: the first attempt ran the dashes across the whole
           floor and straight through the lettering, which read as damage. */
        .intro-ground {
          position: absolute; left: -170%; right: -170%; bottom: -1px; height: 5px;
          pointer-events: none; opacity: 0; transition: opacity .6s ease-out;
          border-radius: 99px;
          /* the dashes are the mask and the fade is the paint: one mask layer, so
             there is no mask-composite to be supported (or not) — on engines
             without it, two layers would union and run the dashes right through
             the wordmark */
          background: linear-gradient(90deg, transparent 32%, #b98a63 47%, #b98a63 53%, transparent 68%);
          -webkit-mask-image: repeating-linear-gradient(90deg, #000 0 22px, transparent 22px 56px);
          mask-image: repeating-linear-gradient(90deg, #000 0 22px, transparent 22px 56px);
        }
        .is-moving .intro-ground { opacity: .85; animation: inTreadmill .92s linear infinite; }
        .intro-vignette {
          background: radial-gradient(120% 104% at 50% 46%, transparent 48%, rgba(120,84,60,.16) 100%);
        }
        /* paper tooth: a dot screen at 6%, just enough that the flat gradients read
           as material instead of as CSS */
        .intro-vignette::after {
          content: ""; position: absolute; inset: 0;
          background-image: radial-gradient(rgba(120,84,60,.55) .5px, transparent .6px);
          background-size: 4px 4px; opacity: .06;
        }
        .intro-rule { background: linear-gradient(90deg, transparent, #f2b23c 22%, #ffd24d 50%, #f2b23c 78%, transparent); }

        @keyframes inBokeh { from { opacity: 0 } to { opacity: .62 } }
        @keyframes inDrift { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-10px) } }
        /* The run-in. He starts well off the left edge and decelerates into the
           mark, so the last third is a skid rather than a sudden stop; the body
           lean on the way in is what sells speed at this size. */
        @keyframes inRun {
          0%   { transform: translateX(-188%) skewX(-5deg) }
          58%  { transform: translateX(0) skewX(0deg) }
          70%  { transform: translateX(-3%) }
          84%  { transform: translateX(1.2%) }
          100% { transform: translateX(0) }
        }
        @keyframes inDust {
          0%   { transform: translate(0, 0) scale(.5); opacity: .55 }
          70%  { opacity: .3 }
          100% { transform: translate(-26px, -11px) scale(1.5); opacity: 0 }
        }
        /* the dashes are the mask, so the mask is what slides */
        @keyframes inTreadmill {
          from { -webkit-mask-position: 0 0; mask-position: 0 0 }
          to   { -webkit-mask-position: -56px 0; mask-position: -56px 0 }
        }
        @keyframes inLetter { from { transform: translateY(.42em) scale(.96); opacity: 0 } to { transform: none; opacity: 1 } }
        @keyframes inRule { from { transform: scaleX(.05); opacity: 0 } to { transform: none; opacity: 1 } }
        @keyframes inFade { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }
        @keyframes inFlash { 0% { opacity: 0 } 12% { opacity: .78 } 100% { opacity: 0 } }
        @keyframes inBolt {
          0% { opacity: 0; transform: translateX(-50%) scaleY(.62) }
          18% { opacity: 1 }
          42% { opacity: .25 }
          58% { opacity: .95 }
          100% { opacity: 0 }
        }
        @keyframes inRing {
          0% { opacity: .9; transform: translate(-50%,-50%) scale(.34) }
          100% { opacity: 0; transform: translate(-50%,-50%) scale(2.1) }
        }
      `}</style>
    </div>
  );
}
