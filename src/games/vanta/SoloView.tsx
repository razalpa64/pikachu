import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ACTION_LABEL, EVENT_LABEL, MAX_ROUNDS, OBJECTIVES, PREDICTIONS, RELAYS, RELAY_WIN_COUNT, RELAY_WIN_STREAK,
  INFLUENCE_TO_WIN, createInitialState, objectiveById, vantaRules, relayWinBlurb, type VantaPlan, type VantaState,
} from './rules';
import { choosePlan, type VantaStrength } from './ai';
import {
  BLUSH_DEEP, BLUSH_LIGHT, BUTTER_DEEP, BUTTER_LIGHT, CARD, CREAM, INK, INK_MUTED, INK_SOFT,
  LEAF, LINE, LINE_STRONG, MINT, MINT_LIGHT, seatColor, seatDeep,
} from './theme';
import { rankFor, vantaRating } from './rank';
import VantaBoard from '../../components/boards/VantaBoard';
import SoloShell from '../../components/SoloShell';
import { Button, Icon, Panel, Segmented, Stat } from '../../components/ui';
import { ResultOverlay } from '../../components/Overlays';
import { useStore } from '../../lib/store';
import type { GameMeta } from '../types';

/**
 * VANTA, solo.
 *
 * Three screens in one column, because a table game does not need a wizard:
 *
 *  1. **The card** — what the game is, what the three wins are, who you are
 *     playing, and the rating you have already earned against the practice AI.
 *  2. **The table** — the board and the plan composer. You lock a plan, the AI
 *     locks one from the same snapshot, and both resolve; neither can react.
 *  3. **The reveal** — the round report, then either the next round or the
 *     result card.
 *
 * The AI is the same engine the relay server runs (`rules.ts`) driven by the
 * same heuristic the online practice mode uses (`ai.ts`). Nothing here is
 * scripted, and no move is ever invented client-side: the practice opponent
 * submits through `vantaRules.applyMove` exactly like a second human would.
 *
 * Everything on this screen is drawn in the arcade's own palette — cream paper,
 * cocoa type, a butter primary button — so the game reads as part of the shelf
 * rather than a dark room bolted onto it. The board is the only "object": a
 * wooden plinth with two seats' colours on it.
 */

const LEVELS: { value: VantaStrength; label: string; note: string }[] = [
  { value: 'beginner', label: 'Beginner', note: 'Plays the obvious square. Will not punish you.' },
  { value: 'casual', label: 'Casual', note: 'Claims what is free, misses most reads.' },
  { value: 'intermediate', label: 'Intermediate', note: 'Fights for relays and defends its ring.' },
  { value: 'advanced', label: 'Advanced', note: 'Sets traps, blocks claims, reads you half the time.' },
  { value: 'expert', label: 'Expert', note: 'Plays the position and reads the report every round.' },
];

const ROUND_CHOICES = [8, 12, 16];

/**
 * The engine names its seats Ivory and Coral — useful in a rulebook, wrong on a
 * screen where the two seats are called You and AI. Every sentence the engine
 * writes goes through here before a player sees it.
 */
const speak = (line: string, you: string, them: string) =>
  line.replace(/\bIvory\b/g, you).replace(/\bCoral\b/g, them);

export default function VantaSolo({ game }: { game: GameMeta }) {
  const { sfx, finishMatch, progress } = useStore();
  const [level, setLevel] = useState<VantaStrength>('intermediate');
  const [rounds, setRounds] = useState<number>(MAX_ROUNDS);
  const [state, setState] = useState<VantaState | null>(null);
  const [thinking, setThinking] = useState(false);
  const [coach, setCoach] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const recorded = useRef(false);
  const seedRef = useRef(1);

  const stat = progress.stats.vanta;
  const rating = vantaRating(stat);
  const rank = rankFor(rating);

  const begin = useCallback((nextLevel = level, nextRounds = rounds) => {
    seedRef.current = (Date.now() % 100000) + 1;
    const fresh = createInitialState({ rounds: nextRounds }, seedRef.current);
    setState(fresh);
    setCoach(null);
    setShown(false);
    recorded.current = false;
    sfx('boot');
  }, [level, rounds, sfx]);

  /* the practice opponent answers through the engine, never through a script */
  const submit = useCallback((mine: VantaPlan) => {
    setState((prev) => {
      if (!prev || prev.over) return prev;
      const afterMine = vantaRules.applyMove(prev, 0, mine);
      if (afterMine.over) return afterMine;
      const theirs = choosePlan(prev, 1, level, Math.random);
      const resolved = vantaRules.applyMove(afterMine, 1, theirs);
      setCoach(coachLine(resolved, 1, level));
      sfx(resolved.influence[0] > prev.influence[0] ? 'spark' : 'place');
      return resolved;
    });
  }, [level, sfx]);

  /* a short beat so the reveal reads as an event rather than a redraw */
  const lock = useCallback((mine: VantaPlan) => {
    if (!state || state.over) return;
    setThinking(true);
    sfx('place');
    window.setTimeout(() => {
      submit(mine);
      setThinking(false);
    }, 340);
  }, [state, submit, sfx]);

  useEffect(() => {
    if (!state?.over || shown || recorded.current) return;
    setShown(true);
    recorded.current = true;
    const won = state.winner === 0;
    sfx(won ? 'win' : state.winner === null ? 'draw' : 'lose');
    finishMatch({
      gameId: 'vanta',
      mode: 'ai',
      result: state.winner === null ? 'draw' : won ? 'win' : 'loss',
      meta: {
        difficulty: level,
        vantaInfluence: state.influence[0],
        vantaReads: state.predictionsCorrect[0],
        vantaInsight: state.insight[0].length,
        vantaRelays: state.relaysHeld[0],
        vantaReason: state.reason,
        vantaRounds: state.round,
      },
    });
  }, [state?.over]);  // eslint-disable-line react-hooks/exhaustive-deps

  const redacted = useMemo(() => {
    if (!state) return null;
    /* the practice seat sees exactly what an online seat sees: their own plan,
       their own traps, their own objective — never the AI's */
    return vantaRules.redact!(state, 0) as VantaState;
  }, [state]);

  if (!state || !redacted) {
    return (
      <div className="mx-auto w-full max-w-[1040px] px-3 py-5 sm:px-5">
        {/* ---------------- the card ---------------- */}
        <div
          className="relative overflow-hidden rounded-[26px] p-4 sm:p-6"
          style={{
            background: `linear-gradient(170deg,${CARD},#fff6e6)`,
            border: `2.5px solid ${LINE_STRONG}`,
            boxShadow: '0 1px 0 rgba(255,255,255,.95) inset, 0 5px 0 0 #edd3b4, 0 22px 40px -30px rgba(140,94,70,.8)',
          }}
        >
          {/* a corner of the cover art, blurred back so the type stays the subject */}
          <span aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-44 w-44 rotate-6 rounded-[28px] opacity-30 sm:h-56 sm:w-56"
            style={{
              backgroundImage: 'url(/art/game/vanta.webp)', backgroundSize: 'cover', backgroundPosition: 'center',
              filter: 'saturate(.95) blur(.4px)',
              maskImage: 'radial-gradient(circle at 70% 30%, #000 30%, transparent 72%)',
              WebkitMaskImage: 'radial-gradient(circle at 70% 30%, #000 30%, transparent 72%)',
            }} />

          <div className="relative">
            <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[.2em]"
              style={{ background: BUTTER_LIGHT, color: BUTTER_DEEP, border: `2px solid ${seatColor(0)}` }}>
              <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: seatColor(0), border: `1px solid ${seatDeep(0)}` }} />
              Two players · read them first
            </span>

            <h1 className="mt-2.5 text-[28px] font-black leading-[1.05] sm:text-[38px]" style={{ color: INK }}>
              Every move has a motive.
            </h1>
            <p className="mt-2 max-w-[62ch] text-[13px] font-semibold leading-relaxed sm:text-[14px]" style={{ color: INK_SOFT }}>
              Seven by seven, three agents a side, five relays. Both players write a plan in secret —
              one agent, one action, one target, and a guess at what the other will do — and the table
              resolves them at the same instant. You cannot answer what they do this round. You can only
              read them before they do it.
            </p>

            <div className="mt-3.5 grid gap-2 sm:grid-cols-3">
              {[
                { t: 'Influence', d: `First to ${INFLUENCE_TO_WIN} wins. Territory, relays and a correct read all pay.`, tint: BUTTER_LIGHT, ink: BUTTER_DEEP },
                { t: 'Relays', d: `Bolt ${relayWinBlurb().toLowerCase()} and the match is yours. A relay only counts once it is bolted.`, tint: MINT_LIGHT, ink: LEAF },
                { t: 'The core', d: 'Own every square around their core and they are boxed in for good.', tint: BLUSH_LIGHT, ink: BLUSH_DEEP },
              ].map((c) => (
                <div key={c.t} className="rounded-[16px] px-2.5 py-2"
                  style={{ background: c.tint, border: `2px solid ${LINE}` }}>
                  <p className="text-[9.5px] font-extrabold uppercase tracking-[.18em]" style={{ color: c.ink }}>{c.t}</p>
                  <p className="mt-0.5 text-[11.5px] font-semibold leading-snug" style={{ color: INK_SOFT }}>{c.d}</p>
                </div>
              ))}
            </div>

            <div className="mt-4 grid gap-3.5 lg:grid-cols-[minmax(0,1fr)_312px]">
              <div>
                <PillLabel>Practice opponent</PillLabel>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {LEVELS.map((l) => (
                    <Pick key={l.value} active={level === l.value} onClick={() => setLevel(l.value)} label={l.label} />
                  ))}
                </div>
                <p className="mt-1.5 text-[11.5px] font-semibold" style={{ color: INK_MUTED }}>{LEVELS.find((l) => l.value === level)?.note}</p>

                <div className="mt-3.5">
                  <PillLabel>Match length</PillLabel>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {ROUND_CHOICES.map((r) => (
                    <Pick key={r} active={rounds === r} onClick={() => setRounds(r)} label={`${r} rounds`} />
                  ))}
                </div>

                <button type="button" onClick={() => begin()}
                  className="btn btn-primary no-tap mt-4 w-full sm:w-auto">
                  Take the table
                </button>
              </div>

              {/* ---------------- rank card ---------------- */}
              <div className="rounded-[18px] px-3 py-2.5"
                style={{ background: `linear-gradient(180deg,${CARD},#fff9ee)`, border: `2px solid ${LINE}` }}>
                <div className="flex items-center justify-between gap-2">
                  <PillLabel>Your table rank</PillLabel>
                  <span className="rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider"
                    style={{ background: BUTTER_LIGHT, color: BUTTER_DEEP, border: `1.5px solid ${seatColor(0)}` }}>{rank.tier}</span>
                </div>
                <p className="mt-0.5 text-[26px] font-black leading-none tabnum" style={{ color: INK }}>{rating}</p>
                <p className="mt-1 text-[11px] font-semibold leading-snug" style={{ color: INK_MUTED }}>{rank.blurb}</p>
                <div className="mt-2 h-2 overflow-hidden rounded-full" style={{ background: CREAM }}>
                  <div className="h-full rounded-full" style={{
                    width: `${Math.round(rank.progress * 100)}%`,
                    background: `linear-gradient(90deg,${BUTTER_LIGHT},${seatColor(0)})`,
                  }} />
                </div>
                <dl className="mt-2.5 grid grid-cols-2 gap-1.5">
                  <StatCell label="Played" value={stat?.played ?? 0} />
                  <StatCell label="Won" value={stat?.wins ?? 0} />
                  <StatCell label="Win rate" value={stat?.played ? `${Math.round(((stat.wins ?? 0) / stat.played) * 100)}%` : '—'} />
                  <StatCell label="Best" value={stat?.best ?? 0} />
                </dl>
              </div>
            </div>
          </div>
        </div>

        {/* ---------------- the three rules that decide matches ---------------- */}
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <Fact title="The read" body="A correct read pays energy every time, and influence the first time you name each of the five categories. Five categories, five points — a predictable opponent is worth five influence, not twelve." />
          <Fact title="Energy" body="You start with 3 and cap at 5. Claims cost 1, a shove or a bolt-break adds 1, a relay they hold adds 2 more, anchors and snares cost 2. Nothing is deducted unless the action actually happens." />
          <Fact title="Objectives" body={`One secret objective each, worth 2 influence: ${OBJECTIVES.map((o) => o.title).join(', ')}. They are never shown to your opponent.`} />
        </div>
      </div>
    );
  }

  const done = redacted.over;
  const foeInfluence = state.influence[1] ?? 0;
  const myRelays = RELAYS.filter((r) => state.owner[r] === 0 && state.anchored[r]).length;

  return (
    <SoloShell
      game={game}
      wide
      mascot={done ? (state.winner === 0 ? 'victory' : state.winner === 1 ? 'defeated' : 'thinking') : thinking ? 'thinking' : 'competitive'}
      mascotLine={thinking ? 'They are reading the table…' : speak(coach ?? coachLine(state, 0, level), 'You', 'They')}
      onRestart={() => begin()}
      controls={
        <>
          <span className="eyebrow">Opponent</span>
          <Segmented value={level} onChange={(v) => { setLevel(v); }} size="sm"
            label="Practice opponent"
            options={LEVELS.map((l) => ({ value: l.value, label: l.label }))} />
          <span className="eyebrow ml-1">Rounds</span>
          <Segmented value={rounds} onChange={(v) => { setRounds(v); begin(level, v); }} size="sm"
            label="Match length"
            options={ROUND_CHOICES.map((r) => ({ value: r, label: String(r) }))} />
          <Button size="sm" variant="ghost" onClick={() => begin()} icon={<Icon name="rotate" size={13} />}>New table</Button>
        </>
      }
      hud={
        <Panel className="vanta-hud p-2 sm:p-3 flex items-center gap-2 sm:gap-3 flex-wrap justify-center">
          <Stat label="You" value={state.influence[0]} accent={BUTTER_DEEP} />
          <Stat label="AI" value={foeInfluence} accent={BLUSH_DEEP} />
          <Stat label="Round" value={`${state.round}/${state.maxRounds ?? MAX_ROUNDS}`} />
          <Stat label="Relays" value={`${myRelays}/5`} accent={LEAF} />
          {state.event && (
            <span className="px-2.5 py-1 text-[10.5px] font-extrabold uppercase tracking-wider notch-sm"
              style={{ background: MINT_LIGHT, color: LEAF, border: `2px solid ${MINT}` }}
              title={EVENT_LABEL[state.event.kind].detail}>
              {EVENT_LABEL[state.event.kind].title}
            </span>
          )}
          <span className="px-2.5 py-1 text-[10.5px] font-extrabold uppercase tracking-wider notch-sm"
            style={{ background: thinking || state.plans[0] ? MINT_LIGHT : BUTTER_LIGHT, color: thinking || state.plans[0] ? LEAF : BUTTER_DEEP }}>
            {done ? 'Match over' : state.plans[0] ? 'Plan locked' : thinking ? 'Resolving' : 'Your plan'}
          </span>
        </Panel>
      }
      footer={
        <div className="panel notch-sm px-3 py-2 w-full max-w-[34ch]">
          <p className="eyebrow mb-1">Your read</p>
          <div className="flex flex-wrap gap-1">
            {PREDICTIONS.map((p) => {
              const cracked = (redacted.insight?.[0] ?? []).includes(p);
              return (
                <span key={p} className="rounded-full px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider"
                  style={{
                    background: cracked ? MINT_LIGHT : '#fffaf0',
                    color: cracked ? LEAF : INK_MUTED,
                    border: `1.5px solid ${cracked ? MINT : CREAM}`,
                  }}>{ACTION_LABEL[p]}</span>
              );
            })}
          </div>
        </div>
      }
    >
      <VantaBoard
        state={{ ...redacted, myInsight: redacted.insight?.[0] ?? [], foeHasSubmitted: !!state.plans[1] }}
        youSlot={0}
        onMove={(m) => lock(m as VantaPlan)}
        interactive={!done && !thinking && !state.plans[0]}
        names={['You', 'AI']}
      />

      {done && (
        <div className="w-full max-w-[560px] rounded-2xl px-3 py-2.5"
          style={{ background: CARD, border: `2px solid ${LINE}` }}>
          <p className="eyebrow" style={{ color: BUTTER_DEEP }}>Match report</p>
          <ul className="mt-1 grid gap-1 text-[12px] font-semibold" style={{ color: INK_SOFT }}>
            <li>Rounds played: <b className="tabnum" style={{ color: INK }}>{state.round}</b> of {state.maxRounds}</li>
            <li>Influence: <b className="tabnum" style={{ color: INK }}>{state.influence[0]} – {state.influence[1]}</b></li>
            <li>Reads: <b className="tabnum" style={{ color: INK }}>{state.predictionsCorrect[0]}</b> correct · {state.insight[0].length} of 5 categories cracked</li>
            <li>Relays held: <b className="tabnum" style={{ color: INK }}>{state.relaysHeld[0]}</b> · squares taken from them: {state.captures[0]}</li>
            <li>Verdict: <b style={{ color: INK }}>{speak(state.reason, 'You', 'the AI')}</b></li>
          </ul>
        </div>
      )}

      {done && (
        <ResultOverlay
          verdict={state.winner === null ? 'draw' : state.winner === 0 ? 'win' : 'loss'}
          reason={speak(state.reason, 'You', 'the AI')}
          playerA={{ name: 'You', score: state.influence[0] }}
          playerB={{ name: `AI · ${LEVELS.find((l) => l.value === level)?.label}`, score: state.influence[1] }}
          rows={[
            { label: 'Influence', a: state.influence[0], b: state.influence[1] },
            { label: 'Reads', a: state.predictionsCorrect[0], b: state.predictionsCorrect[1] },
            { label: 'Relays held', a: state.relaysHeld[0], b: state.relaysHeld[1] },
          ]}
          onRematch={() => begin()}
          rematchLabel="Rematch"
        />
      )}
    </SoloShell>
  );
}

function PillLabel({ children }: { children: ReactNode }) {
  return <p className="text-[9.5px] font-extrabold uppercase tracking-[.18em]" style={{ color: INK_MUTED }}>{children}</p>;
}

/** A choice pill in the site's own language: cream when idle, butter when picked. */
function Pick({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className="no-tap rounded-full px-3 py-1.5 text-[12px] font-extrabold transition"
      style={{
        background: active ? `linear-gradient(180deg,#ffe890,#ffd24d)` : CARD,
        color: active ? '#5a3a12' : INK_SOFT,
        border: `2px solid ${active ? '#e0a21f' : LINE}`,
        boxShadow: active ? '0 2px 0 0 #e0a21f' : undefined,
      }}>{label}</button>
  );
}

function StatCell({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-[10px] px-2 py-1" style={{ background: '#fffaf0', border: `1.5px solid ${CREAM}` }}>
      <dt className="text-[9px] font-extrabold uppercase tracking-wider" style={{ color: INK_MUTED }}>{label}</dt>
      <dd className="tabnum text-[13px] font-extrabold" style={{ color: INK }}>{value}</dd>
    </div>
  );
}

function Fact({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-[16px] px-2.5 py-2"
      style={{ background: `linear-gradient(180deg,${CARD},#fff9ee)`, border: `2px solid ${LINE}` }}>
      <p className="text-[9.5px] font-extrabold uppercase tracking-[.18em]" style={{ color: BUTTER_DEEP }}>{title}</p>
      <p className="mt-0.5 text-[11px] font-semibold leading-snug" style={{ color: INK_MUTED }}>{body}</p>
    </div>
  );
}

/** One honest sentence about the position, not a hint system. */
function coachLine(s: VantaState, slot: 0 | 1, level: VantaStrength): string {
  if (s.over) return s.reason;
  const mine = s.influence[slot];
  const theirs = s.influence[slot === 0 ? 1 : 0];
  const relays = RELAYS.filter((r) => s.owner[r] === slot && s.anchored[r]).length;
  const theirRelays = RELAYS.filter((r) => s.owner[r] === (slot === 0 ? 1 : 0) && s.anchored[r]).length;
  if (relays >= RELAY_WIN_COUNT && s.relayStreak[slot] > 0) {
    return `You hold ${relays} relays and ${s.relayStreak[slot]} of ${RELAY_WIN_STREAK} phases. Hold the network one more round and the match is yours.`;
  }
  if (relays >= RELAY_WIN_COUNT) return 'Your posts are bolted: keep all of them for the rest of the streak and this is over.';
  if (relays === RELAY_WIN_COUNT - 1) return 'One more bolted relay and the clock starts — bolt it, because a loose post does not count.';
  if (theirs - mine >= 4) return 'They are ahead on influence. You need a read or a relay sweep, not another quiet square.';
  if (s.energy[slot] <= 1) return 'Low on energy: a move is free, and a read can pay you back.';
  if (theirRelays >= 2) return 'They are bolting a sweep. Break a bolt — that is the only thing that stops the clock.';
  const obj = objectiveById(s.objective[slot]);
  return `Objective: ${obj.title} — ${obj.detail} ${level === 'expert' ? 'The AI is tracking your last three actions.' : ''}`.trim();
}
