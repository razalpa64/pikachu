import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Difficulty, GameMeta } from '../types';
import SoloShell, { DIFFS } from '../../components/SoloShell';
import { Button, Icon, Panel, Segmented, Stat } from '../../components/ui';
import { ResultOverlay } from '../../components/Overlays';
import { useStore } from '../../lib/store';
import { PikaScene } from '../../mascot';
import {
  createDetective, cycleMark, revealClue, accuse, feedback, scoreCase,
  MAX_ATTEMPTS, type DetectiveState, type Mark,
} from './rules';

const MARK_STYLE: Record<Mark, string> = {
  unknown: 'bg-ink-800 border-ink-500 text-cream-100',
  'ruled-out': 'bg-ink-850 border-ink-500 text-cream-500 line-through',
  suspected: 'bg-volt-200 border-ink-400 text-[#5a3a12]',
};
const MARK_NEXT: Record<Mark, string> = {
  unknown: 'rule out', 'ruled-out': 'mark as suspected', suspected: 'clear the mark',
};

function Column({
  title, items, marks, chosen, onCycle, onChoose,
}: {
  title: string; items: string[]; marks: Mark[]; chosen: number | null;
  onCycle: (i: number) => void; onChoose: (i: number) => void;
}) {
  return (
    <div>
      <p className="eyebrow mb-1.5">{title}</p>
      <ul className="space-y-1.5">
        {items.map((label, i) => (
          <li key={i} className="flex gap-1.5">
            <button
              onClick={() => onCycle(i)}
              aria-label={`${label} — ${marks[i] === 'unknown' ? 'no mark' : marks[i] === 'ruled-out' ? 'ruled out' : 'suspected'}. Click to ${MARK_NEXT[marks[i]]}.`}
              className={`flex-1 text-left px-3 py-2 text-[13px] font-semibold border-2 notch-sm transition-colors ${MARK_STYLE[marks[i]]}`}
            >
              {label}
            </button>
            <button
              onClick={() => onChoose(i)}
              aria-label={`Name ${label} in the accusation`}
              aria-pressed={chosen === i}
              title="Put this in the accusation"
              className={`w-9 shrink-0 grid place-items-center border-2 notch-sm transition-colors ${
                chosen === i ? 'bg-blush-300 border-ink-400 text-[#6d2038]' : 'bg-ink-800 border-ink-500 text-cream-500 hover:border-ink-400'
              }`}
            >
              <Icon name="target" size={14} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function DetectiveSolo({ game }: { game: GameMeta }) {
  const { sfx, finishMatch } = useStore();
  const [difficulty, setDifficulty] = useState<Difficulty>('intermediate');
  const [state, setState] = useState<DetectiveState>(() => createDetective('intermediate', Date.now() >>> 0));
  const [pick, setPick] = useState<{ suspect: number | null; place: number | null; object: number | null }>(
    { suspect: null, place: null, object: null },
  );
  const [note, setNote] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const reset = useCallback((d: Difficulty = difficulty) => {
    setState(createDetective(d, (Date.now() ^ 0x1b873593) >>> 0));
    setPick({ suspect: null, place: null, object: null });
    setNote(null); setShown(false); setElapsed(0);
  }, [difficulty]);

  useEffect(() => { reset(difficulty); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [difficulty]);

  // a plain stopwatch — it measures real elapsed time, nothing is faked
  useEffect(() => {
    if (state.over) return;
    const id = setInterval(() => setElapsed(Math.round((Date.now() - state.startedAt) / 1000)), 1000);
    return () => clearInterval(id);
  }, [state.over, state.startedAt]);

  useEffect(() => {
    if (!state.over || shown) return;
    setShown(true);
    sfx(state.solved ? 'win' : 'lose');
    finishMatch({
      gameId: 'detective', mode: 'solo',
      result: state.solved ? 'win' : 'loss',
      score: scoreCase(state),
      meta: { difficulty, clues: state.revealedClues, attempts: state.accusations.length },
    });
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [state.over]);

  const file = state.file;
  const complete = pick.suspect !== null && pick.place !== null && pick.object !== null;

  const doAccuse = () => {
    if (!complete) return;
    const candidate = { suspect: pick.suspect!, place: pick.place!, object: pick.object! };
    const next = accuse(state, candidate);
    setState(next);
    if (!next.solved && !next.over) {
      const fb = feedback(file, candidate);
      setNote(fb.right === 0
        ? 'Nothing in that accusation was right. Start again from the clues.'
        : `${fb.right} of the three were right — but not which. ${next.attemptsLeft} attempt${next.attemptsLeft === 1 ? '' : 's'} left.`);
      sfx('error');
    } else setNote(null);
  };

  const solvedPick = useMemo(() => ({
    suspect: file.suspects[file.solution.suspect],
    place: file.places[file.solution.place],
    object: file.objects[file.solution.object],
  }), [file]);

  return (
    <SoloShell
      game={game}
      wide
      mascot={state.over ? (state.solved ? 'victory' : 'defeated') : note ? 'error' : complete ? 'competitive' : 'thinking'}
      mascotLine={state.over
        ? (state.solved ? 'Case closed.' : `It was ${solvedPick.suspect}, in ${solvedPick.place}, with ${solvedPick.object}.`)
        : note ?? 'Tap a name to rule it out. Tap the target to name it in the accusation.'}
      onRestart={() => reset()}
      controls={
        <>
          <span className="eyebrow">Case size</span>
          <Segmented value={difficulty} onChange={setDifficulty} options={DIFFS} size="sm" label="Case difficulty" />
        </>
      }
      hud={
        <Panel className="p-2 sm:p-3 flex items-center gap-2 sm:gap-3 flex-wrap justify-center">
            <Stat label="Clues" value={`${state.revealedClues}/${file.clues.length}`} />
            <Stat label="Attempts" value={`${state.attemptsLeft}/${MAX_ATTEMPTS}`} accent={state.attemptsLeft === 1 ? '#a83350' : undefined} />
            <Stat label="Time" value={`${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`} />
        </Panel>
      }
    >
      <div className="w-full max-w-[1060px] mx-auto space-y-3">
        <Panel className="p-5 flex gap-5 items-start">
          {/* The detective himself, on the case. Deliberately the one dark clip
              in the set — it reads as the photo paperclipped to a case file. */}
          <PikaScene clip="detective" className="hidden md:block w-[128px] shrink-0" rounded={14} tilt={-2.5} />
          <div className="min-w-0">
          <p className="eyebrow mb-1">Case file · {file.suspects.length} suspects</p>
          <h2 className="font-display text-[clamp(20px,3.6vw,30px)] font-extrabold text-cream-100">{file.title}</h2>
          <p className="mt-1.5 text-[13px] text-cream-300 max-w-[62ch]">
            Someone took something last night. Work out <strong className="text-cream-100">who</strong>,
            <strong className="text-cream-100"> where</strong>, and <strong className="text-cream-100"> what they left behind</strong>.
            Every clue below is true, and together they point to exactly one answer.
          </p>
          </div>
        </Panel>

        <div className="grid lg:grid-cols-[1.05fr_1fr] gap-3 items-start">
          {/* clues */}
          <Panel className="p-5">
            <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
              <p className="eyebrow">Evidence</p>
              {state.revealedClues < file.clues.length && !state.over && (
                <Button size="sm" variant="ghost" onClick={() => { setState(revealClue(state)); sfx('flip'); }} icon={<Icon name="search" size={13} />}>
                  Pull another clue
                </Button>
              )}
            </div>
            <ol className="space-y-2">
              {file.clues.slice(0, state.revealedClues).map((c, i) => (
                <li key={i} className="flex gap-2.5 text-[13.5px] text-cream-100 leading-snug">
                  <span className="shrink-0 w-5 h-5 grid place-items-center text-[10.5px] font-extrabold notch-sm bg-cream-100 text-ink-800">
                    {i + 1}
                  </span>
                  <span>{c.text}</span>
                </li>
              ))}
            </ol>
            {state.revealedClues < file.clues.length && (
              <p className="mt-3 text-[12px] text-cream-500">
                {file.clues.length - state.revealedClues} more clue{file.clues.length - state.revealedClues === 1 ? '' : 's'} on file.
                Pulling them costs you points, not the case.
              </p>
            )}
          </Panel>

          {/* deduction board */}
          <Panel className="p-5">
            <p className="eyebrow mb-3">Your notes</p>
            <div className="grid sm:grid-cols-3 gap-3">
              <Column
                title="Who" items={file.suspects} marks={state.marks.suspect} chosen={pick.suspect}
                onCycle={(i) => setState(cycleMark(state, 'suspect', i))}
                onChoose={(i) => setPick((p) => ({ ...p, suspect: p.suspect === i ? null : i }))}
              />
              <Column
                title="Where" items={file.places} marks={state.marks.place} chosen={pick.place}
                onCycle={(i) => setState(cycleMark(state, 'place', i))}
                onChoose={(i) => setPick((p) => ({ ...p, place: p.place === i ? null : i }))}
              />
              <Column
                title="What" items={file.objects} marks={state.marks.object} chosen={pick.object}
                onCycle={(i) => setState(cycleMark(state, 'object', i))}
                onChoose={(i) => setPick((p) => ({ ...p, object: p.object === i ? null : i }))}
              />
            </div>

            <div className="mt-4 pt-4 border-t-2 border-dashed border-ink-500">
              <p className="eyebrow mb-1.5">The accusation</p>
              <p className="text-[14px] text-cream-100 leading-relaxed">
                It was{' '}
                <strong className={pick.suspect !== null ? 'text-cream-100' : 'text-cream-500'}>
                  {pick.suspect !== null ? file.suspects[pick.suspect] : '—————'}
                </strong>, in{' '}
                <strong className={pick.place !== null ? 'text-cream-100' : 'text-cream-500'}>
                  {pick.place !== null ? file.places[pick.place] : '—————'}
                </strong>, with{' '}
                <strong className={pick.object !== null ? 'text-cream-100' : 'text-cream-500'}>
                  {pick.object !== null ? file.objects[pick.object] : '—————'}
                </strong>.
              </p>
              <div className="mt-3 flex gap-2 flex-wrap">
                <Button onClick={doAccuse} disabled={!complete || state.over} icon={<Icon name="flag" size={15} />}>
                  Make the accusation
                </Button>
                {state.accusations.length > 0 && !state.over && (
                  <span className="self-center text-[12px] text-cream-500">
                    {state.accusations.length} wrong so far
                  </span>
                )}
              </div>
              {note && (
                <p className="mt-2.5 px-3 py-2 text-[12.5px] font-semibold notch-sm bg-[#ffe9ee] border-2 border-[#e05a74] text-[#8d2740]">
                  {note}
                </p>
              )}
            </div>
          </Panel>
        </div>

        {state.over && shown && (
          <ResultOverlay
            verdict={state.solved ? 'win' : 'loss'}
            reason={state.solved
              ? `Solved in ${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')} with ${state.revealedClues} clues.`
              : `It was ${solvedPick.suspect}, in ${solvedPick.place}, with ${solvedPick.object}.`}
            playerA={{ name: 'You', score: scoreCase(state), you: true }}
            playerB={{ name: 'Case', score: file.title }}
            rows={[
              { label: 'Clues used', a: state.revealedClues, b: file.clues.length },
              { label: 'Accusations', a: state.accusations.length, b: MAX_ATTEMPTS },
            ]}
            onRematch={() => reset()} rematchLabel="New case"
          />
        )}
      </div>
    </SoloShell>
  );
}
