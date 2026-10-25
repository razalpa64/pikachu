import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Difficulty, GameMeta } from '../types';
import { rng, type Slot } from '../types';
import SoloShell, { ModeRail } from '../../components/SoloShell';
import { Button, Panel, Stat } from '../../components/ui';
import { ResultOverlay } from '../../components/Overlays';
import { useStore } from '../../lib/store';
import {
  DEFAULT_BLUFF, MAX_LIE, aiLie, ballot, buildBluffQueue, scoreBallot,
} from './rules';
import type { Question } from '../trivia/bank';

/**
 * Bluff Trivia, alone with the arcade.
 *
 * The duel is the same shape as the online one — write a lie, then find the truth
 * in a ballot of three — but the opponent is Pikachu, so two things are honest
 * here that a fake "online" mode never is:
 *
 *   • the arcade's lie is one of the question's own *plausible wrong answers*,
 *     not a random string, and it is chosen deterministically from the seed;
 *   • its chance of spotting the truth is stated per level and capped below 1.
 *     Even Expert misses one in five, the same as a good human player.
 */
const ACCURACY: Record<Difficulty, number> = {
  beginner: 0.3, casual: 0.42, intermediate: 0.55, advanced: 0.68, expert: 0.8,
};

type Phase = 'write' | 'vote' | 'reveal' | 'done';

interface RoundView {
  question: Question;
  playerLie: string | null;
  aiLie: string | null;
  options: string[];
  owner: (Slot | 'truth')[];
  votes: [number | null, number | null];
  points: [number, number];
}

export default function BluffSolo({ game }: { game: GameMeta }) {
  const { sfx, finishMatch } = useStore();
  const [difficulty, setDifficulty] = useState<Difficulty>('intermediate');
  const [rounds, setRounds] = useState(DEFAULT_BLUFF.rounds);
  const [seed, setSeed] = useState(() => (Date.now() ^ 0x2545f491) >>> 0);

  const queue = useMemo(() => buildBluffQueue(rounds, seed), [rounds, seed]);
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('write');
  const [draft, setDraft] = useState('');
  const [lied, setLied] = useState<string | null>(null);
  const [round, setRound] = useState<RoundView | null>(null);
  const [score, setScore] = useState<[number, number]>([0, 0]);
  const [history, setHistory] = useState<RoundView[]>([]);
  const [left, setLeft] = useState(DEFAULT_BLUFF.writeMs / 1000);
  const logged = useRef(false);
  const aiTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const ask = queue[index];

  const reset = useCallback(() => {
    clearTimeout(aiTimer.current);
    const s = (Date.now() ^ 0x9e3779b9) >>> 0;
    setSeed(s);
    setIndex(0); setPhase('write'); setDraft(''); setLied(null); setRound(null);
    setScore([0, 0]); setHistory([]); setLeft(DEFAULT_BLUFF.writeMs / 1000);
    logged.current = false;
  }, []);

  useEffect(() => { reset(); /* a new setup is a new match */ }, [rounds, difficulty]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------------------------------------------------------- round engine */
  const openVote = useCallback((playerLie: string | null) => {
    if (!ask) return;
    const lie = aiLie(ask, seed, index);
    const { options, owner } = ballot(ask.a[0], [playerLie, lie], seed, index);
    setRound({
      question: ask, playerLie, aiLie: lie, options, owner,
      votes: [null, null], points: [0, 0],
    });
    setPhase('vote');
    setLeft(Math.round(DEFAULT_BLUFF.voteMs / 1000));
    sfx('notify');
  }, [ask, seed, index, sfx]);

  const closeRound = useCallback((choice: number | null) => {
    setRound((r) => {
      if (!r) return r;
      // Pikachu votes: mostly for the truth, sometimes for the better-sounding lie
      const truthIndex = r.owner.indexOf('truth');
      const rr = rng((seed ^ ((index + 1) * 0x27d4eb2f)) >>> 0);
      const spotsTruth = rr() < ACCURACY[difficulty];
      let aiVote = truthIndex;
      if (!spotsTruth) {
        const others = r.options.map((_, i) => i).filter((i) => i !== truthIndex);
        aiVote = others.length ? others[Math.floor(rr() * others.length)] : truthIndex;
      }
      // and never its own invention by accident
      if (r.owner[aiVote] === 1) {
        const mine = r.options.findIndex((o, i) => r.owner[i] === 0);
        aiVote = mine >= 0 ? mine : truthIndex;
      }

      const votes: [number | null, number | null] = [choice, aiVote];
      const points = scoreBallot(r.options, r.owner, votes);
      const closed: RoundView = { ...r, votes, points };
      setHistory((h) => [...h, closed]);
      setScore(([a, b]) => [a + points[0], b + points[1]]);
      setPhase('reveal');
      sfx(points[0] > points[1] ? 'win' : points[0] === points[1] ? 'notify' : 'lose');
      clearTimeout(aiTimer.current);
      aiTimer.current = setTimeout(() => {
        if (index + 1 >= queue.length) setPhase('done');
        else {
          setIndex((i) => i + 1);
          setLied(null);
          setDraft('');
          setRound(null);
          setPhase('write');
          setLeft(Math.round(DEFAULT_BLUFF.writeMs / 1000));
        }
      }, 3200);
      return closed;
    });
  }, [seed, index, difficulty, queue.length, sfx]);

  /* ------------------------------------------------------------- countdown */
  useEffect(() => {
    if (phase === 'reveal' || phase === 'done') return;
    const limit = phase === 'write' ? DEFAULT_BLUFF.writeMs : DEFAULT_BLUFF.voteMs;
    const started = Date.now();
    setLeft(Math.round(limit / 1000));
    const id = setInterval(() => {
      const remaining = Math.max(0, limit - (Date.now() - started));
      setLeft(Math.ceil(remaining / 1000));
      if (remaining <= 0) {
        clearInterval(id);
        // running out of time is a real outcome, not a pause
        if (phase === 'write') openVote(lied);
        else closeRound(null);
      }
    }, 250);
    return () => clearInterval(id);
  }, [phase, index]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => clearTimeout(aiTimer.current), []);

  /* --------------------------------------------------------------- results */
  useEffect(() => {
    if (phase !== 'done' || logged.current) return;
    logged.current = true;
    const result = score[0] > score[1] ? 'win' : score[0] === score[1] ? 'draw' : 'loss';
    finishMatch({
      gameId: 'bluff', mode: 'ai', result, score: score[0],
      meta: { rounds: history.length, difficulty, foundTruth: history.filter((h) => h.votes[0] === h.owner.indexOf('truth')).length },
    });
  }, [phase, score, history, difficulty, finishMatch]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!ask || phase !== 'write' || lied) return;
    if (!text) return;
    if (text.toLowerCase().replace(/[.!?]+$/, '') === ask.a[0].toLowerCase().replace(/[.!?]+$/, '')) {
      // the real answer is not a lie — say so rather than silently balls it up
      sfx('error');
      return;
    }
    setLied(text);
    sfx('select');
    openVote(text);
  };

  const last = history[history.length - 1];
  const verdict = score[0] > score[1] ? 'win' : score[0] === score[1] ? 'draw' : 'loss';

  return (
    <SoloShell
      game={game}
      mascot={phase === 'write' ? 'thinking' : phase === 'vote' ? 'competitive' : phase === 'reveal' ? (verdict === 'win' ? 'victory' : 'waiting') : 'idle'}
      mascotLine={
        phase === 'write' ? 'Write something believable. Pikachu is writing one too.'
          : phase === 'vote' ? 'One of these is true and one is Pikachu’s invention. Pick carefully.'
            : last ? `Truth: ${last.question.a[0]}. ${last.points[0] > last.points[1] ? 'You took the round.' : last.points[0] === last.points[1] ? 'Round split.' : 'Pikachu took it.'}`
              : ''
      }
      onRestart={reset}
      controls={
        <ModeRail
          mode="ai" setMode={() => {}} modes={[{ value: 'ai', label: 'Vs Pikachu' }]}
          difficulty={difficulty} setDifficulty={setDifficulty} showDifficulty
          extra={
            <>
              <span className="eyebrow ml-1">Rounds</span>
              <select value={rounds} onChange={(e) => setRounds(Number(e.target.value))}
                aria-label="Rounds"
                className="bg-ink-800 border-2 border-ink-500 rounded-lg px-2 h-8 text-[12px] font-bold text-cream-100">
                {[3, 5, 8].map((r) => <option key={r} value={r}>{r} rounds</option>)}
              </select>
            </>
          }
        />
      }
      hud={
        <Panel className="p-2 sm:p-3 flex items-center gap-2 sm:gap-4 flex-wrap justify-center">
          <Stat label="Round" value={`${Math.min(index + 1, queue.length)}/${queue.length}`} />
          <Stat label="You" value={score[0]} accent={game.accent} />
          <Stat label="Pikachu" value={score[1]} accent="var(--color-blush-600)" />
          <Stat label="Time" value={`${left}s`} />
        </Panel>
      }
    >
      <div className="w-full max-w-[720px] flex flex-col gap-3">
        <Panel className="p-4 sm:p-5">
          {ask ? (
            <>
              <p className="eyebrow mb-1.5">{ask.cat} · {phase === 'write' ? 'write a lie' : phase === 'vote' ? 'find the truth' : 'the answer'}</p>
              <p className="display text-[19px] sm:text-[22px] leading-snug text-cream-100">{ask.q}</p>

              {phase === 'write' && (
                <form onSubmit={submit} className="mt-3.5">
                  <label htmlFor="bluff-solo-lie" className="eyebrow block mb-1.5">Your lie</label>
                  <div className="flex gap-2">
                    <input id="bluff-solo-lie" value={draft} maxLength={MAX_LIE}
                      onChange={(e) => setDraft(e.target.value.slice(0, MAX_LIE))}
                      placeholder="Believable, but wrong…" autoComplete="off"
                      className="flex-1 min-w-0 bg-ink-800 border-2 border-ink-500 rounded-xl px-3 h-11 text-[14px] text-cream-100 placeholder:text-cream-400 outline-none focus:border-volt-500" />
                    <Button type="submit" variant="primary" className="h-11 shrink-0" disabled={!draft.trim()}>Write it</Button>
                  </div>
                  <p className="text-[10.5px] text-cream-400 mt-1.5">
                    {MAX_LIE - draft.length} characters left. The real answer is not a valid lie.
                  </p>
                </form>
              )}

              {phase === 'vote' && round && (
                <div className="mt-3.5 flex flex-col gap-2">
                  {round.options.map((option, i) => {
                    const mine = round.owner[i] === 0;
                    return (
                      <button key={`${i}-${option}`} disabled={mine} data-option={i}
                        onClick={() => { sfx('select'); closeRound(i); }}
                        className={`text-left px-3.5 py-2.5 rounded-xl border-2 transition-colors
                          ${mine ? 'opacity-55 cursor-not-allowed border-ink-500 bg-ink-800' : 'border-ink-500 bg-ink-800 hover:border-volt-500'}`}>
                        <span className="text-[14px] font-semibold text-cream-100">{option}</span>
                        {mine && <span className="ml-2 text-[10px] font-extrabold uppercase tracking-wider text-blush-600">your lie</span>}
                      </button>
                    );
                  })}
                </div>
              )}

              {(phase === 'reveal' || phase === 'done') && last && (
                <div className="mt-3.5">
                  <div className="rounded-xl border-2 border-leaf-400 bg-[#eafaf2] px-3 py-2.5">
                    <p className="eyebrow text-leaf-700">The truth</p>
                    <p className="text-[15px] font-extrabold text-cream-100">{last.question.a[0]}</p>
                  </div>
                  <ul className="mt-2.5 flex flex-col gap-1.5">
                    {last.options.map((option, i) => {
                      const owner = last.owner[i];
                      const votes = (last.votes[0] === i ? 1 : 0) + (last.votes[1] === i ? 1 : 0);
                      return (
                        <li key={`${i}-${option}`} className="flex items-center gap-2 text-[12.5px]">
                          <span className={`flex-1 ${owner === 'truth' ? 'font-extrabold text-leaf-700' : 'text-cream-300'}`}>{option}</span>
                          <span className="text-[10.5px] uppercase tracking-wider font-extrabold text-cream-400">
                            {owner === 'truth' ? 'true' : owner === 0 ? 'your lie' : 'Pikachu’s lie'}
                          </span>
                          {votes > 0 && <span className="text-[10.5px] font-extrabold text-blush-600">+{(owner === 'truth' ? 2 : 1) * votes}</span>}
                        </li>
                      );
                    })}
                  </ul>
                  <p className="text-[11px] text-cream-400 mt-2">+2 for the truth · +1 for every vote a lie stole.</p>
                </div>
              )}
            </>
          ) : (
            <p className="text-[13px] text-cream-500">No questions left in the bank for this run.</p>
          )}
        </Panel>

        <p className="text-[11px] text-cream-400 text-center max-w-[52ch] mx-auto">
          The arcade’s lie is always one of the question’s own wrong answers, so it sounds like a real one.
          Its chance of finding the truth is fixed by the level — Expert still misses one in five.
        </p>
      </div>

      {phase === 'done' && (
        <ResultOverlay
          verdict={verdict}
          reason={`${score[0]} to ${score[1]} over ${history.length} rounds.`}
          playerA={{ name: 'You', score: score[0], you: true }}
          playerB={{ name: 'Pikachu', score: score[1] }}
          onRematch={reset}
          rematchLabel="Play again"
          onExit={reset}
        />
      )}
    </SoloShell>
  );
}
