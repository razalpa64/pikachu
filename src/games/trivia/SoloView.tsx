import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Difficulty, GameMeta } from '../types';
import SoloShell, { ModeRail } from '../../components/SoloShell';
import { Button, Icon, Panel, Segmented, Stat, Toggle } from '../../components/ui';
import { ResultOverlay } from '../../components/Overlays';
import { useStore } from '../../lib/store';
import { CATEGORY_LABEL, type Category } from './bank';
import {
  createQuiz, orderFor, answer, rivalAnswer, correctCount, accuracyOf,
  DEFAULT_CONFIG, type QuizState,
} from './rules';

const ALL_CATS: Category[] = ['science', 'history', 'general', 'maths', 'geography', 'nature'];
const MODES = [
  { value: 'solo', label: 'Solo' },
  { value: 'ai', label: 'Vs AI' },
  { value: 'local', label: 'Pass & play' },
];

export default function TriviaSolo({ game }: { game: GameMeta }) {
  const { sfx, finishMatch } = useStore();
  const [mode, setMode] = useState<'solo' | 'ai' | 'local'>('ai');
  const [difficulty, setDifficulty] = useState<Difficulty>('intermediate');
  const [cats, setCats] = useState<Category[]>(ALL_CATS);
  const [rounds, setRounds] = useState(10);
  const [timed, setTimed] = useState(true);
  const [seed, setSeed] = useState(() => Date.now() >>> 0);

  const config = useMemo(
    () => ({ ...DEFAULT_CONFIG, categories: cats, rounds, perQuestion: timed ? 20 : 0 }),
    [cats, rounds, timed],
  );
  const [state, setState] = useState<QuizState>(() => createQuiz(config, difficulty, seed));

  const [picked, setPicked] = useState<number | null>(null);
  const [rivalPick, setRivalPick] = useState<number | null>(null);
  const [locked, setLocked] = useState(false);
  const [left, setLeft] = useState(config.perQuestion);
  const [shown, setShown] = useState(false);
  const askedAt = useRef(Date.now());
  const rivalTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const reset = useCallback(() => {
    const s = (Date.now() ^ 0x5bf03635) >>> 0;
    setSeed(s);
    setState(createQuiz(config, difficulty, s));
    setPicked(null); setRivalPick(null); setLocked(false); setShown(false);
    setLeft(config.perQuestion);
    askedAt.current = Date.now();
  }, [config, difficulty]);

  // rebuild whenever the setup changes
  useEffect(() => { reset(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [cats, rounds, timed, difficulty, mode]);

  const question = state.queue[state.index];
  const order = useMemo(() => (question ? orderFor(state, state.index) : []), [state, question]);
  const correctSlot = order.indexOf(0);

  /* ── the rival answers on its own clock ───────────────────────────── */
  useEffect(() => {
    clearTimeout(rivalTimer.current);
    if (mode !== 'ai' || !question || locked || state.over) return;
    const { slot, afterMs } = rivalAnswer(state, difficulty);
    const cap = config.perQuestion > 0 ? Math.min(afterMs, config.perQuestion * 1000 - 400) : afterMs;
    rivalTimer.current = setTimeout(() => setRivalPick(slot), Math.max(600, cap));
    return () => clearTimeout(rivalTimer.current);
  }, [state.index, mode, difficulty, locked, question, state, config.perQuestion]);

  /* ── per-question countdown ───────────────────────────────────────── */
  useEffect(() => {
    if (!timed || locked || state.over || !question) return;
    setLeft(config.perQuestion);
    askedAt.current = Date.now();
    const id = setInterval(() => {
      const elapsed = (Date.now() - askedAt.current) / 1000;
      const rem = Math.max(0, config.perQuestion - elapsed);
      setLeft(rem);
      if (rem <= 0) { clearInterval(id); lock(null); }
    }, 100);
    return () => clearInterval(id);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [state.index, timed, locked, state.over]);

  useEffect(() => { if (!timed) askedAt.current = Date.now(); }, [state.index, timed]);

  const lock = useCallback((slot: number | null) => {
    setLocked((already) => {
      if (already) return already;
      setPicked(slot);
      sfx(slot !== null && slot === order.indexOf(0) ? 'win' : 'error');
      return true;
    });
  }, [order, sfx]);

  const advance = useCallback(() => {
    const took = Date.now() - askedAt.current;
    const next = answer(state, picked, took, mode === 'ai' ? rivalPick : null);
    setState(next);
    setPicked(null); setRivalPick(null); setLocked(false);
    setLeft(config.perQuestion);
    askedAt.current = Date.now();
    if (!next.over) sfx('flip');
  }, [state, picked, rivalPick, mode, config.perQuestion, sfx]);

  /* ── record the finished run once ─────────────────────────────────── */
  useEffect(() => {
    if (!state.over || shown) return;
    setShown(true);
    const result = mode === 'ai'
      ? (state.score > state.rivalScore ? 'win' : state.score === state.rivalScore ? 'draw' : 'loss')
      : correctCount(state) * 2 >= state.asked.length ? 'win' : 'loss';
    finishMatch({
      gameId: 'trivia', mode, result, score: state.score,
      meta: { correct: correctCount(state), of: state.asked.length, bestStreak: state.bestStreak, difficulty },
    });
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [state.over]);

  const toggleCat = (c: Category) =>
    setCats((cur) => (cur.includes(c) ? (cur.length > 1 ? cur.filter((x) => x !== c) : cur) : [...cur, c]));

  const pct = config.perQuestion > 0 ? left / config.perQuestion : 1;
  const urgent = timed && !locked && left <= 5;

  return (
    <SoloShell
      game={game}
      mascot={state.over ? (correctCount(state) * 2 >= state.asked.length ? 'victory' : 'defeated')
        : locked ? (picked === correctSlot ? 'excited' : 'thinking')
        : urgent ? 'competitive' : 'idle'}
      mascotLine={state.over ? `${correctCount(state)} of ${state.asked.length} right, best streak ${state.bestStreak}.`
        : locked ? (picked === correctSlot ? 'Correct. Keep the streak going.' : picked === null ? 'Time. Next one.' : 'Not that one.')
        : `Question ${state.index + 1} of ${state.queue.length}. ${CATEGORY_LABEL[question?.cat ?? 'general']}.`}
      onRestart={reset}
      controls={
        <ModeRail
          mode={mode} setMode={setMode} modes={MODES}
          difficulty={difficulty} setDifficulty={setDifficulty}
          showDifficulty={mode === 'ai'}
          extra={
            <>
              <span className="eyebrow ml-1">Rounds</span>
              <Segmented value={rounds} onChange={setRounds} size="sm" label="Rounds"
                options={[{ value: 5, label: '5' }, { value: 10, label: '10' }, { value: 20, label: '20' }, { value: 50, label: '50' }]} />
              <Toggle checked={timed} onChange={setTimed} label="Timer" />
              {/* topics live with the other settings: on a phone they were a
                  two-row block of chips sitting between you and the answers */}
              <span className="eyebrow ml-1">Topics</span>
              <div className="flex flex-wrap items-center gap-1.5">
                {ALL_CATS.map((c) => {
                  const on = cats.includes(c);
                  return (
                    <button
                      key={c}
                      onClick={() => toggleCat(c)}
                      aria-pressed={on}
                      className={`px-3 min-h-[34px] sm:min-h-0 py-1.5 text-[12px] font-extrabold notch-sm border-2 transition-colors ${
                        on ? 'bg-volt-400 text-[#5a3a12] border-ink-400' : 'bg-ink-800 text-cream-300 border-ink-500 hover:border-ink-400'
                      }`}
                    >
                      {CATEGORY_LABEL[c]}
                    </button>
                  );
                })}
              </div>
            </>
          }
        />
      }
      hud={
        <Panel className="p-2 sm:p-3 flex items-center gap-2 sm:gap-3 flex-wrap justify-center">
            <Stat label="Score" value={state.score} />
            {mode === 'ai' && <Stat label="Rival" value={state.rivalScore} />}
            <Stat label="Streak" value={state.streak} accent={state.streak >= 3 ? '#a83350' : undefined} />
            <Stat label="Round" value={`${Math.min(state.index + 1, state.queue.length)}/${state.queue.length}`} />
        </Panel>
      }
    >
      <div className="w-full max-w-[920px] mx-auto space-y-3">

        {question && !state.over && (
          <Panel className="p-5 sm:p-7">
            {/* timer bar — honest: it only shows when a timer is actually running */}
            {timed && (
              <div className="h-1.5 w-full bg-ink-600 notch-sm overflow-hidden mb-4" role="timer"
                aria-label={`${Math.ceil(left)} seconds left`}>
                <div
                  className="h-full transition-[width] duration-100 ease-linear"
                  style={{ width: `${pct * 100}%`, background: urgent ? '#e05a74' : '#f0b429' }}
                />
              </div>
            )}

            <p className="eyebrow mb-2">{CATEGORY_LABEL[question.cat]} · Level {question.tier}</p>
            <h2 className="font-display text-[clamp(19px,3.2vw,27px)] font-extrabold leading-snug text-cream-100">
              {question.q}
            </h2>

            <div className="mt-5 grid sm:grid-cols-2 gap-2.5" role="group" aria-label="Answer options">
              {order.map((optIndex, slot) => {
                const isCorrect = slot === correctSlot;
                const isPicked = picked === slot;
                const isRival = mode === 'ai' && rivalPick === slot && locked;
                const reveal = locked;
                let tone = 'bg-ink-800 border-ink-500 hover:border-ink-400 text-cream-100';
                if (reveal && isCorrect) tone = 'bg-[#d8f3e5] border-[#2f9c71] text-[#1f6b4d]';
                else if (reveal && isPicked) tone = 'bg-[#ffe0e6] border-[#e05a74] text-[#8d2740]';
                else if (reveal) tone = 'bg-ink-850 border-ink-500 text-cream-500';
                return (
                  <button
                    key={slot}
                    onClick={() => !locked && lock(slot)}
                    disabled={locked}
                    aria-label={`Option ${slot + 1}: ${question.a[optIndex]}`}
                    className={`relative text-left px-4 py-3.5 border-2 notch-sm font-semibold text-[14.5px] transition-colors disabled:cursor-default ${tone}`}
                  >
                    <span className="inline-flex items-center justify-center w-6 h-6 mr-2.5 text-[11px] font-extrabold notch-sm bg-cream-100 text-ink-800">
                      {String.fromCharCode(65 + slot)}
                    </span>
                    {question.a[optIndex]}
                    {reveal && isCorrect && <Icon name="check" size={16} className="absolute right-3 top-1/2 -translate-y-1/2" />}
                    {isRival && (
                      <span className="absolute right-3 bottom-1.5 text-[10px] font-extrabold uppercase tracking-wide text-blush-600">
                        Rival picked this
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {locked && (
              <div role="status" className="mt-4 flex flex-wrap items-center gap-3 border-t-2 border-dashed border-ink-500 pt-3.5">
                <p className="flex-1 min-w-[220px] text-[13px] text-cream-300">
                  {picked === correctSlot
                    ? <><strong className="text-leaf-700">Correct.</strong> {question.note ?? ''}</>
                    : picked === null
                      ? <><strong className="text-blush-600">Out of time.</strong> The answer was {question.a[0]}. {question.note ?? ''}</>
                      : <><strong className="text-blush-600">Not quite.</strong> The answer was {question.a[0]}. {question.note ?? ''}</>}
                </p>
                <Button onClick={advance} icon={<Icon name="play" size={14} />}>
                  {state.index + 1 >= state.queue.length ? 'See the result' : 'Next question'}
                </Button>
              </div>
            )}
          </Panel>
        )}

        {state.over && shown && (
          <ResultOverlay
            verdict={mode === 'ai'
              ? (state.score > state.rivalScore ? 'win' : state.score === state.rivalScore ? 'draw' : 'loss')
              : correctCount(state) * 2 >= state.asked.length ? 'win' : 'loss'}
            reason={`${correctCount(state)} of ${state.asked.length} correct · ${Math.round(accuracyOf(state) * 100)}% accuracy`}
            playerA={{ name: 'You', score: state.score, you: true }}
            playerB={{ name: mode === 'ai' ? `Rival (${difficulty})` : 'Target', score: mode === 'ai' ? state.rivalScore : Math.ceil(state.asked.length / 2) * 100 }}
            rows={[
              { label: 'Correct', a: correctCount(state), b: mode === 'ai' ? state.asked.filter((x) => x.rivalPicked !== null && x.order[x.rivalPicked] === 0).length : '' },
              { label: 'Best streak', a: state.bestStreak, b: '' },
            ]}
            onRematch={reset} rematchLabel="New quiz" onExit={reset}
          />
        )}
      </div>
    </SoloShell>
  );
}
