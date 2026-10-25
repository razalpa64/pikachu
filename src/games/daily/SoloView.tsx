import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GameMeta } from '../types';
import SoloShell from '../../components/SoloShell';
import { Button, Panel, Stat } from '../../components/ui';
import { PikachuMascot } from '../../mascot';
import { useStore } from '../../lib/store';
import {
  DAILY_VERSION, colCluesFor, dateKey, dailyFor, linesSolved, rowCluesFor, satisfies, shareText,
  type DailyPuzzle,
} from './puzzle';
import { readRecord, recordSolve, solvedToday, type DailyRecord } from './streak';

/**
 * One warm-up grid, the same for everyone, per day.
 *
 * Two things are deliberately not here: a "reveal the answer" button (a daily you
 * can look up is not a daily) and a global "players today" number (there is no
 * account, so any such number would be invented). What is here: the grid, a
 * marking tool, a streak you earned, and a share string that spoils nothing.
 */
type Cell = 0 | 1 | 2;   // blank, filled, marked-empty

const fromGrid = (g: boolean[]): Cell[] => g.map((v) => (v ? 1 : 0) as Cell);
const asBool = (cells: Cell[]): boolean[] => cells.map((c) => c === 1);

export default function DailySolo({ game }: { game: GameMeta }) {
  const { sfx, finishMatch } = useStore();
  const [today, setToday] = useState(() => dateKey());
  const puzzle: DailyPuzzle = useMemo(() => dailyFor(today, DAILY_VERSION), [today]);
  const [cells, setCells] = useState<Cell[]>(() => Array(puzzle.size * puzzle.size).fill(0));
  const [marking, setMarking] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [record, setRecord] = useState<DailyRecord>(() => readRecord());
  const [solved, setSolved] = useState(false);
  const [shake, setShake] = useState(0);
  const [copied, setCopied] = useState(false);
  const finished = useRef(false);

  /* A new day while the tab is open must not keep yesterday's grid on screen. */
  useEffect(() => {
    const t = setInterval(() => {
      const now = dateKey();
      setToday((prev) => (prev === now ? prev : now));
    }, 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    setCells(Array(puzzle.size * puzzle.size).fill(0));
    setSolved(false);
    setSeconds(0);
    finished.current = false;
    setRecord(readRecord());
  }, [puzzle]);

  useEffect(() => {
    if (solved) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [solved]);

  const grid = asBool(cells);
  const good = linesSolved(grid, puzzle);
  const totalLines = puzzle.size * 2;

  const check = useCallback((next: Cell[]) => {
    if (finished.current) return;
    if (!satisfies(asBool(next), puzzle)) {
      // only complain once the board is full — mid-solve "wrong" is just noise
      if (next.every((c) => c !== 0)) { setShake((s) => s + 1); sfx('error'); }
      return;
    }
    finished.current = true;
    setSolved(true);
    sfx('win');
    const rec = recordSolve(today);
    setRecord(rec);
    finishMatch({
      gameId: 'daily', mode: 'solo', result: 'win', score: Math.max(0, 900 - seconds),
      meta: { date: today, seconds, streak: rec.streak, version: puzzle.version },
    });
  }, [puzzle, sfx, finishMatch, today, seconds]);

  const paint = (i: number, next: Cell) => {
    if (solved) return;
    const copy = cells.slice();
    copy[i] = next;
    setCells(copy);
    sfx(next === 1 ? 'coin' : 'select');
    check(copy);
  };

  const onCell = (i: number) => {
    // tap cycles blank → filled → marked; the tool toggle decides where it starts
    const current = cells[i];
    const next: Cell = marking ? (current === 2 ? 0 : 2) : (current === 1 ? 0 : 1);
    paint(i, next);
  };

  const restart = () => {
    setCells(Array(puzzle.size * puzzle.size).fill(0));
    setSolved(false);
    setSeconds(0);
    finished.current = false;
  };

  const copy = async () => {
    const text = shareText(puzzle, grid, seconds);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      sfx('notify');
      setTimeout(() => setCopied(false), 2200);
    } catch {
      setCopied(false);
    }
  };

  const alreadyToday = solvedToday(record, today);
  const clock = `${Math.floor(seconds / 60)}:${`${seconds % 60}`.padStart(2, '0')}`;

  return (
    <SoloShell
      game={game}
      mascot={solved ? 'victory' : good > totalLines / 2 ? 'excited' : 'thinking'}
      mascotLine={solved
        ? `Solved in ${clock}. ${record.streak > 1 ? `${record.streak} days in a row.` : 'Streak started.'}`
        : `${good} of ${totalLines} lines satisfied. Tap to fill, or switch to marking.`}
      onRestart={restart}
      hud={
        <Panel className="p-2 sm:p-3 flex items-center gap-2 sm:gap-4 flex-wrap justify-center">
          <Stat label="Today" value={today.slice(5)} />
          <Stat label="Time" value={clock} accent={game.accent} />
          <Stat label="Streak" value={record.streak} accent={record.streak > 1 ? 'var(--color-leaf-700)' : undefined} />
          <Stat label="Best" value={record.best} />
        </Panel>
      }
    >
      <div className="w-full max-w-[560px] flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="eyebrow">Daily Puzzle</p>
            <p className="text-[11.5px] text-cream-400 mt-0.5">
              {puzzle.dateKey} · edition {puzzle.version}{alreadyToday && !solved ? ' · already solved today' : ''}
            </p>
          </div>
          <div className="flex gap-1.5" role="group" aria-label="Tool">
            <Button size="sm" variant={marking ? 'ghost' : 'primary'} aria-pressed={!marking}
              onClick={() => { setMarking(false); sfx('select'); }}>Fill</Button>
            <Button size="sm" variant={marking ? 'primary' : 'ghost'} aria-pressed={marking}
              onClick={() => { setMarking(true); sfx('select'); }}>Mark ✕</Button>
          </div>
        </div>

        <Panel className="p-3 sm:p-4">
          <div className="flex gap-2 sm:gap-3">
            {/* row clues */}
            <div className="flex flex-col gap-[4px] justify-start pt-[26px] sm:pt-[30px]">
              {puzzle.rowClues.map((c, r) => (
                <div key={r} className="h-[38px] sm:h-[44px] flex items-center justify-end gap-1 min-w-[30px] sm:min-w-[38px]">
                  {c.length === 0
                    ? <span className="text-cream-400 text-[11px]">0</span>
                    : c.map((n, i) => <span key={i} className="display text-[13px] text-cream-300 tabnum">{n}</span>)}
                </div>
              ))}
            </div>

            <div className="flex-1 min-w-0">
              {/* column clues */}
              <div className="flex gap-[4px] mb-1.5">
                {puzzle.colClues.map((c, i) => (
                  <div key={i} className="flex-1 h-[20px] flex items-end justify-center gap-0.5">
                    {c.length === 0
                      ? <span className="text-cream-400 text-[10.5px]">0</span>
                      : c.map((n, j) => <span key={j} className="display text-[12px] text-cream-300 tabnum">{n}</span>)}
                  </div>
                ))}
              </div>

              <div
                key={shake}
                role="grid" aria-label="Daily puzzle grid"
                className={`grid gap-[4px] ${shake ? 'pk-shake' : ''}`}
                style={{ gridTemplateColumns: `repeat(${puzzle.size}, minmax(0,1fr))` }}
              >
                {cells.map((c, i) => {
                  const r = Math.floor(i / puzzle.size);
                  const col = i % puzzle.size;
                  const rowOk = JSON.stringify(rowCluesFor(grid, puzzle.size)[r]) === JSON.stringify(puzzle.rowClues[r]);
                  const colOk = JSON.stringify(colCluesFor(grid, puzzle.size)[col]) === JSON.stringify(puzzle.colClues[col]);
                  return (
                    <button
                      key={i}
                      role="gridcell"
                      aria-label={`Row ${r + 1}, column ${col + 1}: ${c === 1 ? 'filled' : c === 2 ? 'marked empty' : 'blank'}`}
                      aria-pressed={c === 1}
                      disabled={solved}
                      onClick={() => onCell(i)}
                      onContextMenu={(e) => { e.preventDefault(); paint(i, cells[i] === 2 ? 0 : 2); }}
                      className="aspect-square min-h-[38px] grid place-items-center border-2 transition-colors no-tap"
                      style={{
                        borderRadius: 7,
                        borderColor: c === 1 ? '#8d5a05' : '#e2c6a6',
                        background: c === 1
                          ? 'linear-gradient(160deg,#ffd24d,#e8a21c)'
                          : c === 2 ? '#f6e7d3' : '#fffdf7',
                        boxShadow: rowOk || colOk ? 'inset 0 0 0 2px rgba(23,121,90,.16)' : undefined,
                      }}
                    >
                      {c === 2 && <span className="text-cream-400 text-[13px] leading-none">✕</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <p className="mt-2.5 text-[10.5px] text-cream-400 leading-snug">
            Numbers give the runs of filled squares in that row or column, in order. Any grid that
            satisfies every clue is accepted — there is more than one way to read some pictures.
          </p>
        </Panel>

        {solved ? (
          <Panel className="p-4 text-center">
            <PikachuMascot state="victory" size={74} className="mx-auto" />
            <p className="display text-[20px] text-cream-100 mt-1">Today’s grid is done</p>
            <p className="text-[12.5px] text-cream-500 mt-1">
              {clock} · streak {record.streak} · best {record.best}
            </p>
            <div className="flex items-center justify-center gap-2 mt-3 flex-wrap">
              <Button variant="primary" onClick={copy}>{copied ? 'Copied' : 'Copy result'}</Button>
              <Button variant="ghost" onClick={restart}>Solve again</Button>
            </div>
          </Panel>
        ) : (
          <div className="flex items-center justify-between gap-2 text-[11.5px] text-cream-400">
            <span>{good}/{totalLines} lines right</span>
            <span>A new grid at midnight, local time.</span>
          </div>
        )}
      </div>
    </SoloShell>
  );
}
