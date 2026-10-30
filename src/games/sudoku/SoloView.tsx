import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GameMeta } from '../types';
import SoloShell, { DIFFS } from '../../components/SoloShell';
import { Button, Icon, Panel, Segmented, Stat } from '../../components/ui';
import { PikachuMascot } from '../../mascot';
import { useStore } from '../../lib/store';
import {
  CLUES, candidates, conflicts, generate, remaining, type Level,
} from './engine';
import {
  DAILY_TARGET_SECONDS, allDone, clearProgress, dailyPuzzle, dateKey, readDaily, readProgress,
  saveProgress, shareText, tasksFor, withResult, writeDaily, type DailyState, type DayResult,
} from './daily';
import SudokuBoard, { type BoardCell } from './SudokuBoard';

/**
 * Sudoku, in two halves.
 *
 * **Free play** is the game: pick a level, get a fresh board that is guaranteed to
 * have exactly one answer, and solve it at your own pace with pencil marks, undo
 * and three hints.
 *
 * **Today** is the habit: one grid a day, the same grid for everyone, with three
 * tasks — finish it, finish it clean, finish it inside twelve minutes — and a
 * streak that only counts days you actually earned. Nothing here is invented:
 * the streak is your own history, the timer is your own clock, and the share
 * string carries your result rather than the board.
 *
 * The two share the board, the number pad and the rules; only the frame differs.
 */
type Mode = 'daily' | 'free';
type SavedGame = { cells: BoardCell[]; seconds: number; mistakes: number; hints: number; date: string };
const HINTS = 3;
const clock = (s: number) => `${Math.floor(s / 60)}:${`${s % 60}`.padStart(2, '0')}`;

const blankBoard = (puzzle: number[]): BoardCell[] => puzzle.map((v) => ({ v, notes: [] }));
const digits = (cells: BoardCell[]) => cells.map((c) => c.v);

export default function SudokuSolo({ game }: { game: GameMeta }) {
  const { sfx, finishMatch } = useStore();

  const [mode, setMode] = useState<Mode>('daily');
  const [level, setLevel] = useState<Level>('casual');
  const [today, setToday] = useState(() => dateKey());
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 0xffffffff));

  /* A tab left open overnight must move to the new day by itself. */
  useEffect(() => {
    const t = setInterval(() => setToday((prev) => (prev === dateKey() ? prev : dateKey())), 30_000);
    return () => clearInterval(t);
  }, []);

  const daily = useMemo(() => dailyPuzzle(today), [today]);
  const free = useMemo(() => generate(seed, level), [seed, level]);
  const board = mode === 'daily' ? daily : free;
  const given = useMemo(() => board.puzzle.map((v) => v > 0), [board]);

  const [cells, setCells] = useState<BoardCell[]>(() => blankBoard(board.puzzle));
  const [selected, setSelected] = useState<number | null>(null);
  const [notesMode, setNotesMode] = useState(false);
  const [instant, setInstant] = useState(true);
  const [mistakes, setMistakes] = useState(0);
  const [hints, setHints] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [solved, setSolved] = useState(false);
  const [record, setRecord] = useState<DailyState>(() => readDaily());
  const [copied, setCopied] = useState(false);
  /* A mistake is permanent. Undo takes the digit back, but not the fact that it
     was wrong — otherwise "no wrong entries" could be laundered by pressing undo
     twice, and the daily task would be worthless. */
  const [history, setHistory] = useState<{ cells: BoardCell[]; hints: number }[]>([]);
  const [announce, setAnnounce] = useState('');
  const finished = useRef(false);

  /* (Re)start a board: fresh grid, or the daily pick up where it was left. */
  useEffect(() => {
    const restored = mode === 'daily' ? readProgress(today) : null;
    if (restored && restored.cells.length === board.puzzle.length) {
      const merged = blankBoard(board.puzzle);
      restored.cells.forEach((c, i) => {
        if (given[i]) return;
        if (c.v >= 1 && c.v <= 9) merged[i] = { v: c.v, notes: [] };
        else if (Array.isArray(c.notes)) merged[i] = { v: 0, notes: c.notes.filter((n) => n >= 1 && n <= 9) };
      });
      setCells(merged);
      setSeconds(Math.max(0, restored.seconds | 0));
      setMistakes(Math.max(0, restored.mistakes | 0));
      setHints(Math.min(HINTS, Math.max(0, restored.hints | 0)));
    } else {
      setCells(blankBoard(board.puzzle));
      setSeconds(0);
      setMistakes(0);
      setHints(0);
    }
    setSelected(null);
    setSolved(false);
    setHistory([]);
    setAnnounce('');
    finished.current = false;
    if (mode === 'daily') setRecord(readDaily());
  }, [board, given, mode, today]);

  useEffect(() => {
    if (solved) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [solved]);

  /* Keep an unfinished daily. Losing a half-solved board to a refresh is the
     kind of small betrayal that stops people coming back. */
  useEffect(() => {
    if (mode !== 'daily' || solved) return;
    const t = setTimeout(() => {
      const snapshot: SavedGame = { cells, seconds, mistakes, hints, date: today };
      saveProgress(snapshot);
    }, 500);
    return () => clearTimeout(t);
  }, [mode, solved, cells, seconds, mistakes, hints, today]);

  const values = useMemo(() => digits(cells), [cells]);
  const bad = useMemo(() => {
    const set = new Set<number>(conflicts(values));
    /* A wrong digit is objectively wrong: the puzzle has exactly one answer, so
       comparing against it is not a hint, it is a fact. It is only *shown* when
       the player asked for it — the count is kept either way. */
    cells.forEach((c, i) => { if (c.v && c.v !== board.solution[i]) set.add(i); });
    return set;
  }, [values, cells, board]);

  const wrongPlaced = useMemo(
    () => cells.reduce((n, c, i) => n + (c.v && c.v !== board.solution[i] ? 1 : 0), 0),
    [cells, board],
  );
  const left = useMemo(() => remaining(values), [values]);
  const filled = values.filter((v) => v > 0).length;

  const finish = useCallback((mistakeCount: number, hintCount: number, secs: number) => {
    if (finished.current) return;
    finished.current = true;
    setSolved(true);
    sfx('win');
    const score = Math.max(50, Math.round(
      (CLUES[level] * 6 + 240 - secs / 4 - mistakeCount * 45 - hintCount * 60),
    ));
    finishMatch({
      gameId: 'sudoku', mode: 'solo', result: 'win', score,
      meta: { level, seconds: secs, mistakes: mistakeCount, hints: hintCount, variant: mode },
    });
    if (mode === 'daily') {
      const result: DayResult = {
        solved: true,
        clean: mistakeCount === 0,
        swift: secs <= DAILY_TARGET_SECONDS,
        seconds: secs,
      };
      const next = withResult(readDaily(), today, result);
      writeDaily(next);
      clearProgress();
      setRecord(next);
      setAnnounce(`Today’s grid solved in ${clock(secs)}. ${mistakeCount === 0 ? 'No wrong entries.' : `${mistakeCount} wrong ${mistakeCount === 1 ? 'entry' : 'entries'}.`}`);
    } else {
      setAnnounce(`Solved in ${clock(secs)} with ${mistakeCount} ${mistakeCount === 1 ? 'mistake' : 'mistakes'}.`);
    }
  }, [finishMatch, level, mode, sfx, today]);

  const pushHistory = useCallback(() => {
    setHistory((h) => [...h.slice(-120), { cells, hints }]);
  }, [cells, hints]);

  const put = useCallback((index: number, digit: number, asNote = false) => {
    if (solved || given[index]) return;
    if (index < 0 || index > 80) return;
    const cell = cells[index];
    const next = cells.slice();
    if (asNote && cell.v === 0) {
      const has = cell.notes.includes(digit);
      next[index] = { v: 0, notes: has ? cell.notes.filter((n) => n !== digit) : [...cell.notes, digit].sort((a, b) => a - b) };
      setCells(next);
      sfx('tone1');
      return;
    }
    pushHistory();
    if (digit === 0) {
      next[index] = { v: 0, notes: cell.notes };
      setCells(next);
      sfx('select');
      setAnnounce('Cell cleared.');
      return;
    }
    const wrong = digit !== board.solution[index];
    next[index] = { v: digit, notes: [] };
    /* Auto-clean pencil marks in the same row, column and box: a note that is
       provably impossible only gets in the way. */
    const r = (index / 9) | 0, c = index % 9;
    for (let i = 0; i < 81; i++) {
      if (i === index) continue;
      const ir = (i / 9) | 0, ic = i % 9;
      const same = ir === r || ic === c || (((ir / 3) | 0) === ((r / 3) | 0) && ((ic / 3) | 0) === ((c / 3) | 0));
      if (same && next[i].v === 0 && next[i].notes.includes(digit)) {
        next[i] = { v: 0, notes: next[i].notes.filter((n) => n !== digit) };
      }
    }
    setCells(next);
    if (wrong) {
      setMistakes((m) => m + 1);
      sfx('error');
      setAnnounce(`Row ${r + 1} column ${c + 1}: ${digit} is wrong.`);
    } else {
      sfx('place');
      setAnnounce(`Row ${r + 1} column ${c + 1}: ${digit}.`);
    }
    const complete = next.every((x, i) => x.v === board.solution[i]);
    if (complete) {
      const secs = seconds;
      finish(wrong ? mistakes + 1 : mistakes, hints, secs);
    }
  }, [board, cells, finish, given, hints, mistakes, pushHistory, seconds, sfx, solved]);

  const reveal = useCallback(() => {
    if (solved) return;
    const open = cells.map((c, i) => (c.v !== board.solution[i] ? i : -1)).filter((i) => i >= 0);
    if (!open.length) return;
    if (hints >= HINTS) { sfx('error'); setAnnounce(`No hints left — ${HINTS} per board.`); return; }
    const pick = selected != null && open.includes(selected) ? selected : open[Math.floor(Math.random() * open.length)];
    pushHistory();
    const next = cells.slice();
    next[pick] = { v: board.solution[pick], notes: [] };
    setCells(next);
    setHints((h) => h + 1);
    setSelected(pick);
    sfx('spark');
    setAnnounce(`Hint: row ${((pick / 9) | 0) + 1} column ${(pick % 9) + 1} is ${board.solution[pick]}.`);
    if (next.every((x, i) => x.v === board.solution[i])) finish(mistakes, hints + 1, seconds);
  }, [board, cells, finish, hints, mistakes, pushHistory, seconds, selected, sfx, solved]);

  const undo = useCallback(() => {
    setHistory((h) => {
      if (!h.length) return h;
      const last = h[h.length - 1];
      setCells(last.cells);
      setHints(last.hints);
      sfx('back');
      setAnnounce('Undone.');
      return h.slice(0, -1);
    });
  }, [sfx]);

  const step = useCallback((key: string) => {
    const at = selected ?? 0;
    const r = (at / 9) | 0, c = at % 9;
    if (key === 'ArrowUp') setSelected(Math.max(0, at - 9));
    else if (key === 'ArrowDown') setSelected(Math.min(80, at + 9));
    else if (key === 'ArrowLeft') setSelected(r * 9 + ((c + 8) % 9));
    else if (key === 'ArrowRight') setSelected(r * 9 + ((c + 1) % 9));
    else if (key === 'Home') setSelected(r * 9);
    else if (key === 'End') setSelected(r * 9 + 8);
    else if (key === 'Backspace' || key === 'Delete' || key === '0') { if (selected != null) put(at, 0); }
    else if (/^[1-9]$/.test(key)) { if (selected != null) put(at, Number(key), notesMode); }
    else if (key === 'n' || key === 'N') { setNotesMode((v) => !v); sfx('toggle'); }
    else if (key === 'h' || key === 'H') reveal();
  }, [notesMode, put, reveal, selected, sfx]);

  /* Keyboard for the whole screen.
     A grid that only listens while it holds focus is a grid that stops working
     the moment you tap "Notes" — which is exactly when a player starts typing.
     Text fields are left alone, and modifiers are ignored so ⌘1 still switches
     tabs. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Backspace', 'Delete', 'n', 'N', 'h', 'H', '0'];
      if (!keys.includes(e.key) && !/^[1-9]$/.test(e.key)) return;
      e.preventDefault();
      step(e.key);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step]);

  const restart = useCallback(() => {
    setCells(blankBoard(board.puzzle));
    setSeconds(0);
    setMistakes(0);
    setHints(0);
    setHistory([]);
    setSolved(false);
    setSelected(null);
    finished.current = false;
    if (mode === 'daily') saveProgress({ cells: blankBoard(board.puzzle), seconds: 0, mistakes: 0, hints: 0, date: today });
  }, [board, mode, today]);

  const alreadyHad = record.days[today];
  const streak = record.streak;
  const tasks = tasksFor(record, today);
  const complete = allDone(record, today);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareText(today, record));
      setCopied(true);
      sfx('notify');
      setTimeout(() => setCopied(false), 2000);
    } catch { setCopied(false); }
  };

  const share = () => {
    const text = shareText(today, record);
    if (navigator.share) {
      void navigator.share({ text }).catch(() => copy());
    } else void copy();
  };

  const candidatesFor = selected != null && !given[selected] ? candidates(values, selected) : [];
  const mascotLine = solved
    ? (mode === 'daily'
      ? `Today done in ${clock(seconds)}${mistakes === 0 ? ', not a single slip.' : `. ${mistakes} slip${mistakes === 1 ? '' : 's'} — tomorrow is clean.`}`
      : `Solved in ${clock(seconds)}${mistakes === 0 ? ' without a mistake.' : ` with ${mistakes} mistake${mistakes === 1 ? '' : 's'}.`}`)
    : selected != null && !given[selected]
      ? (values[selected] === board.solution[selected] && values[selected] !== 0
        ? `Row ${((selected / 9) | 0) + 1}, column ${(selected % 9) + 1} is settled.`
        : `Row ${((selected / 9) | 0) + 1}, column ${(selected % 9) + 1} — ${candidatesFor.length} candidates.`)
      : mode === 'daily'
        ? `${tasks.filter((t) => t.done).length} of 3 tasks today. ${streak > 0 ? `${streak}-day streak.` : 'Tap a cell to begin.'}`
        : 'Tap a cell, then a number. Notes on for pencil marks.';

  return (
    <SoloShell
      game={game}
      mascot={solved ? 'victory' : wrongPlaced > 0 ? 'thinking' : 'idle'}
      mascotLine={mascotLine}
      onRestart={restart}
      hud={
        <Panel className="p-2 sm:p-3 flex items-center gap-2 sm:gap-6 flex-wrap justify-center sm:w-fit sm:mx-auto">
          <Stat label="Time" value={clock(seconds)} accent={game.accent} />
          <Stat label="Mistakes" value={mistakes} accent={mistakes > 0 ? '#b3261e' : undefined} />
          {mode === 'daily'
            ? <Stat label="Streak" value={streak} accent={streak > 1 ? '#1f7a52' : undefined} />
            : <Stat label="Filled" value={`${filled}/81`} />}
        </Panel>
      }
      controls={
        <>
          {mode === 'free' ? (
            <>
              <span className="eyebrow">Level</span>
              <Segmented value={level} onChange={(l) => { setLevel(l as Level); sfx('select'); }} size="sm" label="Difficulty"
                options={DIFFS.map((d) => ({ value: d.value, label: d.label }))} />
            </>
          ) : (
            <span className="text-[11.5px] text-cream-400 self-center">
              One grid for everyone · new board at midnight, local time
            </span>
          )}
          <button
            type="button"
            onClick={() => { setInstant((v) => !v); sfx('toggle'); }}
            aria-pressed={instant}
            className={`text-[11.5px] px-2 py-1 rounded-md border ${instant ? 'border-volt-700 text-volt-700' : 'border-ink-600 text-cream-400'}`}
            title="Mistakes are counted either way; this only hides the red."
          >
            Check as I go: {instant ? 'on' : 'off'}
          </button>
        </>
      }
    >
      <div className="w-full flex flex-col items-center gap-3 sm:gap-4">
        <div className="flex items-center justify-center gap-2 flex-wrap">
          <Segmented value={mode} onChange={(m) => { setMode(m as Mode); sfx('select'); }} size="sm" label="Mode"
            options={[{ value: 'daily', label: 'Today’s grid' }, { value: 'free', label: 'Free play' }]} />
          {mode === 'free' && (
            <Button size="sm" variant="ghost" icon={<Icon name="rotate" size={13} />}
              onClick={() => { setSeed(Math.floor(Math.random() * 0xffffffff)); sfx('select'); }}>New grid</Button>
          )}
        </div>
        <SudokuBoard
          cells={cells}
          given={given}
          bad={instant ? bad : new Set(conflicts(values))}
          selected={selected}
          onSelect={(i) => { setSelected(i); sfx('click'); }}
        />

        {/* number pad + tools */}
        <div className="w-full max-w-[min(100%,540px)] flex flex-col gap-2">
          <div className="grid grid-cols-9 gap-[5px] sm:gap-1.5" role="group" aria-label="Numbers">
            {Array.from({ length: 9 }, (_, k) => k + 1).map((n) => {
              const done = left[n] <= 0;
              const blocked = selected != null && cells[selected].v === 0 &&
                !given[selected] && values[selected] === 0 && !candidatesFor.includes(n);
              return (
                <button
                  key={n}
                  type="button"
                  disabled={solved || done}
                  onClick={() => {
                    if (selected == null) { sfx('error'); setAnnounce('Pick a cell first.'); return; }
                    put(selected, n, notesMode);
                  }}
                  aria-label={`Place ${n}${left[n] > 0 ? `, ${left[n]} left` : ', complete'}`}
                  className={`relative min-h-[46px] sm:min-h-[52px] rounded-[10px] grid place-items-center no-tap transition-transform active:scale-[0.96] ${
                    done ? 'opacity-35' : ''} ${blocked && !notesMode ? 'opacity-60' : ''}`}
                  style={{
                    background: notesMode ? 'linear-gradient(170deg,#fffdf7,#f2e3cc)' : 'linear-gradient(170deg,#ffe08a,#e8a21c)',
                    border: '1px solid #c99b45',
                    boxShadow: '0 2px 0 #b4832f, 0 6px 12px -8px rgba(60,36,12,.7)',
                    color: '#3a2a14',
                  }}
                >
                  <span className="display tabnum leading-none" style={{ fontSize: 'clamp(19px,5.2vw,23px)' }}>{n}</span>
                  <span className="absolute bottom-[3px] right-[5px] text-[9px] tabnum leading-none opacity-55">{left[n] || '·'}</span>
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-4 gap-[5px] sm:gap-1.5">
            <Button
              size="sm"
              variant={notesMode ? 'primary' : 'ghost'}
              aria-pressed={notesMode}
              onClick={() => { setNotesMode((v) => !v); sfx('toggle'); }}
              icon={<Icon name="pen" size={13} />}
            >Notes</Button>
            <Button size="sm" variant="ghost" disabled={selected == null || Boolean(selected != null && given[selected])}
              onClick={() => { if (selected != null) put(selected, 0); }} icon={<Icon name="eraser" size={13} />}>Erase</Button>
            <Button size="sm" variant="ghost" disabled={!history.length} onClick={undo} icon={<Icon name="undo" size={13} />}>Undo</Button>
            <Button size="sm" variant="ghost" disabled={solved || hints >= HINTS} onClick={reveal} icon={<Icon name="spark" size={13} />}>
              Hint {HINTS - hints}
            </Button>
          </div>
        </div>

        {/* daily tasks */}
        {mode === 'daily' && (
          <Panel className="w-full max-w-[min(100%,540px)] p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="eyebrow">Daily tasks</p>
                <p className="text-[11.5px] text-cream-400 mt-0.5">
                  {today}{record.best > 1 ? ` · best streak ${record.best}` : ''}
                  {alreadyHad && !solved ? ' · already finished today' : ''}
                </p>
              </div>
              <div className="text-right">
                <p className="eyebrow">Target</p>
                <p className="text-[11.5px] tabnum text-cream-300">{DAILY_TARGET_SECONDS / 60} min</p>
              </div>
            </div>
            <ul className="mt-2 grid gap-1.5" aria-label="Daily tasks">
              {tasks.map((t, i) => (
                <li key={t.id} data-done={t.done} className="flex items-start gap-2">
                  <span
                    aria-hidden
                    className={`mt-[1px] w-[17px] h-[17px] rounded-full grid place-items-center shrink-0 ${t.done ? 'bg-leaf-700 text-white' : 'border border-ink-600 text-transparent'}`}
                    style={t.done ? undefined : { background: 'rgba(255,255,255,.03)' }}
                  >
                    <Icon name="check" size={11} />
                  </span>
                  <span className="min-w-0">
                    <span className={`block text-[12.5px] font-semibold ${t.done ? 'text-cream-300 line-through decoration-cream-500/50' : 'text-cream-100'}`}>
                      {i + 1}. {t.label}
                    </span>
                    <span className="block text-[11px] text-cream-400 leading-snug">{t.hint}</span>
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-2.5 flex items-center justify-between gap-2 flex-wrap">
              <span className="text-[11px] text-cream-400">
                Streak counts days you finished <em>and</em> kept clean.
              </span>
              <div className="flex gap-1.5">
                <Button size="sm" variant="ghost" onClick={share} disabled={!complete && !solved}>{copied ? 'Copied' : 'Share result'}</Button>
                {alreadyHad && solved && (
                  <Button size="sm" variant="ghost" onClick={restart}>Play again</Button>
                )}
              </div>
            </div>
          </Panel>
        )}

        {solved && (
          <Panel className="w-full max-w-[min(100%,540px)] p-4 text-center">
            <PikachuMascot state="victory" size={72} className="mx-auto" />
            <p className="display text-[20px] text-cream-100 mt-1">Grid complete</p>
            <p className="text-[12.5px] text-cream-500 mt-1">
              {clock(seconds)} · {mistakes === 0 ? 'no mistakes' : `${mistakes} mistake${mistakes === 1 ? '' : 's'}`} · {hints} hint{hints === 1 ? '' : 's'}
            </p>
            <div className="flex items-center justify-center gap-2 mt-3 flex-wrap">
              {mode === 'free'
                ? <Button variant="primary" onClick={() => { setSeed(Math.floor(Math.random() * 0xffffffff)); }}>Next grid</Button>
                : <Button variant="primary" onClick={share}>{copied ? 'Copied' : 'Share result'}</Button>}
              <Button variant="ghost" onClick={restart}>Again</Button>
            </div>
          </Panel>
        )}

        <p className="text-[10.5px] text-cream-400 text-center max-w-[46ch]">
          Every board is generated with exactly one answer. Keyboard: arrows to move, 1–9 to place,
          N for notes, Backspace to clear, H for a hint.
          {mode === 'daily' && ' Today’s tasks are stored on this device; a missed day breaks the streak.'}
        </p>
        <p role="status" aria-live="polite" className="sr-only">{announce}</p>
      </div>
    </SoloShell>
  );
}
