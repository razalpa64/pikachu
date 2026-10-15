import { useEffect, useRef, useState } from 'react';
import { PikachuMascot } from '../mascot';
import { useStore } from '../lib/store';

/**
 * Cinematic cold open: dark arena → pulse → silhouette → lightning → entrance → wordmark.
 * Short (≈4.4 s), skippable at any time, and reduced to a single static title card
 * for anyone who prefers reduced motion.
 */
const BEATS = [
  { at: 0,    name: 'dark' },
  { at: 420,  name: 'pulse' },
  { at: 1150, name: 'silhouette' },
  { at: 1850, name: 'strike' },
  { at: 2350, name: 'reveal' },
  { at: 3150, name: 'title' },
  { at: 4400, name: 'done' },
] as const;

export default function Intro({ onDone }: { onDone: () => void }) {
  const { sfx, audioReady } = useStore();
  const [beat, setBeat] = useState<string>('dark');
  const timers = useRef<number[]>([]);
  const reduce = typeof window !== 'undefined'
    && (window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'off');

  useEffect(() => {
    if (reduce) { setBeat('title'); const t = window.setTimeout(onDone, 1400); return () => clearTimeout(t); }
    for (const b of BEATS) {
      timers.current.push(window.setTimeout(() => {
        if (b.name === 'done') onDone();
        else setBeat(b.name);
      }, b.at));
    }
    return () => { timers.current.forEach(clearTimeout); timers.current = []; };
  }, [onDone, reduce]);

  useEffect(() => {
    if (!audioReady) return;
    if (beat === 'strike') sfx('zap');
    if (beat === 'title') sfx('boot');
  }, [beat, audioReady, sfx]);

  const skip = () => { timers.current.forEach(clearTimeout); onDone(); };

  const show = (n: string) => BEATS.findIndex((b) => b.name === beat) >= BEATS.findIndex((b) => b.name === n);

  return (
    <div className="fixed inset-0 z-[200] bg-ink-900 overflow-hidden select-none" onClick={skip} role="button" tabIndex={0}
      aria-label="Intro sequence. Activate to skip." onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') skip(); }}>

      {/* arena floor */}
      <div className="absolute inset-0" style={{
        background: 'radial-gradient(120% 90% at 50% 18%, #fff6e2 0%, #ffe9d6 45%, #ffd9e4 100%)',
      }} />
      <div className="absolute inset-x-0 bottom-0 h-[42%]" style={{
        background: 'linear-gradient(180deg, transparent, rgba(214,243,231,.85) 55%, rgba(190,235,214,.95) 100%)',
      }} />

      {/* travelling electric pulse */}
      {show('pulse') && (
        <div className="absolute inset-x-0 top-1/2 h-[2px] overflow-hidden" aria-hidden>
          <div className="h-full w-[55%] bg-gradient-to-r from-transparent via-blush-300 to-transparent"
            style={{ animation: 'introSweep 1.25s cubic-bezier(.5,0,.2,1) forwards', filter: 'drop-shadow(0 0 12px #ffadc6)' }} />
        </div>
      )}

      {/* lightning flash */}
      {beat === 'strike' && (
        <>
          <div className="absolute inset-0 bg-white" style={{ animation: 'pk-flash .55s ease-out forwards' }} />
          <svg className="absolute inset-0 w-full h-full" viewBox="0 0 1000 600" preserveAspectRatio="none" aria-hidden>
            <path d="M300,120 a34,34 0 0 1 58,-24 34,34 0 0 1 58,24 c0,48 -58,86 -58,86 S300,168 300,120 Z"
              fill="#ffadc6" stroke="#f2779a" strokeWidth="4" strokeLinejoin="round"
              style={{ filter: 'drop-shadow(0 0 18px rgba(255,173,198,.9))', animation: 'introBolt .5s steps(2) forwards' }} />
            <path d="M620,170 a26,26 0 0 1 44,-18 26,26 0 0 1 44,18 c0,37 -44,66 -44,66 S620,207 620,170 Z"
              fill="#ffd24d" stroke="#e8a21c" strokeWidth="4" strokeLinejoin="round" opacity=".92"
              style={{ filter: 'drop-shadow(0 0 14px rgba(255,210,77,.9))', animation: 'introBolt .5s steps(2) .08s forwards' }} />
          </svg>
        </>
      )}

      {/* mascot: silhouette then full reveal */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-[58%]">
        {show('silhouette') && (
          <div style={{
            filter: show('reveal') ? 'none' : 'brightness(.35) saturate(.2) drop-shadow(0 10px 28px rgba(242,119,154,.45))',
            transition: 'filter .45s ease-out',
            animation: show('reveal') ? 'introLand .6s cubic-bezier(.2,.9,.3,1.4)' : 'introRise .7s cubic-bezier(.2,.8,.3,1)',
          }}>
            <PikachuMascot state={show('reveal') ? 'excited' : 'competitive'} size={Math.min(300, typeof window !== 'undefined' ? window.innerWidth * 0.55 : 300)} />
          </div>
        )}
      </div>

      {/* wordmark */}
      {show('title') && (
        <div className="absolute inset-x-0 bottom-[14%] flex flex-col items-center gap-3 px-6" style={{ animation: 'introTitle .7s cubic-bezier(.2,.9,.3,1.3) both' }}>
          <h1 className="wordmark text-[clamp(44px,13vw,128px)] leading-none">PIKACHU</h1>
          <div className="flex items-center gap-3">
            <span className="h-[3px] w-10 rounded-full bg-blush-300" />
            <p className="eyebrow text-blush-600">A little arcade for two</p>
            <span className="h-[3px] w-10 rounded-full bg-blush-300" />
          </div>
        </div>
      )}

      <button onClick={skip}
        className="absolute bottom-5 right-5 text-[11px] uppercase tracking-[.2em] font-extrabold text-cream-300 hover:text-blush-600 px-4 py-2 border-2 border-ink-500 rounded-full bg-white/80">
        Skip intro
      </button>

      <style>{`
        @keyframes introSweep { from { transform: translateX(-100%) } to { transform: translateX(260%) } }
        @keyframes introRise { from { transform: translateY(42px) scale(.9); opacity: 0 } to { transform: none; opacity: 1 } }
        @keyframes introLand { 0% { transform: translateY(-26px) scale(1.07) } 60% { transform: translateY(6px) scale(.97,1.03) } 100% { transform: none } }
        @keyframes introTitle { from { transform: translateY(26px) scale(.94); opacity: 0; letter-spacing: .4em } to { transform: none; opacity: 1 } }
        @keyframes introBolt { from { opacity: 0 } 40% { opacity: 1 } to { opacity: 0 } }
      `}</style>
    </div>
  );
}
