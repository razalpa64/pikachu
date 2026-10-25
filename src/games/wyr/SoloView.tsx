import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Difficulty, GameMeta, Slot } from '../types';
import SoloShell, { ModeRail } from '../../components/SoloShell';
import { Button, Icon, Panel, Segmented, Stat } from '../../components/ui';
import { ResultOverlay } from '../../components/Overlays';
import { PikachuMascot } from '../../mascot';
import { useStore } from '../../lib/store';
import { DILEMMAS, SIDES, type Dilemma } from './deck';
import { chooserFor, type Side, type WyrRound } from './rules';
import { aiChoose, aiGuess, aiLine } from './ai';

/**
 * Would You Rather, alone with the arcade.
 *
 * Same wager as the online game — one of you answers honestly, the other bets on
 * the answer, and the roles swap every round — with Pikachu taking both parts.
 * The AI is deliberately not a cheat: it remembers which side you tend to pick
 * and gets better at reading you as the difficulty rises, but it never sees the
 * answer before you give it.
 */
const AI: Slot = 1;
const YOU: Slot = 0;

export default function WyrSolo({ game }: { game: GameMeta }) {
  const { sfx, finishMatch } = useStore();
  const [difficulty, setDifficulty] = useState<Difficulty>('intermediate');
  const [rounds, setRounds] = useState(10);
  const [seed] = useState(() => (Date.now() ^ 0x5bf03635) >>> 0);

  const deck = useMemo<Dilemma[]>(() => {
    const r = seed % 9973;
    const rotated = [...DILEMMAS.slice(r % DILEMMAS.length), ...DILEMMAS.slice(0, r % DILEMMAS.length)];
    return rotated.slice(0, Math.max(rounds, 1));
  }, [seed, rounds]);

  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<Side | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [history, setHistory] = useState<WyrRound[]>([]);
  const [score, setScore] = useState<[number, number]>([0, 0]);
  const [logged, setLogged] = useState(false);

  const over = index >= deck.length;
  const dilemma = deck[Math.min(index, deck.length - 1)];
  const chooser = chooserFor(index);
  const youChoose = chooser === YOU;

  const reset = useCallback(() => {
    setIndex(0); setPicked(null); setRevealed(false); setHistory([]); setScore([0, 0]); setLogged(false);
  }, []);

  /* Pikachu's side is computed once, inside `play`, from the history as it was
     *before* this round. Deriving it in a memo would recompute against the updated
     history after the reveal and could quietly show a different answer than the
     one that was scored. */

  const play = (side: Side) => {
    if (picked || revealed || over) return;
    const aiSide = youChoose ? aiGuess(history, difficulty, seed) : aiChoose(dilemma.id, seed);
    const choice = youChoose ? side : aiSide;
    const guess = youChoose ? aiSide : side;
    const hit = choice === guess;
    const points = hit ? AI : YOU;

    setPicked(side);
    setRevealed(true);
    sfx(hit ? 'notify' : 'coin');
    setScore((s) => { const n: [number, number] = [s[0], s[1]]; n[points] += 1; return n; });
    setHistory((h) => [...h, { dilemma, chooser, choice, guess, hit, points }]);
  };

  const next = () => {
    if (!picked) return;
    sfx('click');
    setPicked(null);
    setRevealed(false);
    setIndex((i) => i + 1);
  };

  useEffect(() => {
    if (!over || logged || history.length === 0) return;
    setLogged(true);
    const result = score[0] === score[1] ? 'draw' : score[0] > score[1] ? 'win' : 'loss';
    finishMatch({
      gameId: 'wyr', mode: 'ai', result, score: score[0],
      meta: { rounds: history.length, read: history.filter((r) => r.chooser === AI && r.hit).length },
    });
  }, [over, logged, history, score, finishMatch]);

  const verdict = score[0] === score[1] ? 'draw' : score[0] > score[1] ? 'win' : 'loss';
  const last = history[history.length - 1];

  return (
    <SoloShell
      game={game}
      mascot={over ? (verdict === 'win' ? 'victory' : verdict === 'loss' ? 'defeated' : 'thinking')
        : revealed ? 'excited' : youChoose ? 'waiting' : 'thinking'}
      mascotLine={over
        ? `You ${score[0]} — Pikachu ${score[1]}.`
        : revealed
          ? (last ? aiLine(last, AI) : '')
          : youChoose
            ? 'Answer honestly. Pikachu is guessing what you will pick.'
            : 'Pikachu has picked. Try to read it.'}
      onRestart={reset}
      controls={
        <ModeRail
          mode="ai" setMode={() => {}} modes={[{ value: 'ai', label: 'Vs Pikachu' }]}
          difficulty={difficulty} setDifficulty={setDifficulty} showDifficulty
          extra={
            <>
              <span className="eyebrow ml-1">Rounds</span>
              <Segmented value={rounds} onChange={(v) => { setRounds(v); reset(); }} size="sm" label="Rounds"
                options={[{ value: 6, label: '6' }, { value: 10, label: '10' }, { value: 14, label: '14' }]} />
            </>
          }
        />
      }
      hud={
        <Panel className="p-2 sm:p-3 flex items-center gap-2 sm:gap-3 flex-wrap justify-center">
          <Stat label="Round" value={`${Math.min(index + 1, deck.length)}/${deck.length}`} />
          <Stat label="You" value={score[0]} accent="var(--color-leaf-700)" />
          <Stat label="Pikachu" value={score[1]} accent="var(--color-blush-600)" />
          <Stat label={youChoose ? 'You choose' : 'You guess'} value={youChoose ? 'A/B' : 'A/B'} />
        </Panel>
      }
    >
      <div className="w-full max-w-[820px] mx-auto flex flex-col gap-3">
        <Panel className="p-4 sm:p-6">
          <div className="flex items-center justify-between gap-3 mb-3">
            <p className="eyebrow">{youChoose ? 'You pick — Pikachu is guessing' : 'Pikachu picked — you are guessing'}</p>
            <span className="text-[10.5px] font-extrabold uppercase tracking-wider text-cream-400">
              Round {Math.min(index + 1, deck.length)}
            </span>
          </div>

          <h2 className="display text-[19px] sm:text-[23px] text-cream-100 mb-3.5">Would you rather…</h2>

          <div className="grid sm:grid-cols-2 gap-3">
            {(['a', 'b'] as const).map((side) => {
              const s = SIDES[side];
              const mine = picked === side;
              const show = revealed && last;
              const yourSide = show && (youChoose ? last!.choice === side : last!.guess === side);
              const aiSide = show && (youChoose ? last!.guess === side : last!.choice === side);
              const flagged = mine || yourSide || aiSide;
              return (
                <button
                  key={side}
                  data-side={side}
                  onClick={() => play(side)}
                  disabled={!!picked || over}
                  aria-pressed={mine}
                  className={`relative text-left p-4 min-h-[112px] notch-sm border-2 transition-all no-tap disabled:cursor-default
                    ${flagged ? 'shadow-[0_4px_0_0_var(--line-strong)]' : 'hover:-translate-y-0.5 hover:shadow-[0_4px_0_0_var(--line-strong)]'}`}
                  style={{ background: s.tint, borderColor: s.border }}
                >
                  <span className="inline-grid place-items-center w-6 h-6 rounded-full border-2 text-[11px] font-extrabold mb-2"
                    style={{ borderColor: s.border, color: s.ink, background: '#fffdf7' }}>{s.letter}</span>
                  <span className="block display text-[16px] sm:text-[18px] leading-snug" style={{ color: s.ink }}>{side === 'a' ? dilemma.a : dilemma.b}</span>

                  {revealed && (
                    <span className="mt-2 flex flex-wrap gap-1.5">
                      {youChoose && last?.choice === side && (
                        <span className="px-2 py-[2px] rounded-full bg-[#fffdf7] border text-[9px] font-extrabold uppercase tracking-wider"
                          style={{ borderColor: s.border, color: s.ink }}>Your answer</span>
                      )}
                      {youChoose && last?.guess === side && (
                        <span className="px-2 py-[2px] rounded-full bg-[#fffdf7] border text-[9px] font-extrabold uppercase tracking-wider"
                          style={{ borderColor: s.border, color: s.ink }}>Pikachu guessed this</span>
                      )}
                      {!youChoose && last?.choice === side && (
                        <span className="px-2 py-[2px] rounded-full bg-[#fffdf7] border text-[9px] font-extrabold uppercase tracking-wider"
                          style={{ borderColor: s.border, color: s.ink }}>Pikachu picked this</span>
                      )}
                      {!youChoose && last?.guess === side && (
                        <span className="px-2 py-[2px] rounded-full bg-[#fffdf7] border text-[9px] font-extrabold uppercase tracking-wider"
                          style={{ borderColor: s.border, color: s.ink }}>Your guess</span>
                      )}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {!picked && (
            <p className="mt-3 text-[12px] text-cream-500">
              {youChoose ? 'Pick the one you would actually choose.' : 'Which one do you think Pikachu chose?'}
            </p>
          )}

          {revealed && last && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-ink-600">
              <p className="text-[12.5px] font-bold" style={{ color: last.points === YOU ? 'var(--color-leaf-700)' : 'var(--color-blush-600)' }}>
                {last.points === YOU ? 'Point to you' : 'Point to Pikachu'} · {last.hit ? 'matched' : 'surprised'}
              </p>
              <div className="flex items-center gap-2">
                <PikachuMascot state={last.hit ? 'excited' : 'thinking'} size={44} />
                <Button variant="primary" size="sm" onClick={next} icon={<Icon name="chevron-right" size={14} />}>
                  {index + 1 >= deck.length ? 'See the result' : 'Next one'}
                </Button>
              </div>
            </div>
          )}
        </Panel>

        {history.length > 0 && (
          <Panel className="p-3">
            <p className="eyebrow mb-1.5">So far</p>
            <ul className="flex flex-col gap-1.5">
              {history.slice(-4).reverse().map((r, i) => (
                <li key={history.length - i} className="flex items-center gap-2 text-[11.5px] text-cream-500">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${r.points === YOU ? 'bg-leaf-400' : 'bg-blush-400'}`} />
                  <span className="truncate flex-1">{r.dilemma.a} <span className="text-cream-400">vs</span> {r.dilemma.b}</span>
                  <span className="font-extrabold shrink-0" style={{ color: r.points === YOU ? 'var(--color-leaf-700)' : 'var(--color-blush-600)' }}>
                    {r.points === YOU ? '+1 you' : '+1 pika'}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>

      {over && history.length > 0 && (
        <ResultOverlay
          verdict={verdict}
          reason={`You ${score[0]} — Pikachu ${score[1]}. ${history.filter((r) => r.chooser === AI && r.hit).length} of ${history.filter((r) => r.chooser === AI).length} reads landed.`}
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
