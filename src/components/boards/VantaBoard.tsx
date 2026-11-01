import { useEffect, useMemo, useRef, useState } from 'react';
import type { BoardProps } from './types';
import { BoardStage, BoardGrid } from './BoardStage';
import {
  ACTION_LABEL, CORES, COST, EVENT_LABEL, MAX_ENERGY, MAX_ROUNDS, N,
  PREDICTIONS, RELAYS, actionBlurb, costFor, neighbours, objectiveById, relayWinBlurb, squareName, targetsFor,
  type Prediction, type VantaAction, type VantaPlan, type VantaState,
} from '../../games/vanta/rules';
import { ASH, CORAL, INK, IVORY, PAPER, SLATE, onSeat, seatColor } from '../../games/vanta/theme';

/**
 * VANTA's table.
 *
 * The board is the game: a 7 × 7 slate with five relays, two cores, three agents
 * a side, one secret objective, and a plan composer that only ever offers moves
 * the engine will accept. Everything on screen outside the grid is a readout of
 * state the server already sent — the component never decides an outcome, it
 * only draws one and proposes a plan.
 *
 * Palette is VANTA's own (ink `#15191F`, slate `#20242C`, ivory `#E9E6DF`, paper
 * `#F4F0E8`, coral `#F16B61`, ash `#A8ADB5`), deliberately quieter than the rest
 * of the app: this is the one table where nothing glows.
 */


/** The redacted view the room hands a board, with the fields VANTA adds. */
type VantaViewState = VantaState & {
  foeHasSubmitted?: boolean;
  myInsight?: Prediction[];
  myPredictions?: number;
};

const ACTION_LIST: VantaAction[] = ['move', 'claim', 'anchor', 'feint', 'snare', 'hold'];
const AGENT_LABEL = ['A', 'B', 'C'];

function Pip({ filled, tint }: { filled: boolean; tint: string }) {
  return (
    <span
      aria-hidden
      className="inline-block h-2 w-2 rounded-full"
      style={{ background: filled ? tint : 'transparent', border: `1.5px solid ${filled ? tint : '#3a4049'}` }}
    />
  );
}

export default function VantaBoard({ state, youSlot, onMove, interactive, names }: BoardProps<VantaViewState>) {
  const s = state;
  const foeSlot = (youSlot === 0 ? 1 : 0) as 0 | 1;
  const myPlan = s.plans?.[youSlot] ?? null;
  const locked = !!myPlan;
  const foeLocked = s.plans?.[foeSlot] ?? !!s.foeHasSubmitted;

  const [agent, setAgent] = useState<number | null>(null);
  const [action, setAction] = useState<VantaAction>('move');
  const [target, setTarget] = useState<number | null>(null);
  const [predict, setPredict] = useState<Prediction>('claim');
  const lastRoundRef = useRef<number>(s.round);

  /* a new round means a new plan: clear the composer, never carry a half-made
     plan across two rounds and quietly submit it */
  useEffect(() => {
    if (s.round !== lastRoundRef.current) {
      lastRoundRef.current = s.round;
      setAgent(null);
      setTarget(null);
      setAction('move');
    }
  }, [s.round]);

  /* locking clears the composer — done in the same tick as the submit rather
     than from an effect, so there is no render where both are true */


  const legalTargets = useMemo(() => {
    if (agent === null) return [] as number[];
    if (action === 'anchor' || action === 'hold') return [];
    return targetsFor(s, youSlot, agent, action);
  }, [s, youSlot, agent, action]);

  const canLock = agent !== null && (action === 'anchor' || action === 'hold' || target !== null);
  const cost = agent === null ? 0 : costFor(s, youSlot, action, target, agent);
  const affordable = cost <= s.energy[youSlot];

  const submit = () => {
    if (!canLock || !affordable) return;
    onMove({ agent, action, to: action === 'anchor' || action === 'hold' ? null : target, predict } as VantaPlan);
    setAgent(null);
    setTarget(null);
  };

  const myObjective = objectiveById(s.objective?.[youSlot] ?? 'reader');
  const myProgress = s.objectiveProgress?.[youSlot] ?? 0;
  const myInsight: Prediction[] = s.myInsight ?? s.insight?.[youSlot] ?? [];
  const report = s.lastRound;

  const cellOwner = (i: number) => s.owner?.[i] ?? null;
  const agentHere = (i: number) =>
    [0, 1].flatMap((slot) => (s.agents?.[slot] ?? []).map((sq, idx) => (sq === i ? { slot: slot as 0 | 1, idx } : null)))
      .filter(Boolean) as { slot: 0 | 1; idx: number }[];

  const ringSquares = neighbours(CORES[foeSlot]);

  return (
    <div className="w-full select-none" style={{ color: PAPER }}>
      {/* ---------------- readout bar ---------------- */}
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[.2em]"
          style={{ background: SLATE, color: ASH, border: `1px solid #2c323b` }}>
          Round {s.round} / {s.maxRounds ?? MAX_ROUNDS}
        </span>
        {s.event && (
          <span className="rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[.16em]"
            style={{ background: 'rgba(241,107,97,.14)', color: CORAL, border: `1px solid rgba(241,107,97,.45)` }}
            title={EVENT_LABEL[s.event.kind].detail}>
            {EVENT_LABEL[s.event.kind].title}
          </span>
        )}
        <span className="ml-auto flex items-center gap-2 text-[11px]" style={{ color: ASH }}>
          <span className="font-bold" style={{ color: seatColor(youSlot) }}>{names?.[youSlot] ?? 'You'}</span>
          <span className="tabnum text-[13px] font-extrabold" style={{ color: PAPER }}>{s.influence?.[youSlot] ?? 0}</span>
          <span aria-hidden>·</span>
          <span className="tabnum text-[13px] font-extrabold" style={{ color: PAPER }}>{s.influence?.[foeSlot] ?? 0}</span>
          <span className="font-bold" style={{ color: seatColor(foeSlot) }}>{names?.[foeSlot] ?? 'Them'}</span>
        </span>
      </div>

      {/* ---------------- the table ----------------
          Sized by the stage, not by the window: the composer under the board is
          tall, so the board is measured against the height that is actually left
          for it. */}
      <BoardStage ratio={1} max={560} min={240} reserve={300} chrome={16} label="VANTA table">
      <div className="rounded-[18px] p-2 sm:p-3" style={{ background: `linear-gradient(168deg,#191d24,${INK})`, border: '1px solid #2b313a', boxShadow: '0 24px 60px -34px rgba(0,0,0,.9)' }}>
        <BoardGrid cols={N} rows={N} gap="clamp(3px, 1.2%, 6px)" role="grid"
          aria-label={`VANTA table, round ${s.round} of ${s.maxRounds ?? MAX_ROUNDS}`}>
          {Array.from({ length: N * N }).map((_, i) => {
            const owner = cellOwner(i);
            const relay = RELAYS.includes(i);
            const core = s.core?.[i] ?? null;
            const mine = agentHere(i).filter((a) => a.slot === youSlot);
            const theirs = agentHere(i).filter((a) => a.slot === foeSlot);
            const decoy = (s.decoys ?? []).find((d) => d.idx === i);
            const myTrap = (s.traps ?? []).some((t) => t.idx === i);
            const sealed = s.event?.kind === 'blackout' && s.event.squares.includes(i);
            const bolted = s.anchored?.[i] === true;   // a bolt is what makes a relay count
            const isTarget = legalTargets.includes(i);
            const pickable = interactive && !locked && agent !== null && isTarget;
            const onRing = ringSquares.includes(i);
            const selectableAgent = interactive && !locked && mine[0] !== undefined
              && !(s.stunned?.[youSlot] ?? []).includes(mine[0].idx);
            const clickable = pickable || selectableAgent;
            const ownerTint = owner === 0 ? 'rgba(233,230,223,.10)' : owner === 1 ? 'rgba(241,107,97,.16)' : 'rgba(255,255,255,.026)';

            const label = [
              squareName(i),
              relay ? 'relay' : 'square',
              core !== null ? `${core === youSlot ? 'your' : 'their'} core` : '',
              owner !== null ? `${owner === youSlot ? 'held by you' : 'held by them'}` : '',
              mine.length ? `your agent ${AGENT_LABEL[mine[0].idx]}` : '',
              theirs.length ? 'their agent' : '',
              myTrap ? 'your snare' : '',
              decoy ? 'decoy' : '',
              sealed ? 'sealed this round' : '',
              bolted ? 'bolted' : '',
            ].filter(Boolean).join(', ');

            return (
              <button
                key={i}
                type="button"
                role="gridcell"
                disabled={!clickable}
                aria-label={label}
                aria-pressed={pickable || (selectableAgent && agent === mine[0]?.idx)}
                data-vanta-target={pickable ? '1' : undefined}
                data-vanta-agent={selectableAgent ? String(mine[0]?.idx) : undefined}
                onClick={() => {
                  if (!interactive || locked) return;
                  if (pickable) { setTarget(i); return; }
                  if (selectableAgent) {
                    setAgent(mine[0].idx);
                    setTarget(null);
                  }
                }}
                className="relative aspect-square rounded-[7px] transition-colors duration-100 disabled:cursor-default"
                style={{
                  background: ownerTint,
                  border: pickable
                    ? `2px solid ${PAPER}`
                    : selectableAgent
                      ? `2px dashed ${seatColor(youSlot)}`
                      : onRing
                        ? `1px solid rgba(241,107,97,.34)`
                        : '1px solid #262c34',
                  boxShadow: pickable ? `0 0 0 3px rgba(244,240,232,.10)` : undefined,
                  outline: target === i ? `2px solid ${CORAL}` : undefined,
                  outlineOffset: 1,
                }}
              >
                {/* relay mark */}
                {relay && (
                  <span aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
                    <span className="block rounded-[2px]" style={{
                      width: '42%', height: '42%', transform: 'rotate(45deg)',
                      border: `1.5px solid ${owner === null ? ASH : owner === 0 ? 'rgba(233,230,223,.85)' : 'rgba(241,107,97,.95)'}`,
                      background: owner === null ? 'transparent' : owner === 0 ? 'rgba(233,230,223,.18)' : 'rgba(241,107,97,.3)',
                    }} />
                  </span>
                )}
                {/* core */}
                {core !== null && (
                  <span aria-hidden className="pointer-events-none absolute inset-[14%] rounded-[5px]"
                    style={{ border: `2px solid ${seatColor(core)}`, background: core === youSlot ? 'rgba(233,230,223,.14)' : 'rgba(241,107,97,.2)' }} />
                )}
                {/* bolt: a ring inside the cell, so a held relay and a bolted one
                    never read the same — the sweep only counts bolted posts */}
                {bolted && (
                  <span aria-hidden className="pointer-events-none absolute inset-[7%] rounded-[5px]" style={{
                    border: `1.5px solid ${owner === 1 ? 'rgba(241,107,97,.95)' : 'rgba(233,230,223,.8)'}`,
                    boxShadow: 'inset 0 0 0 1px rgba(21,25,31,.55)',
                  }} />
                )}
                {/* my snare */}
                {myTrap && (
                  <span aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center text-[11px] font-black" style={{ color: YELLOWISH }}>
                    ✳
                  </span>
                )}
                {/* decoy */}
                {decoy && (
                  <span aria-hidden className="pointer-events-none absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full"
                    style={{ border: `1.5px dashed ${seatColor(decoy.slot)}` }} />
                )}
                {/* sealed */}
                {sealed && (
                  <span aria-hidden className="pointer-events-none absolute inset-0 rounded-[6px]"
                    style={{ background: 'repeating-linear-gradient(45deg,rgba(168,173,181,.16) 0 4px,transparent 4px 8px)' }} />
                )}
                {/* agents */}
                {[...mine, ...theirs].map((a) => (
                  <span
                    key={`${a.slot}-${a.idx}`}
                    aria-hidden
                    className="pointer-events-none absolute grid place-items-center rounded-full text-[9px] font-black"
                    style={{
                      width: '62%', height: '62%',
                      left: a.slot === youSlot ? '19%' : '48%',
                      top: a.slot === youSlot ? '19%' : '48%',
                      transform: a.slot === youSlot ? 'none' : 'translate(-19%,-19%)',
                      background: seatColor(a.slot),
                      color: onSeat(a.slot),
                      boxShadow: agent === a.idx && a.slot === youSlot ? `0 0 0 2px ${PAPER}` : 'none',
                      opacity: (s.stunned?.[a.slot] ?? []).includes(a.idx) ? 0.45 : 1,
                    }}
                  >
                    {AGENT_LABEL[a.idx]}
                  </span>
                ))}
              </button>
            );
          })}
        </BoardGrid>
      </div>
      </BoardStage>

      {/* ---------------- energy + objective + insight ---------------- */}
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <div className="rounded-xl px-2.5 py-2" style={{ background: SLATE, border: '1px solid #2b313a' }}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[9.5px] font-extrabold uppercase tracking-[.18em]" style={{ color: ASH }}>Energy</span>
            <span className="flex items-center gap-1" aria-label={`${s.energy?.[youSlot] ?? 0} of ${MAX_ENERGY} energy`}>
              {Array.from({ length: MAX_ENERGY }).map((_, k) => (
                <Pip key={k} filled={k < (s.energy?.[youSlot] ?? 0)} tint={seatColor(youSlot)} />
              ))}
            </span>
          </div>
          <p className="mt-1 text-[11px] leading-snug" style={{ color: ASH }}>
            {s.stunned?.[youSlot]?.length
              ? `Agent ${s.stunned[youSlot].map((a) => AGENT_LABEL[a]).join(', ')} is caught in a snare this round.`
              : `${s.relaysHeld?.[youSlot] ?? 0} of 5 relays held · ${s.insight?.[youSlot]?.length ?? myInsight.length} of 5 reads cracked`}
          </p>
        </div>
        <div className="rounded-xl px-2.5 py-2" style={{ background: SLATE, border: '1px solid #2b313a' }}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[9.5px] font-extrabold uppercase tracking-[.18em]" style={{ color: ASH }}>Secret objective</span>
            {s.objectiveDone?.[youSlot] && (
              <span className="text-[9.5px] font-extrabold uppercase tracking-wider" style={{ color: CORAL }}>done</span>
            )}
          </div>
          <p className="mt-1 text-[11.5px] font-bold leading-snug" style={{ color: PAPER }}>{myObjective.title}</p>
          <p className="text-[11px] leading-snug" style={{ color: ASH }}>
            {myObjective.detail} <span className="tabnum">({Math.min(myProgress, myObjective.target)}/{myObjective.target})</span>
          </p>
        </div>
      </div>

      {/* ---------------- last round / reveal ---------------- */}
      {report && (
        <div className="mt-2 rounded-xl px-3 py-2" style={{ background: 'rgba(255,255,255,.03)', border: '1px solid #2b313a' }}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[9.5px] font-extrabold uppercase tracking-[.18em]" style={{ color: ASH }}>
              Round {report.round} resolved
            </span>
            <span className="text-[10px] font-bold tabnum" style={{ color: ASH }}>
              +{report.influenceGain?.[youSlot] ?? 0} / +{report.influenceGain?.[foeSlot] ?? 0} influence
            </span>
          </div>
          <ul className="mt-1 space-y-0.5">
            <li className="text-[11.5px] leading-snug" style={{ color: PAPER }}>{report.lines?.[youSlot]}</li>
            <li className="text-[11.5px] leading-snug" style={{ color: ASH }}>{report.lines?.[foeSlot]}</li>
          </ul>
        </div>
      )}

      {/* ---------------- composer ---------------- */}
      {!s.over && (
        <div className="mt-2 rounded-xl p-2.5" style={{ background: SLATE, border: '1px solid #2b313a' }}>
          {locked ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span className="text-[9.5px] font-extrabold uppercase tracking-[.18em]" style={{ color: CORAL }}>Plan locked</span>
              <span className="text-[12px] font-bold" style={{ color: PAPER }}>
                {AGENT_LABEL[myPlan!.agent]} · {ACTION_LABEL[myPlan!.action]}
                {myPlan!.to !== null ? ` → ${squareName(myPlan!.to)}` : ''} · read {ACTION_LABEL[myPlan!.predict].toLowerCase()}
              </span>
              <span className="ml-auto text-[11px] tabnum" style={{ color: ASH }} role="status" aria-live="polite">
                {foeLocked ? 'Both plans in — resolving…' : 'Waiting for their plan…'}
              </span>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-[9.5px] font-extrabold uppercase tracking-[.18em]" style={{ color: ASH }}>Agent</span>
                {[0, 1, 2].map((a) => {
                  const stunned = (s.stunned?.[youSlot] ?? []).includes(a);
                  const active = agent === a;
                  return (
                    <button key={a} type="button" disabled={!interactive || stunned}
                      onClick={() => { setAgent(a); setTarget(null); }}
                      aria-pressed={active}
                      aria-label={`Agent ${AGENT_LABEL[a]}${stunned ? ', caught in a snare' : ''}`}
                      className="h-8 w-8 rounded-full text-[11px] font-black transition disabled:opacity-35"
                      style={{
                        background: active ? seatColor(youSlot) : 'rgba(255,255,255,.05)',
                        color: active ? onSeat(youSlot) : ASH,
                        border: `1.5px solid ${active ? seatColor(youSlot) : '#333a44'}`,
                      }}>{AGENT_LABEL[a]}</button>
                  );
                })}
                <span className="ml-auto text-[11px] tabnum" style={{ color: cost > (s.energy?.[youSlot] ?? 0) ? CORAL : ASH }}>
                  cost {cost} / {s.energy?.[youSlot] ?? 0}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-[9.5px] font-extrabold uppercase tracking-[.18em]" style={{ color: ASH }}>Action</span>
                {ACTION_LIST.map((a) => {
                  const active = action === a;
                  return (
                    <button key={a} type="button" disabled={!interactive}
                      onClick={() => { setAction(a); setTarget(null); }}
                      aria-pressed={active}
                      title={actionBlurb(a)}
                      className="rounded-full px-2.5 py-1 text-[11px] font-bold transition disabled:opacity-40"
                      style={{
                        background: active ? 'rgba(241,107,97,.18)' : 'rgba(255,255,255,.04)',
                        color: active ? CORAL : ASH,
                        border: `1.5px solid ${active ? 'rgba(241,107,97,.6)' : '#333a44'}`,
                      }}>
                      {ACTION_LABEL[a]}
                      {COST[a] > 0 && <span className="ml-1 tabnum opacity-60">{COST[a]}</span>}
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-[9.5px] font-extrabold uppercase tracking-[.18em]" style={{ color: ASH }}>Read</span>
                {PREDICTIONS.map((p) => (
                  <button key={p} type="button" disabled={!interactive}
                    onClick={() => setPredict(p)}
                    aria-pressed={predict === p}
                    aria-label={`Predict ${ACTION_LABEL[p].toLowerCase()}`}
                    className="rounded-full px-2 py-1 text-[11px] font-bold transition disabled:opacity-40"
                    style={{
                      background: predict === p ? 'rgba(233,230,223,.9)' : 'rgba(255,255,255,.04)',
                      color: predict === p ? SLATE : ASH,
                      border: `1.5px solid ${predict === p ? IVORY : '#333a44'}`,
                    }}>{ACTION_LABEL[p]}</button>
                ))}
                <span className="text-[10.5px]" style={{ color: ASH }}>
                  {myInsight.includes(predict) ? 'already cracked' : 'first crack pays influence'}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px]" style={{ color: ASH }} role="status" aria-live="polite">
                  {agent === null
                    ? 'Pick an agent.'
                    : action === 'anchor' || action === 'hold'
                      ? `${ACTION_LABEL[action]} needs no target.`
                      : target === null
                        ? `Pick a square for ${ACTION_LABEL[action].toLowerCase()}.`
                        : `${AGENT_LABEL[agent]} ${ACTION_LABEL[action].toLowerCase()} → ${squareName(target)}`}
                </span>
                <button type="button" disabled={!interactive || !canLock || !affordable}
                  onClick={submit}
                  className="ml-auto rounded-full px-4 py-1.5 text-[12px] font-extrabold uppercase tracking-wider transition disabled:opacity-40"
                  style={{ background: CORAL, color: '#2a1412' }}>
                  Lock plan
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---------------- the three ways to win ---------------- */}
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10.5px]" style={{ color: ASH }}>
        <span>Influence 12</span>
        <span aria-hidden>·</span>
        <span>{relayWinBlurb()} <span aria-hidden style={{ opacity: .75 }}>(ring = bolted)</span></span>
        <span aria-hidden>·</span>
        <span>close all {ringSquares.length} around their core</span>
      </div>
    </div>
  );
}

const YELLOWISH = '#e7c873';

