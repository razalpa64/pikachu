import {
  forwardRef, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode,
} from 'react';
import { useStore } from '../lib/store';
import { PikachuMascot, type MascotState } from '../mascot';

/* ------------------------------------------------------------------ button */
type Variant = 'primary' | 'ghost' | 'blue' | 'danger' | 'default';
interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant; size?: 'sm' | 'md' | 'lg'; icon?: ReactNode; cue?: 'click' | 'select' | 'back' | 'toggle';
}
export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button(
  { variant = 'default', size = 'md', icon, children, className = '', cue = 'click', onClick, onPointerEnter, ...rest }, ref,
) {
  const { sfx } = useStore();
  const v = variant === 'default' ? '' : `btn-${variant}`;
  const s = size === 'sm' ? 'btn-sm' : size === 'lg' ? 'btn-lg' : '';
  return (
    <button ref={ref} className={`btn ${v} ${s} no-tap ${className}`}
      onPointerEnter={(e) => { if (!rest.disabled) sfx('hover'); onPointerEnter?.(e); }}
      onClick={(e) => { sfx(cue); onClick?.(e); }} {...rest}>
      {icon}{children}
    </button>
  );
});

/* ------------------------------------------------------------------ icons (inline, no network) */
export const Icon = ({ name, size = 18, className = '' }: { name: string; size?: number; className?: string }) => {
  const p: Record<string, ReactNode> = {
    home: <path d="M3 10.6 12 3l9 7.6V21a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z" />,
    grid: <><rect x="3" y="3" width="7.5" height="7.5" rx="1.4" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.4" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.4" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.4" /></>,
    users: <><circle cx="9" cy="8" r="3.4" /><circle cx="17" cy="9.5" r="2.6" /><path d="M2.5 20c0-3.6 2.9-5.6 6.5-5.6s6.5 2 6.5 5.6z" /><path d="M16.5 14.6c3 .3 5 2.2 5 5.4h-4.2" /></>,
    user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7z" /></>,
    bolt: <path d="M13 2 4 14h6l-1 8 9-12h-6z" />,
    trophy: <><path d="M7 4h10v5a5 5 0 0 1-10 0z" /><path d="M7 5H4v2a3 3 0 0 0 3 3M17 5h3v2a3 3 0 0 1-3 3" /><path d="M10 14h4v3h-4zM8 20h8v2H8z" /></>,
    target: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.6" /><circle cx="12" cy="12" r="1.3" /></>,
    gear: <><circle cx="12" cy="12" r="3.2" /><path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1M18.7 18.7l-2.1-2.1M7.4 7.4 5.3 5.3" /></>,
    search: <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 5 5" /></>,
    star: <path d="m12 3 2.7 5.8 6.3.8-4.6 4.4 1.2 6.3L12 17.3 6.4 20.3l1.2-6.3L3 9.6l6.3-.8z" />,
    play: <path d="M7 4.5 19.5 12 7 19.5z" />,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    link: <><path d="M10.5 13.5a4 4 0 0 0 5.7 0l2.8-2.8a4 4 0 1 0-5.7-5.7l-1.3 1.3" /><path d="M13.5 10.5a4 4 0 0 0-5.7 0L5 13.3a4 4 0 1 0 5.7 5.7l1.3-1.3" /></>,
    copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" /></>,
    check: <path d="m4 12.5 5.2 5.2L20 7" />,
    x: <path d="M6 6l12 12M18 6 6 18" />,
    back: <path d="M15 5l-7 7 7 7" />,
    flag: <><path d="M5 21V4M5 4h11l-2 4 2 4H5" /></>,
    hand: <path d="M7 12V5.5a1.5 1.5 0 0 1 3 0V11m0-5.5a1.5 1.5 0 0 1 3 0V11m0-4a1.5 1.5 0 0 1 3 0v6c0 4-2.5 7-6.5 7S7 18 7 14v-2" />,
    undo: <><path d="M4 9h10a5 5 0 0 1 0 10h-3" /><path d="m4 9 4-4M4 9l4 4" /></>,
    rotate: <><path d="M20 12a8 8 0 1 1-2.6-5.9" /><path d="M20 4v5h-5" /></>,
    volume: <><path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z" /><path d="M16 9a4.5 4.5 0 0 1 0 6M18.6 6.4a8 8 0 0 1 0 11.2" /></>,
    mute: <><path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z" /><path d="m16.5 9.5 5 5M21.5 9.5l-5 5" /></>,
    clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5.4l3.4 2" /></>,
    brain: <path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5.3A3 3 0 0 0 6 17a3 3 0 0 0 3 3h1V4zM15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5.3A3 3 0 0 1 18 17a3 3 0 0 1-3 3h-1V4z" />,
    sword: <><path d="M14.5 3H21v6.5L10 20.5l-6.5-6.5z" /><path d="m5 19-2 2M7.5 13.5 14 7" /></>,
    menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
    wifi: <><path d="M2.5 9a15 15 0 0 1 19 0M5.5 12.6a10.5 10.5 0 0 1 13 0M8.8 16.3a5.5 5.5 0 0 1 6.4 0" /><circle cx="12" cy="20" r="1.2" /></>,
    sparkle: <path d="M12 3l1.8 5.4L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.6z" />,
    shield: <path d="M12 3 20 6v6c0 5-3.4 8.2-8 9.5C7.4 20.2 4 17 4 12V6z" />,
    moon: <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z" />,
    pause: <><path d="M8.5 4.5v15M15.5 4.5v15" /></>,
    chat: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
    send: <><path d="m22 2-7 20-4-9-9-4z" /><path d="M22 2 11 13" /></>,
    pen: <><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /><path d="m15 5 4 4" /></>,
    eraser: <><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" /><path d="M22 21H7" /><path d="m5 11 9 9" /></>,
    'chevron-up': <path d="m5 15 7-7 7 7" />,
    'chevron-down': <path d="m5 9 7 7 7-7" />,
    'chevron-left': <path d="m15 5-7 7 7 7" />,
    'chevron-right': <path d="m9 5 7 7-7 7" />,
    spark: <><path d="M12 3.2 13.7 9l5.8 1.7-5.8 1.7L12 18.2l-1.7-5.8L4.5 10.7 10.3 9z" /><path d="M18.6 3.4 19.4 6l2.6.8-2.6.8-.8 2.6-.8-2.6L15.2 6.8 17.8 6z" /></>,
    book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15H6.5A2.5 2.5 0 0 0 4 20.5z" /><path d="M19 18v3H6.5A2.5 2.5 0 0 1 4 18.5" /></>,
    coffee: <><path d="M4 8.5h11.5v5.8a4.2 4.2 0 0 1-4.2 4.2H8.2A4.2 4.2 0 0 1 4 14.3z" /><path d="M15.5 10h1.6a2.4 2.4 0 0 1 0 4.8h-1.6" /><path d="M7.2 2.4c-.9.9-.9 1.7 0 2.6M11 2.4c-.9.9-.9 1.7 0 2.6" /><path d="M3 21.5h14" /></>,
    external: <><path d="M14.5 4H20v5.5" /><path d="M20 4 11 13" /><path d="M18 14.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4.5" /></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {p[name] ?? p.bolt}
    </svg>
  );
};

/* ------------------------------------------------------------------ panel */
export function Panel({ children, className = '', notch = true, as: As = 'div', ...rest }: any) {
  return <As className={`panel ${notch ? 'panel-notch' : ''} ${className}`} {...rest}>{children}</As>;
}

/* `id` belongs on the heading, not on the grid below it: sections are
   aria-labelledby their title, and pointing that at a wrapper made a screen
   reader announce every card in the grid as the section's name. */
export function SectionTitle({ eyebrow, title, action, id }: { eyebrow?: string; title: string; action?: ReactNode; id?: string }) {
  return (
    <div className="flex items-end justify-between gap-4 mb-3.5">
      <div>
        {eyebrow && <p className="eyebrow mb-1">{eyebrow}</p>}
        <h2 id={id} className="display text-[22px] sm:text-[26px] text-cream-100">{title}</h2>
      </div>
      {action}
    </div>
  );
}

/* ------------------------------------------------------------------ dialog */
export function ConfirmDialog({
  open, title, body, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger, onConfirm, onCancel,
}: { open: boolean; title: string; body?: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean; onConfirm: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const focusables = () => Array.from(node?.querySelectorAll<HTMLElement>('button, [href], input, select, [tabindex]:not([tabindex="-1"])') ?? []);
    focusables()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
      if (e.key === 'Tab') {
        const f = focusables();
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); prev?.focus(); };
  }, [open, onCancel]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] grid place-items-center p-4 blur-heavy backdrop-blur-[3px]" style={{ background: "rgba(92, 64, 53, .38)" }} onClick={onCancel}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId}
        className="panel panel-notch w-full max-w-[420px] p-6 a-pop" onClick={(e) => e.stopPropagation()}>
        <div className="flex gap-3 items-start">
          <PikachuMascot state={danger ? 'thinking' : 'waiting'} size={74} />
          <div className="flex-1 min-w-0">
            <h3 id={titleId} className="display text-[19px] text-cream-100">{title}</h3>
            {body && <p className="text-[13px] text-cream-500 mt-1.5 leading-relaxed">{body}</p>}
          </div>
        </div>
        <div className="flex gap-2.5 justify-end mt-5">
          <Button variant="ghost" size="sm" onClick={onCancel} cue="back">{cancelLabel}</Button>
          <Button variant={danger ? 'danger' : 'primary'} size="sm" onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ states */
export function EmptyState({ title, body, action, mascot = 'waiting' }: { title: string; body?: string; action?: ReactNode; mascot?: MascotState }) {
  return (
    <div className="flex flex-col items-center text-center gap-3 py-12 px-6">
      <PikachuMascot state={mascot} size={150} />
      <h3 className="display text-[19px] text-cream-100">{title}</h3>
      {body && <p className="text-[13.5px] text-cream-500 max-w-[42ch] leading-relaxed">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ title, body, recovery, onRetry, retryLabel = 'Try again' }: { title: string; body?: string; recovery?: string; onRetry?: () => void; retryLabel?: string }) {
  return (
    <div className="flex flex-col items-center text-center gap-3 py-10 px-6" role="alert">
      <PikachuMascot state="error" size={150} />
      <h3 className="display text-[19px] text-ember-600">{title}</h3>
      {body && <p className="text-[13.5px] text-cream-300 max-w-[44ch] leading-relaxed">{body}</p>}
      {recovery && <p className="text-[12.5px] text-cream-500 max-w-[44ch]">{recovery}</p>}
      {onRetry && <Button variant="primary" size="sm" className="mt-2" onClick={onRetry} icon={<Icon name="rotate" size={15} />}>{retryLabel}</Button>}
    </div>
  );
}

/* ------------------------------------------------------------------ connection pill */
export function ConnectionIndicator({ state, rtt }: { state: string; rtt: number | null }) {
  const map: Record<string, { c: string; t: string }> = {
    online: { c: 'bg-leaf-400', t: 'Connected' },
    connecting: { c: 'bg-volt-400', t: 'Connecting' },
    reconnecting: { c: 'bg-volt-400', t: 'Reconnecting' },
    offline: { c: 'bg-ember-400', t: 'Offline' },
    idle: { c: 'bg-cream-500', t: 'Idle' },
  };
  const m = map[state] ?? map.idle;
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-bold tracking-wide uppercase text-cream-300 bg-white/70 border-2 border-ink-500 rounded-full px-2.5 py-1" title={`Relay ${m.t}${rtt != null ? ` · ${rtt} ms` : ''}`}>
      <span className={`w-2 h-2 rounded-full ${m.c} ${state === 'reconnecting' || state === 'connecting' ? 'animate-pulse' : ''}`} />
      {m.t}{rtt != null && state === 'online' && <span className="text-cream-500 tabnum">{rtt}ms</span>}
    </span>
  );
}

/* ------------------------------------------------------------------ toasts */
export function ToastStack() {
  const { toasts, dismiss } = useStore();
  if (!toasts.length) return null;
  return (
    <div className="fixed z-[100] bottom-4 right-4 left-4 sm:left-auto sm:w-[340px] flex flex-col gap-2 safe-b pointer-events-none" role="region" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id}
          className={`panel p-3 pr-9 flex gap-2.5 items-start a-slide-up relative pointer-events-auto
            ${t.kind === 'achievement' ? 'border-volt-400' : t.kind === 'error' ? 'border-ember-400' : ''}`}>
          {t.kind === 'achievement'
            ? <PikachuMascot state="excited" size={62} shadow={false} />
            : <span className={`mt-0.5 ${t.kind === 'error' ? 'text-ember-600' : t.kind === 'success' ? 'text-leaf-700' : 'text-volt-700'}`}>
                <Icon name={t.kind === 'error' ? 'x' : t.kind === 'success' ? 'check' : 'bolt'} size={18} />
              </span>}
          <div className="min-w-0 flex-1">
            {t.kind === 'achievement' && <p className="eyebrow text-volt-700 mb-0.5">Achievement unlocked</p>}
            <p className="text-[13.5px] font-extrabold text-cream-100 leading-tight">{t.title}</p>
            {t.body && <p className="text-[12px] text-cream-500 mt-0.5 leading-snug">{t.body}</p>}
          </div>
          <button onClick={() => dismiss(t.id)} aria-label="Dismiss notification"
            className="absolute top-2 right-2 text-cream-500 hover:text-cream-100 p-1"><Icon name="x" size={13} /></button>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ misc */
export function Stat({ label, value, accent }: { label: string; value: ReactNode; accent?: string }) {
  return (
    <div className="px-2.5 py-1.5 sm:px-3.5 sm:py-2 bg-white/80 border-2 border-ink-500 rounded-xl sm:rounded-2xl min-w-[62px] sm:min-w-[76px] text-center">
      <p className="eyebrow text-[10px] sm:text-[10.5px] mb-0 sm:mb-0.5">{label}</p>
      <p className="display text-[15px] sm:text-[18px] tabnum leading-none" style={{ color: accent ?? 'var(--color-cream-100)' }}>{value}</p>
    </div>
  );
}

export function Segmented<T extends string | number>({
  value, onChange, options, size = 'md', label,
}: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; size?: 'sm' | 'md'; label?: string }) {
  const { sfx } = useStore();
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap gap-1 p-1 bg-blush-100 border-2 border-ink-500 rounded-full">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button key={String(o.value)} role="radio" aria-checked={active}
            onClick={() => { sfx('toggle'); onChange(o.value); }}
            className={`px-3 rounded-full grid place-items-center font-bold transition-all no-tap
              ${size === 'sm' ? 'min-h-[34px] sm:min-h-0 py-1 text-[11px]' : 'min-h-[36px] sm:min-h-0 py-1.5 text-[12px]'}
              ${active
                ? 'bg-volt-400 text-[#5a3a12] shadow-[0_2px_0_0_#e0a21f]'
                : 'text-cream-500 hover:text-cream-100 hover:bg-white/70'}`}
            style={{ fontFamily: 'var(--font-display)' }}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  const { sfx } = useStore();
  return (
    <button role="switch" aria-checked={checked} onClick={() => { sfx('toggle'); onChange(!checked); }}
      className="inline-flex items-center gap-2.5 no-tap group min-h-[34px] sm:min-h-0">
      <span className={`w-[48px] h-[27px] rounded-full border-2 transition-colors relative ${checked ? 'bg-volt-400 border-volt-600' : 'bg-blush-100 border-ink-500'}`}>
        <span className={`absolute top-[2.5px] w-[18px] h-[18px] rounded-full transition-all shadow-sm ${checked ? 'left-[24px] bg-white' : 'left-[3px] bg-white'}`} />
      </span>
      <span className="text-[13px] font-semibold text-cream-300 group-hover:text-cream-100">{label}</span>
    </button>
  );
}

export function CopyField({ value, label, onCopied }: { value: string; label: string; onCopied?: () => void }) {
  const [done, setDone] = useState(false);
  const { sfx, toast } = useStore();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setDone(true); sfx('select'); onCopied?.();
      setTimeout(() => setDone(false), 1800);
    } catch {
      toast({ kind: 'error', title: 'Clipboard blocked', body: 'Select the text and copy it manually.' });
    }
  };
  return (
    <div className="flex items-stretch gap-0 border-2 border-ink-500 bg-white rounded-2xl overflow-hidden">
      <div className="px-3 py-2 min-w-0 flex-1">
        <p className="eyebrow text-[9px] mb-0.5">{label}</p>
        <p className="font-mono text-[12.5px] text-cream-100 truncate">{value}</p>
      </div>
      <button onClick={copy} aria-label={`Copy ${label}`}
        className={`px-4 font-extrabold text-[11px] uppercase tracking-wider transition-colors no-tap ${done ? 'bg-leaf-400 text-[#12503a]' : 'bg-blush-100 text-cream-300 hover:bg-volt-400 hover:text-[#5a3a12]'}`}>
        <Icon name={done ? 'check' : 'copy'} size={15} />
      </button>
    </div>
  );
}
