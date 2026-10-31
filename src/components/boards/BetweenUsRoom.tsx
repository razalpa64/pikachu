import { useEffect, useRef, useState } from 'react';
import type { BoardProps } from './types';
import type { BetweenUsView } from '../../games/betweenus/rules';
import type { BeuMove } from '../../games/betweenus/rules';
import type { RoomHandle } from '../../games/betweenus/scene';
import { BoardStage } from './BoardStage';

/**
 * The room's view of BETWEEN US.
 *
 * The three.js scene is imported lazily — the whole renderer is code-split away
 * from the rest of the site, and only downloads when somebody actually walks
 * into the signal room. What lives here is the frame around it: the station card
 * that tells you which half of the truth you are holding, and the HUD.
 */
export default function BetweenUsRoom({ state, youSlot, onMove, names }: BoardProps<BetweenUsView>) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const roomRef = useRef<RoomHandle | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const moveRef = useRef(onMove);
  moveRef.current = onMove;

  const station = state.station;
  const listener = station === 'listener';

  useEffect(() => {
    let disposed = false;
    let handle: RoomHandle | null = null;
    (async () => {
      try {
        const { createRoom } = await import('../../games/betweenus/scene');
        if (disposed || !canvasRef.current) return;
        handle = createRoom(canvasRef.current, {
          station,
          onMove: (m: BeuMove) => moveRef.current(m),
          reducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
        });
        roomRef.current = handle;
        setReady(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'The room would not load.');
      }
    })();
    const onResize = () => roomRef.current?.resize();
    window.addEventListener('resize', onResize);
    return () => {
      disposed = true;
      window.removeEventListener('resize', onResize);
      handle?.dispose();
      roomRef.current = null;
    };
    // the scene is built once per station; everything else arrives through setView
  }, [station]);

  useEffect(() => {
    if (!ready) return;
    roomRef.current?.setView({
      station,
      code: state.code ?? [],
      legend: state.legend ?? [],
      dials: state.dials ?? [0, 0, 0],
      strikes: state.strikes ?? 0,
      strikesLeft: state.strikesLeft ?? 3,
      round: state.round ?? 1,
      rounds: state.rounds ?? 3,
      solved: !!state.solved,
      over: !!state.over,
      eventKey: `${state.round}:${state.strikes}:${state.over ? 1 : 0}:${state.moves ?? 0}`,
    });
  }, [ready, state, station]);

  const strikesLeft = state.strikesLeft ?? 3;

  /* The keyboard is not an afterthought here: a room you can only reach with a
     mouse is a room half the people who could play it cannot enter. 1–3 turn a
     dial up, shift and 1–3 turn it down, enter pulls the lever. */
  useEffect(() => {
    if (station !== 'operator' || state.over) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        onMove({ t: 'pull' });
        return;
      }
      const m = /^[1-3]$/.exec(e.key);
      if (!m) return;
      e.preventDefault();
      onMove({ t: 'dial', index: Number(m[0]) - 1, delta: e.shiftKey ? -1 : 1 });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [station, state.over, onMove]);

  return (
    <div className="w-full flex flex-col items-center gap-3">
      {/* who you are, and the half of the truth you are holding */}
      <div className="w-full max-w-[620px] flex flex-wrap items-center justify-center gap-2 text-[11.5px]">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-bold uppercase tracking-wider text-[10px] ${listener ? 'border-[#4a90d9]/60 text-[#bcd8f2]' : 'border-[#c08a45]/70 text-[#f0d5a8]'}`}
        >
          <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-current" />
          You are the {listener ? 'listener' : 'operator'}
        </span>
        <span className="text-cream-400">{names[0]} · {names[1]}</span>
        <span className="text-cream-500" aria-hidden>·</span>
        <span className="text-cream-300">frequency {state.round}/{state.rounds}</span>
        <span className="text-cream-500" aria-hidden>·</span>
        <span className={strikesLeft <= 1 ? 'text-red-300 font-bold' : 'text-cream-300'}>
          {strikesLeft} bad pull{strikesLeft === 1 ? '' : 's'} left
        </span>
      </div>

      <BoardStage ratio={16 / 10} max={760} min={300} reserve={190} chrome={6} label="The signal room">
        <div className="relative w-full" style={{ aspectRatio: '16 / 10' }}>
          <canvas
            ref={canvasRef}
            className="w-full h-full block rounded-[14px] bg-[#07090b]"
            style={{ touchAction: 'manipulation' }}
            data-between-us=""
            data-station={station}
            data-round={state.round}
            data-dials={(state.dials ?? []).join(',')}
            data-code={listener ? (state.code ?? []).join(',') : undefined}
            data-legend={listener ? undefined : (state.legend ?? []).join(',')}
            data-strikes={state.strikes ?? 0}
            data-solved={state.solved ? '1' : '0'}
            aria-label={
              listener
                ? `The signal room. You are the listener; ${state.code?.length ?? 0} glyphs are lit on the wall.`
                : 'The signal room. You are the operator; three dials and a lever are in front of you.'
            }
            role="img"
          />
          {!ready && !error && (
            <div className="absolute inset-0 grid place-items-center rounded-[14px] bg-[#07090b]">
              <p className="text-[12px] text-cream-400">Opening the room…</p>
            </div>
          )}
          {error && (
            <div className="absolute inset-0 grid place-items-center rounded-[14px] bg-[#07090b] p-4 text-center">
              <p className="text-[12.5px] text-red-200">The 3D room could not start: {error}</p>
            </div>
          )}
        </div>
      </BoardStage>

      {/* The console, as buttons.
          The 3D dials are the real thing, but a lever you can only hit with a
          precise tap is a lever half the people on a phone cannot pull. These
          are the same moves through a control that cannot be missed — and they
          double as the accessible path for anybody using a keyboard or a reader. */}
      {station === 'operator' && !state.over && (
        <div className="w-full max-w-[560px] flex flex-col items-center gap-2">
          <div className="grid grid-cols-3 gap-2 w-full">
            {[0, 1, 2].map((i) => {
              const value = state.dials?.[i] ?? 0;
              return (
                <div key={i} className="flex items-center justify-between rounded-[10px] border border-ink-600 bg-black/15 px-1.5 py-1">
                  <button
                    type="button"
                    aria-label={`Dial ${i + 1} down`}
                    onClick={() => onMove({ t: 'dial', index: i, delta: -1 })}
                    className="btn btn-sm btn-ghost btn-iconish px-2"
                  >−</button>
                  <span className="tabnum text-[15px] font-extrabold text-cream-100" aria-live="off">{value}</span>
                  <button
                    type="button"
                    aria-label={`Dial ${i + 1} up`}
                    onClick={() => onMove({ t: 'dial', index: i, delta: 1 })}
                    className="btn btn-sm btn-ghost btn-iconish px-2"
                  >+</button>
                </div>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => onMove({ t: 'pull' })}
            className="btn btn-primary w-full max-w-[280px] font-extrabold"
          >
            Pull the lever
          </button>
        </div>
      )}

      <p className="text-[11.5px] text-cream-400 text-center max-w-[52ch]">
        {state.over
          ? state.reason
          : listener
            ? 'Read out what the glyphs look like. Your partner has the plate that turns them into numbers.'
            : 'Your partner can see the wall; you hold the plate that turns a glyph into a number. Set the dials, then pull the lever when you agree.'}
      </p>
    </div>
  );
}
