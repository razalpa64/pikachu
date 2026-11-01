import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MAX_ROUNDS, OBJECTIVES, RELAYS, RELAY_WIN_COUNT, RELAY_WIN_STREAK, INFLUENCE_TO_WIN, createInitialState, objectiveById,
  vantaRules, relayWinBlurb, type VantaPlan, type VantaState,
} from './rules';
import { choosePlan, type VantaStrength } from './ai';
import { ASH, CORAL, INK, IVORY, PAPER, SLATE } from './theme';
import { rankFor, vantaRating } from './rank';
import VantaBoard from '../../components/boards/VantaBoard';
import { ResultOverlay } from '../../components/Overlays';
import { useStore } from '../../lib/store';
import type { GameMeta } from '../types';

/**
 * VANTA, solo.
 *
 * Three screens in one column, because a table game does not need a wizard:
 *
 *  1. **The card** — what the game is, what the three wins are, who you are
 *     playing, and the stats you have already earned against the practice AI.
 *  2. **The table** — the board and the plan composer. You lock a plan, the AI
 *     locks one from the same snapshot, and both resolve; neither can react.
 *  3. **The reveal** — the round report, then either the next round or the
 *     result card.
 *
 * The AI is the same engine the relay server runs (`rules.ts`) driven by the
 * same heuristic the online practice mode uses (`ai.ts`). Nothing here is
 * scripted, and no move is ever invented client-side: the practice opponent
 * submits through `vantaRules.applyMove` exactly like a second human would.
 */

const LEVELS: { value: VantaStrength; label: string; note: string }[] = [
  { value: 'beginner', label: 'Beginner', note: 'Plays the obvious square. Will not punish you.' },
  { value: 'casual', label: 'Casual', note: 'Claims what is free, misses most reads.' },
  { value: 'intermediate', label: 'Intermediate', note: 'Fights for relays and defends its ring.' },
  { value: 'advanced', label: 'Advanced', note: 'Sets traps, blocks claims, reads you half the time.' },
  { value: 'expert', label: 'Expert', note: 'Plays the position and reads the report every round.' },
];

const ROUND_CHOICES = [8, 12, 16];

export default function VantaSolo({ game: _game }: { game: GameMeta }) {
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
      <div className="mx-auto w-full max-w-[1040px] px-3 py-5 sm:px-5" style={{ color: PAPER }}>
        <div className="rounded-3xl p-5 sm:p-7" style={{ background: `linear-gradient(160deg,${SLATE},${INK})`, border: '1px solid #2b313a' }}>
          <p className="text-[10px] font-extrabold uppercase tracking-[.28em]" style={{ color: CORAL }}>VANTA · two players</p>
          <h1 className="mt-2 text-[26px] font-black leading-tight sm:text-[34px]" style={{ color: PAPER }}>
            Every move has a motive.
          </h1>
          <p className="mt-2 max-w-[62ch] text-[13px] leading-relaxed sm:text-[14px]" style={{ color: ASH }}>
            Seven by seven, three agents a side, five relays. Both players write a plan in secret —
            one agent, one action, one target, and a guess at what the other will do — and the table
            resolves them at the same instant. You cannot answer what they do this round. You can only
            read them before they do it.
          </p>

          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {[
              { t: 'Influence', d: `First to ${INFLUENCE_TO_WIN} wins. Territory, relays and a correct read all pay.` },
              { t: 'Relays', d: `Bolt ${relayWinBlurb().toLowerCase()} and the match is yours. A relay only counts once it is bolted.` },
              { t: 'The core', d: 'Own every square around their core and they are boxed in for good.' },
            ].map((c) => (
              <div key={c.t} className="rounded-2xl px-3 py-2.5" style={{ background: 'rgba(255,255,255,.04)', border: '1px solid #2b313a' }}>
                <p className="text-[10px] font-extrabold uppercase tracking-[.18em]" style={{ color: CORAL }}>{c.t}</p>
                <p className="mt-1 text-[12px] leading-snug" style={{ color: ASH }}>{c.d}</p>
              </div>
            ))}
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-[.18em]" style={{ color: ASH }}>Practice opponent</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {LEVELS.map((l) => (
                  <button key={l.value} type="button" onClick={() => setLevel(l.value)} aria-pressed={level === l.value}
                    className="rounded-full px-3 py-1.5 text-[12px] font-bold transition"
                    style={{
                      background: level === l.value ? IVORY : 'rgba(255,255,255,.05)',
                      color: level === l.value ? SLATE : ASH,
                      border: `1.5px solid ${level === l.value ? IVORY : '#333a44'}`,
                    }}>{l.label}</button>
                ))}
              </div>
              <p className="mt-1.5 text-[11.5px]" style={{ color: ASH }}>{LEVELS.find((l) => l.value === level)?.note}</p>

              <p className="mt-4 text-[10px] font-extrabold uppercase tracking-[.18em]" style={{ color: ASH }}>Match length</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {ROUND_CHOICES.map((r) => (
                  <button key={r} type="button" onClick={() => setRounds(r)} aria-pressed={rounds === r}
                    className="rounded-full px-3 py-1.5 text-[12px] font-bold transition"
                    style={{
                      background: rounds === r ? IVORY : 'rgba(255,255,255,.05)',
                      color: rounds === r ? SLATE : ASH,
                      border: `1.5px solid ${rounds === r ? IVORY : '#333a44'}`,
                    }}>{r} rounds</button>
                ))}
              </div>

              <button type="button" onClick={() => begin()}
                className="mt-5 w-full rounded-full px-5 py-3 text-[13px] font-extrabold uppercase tracking-[.14em] transition sm:w-auto"
                style={{ background: CORAL, color: '#2a1412' }}>
                Take the table
              </button>
            </div>

            <div className="rounded-2xl p-3" style={{ background: 'rgba(255,255,255,.04)', border: '1px solid #2b313a' }}>
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-extrabold uppercase tracking-[.18em]" style={{ color: ASH }}>Your table rank</p>
                <span className="rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider"
                  style={{ background: 'rgba(241,107,97,.16)', color: CORAL }}>{rank.tier}</span>
              </div>
              <p className="mt-1 text-[24px] font-black leading-none tabnum" style={{ color: PAPER }}>{rating}</p>
              <p className="mt-1 text-[11px]" style={{ color: ASH }}>{rank.blurb}</p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full" style={{ background: '#2b313a' }}>
                <div className="h-full rounded-full" style={{ width: `${Math.round(rank.progress * 100)}%`, background: CORAL }} />
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-1.5 text-[11px]">
                <StatCell label="Played" value={stat?.played ?? 0} />
                <StatCell label="Won" value={stat?.wins ?? 0} />
                <StatCell label="Win rate" value={stat?.played ? `${Math.round(((stat.wins ?? 0) / stat.played) * 100)}%` : '—'} />
                <StatCell label="Best" value={stat?.best ?? 0} />
              </dl>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const done = redacted.over;
  return (
    <div className="mx-auto w-full max-w-[980px] px-3 py-4 sm:px-5" style={{ color: PAPER }}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <p className="text-[10px] font-extrabold uppercase tracking-[.24em]" style={{ color: CORAL }}>VANTA</p>
        <span className="text-[11px]" style={{ color: ASH }}>
          practice · {LEVELS.find((l) => l.value === level)?.label} · {rank.tier}
        </span>
        <button type="button" onClick={() => begin()}
          className="ml-auto rounded-full px-3 py-1 text-[11px] font-bold"
          style={{ color: ASH, border: `1px solid #333a44` }}>New match</button>
      </div>

      <div className="rounded-3xl p-2.5 sm:p-4" style={{ background: `linear-gradient(170deg,${SLATE},${INK})`, border: '1px solid #2b313a' }}>
        <VantaBoard
          state={{ ...redacted, myInsight: redacted.insight?.[0] ?? [], foeHasSubmitted: !!state.plans[1] }}
          youSlot={0}
          onMove={(m) => lock(m as VantaPlan)}
          interactive={!done && !thinking && !state.plans[0]}
          names={['You', `AI · ${LEVELS.find((l) => l.value === level)?.label}`]}
        />
      </div>

      <div className="mt-2 rounded-2xl px-3 py-2" style={{ background: 'rgba(255,255,255,.04)', border: '1px solid #2b313a' }}>
        <p className="text-[10px] font-extrabold uppercase tracking-[.18em]" style={{ color: ASH }}>Coach</p>
        <p className="mt-0.5 text-[12px] leading-snug" style={{ color: PAPER }} aria-live="polite">
          {thinking ? 'They are reading the table…' : coach ?? coachLine(state, 0, level)}
        </p>
      </div>

      {done && (
        <div className="mt-3 rounded-2xl p-3" style={{ background: 'rgba(255,255,255,.04)', border: '1px solid #2b313a' }}>
          <p className="text-[10px] font-extrabold uppercase tracking-[.18em]" style={{ color: CORAL }}>Match report</p>
          <ul className="mt-1 grid gap-1 text-[12px]" style={{ color: ASH }}>
            <li>Rounds played: <span className="tabnum" style={{ color: PAPER }}>{state.round}</span> of {state.maxRounds}</li>
            <li>Influence: <span className="tabnum" style={{ color: PAPER }}>{state.influence[0]} – {state.influence[1]}</span></li>
            <li>Reads: <span className="tabnum" style={{ color: PAPER }}>{state.predictionsCorrect[0]}</span> correct · {state.insight[0].length} of 5 categories cracked</li>
            <li>Relays held: <span className="tabnum" style={{ color: PAPER }}>{state.relaysHeld[0]}</span> · squares taken from them: {state.captures[0]}</li>
            <li>Verdict: <span style={{ color: PAPER }}>{state.reason}</span></li>
          </ul>
        </div>
      )}

      {done && (
        <ResultOverlay
          verdict={state.winner === null ? 'draw' : state.winner === 0 ? 'win' : 'loss'}
          reason={state.reason}
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

      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        <Fact title="The read" body="A correct read pays energy every time, and influence the first time you name each of the five categories. Five categories, five points — a predictable opponent is worth five influence, not twelve." />
        <Fact title="Energy" body={`You start with 3 and cap at 5. Claims cost 1, a shove or a bolt-break adds 1, a relay they hold adds 2 more, anchors and snares cost 2. Nothing is deducted unless the action actually happens.`} />
        <Fact title="Objectives" body={`One secret objective each, worth 2 influence: ${OBJECTIVES.map((o) => o.title).join(', ')}. They are never shown to your opponent.`} />
      </div>
    </div>
  );
}

function StatCell({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg px-2 py-1" style={{ background: 'rgba(255,255,255,.04)' }}>
      <dt className="text-[9.5px] font-extrabold uppercase tracking-wider" style={{ color: ASH }}>{label}</dt>
      <dd className="tabnum text-[13px] font-bold" style={{ color: PAPER }}>{value}</dd>
    </div>
  );
}

function Fact({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl px-3 py-2.5" style={{ background: 'rgba(255,255,255,.04)', border: '1px solid #2b313a' }}>
      <p className="text-[10px] font-extrabold uppercase tracking-[.18em]" style={{ color: CORAL }}>{title}</p>
      <p className="mt-1 text-[11.5px] leading-snug" style={{ color: ASH }}>{body}</p>
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
