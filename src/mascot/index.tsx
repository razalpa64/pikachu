import { memo, useEffect, useRef, useState } from 'react';
import PikachuMascot, { PikaScene, type MascotState, type SceneClip } from './PikachuMascot';

export { PikachuMascot, PikaScene };
export type { MascotState, SceneClip };

/* ------------------------------------------------------------------ loader */
export const ElectricLoader = memo(function ElectricLoader({
  status = 'Charging the arena',
  detail,
  progress,
  size = 180,
  compact = false,
}: { status?: string; detail?: string; progress?: number | null; size?: number; compact?: boolean }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-4 ${compact ? 'py-6' : 'py-14'}`}>
      <PikachuMascot state="loading" size={size} />
      <div className="text-center">
        <p className="display text-cream-100" style={{ fontSize: compact ? 16 : 21 }}>{status}</p>
        {detail && <p className="text-[12.5px] text-cream-500 mt-1.5 max-w-[32ch]">{detail}</p>}
      </div>
      {/* honest indicator: determinate bar only when progress is measurable */}
      {typeof progress === 'number' ? (
        <div className="w-56 h-[10px] rounded-full bg-blush-100 border-2 border-ink-500 overflow-hidden" role="progressbar"
          aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-gradient-to-r from-volt-400 to-blush-300 transition-[width] duration-200"
            style={{ width: `${Math.max(2, Math.min(100, progress * 100))}%` }} />
        </div>
      ) : (
        <div className="w-56 h-[10px] rounded-full bg-blush-100 border-2 border-ink-500 overflow-hidden relative" role="status" aria-label={status}>
          <div className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-blush-300 to-transparent shimmer" />
        </div>
      )}
    </div>
  );
});

/* ------------------------------------------------------------------ reaction bubble */
const LINES: Record<MascotState, string[]> = {
  idle: ['Ready when you are.', 'Pick something sweet.', 'I saved you a seat.'],
  excited: ['Yayyy, let’s play!', 'This is my favourite part.', 'Pika pika!'],
  thinking: ['Hmm… let me think.', 'Working it out…', 'One tiny second.'],
  competitive: ['Okay, I’m trying now!', 'No going easy this time.', 'Here I come!'],
  victory: ['We did it!', 'That was lovely.', 'One more for luck?'],
  defeated: ['So close. Again?', 'The next one is ours.', 'Aw. Cuddle and retry?'],
  waiting: ['Waiting for your favourite person…', 'Send them the code!', 'Any second now.'],
  sleeping: ['Zzz… nudge me.', 'Just a little nap.', 'Wake me for the rematch.'],
  loading: ['Getting things ready…', 'Almost there.', 'Fluffing the cushions.'],
  error: ['Something went wrong.', 'That didn’t connect.', 'Let’s try that again.'],
};

export const PikachuReaction = memo(function PikachuReaction({
  state, line, size = 130, side = 'right', className = '',
}: { state: MascotState; line?: string; size?: number; side?: 'left' | 'right'; className?: string }) {
  const [text, setText] = useState(line ?? LINES[state][0]);
  useEffect(() => {
    setText(line ?? LINES[state][Math.floor(Math.random() * LINES[state].length)]);
  }, [state, line]);
  return (
    <div className={`flex items-end gap-2.5 ${side === 'left' ? 'flex-row' : 'flex-row-reverse'} ${className}`}>
      <PikachuMascot state={state} size={size} flip={side === 'right'} />
      <div className={`relative panel px-4 py-2.5 max-w-[24ch] a-pop ${side === 'left' ? '' : 'text-right'}`}
        style={{ borderRadius: 18 }}>
        <p className="text-[13.5px] leading-snug text-cream-100 font-bold">{text}</p>
        <span aria-hidden className="absolute bottom-2.5 w-3 h-3 rotate-45 bg-ink-800 border-ink-500"
          style={{
            [side === 'left' ? 'left' : 'right']: -8,
            borderLeftWidth: side === 'left' ? 2 : 0, borderBottomWidth: 2,
            borderRightWidth: side === 'left' ? 0 : 2, borderTopWidth: 0,
          } as React.CSSProperties} />
      </div>
    </div>
  );
});

/* ------------------------------------------------------------------ bolt divider / sparkline */
export function BoltRule({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 ${className}`} aria-hidden>
      <div className="flex-1 bolt-divider" />
      <svg width="18" height="16" viewBox="0 0 18 16" className="shrink-0">
        <path d="M9 15S1 10.2 1 5.6A4.2 4.2 0 0 1 9 3.4 4.2 4.2 0 0 1 17 5.6C17 10.2 9 15 9 15Z"
          fill="#ffadc6" stroke="#d9456f" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
      <div className="flex-1 bolt-divider" />
    </div>
  );
}

/* ------------------------------------------------------------------ confetti burst (cheap, bounded) */
export function ConfettiBurst({ count = 46, active = true }: { count?: number; active?: boolean }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (!active) return;
    const canvas = ref.current;
    if (!canvas) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      || document.documentElement.dataset.motion === 'off';
    if (reduce) return;
    const quality = document.documentElement.dataset.quality;
    const n = quality === 'performance' ? Math.min(14, count) : quality === 'balanced' ? Math.min(28, count) : count;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => {
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
    };
    resize();
    const colours = ['#FFD24D', '#FFADC6', '#F2779A', '#8FDCBB', '#FFE27A', '#8EC8F6', '#FFFFFF'];
    const parts = Array.from({ length: n }, () => ({
      x: canvas.width * (0.3 + Math.random() * 0.4),
      y: canvas.height * (0.35 + Math.random() * 0.2),
      vx: (Math.random() - 0.5) * 9 * dpr,
      vy: (-6 - Math.random() * 7) * dpr,
      r: (3 + Math.random() * 4) * dpr,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      c: colours[Math.floor(Math.random() * colours.length)],
      heart: Math.random() < 0.45,
      life: 1,
    }));
    let raf = 0;
    let stopped = false;
    const tick = () => {
      if (stopped) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      let alive = 0;
      for (const p of parts) {
        p.vy += 0.34 * dpr;
        p.vx *= 0.995;
        p.x += p.vx; p.y += p.vy; p.rot += p.vr;
        p.life -= 0.0085;
        if (p.life <= 0 || p.y > canvas.height + 40) continue;
        alive++;
        ctx.save();
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.c;
        if (p.heart) {
          const s2 = p.r * 0.95;
          ctx.beginPath();
          ctx.moveTo(0, s2 * 0.9);
          ctx.bezierCurveTo(-s2 * 1.5, -s2 * 0.2, -s2 * 0.6, -s2 * 1.3, 0, -s2 * 0.45);
          ctx.bezierCurveTo(s2 * 0.6, -s2 * 1.3, s2 * 1.5, -s2 * 0.2, 0, s2 * 0.9);
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.arc(0, 0, p.r * 0.85, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
      if (alive > 0) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const onVis = () => { if (document.hidden) { stopped = true; cancelAnimationFrame(raf); } };
    document.addEventListener('visibilitychange', onVis);
    return () => { stopped = true; cancelAnimationFrame(raf); document.removeEventListener('visibilitychange', onVis); };
  }, [active, count]);
  return <canvas ref={ref} className="pointer-events-none absolute inset-0 w-full h-full fx-heavy" aria-hidden />;
}
