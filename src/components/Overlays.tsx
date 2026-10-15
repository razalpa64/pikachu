import { useEffect, useRef, useState, type ReactNode } from 'react';
import { PikachuMascot, ConfettiBurst } from '../mascot';
import { Button, Icon } from './ui';
import { useStore } from '../lib/store';

export type Verdict = 'win' | 'loss' | 'draw';

const COPY: Record<Verdict, { eyebrow: string; title: string; line: string; mascot: 'victory' | 'defeated' | 'thinking'; colour: string }> = {
  win:  { eyebrow: 'Match complete', title: 'Victory',  line: 'The arena is yours.',            mascot: 'victory',  colour: '#f0b429' },
  loss: { eyebrow: 'Match complete', title: 'Defeated', line: 'Close one. Run it back?',        mascot: 'defeated', colour: '#4a9fd8' },
  draw: { eyebrow: 'Match complete', title: 'Drawn',    line: 'Dead even. Someone has to break the tie.', mascot: 'thinking', colour: '#F7F1DF' },
};

export interface ScoreRow { label: string; a: ReactNode; b: ReactNode }

export function ResultOverlay({
  verdict, reason, playerA, playerB, rows, onRematch, onExit,
  rematchLabel = 'Rematch', exitLabel = 'Back to lobby', rematchPending, extra,
}: {
  verdict: Verdict; reason?: string;
  playerA: { name: string; score?: ReactNode; you?: boolean };
  playerB: { name: string; score?: ReactNode; you?: boolean };
  rows?: ScoreRow[];
  onRematch?: () => void; onExit?: () => void;
  rematchLabel?: string; exitLabel?: string; rematchPending?: boolean;
  extra?: ReactNode;
}) {
  const { sfx } = useStore();
  const c = COPY[verdict];
  const ref = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [reveal, setReveal] = useState(0);

  useEffect(() => {
    sfx(verdict === 'win' ? 'win' : verdict === 'loss' ? 'lose' : 'draw');
    const t1 = setTimeout(() => setReveal(1), 220);
    const t2 = setTimeout(() => setReveal(2), 520);
    ref.current?.querySelector<HTMLElement>('button')?.focus();
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  /**
   * This is an `aria-modal` dialog, so Escape has to dismiss it. It previously
   * did nothing at all, which left the keyboard with no way out of a defeat card.
   *
   * It must also yield to anything stacked on top of it: in an online room the
   * exit button opens a "Leave this arena?" confirm, and that dialog listens for
   * Escape on `document` while this one listens on `window` in the capture phase.
   * Without the check below this handler would swallow the key first and the
   * confirm could never be dismissed.
   */
  useEffect(() => {
    if (!onExit) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
      if (dialogs.some((d) => d !== rootRef.current)) return; // something is on top of us
      e.preventDefault();
      e.stopPropagation();
      onExit();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onExit]);

  return (
    <div ref={rootRef} className="absolute inset-0 z-40 grid place-items-center p-4 bg-ink-900/88 blur-heavy backdrop-blur-[3px]"
      role="dialog" aria-modal="true" aria-label={`${c.title}. ${reason ?? ''}`}>
      {verdict === 'win' && <ConfettiBurst />}
      <div ref={ref} className="relative panel panel-notch w-full max-w-[520px] p-6 sm:p-7 a-pop text-center">
        {/* radial glow */}
        <div className="absolute inset-0 pointer-events-none fx-heavy" aria-hidden
          style={{ background: `radial-gradient(circle at 50% 24%, ${c.colour}22, transparent 62%)` }} />

        <div className="relative">
          <PikachuMascot state={c.mascot} size={170} className="mx-auto" />
          <p className="eyebrow mt-1 mb-1" style={{ color: c.colour }}>{c.eyebrow}</p>
          <h2 className="wordmark text-[46px] sm:text-[58px] leading-none mb-1.5"
            style={verdict !== 'win' ? { background: `linear-gradient(177deg,#fff,${c.colour} 60%,#6b6250)`, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', filter: 'none' } : undefined}>
            {c.title}
          </h2>
          <p className="text-[13px] text-cream-300">{reason ? `${reason} — ${c.line}` : c.line}</p>

          {/* scoreboard */}
          <div className={`mt-5 grid grid-cols-[1fr_auto_1fr] gap-2 items-center transition-all duration-500 ${reveal >= 1 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`}>
            <div className="panel notch-sm p-3">
              <p className="eyebrow text-[9px] mb-1 truncate">{playerA.name}{playerA.you ? ' (you)' : ''}</p>
              <p className="display text-[28px] tabnum text-volt-700">{playerA.score ?? '—'}</p>
            </div>
            <span className="display text-[14px] text-ink-400">VS</span>
            <div className="panel notch-sm p-3">
              <p className="eyebrow text-[9px] mb-1 truncate">{playerB.name}{playerB.you ? ' (you)' : ''}</p>
              <p className="display text-[28px] tabnum text-blush-600">{playerB.score ?? '—'}</p>
            </div>
          </div>

          {rows && rows.length > 0 && (
            <div className={`mt-3 transition-all duration-500 delay-150 ${reveal >= 2 ? 'opacity-100' : 'opacity-0'}`}>
              {rows.map((r) => (
                <div key={r.label} className="grid grid-cols-[1fr_auto_1fr] gap-2 py-1.5 border-t border-ink-600 text-[12px]">
                  <span className="text-right text-cream-100 font-bold tabnum">{r.a}</span>
                  <span className="text-cream-500 uppercase tracking-wider text-[10px] font-bold px-2">{r.label}</span>
                  <span className="text-left text-cream-100 font-bold tabnum">{r.b}</span>
                </div>
              ))}
            </div>
          )}

          {extra && <div className="mt-4">{extra}</div>}

          <div className="flex flex-wrap gap-2.5 justify-center mt-6">
            {onRematch && (
              <Button variant="primary" size="lg" onClick={onRematch} disabled={rematchPending} icon={<Icon name="rotate" size={16} />}>
                {rematchPending ? 'Waiting for rival…' : rematchLabel}
              </Button>
            )}
            {onExit && <Button variant="ghost" size="lg" onClick={onExit} cue="back" icon={<Icon name="back" size={16} />}>{exitLabel}</Button>}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ countdown */
export function MatchCountdown({ startsAt, names, onDone }: { startsAt: number; names: [string, string]; onDone?: () => void }) {
  const { sfx } = useStore();
  const [left, setLeft] = useState(() => Math.max(0, startsAt - Date.now()));
  const lastTick = useRef(-1);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const ms = Math.max(0, startsAt - Date.now());
      setLeft(ms);
      const sec = Math.ceil(ms / 1000);
      if (sec !== lastTick.current && sec > 0) { lastTick.current = sec; sfx('countdown'); }
      if (ms <= 0) { sfx('go'); onDone?.(); return; }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [startsAt, onDone, sfx]);

  const n = Math.ceil(left / 1000);
  return (
    <div className="absolute inset-0 z-40 grid place-items-center bg-ink-900/92 blur-heavy backdrop-blur-sm" role="status" aria-live="assertive">
      <div className="text-center">
        <div className="flex items-end justify-center gap-6 mb-6">
          <div className="text-right">
            <PikachuMascot state="competitive" size={120} />
            <p className="display text-[15px] text-volt-700 mt-1 max-w-[14ch] truncate">{names[0]}</p>
          </div>
          <span className="display text-[20px] text-ink-400 mb-10">VS</span>
          <div className="text-left">
            <PikachuMascot state="competitive" size={120} flip />
            <p className="display text-[15px] text-blush-600 mt-1 max-w-[14ch] truncate">{names[1]}</p>
          </div>
        </div>
        <p key={n} className="wordmark text-[96px] sm:text-[130px] leading-none a-pop">{n > 0 ? n : 'GO'}</p>
        <p className="eyebrow text-volt-700 mt-1">The arena is charging</p>
      </div>
    </div>
  );
}
