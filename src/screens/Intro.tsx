import { useEffect, useRef, useState } from 'react';
import { PikachuMascot } from '../mascot';
import { useStore } from '../lib/store';

/**
 * The cold open.
 *
 * It runs once per session, so it has one job: make the first second feel like
 * something, then get out of the way. There is deliberately **no skip button** —
 * a skip button on a four-second splash is an admission that the splash is too
 * long. Instead the whole thing is built to be short enough to sit through:
 *
 *   0.00  paper, warm light, a slow vignette
 *   0.30  a hairline of electricity crosses the screen
 *   0.75  the mascot rises, still a silhouette
 *   1.35  the strike — flash, two bolts, the zap
 *   1.75  colour, and it lands
 *   2.25  the wordmark, one letter at a time
 *   2.60  the tagline, and three of the covers fan out to say what is inside
 *   3.45  fade out, hand over to the app
 *
 * Anyone who prefers reduced motion gets a single static card for 1.2 s and no
 * animation at all — and because nothing is clickable, that is the *only* thing
 * that changes for them.
 */
const BEATS = [
  { at: 0,    name: 'dark' },
  { at: 300,  name: 'pulse' },
  { at: 750,  name: 'silhouette' },
  { at: 1350, name: 'strike' },
  { at: 1750, name: 'reveal' },
  { at: 2250, name: 'title' },
  { at: 2600, name: 'signature' },
  { at: 3450, name: 'leaving' },
  { at: 3720, name: 'done' },
] as const;

const WORDMARK = 'PIKACHU';
const TILES = ['/art/game/chess.webp', '/art/game/reversi.webp', '/art/game/cards.webp'];

export default function Intro({ onDone }: { onDone: () => void }) {
  const { sfx, audioReady } = useStore();
  const [beat, setBeat] = useState<string>('dark');
  const timers = useRef<number[]>([]);
  const reduce = typeof window !== 'undefined'
    && (window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'off');

  /* The halo drifts toward the pointer so the light feels like it is in the room.
     It is written straight onto the element as CSS custom properties inside a
     requestAnimationFrame, NOT held in React state: a re-render per mousemove
     during a three-second animation is exactly how a splash starts to feel cheap
     on a phone. One frame, one style write, zero renders. */
  const backdrop = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (reduce) {
      setBeat('title');
      const t = window.setTimeout(onDone, 1200);
      return () => clearTimeout(t);
    }
    for (const b of BEATS) {
      timers.current.push(window.setTimeout(() => {
        if (b.name === 'done') onDone();
        else setBeat(b.name);
      }, b.at));
    }
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const el = backdrop.current;
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

  useEffect(() => {
    if (!audioReady) return;
    if (beat === 'strike') sfx('zap');
    if (beat === 'title') sfx('boot');
  }, [beat, audioReady, sfx]);

  const show = (n: string) => BEATS.findIndex((b) => b.name === beat) >= BEATS.findIndex((b) => b.name === n);
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
        Welcome to Pikachu Arcade — twenty free browser games for one or two people, including chess,
        checkers, battleship, Wild Eights and a picture quiz. Open a private room, share the five-letter
        code, and play from anywhere. The arcade is opening.
      </p>

      {/* warm paper, with the light following the pointer */}
      <div ref={backdrop} aria-hidden className="absolute inset-0 intro-glow" />
      <div aria-hidden className="absolute inset-0" style={{
        background: 'radial-gradient(120% 100% at 50% 50%, transparent 42%, rgba(90,63,52,.16) 100%)',
      }} />
      {/* a whisper of paper tooth, so the flat gradients read as material */}
      <div aria-hidden className="absolute inset-0 opacity-[.06]" style={{
        backgroundImage: 'radial-gradient(rgba(90,63,52,.9) .5px, transparent .6px)',
        backgroundSize: '4px 4px',
      }} />
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-[38%]" style={{
        background: 'linear-gradient(180deg, transparent, rgba(214,243,231,.7) 58%, rgba(188,234,212,.92) 100%)',
      }} />

      {/* travelling electric pulse */}
      {show('pulse') && (
        <div aria-hidden className="absolute inset-x-0 top-[46%] h-[2px] overflow-hidden">
          <div className="h-full w-[46%]"
            style={{
              background: 'linear-gradient(90deg, transparent, #ffc2d6 20%, #ffd24d 60%, transparent)',
              filter: 'drop-shadow(0 0 14px rgba(255,173,198,.85))',
              animation: 'introSweep 1.4s cubic-bezier(.45,0,.2,1) forwards',
            }} />
        </div>
      )}

      {/* the strike */}
      {beat === 'strike' && (
        <>
          <div aria-hidden className="absolute inset-0 bg-white" style={{ animation: 'pk-flash .6s ease-out forwards' }} />
          <svg aria-hidden className="absolute inset-0 w-full h-full" viewBox="0 0 1000 600" preserveAspectRatio="none">
            <path d="M300,120 a34,34 0 0 1 58,-24 34,34 0 0 1 58,24 c0,48 -58,86 -58,86 S300,168 300,120 Z"
              fill="#ffadc6" stroke="#f2779a" strokeWidth="4" strokeLinejoin="round"
              style={{ filter: 'drop-shadow(0 0 18px rgba(255,173,198,.9))', animation: 'introBolt .55s steps(2) forwards' }} />
            <path d="M620,170 a26,26 0 0 1 44,-18 26,26 0 0 1 44,18 c0,37 -44,66 -44,66 S620,207 620,170 Z"
              fill="#ffd24d" stroke="#e8a21c" strokeWidth="4" strokeLinejoin="round" opacity=".92"
              style={{ filter: 'drop-shadow(0 0 14px rgba(255,210,77,.9))', animation: 'introBolt .55s steps(2) .08s forwards' }} />
          </svg>
        </>
      )}

      {/* mascot: silhouette, then full colour and a landing */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-[58%]">
        {show('silhouette') && (
          <div style={{
            filter: show('reveal') ? 'none' : 'brightness(.32) saturate(.15) drop-shadow(0 10px 28px rgba(242,119,154,.45))',
            transition: 'filter .45s ease-out',
            animation: show('reveal') ? 'introLand .62s cubic-bezier(.2,.9,.3,1.4)' : 'introRise .7s cubic-bezier(.2,.8,.3,1)',
          }}>
            <PikachuMascot
              state={show('reveal') ? 'excited' : 'competitive'}
              size={Math.min(300, typeof window !== 'undefined' ? Math.min(window.innerWidth * 0.5, window.innerHeight * 0.36) : 300)}
            />
          </div>
        )}
        {/* the shadow it lands on, so it is standing on the floor rather than floating */}
        {show('reveal') && (
          <div aria-hidden className="mx-auto mt-1 h-[10px] w-[150px] rounded-full"
            style={{ background: 'radial-gradient(50% 50% at 50% 50%, rgba(90,63,52,.26), transparent 72%)', animation: 'introShadow .5s ease-out both' }} />
        )}
      </div>

      {/* wordmark, letter by letter */}
      {show('title') && (
        <div className="absolute inset-x-0 bottom-[19%] flex flex-col items-center gap-3 px-6">
          <h1 className="wordmark text-[clamp(44px,13vw,124px)] leading-none flex" aria-label="PIKACHU">
            {WORDMARK.split('').map((ch, i) => (
              <span key={i} aria-hidden style={{ animation: `introLetter .5s cubic-bezier(.2,.9,.3,1.3) ${i * 0.055}s both` }}>{ch}</span>
            ))}
          </h1>
          {show('signature') && (
            <div className="flex items-center gap-3" style={{ animation: 'introFade .5s ease-out both' }}>
              <span aria-hidden className="h-[3px] w-10 rounded-full bg-blush-300" />
              <p className="eyebrow text-blush-600">A little arcade for two</p>
              <span aria-hidden className="h-[3px] w-10 rounded-full bg-blush-300" />
            </div>
          )}
        </div>
      )}

      {/* three covers fan out — the only claim the splash makes about what is inside */}
      {show('signature') && (
        <div aria-hidden className="absolute inset-x-0 bottom-[7%] flex justify-center items-end gap-2.5">
          {TILES.map((src, i) => (
            <img key={src} src={src} alt="" loading="eager" decoding="async"
              className="w-[62px] h-[62px] sm:w-[74px] sm:h-[74px] rounded-2xl border-2 border-ink-600 shadow-[0_3px_0_0_rgba(90,63,52,.18)] object-cover"
              style={{
                transform: `rotate(${(i - 1) * 7}deg)`,
                animation: `introTile .55s cubic-bezier(.2,.9,.3,1.3) ${0.08 * i}s both`,
              }} />
          ))}
        </div>
      )}

      <style>{`
        .intro-glow {
          --gx: 50%; --gy: 22%;
          background: radial-gradient(90% 70% at var(--gx) var(--gy), #fffaf0 0%, #fff2dd 38%, #ffe3d9 72%, #ffd3e2 100%);
          transition: background 700ms ease-out;
        }
        @keyframes introSweep { from { transform: translateX(-120%) } to { transform: translateX(300%) } }
        @keyframes introRise { from { transform: translateY(46px) scale(.9); opacity: 0 } to { transform: none; opacity: 1 } }
        @keyframes introLand { 0% { transform: translateY(-26px) scale(1.07) } 60% { transform: translateY(6px) scale(.97,1.03) } 100% { transform: none } }
        @keyframes introShadow { from { transform: scale(.4); opacity: 0 } to { transform: none; opacity: 1 } }
        @keyframes introLetter { from { transform: translateY(28px) rotate(-6deg); opacity: 0 } to { transform: none; opacity: 1 } }
        @keyframes introFade { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }
        @keyframes introTile { from { opacity: 0; transform: translateY(22px) scale(.86) } to { opacity: 1 } }
        @keyframes introBolt { from { opacity: 0 } 40% { opacity: 1 } to { opacity: 0 } }
        @media (prefers-reduced-motion: reduce) {
          [style*="introLetter"], [style*="introFade"], [style*="introTile"], [style*="introRise"], [style*="introLand"] {
            animation: none !important;
          }
        }
      `}</style>
    </div>
  );
}
