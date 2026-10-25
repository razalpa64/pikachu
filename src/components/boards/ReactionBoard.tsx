import { useEffect, useRef, useState } from 'react';
import { useTouch } from '../../lib/useTouch';
import type { RDState } from '../../games/reaction/rules';
import type { BoardProps } from './types';
import { PikachuMascot } from '../../mascot';
import { useStore } from '../../lib/store';
import { BoardStage } from './BoardStage';

/**
 * The visual signal is driven by SERVER state (`phase === 'signal'`), never by a local timer,
 * and the press is timestamped by the server. Latency is surfaced honestly in the HUD.
 */
export default function ReactionBoard({ state, youSlot, onMove, interactive, names }: BoardProps<RDState>) {
  const touch = useTouch();
  const { sfx } = useStore();
  const opp = youSlot === 0 ? 1 : 0;
  const [flashKey, setFlashKey] = useState(0);
  const prevPhase = useRef(state.phase);

  useEffect(() => {
    if (prevPhase.current !== state.phase) {
      if (state.phase === 'signal') { sfx('go'); setFlashKey((k) => k + 1); }
      if (state.phase === 'countdown') sfx('countdown');
      prevPhase.current = state.phase;
    }
  }, [state.phase, sfx]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.key !== 'Enter') return;
      e.preventDefault();
      if (interactive) onMove({ type: 'press' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [interactive, onMove]);

  const mine = state.responses[youSlot];
  const myFalse = state.falseStart[youSlot];
  const armed = state.phase === 'armed' || state.phase === 'countdown';
  const live = state.phase === 'signal';
  const need = Math.floor(state.bestOf / 2) + 1;

  /* Four pad states, four unmistakable colours. The waiting state used to be a
     lavender gradient, which was the one cool note in a warm palette and read as
     "the signal" to more than one person; it is now paper-shadow, so the only
     saturated thing on the screen is the cue itself. */
  const bg = live ? 'linear-gradient(160deg,#ffe98f,#ffd24d)'
    : myFalse ? 'linear-gradient(160deg,#ffc2d3,#f2779a)'
    : armed ? 'linear-gradient(160deg,#f3e7d6,#e6d2b8)'
    : 'linear-gradient(160deg,#fff4e2,#f6e3c9)';

  return (
    <div className="w-full max-w-[760px] mx-auto">
      {/* series tally */}
      <div className="flex items-center justify-between mb-3 gap-3">
        <Tally name={names[0]} wins={state.wins[0]} need={need} colour="#f0b429" me={youSlot === 0} />
        <span className="display text-[13px] text-cream-400 shrink-0">ROUND {Math.min(state.rounds.length + 1, state.bestOf)}/{state.bestOf}</span>
        <Tally name={names[1]} wins={state.wins[1]} need={need} colour="#4a9fd8" me={youSlot === 1} align="right" />
      </div>

      {/* At 16:9 in a 720 px column this pad was 405 px tall on a desktop and 193 px
          on a phone — shorter than the mascot, the word and the sub-line stacked
          inside it, so the cue you are supposed to react to was clipped on mobile.
          The stage fixes the height budget and the pad is never shorter than its
          own content. */}
      <BoardStage ratio={2} max={760} min={272} reserve={210} chrome={0}>
      <button
        onClick={() => { if (interactive) onMove({ type: 'press' }); }}
        disabled={!interactive}
        aria-label={live ? 'Strike now'
          : state.phase === 'countdown' ? 'Get ready'
          : myFalse ? 'False start — this round is lost'
          : state.phase === 'reveal' || state.phase === 'done' ? 'Round result'
          : 'Wait for the signal'}
        className="relative w-full min-h-[clamp(214px,30dvh,340px)] grid place-items-center border-2 overflow-hidden no-tap transition-[background] duration-75"
        style={{ background: bg, borderColor: live ? '#e8a21c' : myFalse ? '#d9456f' : '#c9a888', borderRadius: 26, cursor: interactive ? 'pointer' : 'default' }}>

        {/* The cue must never be covered. This used to be a full-pad white flash,
            which blanked the word "STRIKE" for the 400 ms the player is supposed
            to be reacting in. It is now a ring on the border: the padding still
            flashes, the thing you have to read does not. */}
        {live && (
          <span key={flashKey} aria-hidden className="absolute inset-0 pointer-events-none rounded-[26px]"
            style={{ boxShadow: 'inset 0 0 0 9px rgba(255,255,255,.92)', animation: 'pk-flash .4s ease-out forwards' }} />
        )}

        {/* radiating guides — only while the pad is waiting; nothing decorative
            sits in the field once the signal is live */}
        {!live && (
          <div className="absolute inset-0 opacity-25 pointer-events-none fx-heavy" aria-hidden>
            {[...Array(14)].map((_, i) => (
              <span key={i} className="absolute left-1/2 top-1/2 h-px w-[60%] origin-left"
                style={{ background: 'rgba(146,110,86,.35)', transform: `rotate(${(i / 14) * 360}deg)` }} />
            ))}
          </div>
        )}

        <div className="relative text-center px-4">
          {state.phase === 'countdown' && (
            <>
              <PikachuMascot state="competitive" size={120} className="mx-auto" />
              <p className="display text-[26px] sm:text-[34px] text-volt-700 mt-1">Get ready</p>
              <p className="text-[12.5px] text-cream-500 mt-1">Hands off until the arena flashes</p>
            </>
          )}
          {state.phase === 'armed' && (
            <>
              <PikachuMascot state="thinking" size={120} className="mx-auto" />
              <p className="display text-[26px] sm:text-[34px] text-cream-300 mt-1">Wait…</p>
              <p className="text-[12.5px] text-cream-500 mt-1">{myFalse ? 'False start — sit this round out' : 'Any moment now'}</p>
            </>
          )}
          {state.phase === 'signal' && (
            <>
              <p className="wordmark text-[52px] sm:text-[82px] leading-none text-[#2a1d00]">STRIKE</p>
              <p className="text-[13px] font-extrabold uppercase tracking-[.2em] text-ink-800 mt-1">
                {mine !== null ? `${mine} ms — logged` : touch ? 'Tap the pad' : 'Click or press space'}
              </p>
            </>
          )}
          {(state.phase === 'reveal' || state.phase === 'done') && (
            <>
              <PikachuMascot state={state.rounds.at(-1)?.winner === youSlot ? 'excited' : state.rounds.at(-1)?.winner === null ? 'thinking' : 'defeated'} size={120} className="mx-auto" />
              <p className="display text-[22px] sm:text-[28px] text-volt-700 mt-1">
                {state.rounds.at(-1)?.winner === youSlot ? 'Round won' : state.rounds.at(-1)?.winner === null ? 'Split round' : 'Round lost'}
              </p>
              <div className="flex justify-center gap-5 mt-2 text-[12.5px]">
                <span className="text-cream-300">You <strong className="text-volt-700 tabnum">{fmt(state.rounds.at(-1)?.responses[youSlot] ?? null, state.rounds.at(-1)?.falseStart[youSlot])}</strong></span>
                <span className="text-cream-300">{names[opp]} <strong className="text-blush-600 tabnum">{fmt(state.rounds.at(-1)?.responses[opp] ?? null, state.rounds.at(-1)?.falseStart[opp])}</strong></span>
              </div>
            </>
          )}
        </div>
      </button>
      </BoardStage>

      {/* round log */}
      {state.rounds.length > 0 && (
        <div className="mt-3 panel notch-sm p-3">
          <p className="eyebrow mb-2">Round log</p>
          <div className="flex flex-col gap-1">
            {state.rounds.map((r) => (
              <div key={r.index} className="grid grid-cols-[auto_1fr_auto_1fr] gap-2 items-center text-[11.5px] tabnum">
                <span className="text-cream-400 w-6">#{r.index + 1}</span>
                <span className={`text-right ${r.winner === 0 ? 'text-volt-700 font-extrabold' : 'text-cream-500'}`}>{fmt(r.responses[0], r.falseStart[0])}</span>
                <span className="text-cream-400">·</span>
                <span className={`${r.winner === 1 ? 'text-blush-600 font-extrabold' : 'text-cream-500'}`}>{fmt(r.responses[1], r.falseStart[1])}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const fmt = (ms: number | null, falseStart?: boolean) => (falseStart ? 'false start' : ms === null ? 'no press' : `${ms} ms`);

function Tally({ name, wins, need, colour, me, align }: { name: string; wins: number; need: number; colour: string; me: boolean; align?: 'right' }) {
  return (
    <div className={`min-w-0 flex-1 ${align === 'right' ? 'text-right' : ''}`}>
      <p className="text-[12px] font-extrabold text-cream-100 truncate">{name}{me ? ' (you)' : ''}</p>
      <div className={`flex gap-1 mt-1 ${align === 'right' ? 'justify-end' : ''}`}>
        {Array.from({ length: need }).map((_, i) => (
          <span key={i} className="w-5 h-[5px]" style={{ background: i < wins ? colour : '#e0c9ae' }} />
        ))}
      </div>
    </div>
  );
}
