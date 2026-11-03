import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { BoardProps } from './types';
import { BoardStage, BoardGrid } from './BoardStage';
import {
  ACTION_DETAIL, ACTION_LABEL, CORES, COST, EVENT_LABEL, MAX_ENERGY, MAX_ROUNDS, N,
  PREDICTIONS, RELAYS, actionBlurb, costFor, neighbours, objectiveById, relayWinBlurb, squareName, targetsFor,
  type Prediction, type VantaAction, type VantaPlan, type VantaState,
} from '../../games/vanta/rules';
import {
  BLUSH_DEEP, BLUSH_LIGHT, BUTTER, BUTTER_DEEP, BUTTER_LIGHT, CARD, CELL, CREAM, INK, INK_MUTED,
  INK_SOFT, LEAF, LINE, LINE_STRONG, MINT, MINT_LIGHT, PLINTH, seatColor, seatDeep, seatWash,
} from '../../games/vanta/theme';

/**
 * VANTA's table.
 *
 * The board is the game: a 7 × 7 of cream squares on a honey plinth, five relays,
 * two cores, three agents a side, one secret objective, and a plan composer that
 * only ever offers plans the engine will accept. Everything outside the grid is a
 * readout of state the server already sent — this component never decides an
 * outcome, it only draws one and proposes a plan.
 *
 * The visual language is the arcade's own: cream paper, a wooden plinth like the
 * chess and ludo boards, cocoa type, butter and blush for the two seats, mint for
 * everything the table does by itself. A near-black table was the first draft and
 * it read as a game from a different app; the tokens are the same lacquered coins
 * the rest of the shelf uses, so a player recognises the material before they
 * read a single label.
 */

/** The redacted view the room hands a board, with the fields VANTA adds. */
type VantaViewState = VantaState & {
  foeHasSubmitted?: boolean;
  myInsight?: Prediction[];
  myPredictions?: number;
};

const ACTION_LIST: VantaAction[] = ['move', 'claim', 'anchor', 'feint', 'snare', 'hold'];
const AGENT_LABEL = ['A', 'B', 'C'];
const COIN = ['/art/piece/checker-gold.webp', '/art/piece/checker-blush.webp'];

/** A small paper card — the shape every readout under the board uses. */
function Card({ children, className = '', tint }: { children: ReactNode; className?: string; tint?: string }) {
  return (
    <div
      className={`rounded-[16px] px-2.5 py-2 ${className}`}
      style={{
        background: tint ? `linear-gradient(180deg,${tint},${CARD})` : `linear-gradient(180deg,${CARD},#fffaf0)`,
        border: `2px solid ${LINE}`,
        boxShadow: '0 1px 0 rgba(255,255,255,.9) inset, 0 10px 22px -20px rgba(140,94,70,.7)',
      }}
    >
      {children}
    </div>
  );
}

/** The small caps label used above every group of controls on the site. */
function Label({ children, tone = INK_MUTED }: { children: ReactNode; tone?: string }) {
  return (
    <span className="text-[9.5px] font-extrabold uppercase tracking-[.18em]" style={{ color: tone }}>
      {children}
    </span>
  );
}

function Pip({ filled }: { filled: boolean }) {
  return (
    <span
      aria-hidden
      className="inline-block h-2.5 w-2.5 rounded-full"
      style={{
        background: filled ? `linear-gradient(180deg,${BUTTER_LIGHT},${BUTTER})` : 'transparent',
        border: `1.8px solid ${filled ? BUTTER_DEEP : LINE_STRONG}`,
      }}
    />
  );
}

/** One choice in the composer: a pill that reads as pressed when it is the pick. */
function Choice({
  active, tone = 'butter', onClick, disabled, label, hint, pressed,
}: {
  active: boolean; tone?: 'butter' | 'mint'; onClick: () => void; disabled?: boolean;
  label: string; hint?: ReactNode; pressed?: boolean;
}) {
  const ramp = tone === 'mint'
    ? { on: 'linear-gradient(180deg,#eafaf2,#bfe8d6)', fg: '#175c45', br: '#7fcaa8' }
    : { on: 'linear-gradient(180deg,#ffe890,#ffd24d)', fg: '#5a3a12', br: '#e0a21f' };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed ?? active}
      className="no-tap rounded-full px-2.5 py-1 text-[11.5px] font-extrabold transition disabled:opacity-40"
      style={{
        background: active ? ramp.on : CARD,
        color: active ? ramp.fg : INK_SOFT,
        border: `2px solid ${active ? ramp.br : LINE}`,
        boxShadow: active ? `0 2px 0 0 ${ramp.br}` : undefined,
      }}
    >
      {label}
      {hint !== undefined && <span className="ml-1 tabnum opacity-70">{hint}</span>}
    </button>
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

  const legalTargets = useMemo(() => {
    if (agent === null) return [] as number[];
    if (action === 'anchor' || action === 'hold') return [];
    return targetsFor(s, youSlot, agent, action);
  }, [s, youSlot, agent, action]);

  const canLock = agent !== null && (action === 'anchor' || action === 'hold' || target !== null);
  const cost = agent === null ? 0 : costFor(s, youSlot, action, target, agent);
  const affordable = cost <= s.energy[youSlot];

  /* locking clears the composer — done in the same tick as the submit rather
     than from an effect, so there is no render where both are true */
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

  /* The engine writes its report with the two seat names baked in ("1. Ivory
     stepped to b2."). On screen the seats are called whatever the room called
     them, so the baked prefix is stripped and the real name is set in bold —
     otherwise a line reads "You · 1. Ivory stepped to b2." */
  const outcomeText = (line: string | undefined) => (line ?? '').replace(/^\d+\.\s*(Ivory|Coral)\s*/, '');

  return (
    <div className="mx-auto w-full max-w-[560px] select-none" style={{ color: INK }}>
      {/* ---------------- the event this round ---------------- */}
      {s.event && (
        <div
          className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-[14px] px-2.5 py-1.5"
          style={{ background: MINT_LIGHT, border: `2px solid ${MINT}` }}
          title={EVENT_LABEL[s.event.kind].detail}
        >
          <span className="text-[9.5px] font-extrabold uppercase tracking-[.18em]" style={{ color: LEAF }}>Table event</span>
          <span className="text-[12px] font-extrabold" style={{ color: INK }}>{EVENT_LABEL[s.event.kind].title}</span>
          <span className="text-[11px]" style={{ color: INK_SOFT }}>{EVENT_LABEL[s.event.kind].detail}</span>
        </div>
      )}

      {/* ---------------- the table ----------------
          Sized by the stage, not by the window: the composer under the board is
          tall, so the board is measured against the height that is actually left
          for it. */}
      <BoardStage ratio={1} max={520} min={240} reserve={236} chrome={12} label="VANTA table">
        <div
          className="relative p-[clamp(5px,1.6%,13px)] rounded-[clamp(14px,4%,22px)]"
          style={{
            background: PLINTH,
            border: `3px solid ${LINE_STRONG}`,
            boxShadow: '0 26px 54px -30px rgba(140,94,70,.6), inset 0 2px 0 rgba(255,255,255,.8)',
          }}
        >
          <BoardGrid cols={N} rows={N} gap="clamp(3px, 1.1%, 6px)" role="grid"
            aria-label={`VANTA table, round ${s.round} of ${s.maxRounds ?? MAX_ROUNDS}`}
            className="overflow-hidden"
            style={{ borderRadius: 'clamp(6px, 2%, 12px)' }}>
            {Array.from({ length: N * N }).map((_, i) => {
              const owner = cellOwner(i);
              const relay = RELAYS.includes(i);
              const core = s.core?.[i] ?? null;
              const mine = agentHere(i).filter((a) => a.slot === youSlot);
              const theirs = agentHere(i).filter((a) => a.slot === foeSlot);
              const decoy = (s.decoys ?? []).find((d) => d.idx === i);
              const myTrap = (s.traps ?? []).some((t) => t.idx === i);
              const sealed = s.event?.kind === 'blackout' && s.event.squares.includes(i);
              const bolted = s.anchored?.[i] === true;
              const isTarget = legalTargets.includes(i);
              const pickable = interactive && !locked && agent !== null && isTarget;
              const onRing = ringSquares.includes(i);
              const selectableAgent = interactive && !locked && mine[0] !== undefined
                && !(s.stunned?.[youSlot] ?? []).includes(mine[0].idx);
              const clickable = pickable || selectableAgent;
              const selected = selectableAgent && agent === mine[0]?.idx;

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
                  aria-pressed={pickable || selected}
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
                  className="board-cell no-tap relative aspect-square rounded-[9%] transition-colors duration-100"
                  style={{
                    /* a flag is a wash of the owner's colour over cream paper; the
                       paper still shows through, so the grid never turns into a
                       two-colour checkerboard you have to decode */
                    background: owner === null
                      ? CELL
                      : `linear-gradient(180deg, ${seatWash(owner, .18)}, ${seatWash(owner, .34)}), ${CELL}`,
                    border: `1px solid rgba(200,155,120,.55)`,
                    boxShadow: [
                      selected ? `inset 0 0 0 3px ${seatDeep(youSlot)}` : '',
                      onRing && owner === null ? `inset 0 0 0 2px rgba(242,119,154,.35)` : '',
                    ].filter(Boolean).join(', ') || undefined,
                    cursor: clickable ? 'pointer' : 'default',
                  }}
                >
                  {/* relay: a diamond inlaid into the square. Mint while it is
                      nobody's, the owner's colour once it is held. */}
                  {relay && (
                    <span aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
                      <span className="block" style={{
                        width: '46%', height: '46%', transform: 'rotate(45deg)',
                        borderRadius: '18%',
                        background: owner === null
                          ? `linear-gradient(140deg,${MINT_LIGHT},${MINT})`
                          : `linear-gradient(140deg,${seatWash(owner, .55)},${seatColor(owner)})`,
                        border: `1.5px solid ${owner === null ? LEAF : seatDeep(owner)}`,
                        opacity: owner === null ? .95 : 1,
                      }} />
                    </span>
                  )}

                  {/* core: a printed seal, one at each end of the table */}
                  {core !== null && (
                    <span aria-hidden className="pointer-events-none absolute inset-[14%] grid place-items-center rounded-[24%]" style={{
                      background: `linear-gradient(160deg,${seatColor(core)},${seatDeep(core)})`,
                      border: `1.5px solid ${seatDeep(core)}`,
                      boxShadow: 'inset 0 0 0 2.5px rgba(255,253,247,.55), inset 0 2px 0 rgba(255,255,255,.5)',
                    }}>
                      {/* a seal, not a tile: the inner diamond ties the core to the
                          relay language on the rest of the table */}
                      <span className="block" style={{
                        width: '46%', height: '46%', transform: 'rotate(45deg)',
                        border: '1.5px solid rgba(255,253,247,.8)', borderRadius: '18%',
                      }} />
                    </span>
                  )}

                  {/* bolt: a ring drawn inside the square. A relay only counts
                      toward the sweep once it is bolted, so this has to be
                      visible at a glance, not a footnote. */}
                  {bolted && (
                    <span aria-hidden className="pointer-events-none absolute inset-[5%] rounded-[14%]" style={{
                      border: `2.5px solid ${owner === null ? LINE_STRONG : seatDeep(owner)}`,
                      opacity: .8,
                    }} />
                  )}

                  {/* a snare of mine: mint disc, leaf glyph. Theirs is never sent. */}
                  {myTrap && (
                    <span aria-hidden className="pointer-events-none absolute left-[6%] top-[6%] grid h-[30%] w-[30%] place-items-center rounded-full text-[9px] font-black"
                      style={{ background: MINT_LIGHT, color: LEAF, border: `1.5px solid ${MINT}` }}>
                      ✳
                    </span>
                  )}

                  {/* decoy: a dashed ghost, readable but clearly not a piece */}
                  {decoy && (
                    <span aria-hidden className="pointer-events-none absolute right-[7%] top-[7%] h-[24%] w-[24%] rounded-full"
                      style={{ border: `1.8px dashed ${seatDeep(decoy.slot)}`, background: 'rgba(255,255,255,.55)' }} />
                  )}

                  {/* blackout: the square is sealed this round */}
                  {sealed && (
                    <span aria-hidden className="pointer-events-none absolute inset-0 rounded-[9%]" style={{
                      background: 'repeating-linear-gradient(45deg, rgba(92,64,53,.18) 0 3px, transparent 3px 7px)',
                    }} />
                  )}

                  {/* agents: the same lacquered coins as the rest of the shelf,
                      stamped with the agent's letter so A, B and C are never
                      confused at a glance */}
                  {[...mine, ...theirs].map((a) => (
                    <span
                      key={`${a.slot}-${a.idx}`}
                      aria-hidden
                      className="pointer-events-none absolute grid place-items-center"
                      style={{
                        width: '74%', height: '74%',
                        left: a.slot === youSlot ? '2%' : '24%',
                        top: a.slot === youSlot ? '5%' : '24%',
                        opacity: (s.stunned?.[a.slot] ?? []).includes(a.idx) ? 0.45 : 1,
                        filter: (s.stunned?.[a.slot] ?? []).includes(a.idx) ? 'grayscale(1)' : undefined,
                      }}
                    >
                      <img
                        src={COIN[a.slot]}
                        alt=""
                        draggable={false}
                        decoding="async"
                        className="block h-full w-full"
                        style={{ filter: 'drop-shadow(0 1px 1px rgba(120,80,55,.35)) drop-shadow(0 2px 3px rgba(120,80,55,.22))' }}
                      />
                      {/* the coin artwork is dark at this size, and a letter set
                          straight onto it measured about 2:1 — so the letter sits
                          on a cream chip, which reads on both seats' coins */}
                      <span className="absolute grid place-items-center rounded-full font-black leading-none tabnum" style={{
                        width: '52%', height: '52%',
                        background: 'rgba(255,253,247,.94)',
                        color: seatDeep(a.slot),
                        fontSize: 'clamp(7px, 22cqw, 10px)',
                        boxShadow: '0 1px 2px rgba(120,80,55,.28)',
                      }}>{AGENT_LABEL[a.idx]}</span>
                      {selected && a.slot === youSlot && (
                        <span className="absolute inset-0 rounded-full" style={{ boxShadow: `0 0 0 2px ${BUTTER_DEEP}` }} />
                      )}
                    </span>
                  ))}

                  {/* where the plan would land */}
                  {pickable && (
                    <span aria-hidden className="pointer-events-none absolute inset-[7%] rounded-[12%]"
                      style={{ border: `2px dashed ${target === i ? BUTTER_DEEP : 'rgba(141,90,5,.55)'}` }} />
                  )}
                  {target === i && (
                    <span aria-hidden className="pointer-events-none absolute inset-0 rounded-[9%]"
                      style={{ boxShadow: `inset 0 0 0 3px ${BUTTER_DEEP}` }} />
                  )}
                </button>
              );
            })}
          </BoardGrid>
        </div>
      </BoardStage>

      {/* ---------------- energy + objective ---------------- */}
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <Card>
          <div className="flex items-center justify-between gap-2">
            <Label>Energy</Label>
            <span className="flex items-center gap-1" aria-label={`${s.energy?.[youSlot] ?? 0} of ${MAX_ENERGY} energy`}>
              {Array.from({ length: MAX_ENERGY }).map((_, k) => <Pip key={k} filled={k < (s.energy?.[youSlot] ?? 0)} />)}
            </span>
          </div>
          <p className="mt-1 text-[11px] leading-snug" style={{ color: INK_SOFT }}>
            {s.stunned?.[youSlot]?.length
              ? `Agent ${s.stunned[youSlot].map((a) => AGENT_LABEL[a]).join(', ')} is caught in a snare this round.`
              : `${s.relaysHeld?.[youSlot] ?? 0} of 5 relays held · ${s.insight?.[youSlot]?.length ?? myInsight.length} of 5 reads cracked`}
          </p>
        </Card>
        <Card tint={BUTTER_LIGHT}>
          <div className="flex items-center justify-between gap-2">
            <Label tone={BUTTER_DEEP}>Secret objective</Label>
            {s.objectiveDone?.[youSlot] && (
              <span className="rounded-full px-2 py-0.5 text-[9.5px] font-extrabold uppercase tracking-wider"
                style={{ background: MINT_LIGHT, color: LEAF, border: `1.5px solid ${MINT}` }}>kept</span>
            )}
          </div>
          <p className="mt-0.5 text-[12px] font-extrabold leading-snug" style={{ color: INK }}>{myObjective.title}</p>
          <p className="text-[11px] leading-snug" style={{ color: INK_SOFT }}>
            {myObjective.detail} <span className="tabnum font-bold">({Math.min(myProgress, myObjective.target)}/{myObjective.target})</span>
          </p>
        </Card>
      </div>

      {/* ---------------- last round / reveal ---------------- */}
      {report && (
        <Card className="mt-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="flex items-baseline gap-2">
              <Label>Round {report.round} resolved</Label>
              {/* the read is the point of the game, so a correct one is named */}
              {report.predictionHit?.[youSlot] && (
                <span className="rounded-full px-2 py-0.5 text-[9.5px] font-extrabold uppercase tracking-wider"
                  style={{ background: MINT_LIGHT, color: LEAF, border: `1.5px solid ${MINT}` }}>read</span>
              )}
            </span>
            <span className="text-[10.5px] font-extrabold tabnum" style={{ color: INK_SOFT }}>
              +{report.influenceGain?.[youSlot] ?? 0} / +{report.influenceGain?.[foeSlot] ?? 0} influence
            </span>
          </div>
          <ul className="mt-1 space-y-0.5">
            <li className="flex items-start gap-1.5 text-[11.5px] leading-snug" style={{ color: INK }}>
              <span aria-hidden className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: seatColor(youSlot) }} />
              <span><b style={{ color: seatDeep(youSlot) }}>{names?.[youSlot] ?? 'You'}</b> · {outcomeText(report.lines?.[youSlot])}</span>
            </li>
            <li className="flex items-start gap-1.5 text-[11.5px] leading-snug" style={{ color: INK_SOFT }}>
              <span aria-hidden className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: seatColor(foeSlot) }} />
              <span><b style={{ color: seatDeep(foeSlot) }}>{names?.[foeSlot] ?? 'Them'}</b> · {outcomeText(report.lines?.[foeSlot])}</span>
            </li>
          </ul>
        </Card>
      )}

      {/* ---------------- composer ---------------- */}
      {!s.over && (
        <div
          className="mt-2 rounded-[18px] p-2.5"
          style={{
            background: `linear-gradient(180deg,${CARD},#fff7ea)`,
            border: `2px solid ${LINE}`,
            boxShadow: '0 1px 0 rgba(255,255,255,.95) inset, 0 14px 26px -24px rgba(140,94,70,.8)',
          }}
        >
          {locked ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span className="rounded-full px-2 py-0.5 text-[9.5px] font-extrabold uppercase tracking-[.16em]"
                style={{ background: MINT_LIGHT, color: LEAF, border: `1.5px solid ${MINT}` }}>Plan locked</span>
              <span className="text-[12px] font-extrabold" style={{ color: INK }}>
                {AGENT_LABEL[myPlan!.agent]} · {ACTION_LABEL[myPlan!.action]}
                {myPlan!.to !== null ? ` → ${squareName(myPlan!.to)}` : ''} · read {ACTION_LABEL[myPlan!.predict].toLowerCase()}
              </span>
              <span className="ml-auto text-[11px] font-bold" style={{ color: INK_SOFT }} role="status" aria-live="polite">
                {foeLocked ? 'Both plans in — resolving…' : 'Waiting for their plan…'}
              </span>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 w-[46px]"><Label>Agent</Label></span>
                {[0, 1, 2].map((a) => {
                  const stunned = (s.stunned?.[youSlot] ?? []).includes(a);
                  const active = agent === a;
                  return (
                    <button key={a} type="button" disabled={!interactive || stunned}
                      onClick={() => { setAgent(a); setTarget(null); }}
                      aria-pressed={active}
                      aria-label={`Agent ${AGENT_LABEL[a]}${stunned ? ', caught in a snare' : ''}`}
                      className="no-tap h-8 w-8 rounded-full text-[12px] font-black transition disabled:opacity-35"
                      style={{
                        background: active ? `linear-gradient(180deg,${seatColor(youSlot)},${seatDeep(youSlot)})` : CARD,
                        color: active ? '#fffdf7' : INK_SOFT,
                        border: `2px solid ${active ? seatDeep(youSlot) : LINE}`,
                        boxShadow: active ? `0 2px 0 0 ${seatDeep(youSlot)}` : undefined,
                      }}>{AGENT_LABEL[a]}</button>
                  );
                })}
                <span className="ml-auto rounded-full px-2 py-0.5 text-[11px] font-extrabold tabnum"
                  style={{
                    background: affordable ? CREAM : BLUSH_LIGHT,
                    color: affordable ? INK_SOFT : BLUSH_DEEP,
                  }}>
                  cost {cost} / {s.energy?.[youSlot] ?? 0}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 w-[46px]"><Label>Action</Label></span>
                {ACTION_LIST.map((a) => (
                  <Choice key={a} active={action === a} onClick={() => { setAction(a); setTarget(null); }}
                    disabled={!interactive} label={ACTION_LABEL[a]} hint={COST[a] > 0 ? COST[a] : undefined} />
                ))}
              </div>
              <p className="pl-[50px] text-[11px] leading-snug" style={{ color: INK_MUTED }}>{ACTION_DETAIL[action]}</p>

              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 w-[46px]"><Label>Read</Label></span>
                {PREDICTIONS.map((p) => (
                  <Choice key={p} tone="mint" active={predict === p} onClick={() => setPredict(p)}
                    disabled={!interactive} label={ACTION_LABEL[p]}
                    pressed={predict === p} />
                ))}
                <span className="text-[10.5px]" style={{ color: INK_MUTED }}>
                  {myInsight.includes(predict) ? 'already cracked' : 'first crack pays influence'}
                </span>
              </div>

              <div className="mt-0.5 flex flex-wrap items-center gap-2 border-t pt-2" style={{ borderColor: CREAM }}>
                <span className="text-[11px] font-bold" style={{ color: INK_SOFT }} role="status" aria-live="polite">
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
                  title={actionBlurb(action)}
                  className="btn btn-primary btn-sm ml-auto no-tap">
                  Lock plan
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---------------- the three ways to win ---------------- */}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] font-bold" style={{ color: INK_MUTED }}>
        <span>First to 12 influence</span>
        <span aria-hidden style={{ color: LINE_STRONG }}>·</span>
        <span>
          {relayWinBlurb()}
          <span aria-hidden className="ml-1 inline-flex items-center gap-1" style={{ color: INK_MUTED }}>
            <span className="inline-block h-2 w-2 rounded-[2px]" style={{ border: `2px solid ${LINE_STRONG}` }} />
            ring = bolted
          </span>
        </span>
        <span aria-hidden style={{ color: LINE_STRONG }}>·</span>
        <span>close all {ringSquares.length} around their core</span>
      </div>
    </div>
  );
}
