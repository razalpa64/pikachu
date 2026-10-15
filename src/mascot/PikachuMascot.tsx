import { memo } from 'react';

/**
 * The mascot is real animation, not drawn shapes.
 *
 * Every clip here comes from the artwork that was handed to the project. They were
 * cropped to drop the source watermark, had their flat backgrounds knocked out so they
 * sit on the cream paper, and were re-encoded as animated WebP (768 KB for all eight,
 * down from 5.1 MB of GIF). `scripts/gifs.py` is the whole pipeline.
 *
 * Five of the clips are cut-outs and can float anywhere in the layout; three keep their
 * original scene and are shown framed, through <PikaScene/>.
 */

export type MascotState =
  | 'idle' | 'excited' | 'thinking' | 'competitive' | 'victory'
  | 'defeated' | 'waiting' | 'sleeping' | 'loading' | 'error';

export type SceneClip = 'gift' | 'crowd' | 'curious' | 'meadow' | 'goldenhour' | 'storm' | 'detective';

type Clip = 'shy' | 'hello' | 'run' | 'cap' | 'materialise';

/** natural sizes, so the browser reserves the box and nothing jumps while loading */
const CLIP: Record<Clip, { src: string; w: number; h: number; pixel: boolean }> = {
  shy:         { src: '/art/pika/shy.webp',         w: 300, h: 143, pixel: false },
  hello:       { src: '/art/pika/hello.webp',       w: 280, h: 148, pixel: false },
  run:         { src: '/art/pika/run.webp',         w: 300, h: 199, pixel: true  },
  cap:         { src: '/art/pika/cap.webp',         w: 250, h: 250, pixel: true  },
  materialise: { src: '/art/pika/materialise.webp', w: 230, h: 230, pixel: true  },
};

export const SCENE: Record<SceneClip, { src: string; w: number; h: number; alt: string }> = {
  gift:    { src: '/art/pika/gift.webp',    w: 420, h: 286, alt: 'Pikachu hugging a wrapped present' },
  crowd:   { src: '/art/pika/crowd.webp',   w: 440, h: 231, alt: 'A whole crowd of Pikachu cheering' },
  curious: { src: '/art/pika/curious.webp', w: 440, h: 234, alt: 'Pikachu looking right at you from the grass' },
  // painted stills rather than clips — same frame treatment, no animation
  meadow:     { src: '/art/pika/meadow.webp',     w: 520, h: 314, alt: 'Pikachu sitting in a sunlit meadow' },
  goldenhour: { src: '/art/pika/goldenhour.webp', w: 380, h: 477, alt: 'Pikachu in tall golden grass with its eyes happily shut' },
  storm:      { src: '/art/pika/storm.webp',      w: 400, h: 400, alt: 'Pikachu crackling with lightning' },
  /* The one deliberately dark clip in the set: a vignette rolls the cluttered
     source background down to black so it reads as a noir case-file photo. */
  detective:  { src: '/art/pika/detective.webp',  w: 300, h: 445, alt: 'Pikachu in a detective cap, raising a magnifying glass to his eye' },
};

type Look = {
  clip: Clip;
  anim: string;
  alt: string;
  tilt?: number;
  dim?: boolean;
  badge?: 'hearts' | 'zzz' | 'dots' | 'bang' | 'sweat' | 'spark';
};

const LOOK: Record<MascotState, Look> = {
  idle:        { clip: 'shy',         anim: 'a-float',     alt: 'Pikachu waiting happily' },
  excited:     { clip: 'hello',       anim: 'a-hop',       alt: 'Pikachu cheering with both arms up', badge: 'spark' },
  thinking:    { clip: 'cap',         anim: 'a-wobble',    alt: 'Pikachu thinking it over', badge: 'dots' },
  competitive: { clip: 'run',         anim: 'a-breathe',   alt: 'Pikachu charging in', tilt: -4 },
  victory:     { clip: 'hello',       anim: 'a-hop',       alt: 'Pikachu celebrating a win', badge: 'hearts' },
  defeated:    { clip: 'shy',         anim: 'a-breathe',   alt: 'Pikachu a bit deflated', tilt: 7, dim: true, badge: 'sweat' },
  waiting:     { clip: 'cap',         anim: 'a-float',     alt: 'Pikachu waiting for someone', badge: 'dots' },
  sleeping:    { clip: 'shy',         anim: '',            alt: 'Pikachu dozing off', dim: true, badge: 'zzz' },
  loading:     { clip: 'materialise', anim: '',            alt: 'Pikachu materialising' },
  error:       { clip: 'cap',         anim: 'a-shake',     alt: 'Pikachu looking worried', badge: 'bang' },
};

function Badge({ kind }: { kind: NonNullable<Look['badge']> }) {
  const base = 'absolute pointer-events-none select-none fx-heavy';
  if (kind === 'hearts')
    return (
      <span className={`${base} -top-1 -right-1`} aria-hidden>
        <span className="block text-[20px] leading-none a-heartbeat" style={{ color: '#f2779a' }}>♥</span>
        <span className="block text-[13px] leading-none a-float -mt-1 ml-3" style={{ color: '#ffadc6', animationDelay: '.4s' }}>♥</span>
      </span>
    );
  if (kind === 'zzz')
    return (
      <span className={`${base} -top-2 right-0 display text-[15px]`} style={{ color: '#a98a79' }} aria-hidden>
        <span className="a-float inline-block">z</span>
        <span className="a-float inline-block text-[12px]" style={{ animationDelay: '.5s' }}>z</span>
      </span>
    );
  if (kind === 'dots')
    return (
      <span className={`${base} -top-1 right-0 flex gap-[3px]`} aria-hidden>
        {[0, 1, 2].map((i) => (
          <span key={i} className="w-[5px] h-[5px] rounded-full"
            style={{ background: '#c9a888', animation: 'pk-pulse 1.3s ease-in-out infinite', animationDelay: `${i * 0.18}s` }} />
        ))}
      </span>
    );
  if (kind === 'bang')
    return (
      <span className={`${base} -top-2 -right-1 display text-[22px]`} style={{ color: '#ef6a7f' }} aria-hidden>!</span>
    );
  if (kind === 'sweat')
    // drawn, not an emoji: a colour-font glyph would render differently on every
    // platform and sit outside the palette, which is the whole reason the
    // mascot is real artwork in the first place
    return (
      <span className={`${base} top-0.5 right-1 a-float`} aria-hidden>
        <svg width="11" height="15" viewBox="0 0 11 15" fill="none">
          <path d="M5.5 0.6C5.5 0.6 10.4 7.0 10.4 10.0a4.9 4.9 0 1 1-9.8 0C0.6 7.0 5.5 0.6 5.5 0.6Z"
            fill="#a8d8f5" stroke="#6fa8cf" strokeWidth="1.1" strokeLinejoin="round" />
          <ellipse cx="4" cy="10.2" rx="1.3" ry="1.9" fill="#ffffff" opacity=".75" />
        </svg>
      </span>
    );
  return (
    <span className={`${base} -top-1 -right-1 text-[16px]`} style={{ color: '#ffd24d', animation: 'pk-spark-spin 3.4s linear infinite' }} aria-hidden>✦</span>
  );
}

export interface MascotProps {
  state?: MascotState;
  /** width of the box in px; the clip is scaled to fit inside it */
  size?: number;
  label?: string;
  flip?: boolean;
  className?: string;
  /** set on the one mascot that is visible at first paint */
  priority?: boolean;
  /** draw the soft contact shadow underneath */
  shadow?: boolean;
}

function PikachuMascotBase({
  state = 'idle', size = 120, label, flip = false,
  className = '', priority = false, shadow = true,
}: MascotProps) {
  const look = LOOK[state];
  const clip = CLIP[look.clip];
  const w = size;
  const h = Math.round((clip.h / clip.w) * size);

  return (
    <div
      className={`relative inline-block shrink-0 ${className}`}
      style={{ width: w, height: h + (shadow ? 10 : 0) }}
      role="img"
      aria-label={label ?? look.alt}
    >
      {shadow && (
        <span
          aria-hidden
          className="absolute left-1/2 -translate-x-1/2 rounded-[50%] fx-heavy"
          style={{
            bottom: 0, width: w * 0.62, height: Math.max(6, h * 0.075),
            background: 'radial-gradient(closest-side, rgba(150,106,78,.34), transparent)',
          }}
        />
      )}
      <div
        className={look.anim}
        style={{
          width: w, height: h,
          transform: `${flip ? 'scaleX(-1) ' : ''}${look.tilt ? `rotate(${look.tilt}deg)` : ''}`,
          transformOrigin: '50% 85%',
        }}
      >
        <img
          src={clip.src}
          width={clip.w}
          height={clip.h}
          alt=""
          aria-hidden
          draggable={false}
          decoding="async"
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : undefined}
          className={clip.pixel ? 'pixelated' : ''}
          style={{
            width: '100%', height: '100%', objectFit: 'contain',
            filter: look.dim ? 'saturate(.72) brightness(.96)' : undefined,
          }}
        />
      </div>
      {look.badge && <Badge kind={look.badge} />}
    </div>
  );
}

export const PikachuMascot = memo(PikachuMascotBase);

/**
 * The three clips that keep their own background, shown as a framed little photo —
 * which is also the honest way to present them: they are scenes, not cut-outs.
 */
export const PikaScene = memo(function PikaScene({
  clip, className = '', rounded = 22, priority = false, tilt = 0,
}: { clip: SceneClip; className?: string; rounded?: number; priority?: boolean; tilt?: number }) {
  const s = SCENE[clip];
  return (
    <span
      className={`relative block p-[7px] bg-ink-800 border-[2.5px] border-ink-400 ${className}`}
      style={{
        borderRadius: rounded + 7,
        transform: tilt ? `rotate(${tilt}deg)` : undefined,
        boxShadow: '0 6px 0 rgba(140,94,70,.16), 0 14px 28px -16px rgba(140,94,70,.5)',
      }}
    >
      <span className="relative block overflow-hidden" style={{ borderRadius: rounded }}>
        <img
          src={s.src} width={s.w} height={s.h} alt={s.alt}
          draggable={false} decoding="async"
          loading={priority ? 'eager' : 'lazy'}
          className="block w-full h-full object-cover"
          /* the source clips are saturated anime stills; warm them down so they
             sit on cream paper instead of fighting it */
          style={{ filter: 'saturate(0.82) contrast(0.95) brightness(1.03) sepia(0.14)' }}
        />
        {/* warm wash + soft inner vignette, so the rectangle stops shouting */}
        <span
          aria-hidden
          className="absolute inset-0 pointer-events-none mix-blend-multiply"
          style={{ background: 'linear-gradient(150deg, rgba(255,217,90,.20), rgba(255,173,198,.18) 55%, rgba(255,246,230,.10))' }}
        />
        <span
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          style={{ boxShadow: 'inset 0 0 22px 10px rgba(255,248,236,.45), inset 0 0 0 1.5px rgba(255,255,255,.55)' }}
        />
      </span>
      {/* a little taped corner — it reads as something kept, not something embedded */}
      <span
        aria-hidden
        className="absolute -top-2 -right-2 w-7 h-7 rotate-12 rounded-[6px] border-2 border-ink-400"
        style={{ background: 'repeating-linear-gradient(45deg,#ffd95a 0 5px,#ffcf3d 5px 10px)' }}
      />
    </span>
  );
});

export default PikachuMascot;
