import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import SoloShell from '../../components/SoloShell';
import { Button, Panel, Segmented, Stat } from '../../components/ui';
import { PikachuMascot } from '../../mascot';
import { useStore } from '../../lib/store';
import type { GameMeta } from '../types';
import { LOCATIONS, LOCATION_BY_ID } from './deck';
import {
  MAX_SEATS, MIN_SEATS, cardFor, dealRound, scoreRound, tally, type Deal,
} from './round';

/**
 * Spyfall — three to eight players, one phone, passed around.
 *
 * Why one device rather than a room: the whole game is a private card. A phone
 * handed to the next person with a curtain over the screen is the *only* honest
 * way to hide a card from the person standing next to you, and it is how a table
 * game is actually played. The relay seats two, and a two-player Spyfall is not
 * Spyfall — so this game says what it is, plainly, instead of pretending.
 *
 * The screen has no idea who the spy is until the vote closes: it reads `deal`
 * and `scoreRound`, both of which live in `round.ts` and are covered by tests.
 */
type Phase = 'setup' | 'deal' | 'talk' | 'vote' | 'tally' | 'guess' | 'done';

export default function SpyfallSolo({ game }: { game: GameMeta }) {
  const { sfx, finishMatch } = useStore();

  const [seats, setSeats] = useState(5);
  const [minutes, setMinutes] = useState(5);
  const [roundCount, setRoundCount] = useState(3);
  const [names, setNames] = useState<string[]>([]);

  const [phase, setPhase] = useState<Phase>('setup');
  const [seed, setSeed] = useState(() => (Date.now() ^ 0x5bf03635) >>> 0);
  const [round, setRound] = useState(1);
  const deal: Deal = useMemo(() => dealRound(seats, seed), [seats, seed]);

  const [handIndex, setHandIndex] = useState(0);       // whose card is being shown
  const [cardOpen, setCardOpen] = useState(false);
  const [votes, setVotes] = useState<(number | null)[]>([]);
  const [voteIndex, setVoteIndex] = useState(0);
  const [choose, setChoose] = useState<number | null>(null);
  const [spyGuess, setSpyGuess] = useState<string | null>(null);
  const [scores, setScores] = useState<number[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [secsLeft, setSecsLeft] = useState(minutes * 60);
  const [prompt, setPrompt] = useState(0);
  const logged = useRef(false);

  const namesOf = useMemo(
    () => Array.from({ length: seats }, (_, i) => (names[i]?.trim() || `Player ${i + 1}`)),
    [names, seats],
  );

  const newDeal = useCallback(() => {
    setSeed((Date.now() ^ (round * 0x9e3779b9)) >>> 0);
    setHandIndex(0); setCardOpen(false);
    setVotes(Array.from({ length: seats }, () => null));
    setVoteIndex(0); setChoose(null); setSpyGuess(null);
    setSecsLeft(minutes * 60);
    setPrompt(0);
    setPhase('deal');
    setLog([]);
  }, [round, seats, minutes]);

  const startMatch = () => {
    setRound(1);
    setScores(Array.from({ length: seats }, () => 0));
    setLog([]);
    logged.current = false;
    newDeal();
  };

  /* the interrogation clock only runs while the table is talking */
  useEffect(() => {
    if (phase !== 'talk') return;
    const id = setInterval(() => setSecsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [phase]);

  /* time up is its own transition, so nothing has to run inside a state updater */
  useEffect(() => {
    if (phase !== 'talk' || secsLeft > 0) return;
    setPhase('vote');
    setVoteIndex(0);
    sfx('notify');
  }, [phase, secsLeft, sfx]);

  useEffect(() => {
    if (phase !== 'vote') return;
    setVotes((v) => (v.length === seats ? v : Array.from({ length: seats }, (_, i) => v[i] ?? null)));
  }, [phase, seats]);

  const result = useMemo(
    () => (phase === 'tally' || phase === 'guess' || phase === 'done' ? scoreRound(deal, votes, spyGuess) : null),
    [phase, deal, votes, spyGuess],
  );

  const finishMatchOnce = useCallback((finalScores: number[]) => {
    if (logged.current) return;
    logged.current = true;
    const best = Math.max(...finalScores);
    const winnerIsSpy = finalScores[deal.spy] === best;
    finishMatch({
      gameId: 'spyfall', mode: 'local', result: winnerIsSpy ? 'loss' : 'win',
      score: best,
      meta: { players: seats, rounds: roundCount, location: deal.location.name },
    });
  }, [deal, seats, roundCount, finishMatch]);

  const restart = () => {
    setPhase('setup');
    setScores([]);
    setLog([]);
    logged.current = false;
  };

  const accuse = (seat: number | null) => {
    setVotes((v) => { const c = v.slice(); c[voteIndex] = seat; return c; });
    setChoose(null);
    if (voteIndex + 1 >= seats) {
      setPhase('tally');
      sfx('notify');
    } else {
      setVoteIndex((i) => i + 1);
      setCardOpen(false);
      sfx('select');
    }
  };

  /**
   * Bank the round once, then leave the tally behind. Staying on the tally after
   * scoring would let a second tap bank the same points again — and would leave
   * the table staring at a "Next round" button that does nothing.
   */
  const closeRound = () => {
    if (!result) return;
    const next = scores.map((s, i) => s + (result.points[i] ?? 0));
    setScores(next);
    setLog((l) => [...l, result.summary]);
    if (round >= roundCount) {
      finishMatchOnce(next);
      setPhase('done');
      return;
    }
    setRound((r) => r + 1);
    setSeed((prev) => (prev ^ ((round + 1) * 0x85ebca6b)) >>> 0);
    setHandIndex(0); setCardOpen(false);
    setVotes(Array.from({ length: seats }, () => null));
    setVoteIndex(0); setChoose(null); setSpyGuess(null);
    setSecsLeft(minutes * 60);
    setPrompt(0);
    setPhase('deal');
  };

  const mmss = `${Math.floor(secsLeft / 60)}:${`${secsLeft % 60}`.padStart(2, '0')}`;
  const sorted = scores.map((s, i) => ({ seat: i, name: namesOf[i], score: s })).sort((a, b) => b.score - a.score);

  /* ------------------------------------------------------------------ shell */
  return (
    <SoloShell
      game={game}
      mascot={phase === 'setup' ? 'waiting' : phase === 'talk' ? 'competitive' : phase === 'done' ? 'victory' : 'thinking'}
      mascotLine={
        phase === 'setup' ? 'Three to eight players, one phone. Deal the cards and pass it round.'
          : phase === 'deal' ? `Pass the phone to ${namesOf[handIndex] ?? 'the next player'} — nobody else looks.`
            : phase === 'talk' ? `${mmss} left. Ask questions out loud; the phone just keeps the clock.`
              : phase === 'vote' ? `${namesOf[voteIndex]} is voting. Everyone else looks away.`
                : phase === 'tally' ? 'The votes are in.'
                  : phase === 'guess' ? 'The spy escaped the vote — one guess at the location.'
                    : 'Match over.'
      }
      onRestart={restart}
      hud={
        <Panel className="p-2 sm:p-3 flex items-center gap-2 sm:gap-4 flex-wrap justify-center">
          <Stat label="Round" value={`${Math.min(round, roundCount)}/${roundCount}`} />
          <Stat label="Players" value={seats} />
          {phase === 'talk' && <Stat label="Time" value={mmss} accent={secsLeft < 45 ? 'var(--color-blush-600)' : undefined} />}
          {phase === 'tally' || phase === 'guess' || phase === 'done'
            ? <Stat label="Location" value={LOCATION_BY_ID.get(deal.location.id)?.name ?? deal.location.name} accent={game.accent} />
            : null}
        </Panel>
      }
    >
      {/* -------------------------------------------------------------- setup */}
      {phase === 'setup' && (
        <div className="w-full max-w-[620px] flex flex-col gap-3">
          <Panel className="p-4 sm:p-5">
            <p className="eyebrow mb-1">Table</p>
            <p className="text-[13px] text-cream-300 mb-3">
              Everyone gets a role card except one person, who is the spy. The spy has to work out where they are
              without giving themselves away.
            </p>
            <div className="flex items-center gap-2 flex-wrap mb-3">
              <span className="eyebrow">Players</span>
              <Segmented value={seats} onChange={(v) => { setSeats(v); setNames([]); }} size="sm" label="Players"
                options={[3, 4, 5, 6, 7, 8].map((n) => ({ value: n, label: `${n}` }))} />
            </div>
            <div className="flex items-center gap-2 flex-wrap mb-3">
              <span className="eyebrow">Round timer</span>
              <Segmented value={minutes} onChange={setMinutes} size="sm" label="Round timer"
                options={[{ value: 3, label: '3 min' }, { value: 5, label: '5 min' }, { value: 8, label: '8 min' }]} />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="eyebrow">Rounds</span>
              <Segmented value={roundCount} onChange={setRoundCount} size="sm" label="Rounds"
                options={[{ value: 1, label: '1' }, { value: 3, label: '3' }, { value: 5, label: '5' }]} />
            </div>
          </Panel>

          <Panel className="p-4 sm:p-5">
            <p className="eyebrow mb-2">Names <span className="text-cream-400 normal-case tracking-normal font-semibold">(optional)</span></p>
            <div className="grid sm:grid-cols-2 gap-2">
              {Array.from({ length: seats }, (_, i) => (
                <input key={i} value={names[i] ?? ''}
                  onChange={(e) => setNames((n) => { const c = n.slice(); c[i] = e.target.value.slice(0, 16); return c; })}
                  aria-label={`Name for player ${i + 1}`} placeholder={`Player ${i + 1}`}
                  className="px-3 py-2 text-[13.5px] font-semibold notch-sm border-2 border-ink-500 bg-ink-800 text-cream-100 focus:border-ink-400 outline-none" />
              ))}
            </div>
          </Panel>

          <Button size="lg" variant="primary" className="w-full justify-center" onClick={startMatch}>
            Deal the cards
          </Button>
          <p className="text-[11px] text-cream-400 text-center max-w-[52ch] mx-auto">
            One device, {MIN_SEATS}–{MAX_SEATS} players. A spy is always dealt — the deal is seeded and tested, and no
            two players ever hold the same role.
          </p>
        </div>
      )}

      {/* --------------------------------------------------------------- deal */}
      {phase === 'deal' && (
        <div className="w-full max-w-[520px]">
          <Panel className="p-5 text-center">
            {!cardOpen ? (
              <>
                <PikachuMascot state="waiting" size={78} className="mx-auto" />
                <p className="eyebrow mt-2">Pass the phone</p>
                <p className="display text-[22px] text-cream-100 mt-1">{namesOf[handIndex]}</p>
                <p className="text-[12.5px] text-cream-500 mt-1.5 max-w-[34ch] mx-auto">
                  Everyone else look away. Tap when the phone is in the right hands.
                </p>
                <Button variant="primary" className="mt-4" onClick={() => { setCardOpen(true); sfx('select'); }}>
                  Show my card
                </Button>
              </>
            ) : (
              <SpyCard deal={deal} seat={handIndex}
                onDone={() => {
                  setCardOpen(false);
                  if (handIndex + 1 >= seats) { setPhase('talk'); setSecsLeft(minutes * 60); }
                  else { setHandIndex((i) => i + 1); sfx('select'); }
                }} />
            )}
          </Panel>
        </div>
      )}

      {/* --------------------------------------------------------------- talk */}
      {phase === 'talk' && (
        <div className="w-full max-w-[620px] flex flex-col gap-3">
          <Panel className="p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <p className="eyebrow">Interrogation</p>
              <p className="display text-[20px] tabnum" style={{ color: secsLeft < 45 ? '#b0301d' : 'var(--color-cream-100)' }}>{mmss}</p>
            </div>
            <div className="mt-2 rounded-xl border-2 border-ink-500 bg-white/70 px-3.5 py-3">
              <p className="eyebrow text-volt-700">Ask someone</p>
              <p className="display text-[17px] leading-snug text-cream-100 mt-0.5">{deal.prompts[prompt % deal.prompts.length]}</p>
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              <Button variant="ghost" size="sm" onClick={() => { setPrompt((p) => p + 1); sfx('select'); }}>Another question</Button>
              <Button variant="primary" size="sm" onClick={() => { setPhase('vote'); setVoteIndex(0); sfx('notify'); }}>
                Call the vote
              </Button>
            </div>
            <p className="text-[11px] text-cream-400 mt-2.5">
              Answer out loud, in character. Too vague and the table turns on you; too specific and the spy learns the place.
            </p>
          </Panel>

          <Panel className="p-3">
            <p className="eyebrow mb-1.5">At the table</p>
            <div className="flex flex-wrap gap-1.5">
              {namesOf.map((n, i) => (
                <span key={i} className="px-2 py-1 rounded-full border border-ink-500 bg-ink-800 text-[11.5px] font-bold text-cream-300">{n}</span>
              ))}
            </div>
          </Panel>
        </div>
      )}

      {/* --------------------------------------------------------------- vote */}
      {phase === 'vote' && (
        <div className="w-full max-w-[520px]">
          <Panel className="p-5">
            <p className="eyebrow">Secret vote</p>
            <p className="display text-[20px] text-cream-100 mt-0.5">{namesOf[voteIndex]}</p>
            <p className="text-[12px] text-cream-500 mt-1 mb-3">Who is the spy? Everyone else look away.</p>
            <div className="flex flex-col gap-1.5">
              {namesOf.map((n, i) => (
                i === voteIndex ? null : (
                  <button key={i} onClick={() => setChoose(i)} aria-pressed={choose === i}
                    className={`text-left px-3 py-2 rounded-xl border-2 text-[13.5px] font-semibold transition-colors
                      ${choose === i ? 'border-volt-600 bg-volt-100 text-cream-100' : 'border-ink-500 bg-ink-800 text-cream-300 hover:border-volt-500'}`}>
                    {n}
                  </button>
                )
              ))}
              <button onClick={() => setChoose(null)} aria-pressed={choose === null}
                className={`text-left px-3 py-2 rounded-xl border-2 border-dashed text-[12.5px] font-semibold
                  ${choose === null ? 'border-ink-400 text-cream-300' : 'border-ink-500 text-cream-400'}`}>
                No idea — abstain
              </button>
            </div>
            <Button variant="primary" className="mt-3 w-full justify-center" onClick={() => accuse(choose)}>
              Lock in vote
            </Button>
          </Panel>
        </div>
      )}

      {/* -------------------------------------------------------------- tally */}
      {(phase === 'tally' || phase === 'guess') && result && (
        <div className="w-full max-w-[560px] flex flex-col gap-3">
          <Panel className="p-5 text-center">
            <p className="eyebrow">{result.caught ? 'Caught' : 'Escaped'}</p>
            <p className="display text-[22px] text-cream-100 mt-0.5">
              {namesOf[deal.spy]} was the spy
            </p>
            <p className="text-[13px] text-cream-500 mt-1">{result.summary}</p>
            <div className="mt-3 rounded-xl border-2 border-ink-500 bg-white/70 px-3 py-2.5 text-left">
              <p className="eyebrow text-leaf-700">The location</p>
              <p className="display text-[17px] text-cream-100">{deal.location.name}</p>
              <p className="text-[11.5px] text-cream-400">{deal.location.blurb}</p>
            </div>
            <div className="mt-3 flex flex-wrap justify-center gap-1.5">
              {tally(votes, seats).counts.map((c, i) => (
                <span key={i} className="px-2 py-1 rounded-full border border-ink-500 text-[11px] font-bold text-cream-300">
                  {namesOf[i]} · {c}
                </span>
              ))}
            </div>

            {phase === 'guess' && (
              <div className="mt-4 text-left">
                <p className="eyebrow mb-1.5">Spy’s last guess</p>
                <p className="text-[12px] text-cream-500 mb-2">Pick the location. Right answers add a point, and the table never forgets it.</p>
                <div className="grid grid-cols-2 gap-1.5 max-h-[220px] overflow-auto pr-1">
                  {LOCATIONS.map((l) => (
                    <button key={l.id} onClick={() => setSpyGuess(l.id)}
                      aria-pressed={spyGuess === l.id}
                      className={`text-left px-2.5 py-1.5 rounded-lg border-2 text-[12px] font-semibold
                        ${spyGuess === l.id ? 'border-volt-600 bg-volt-100 text-cream-100' : 'border-ink-500 bg-ink-800 text-cream-300'}`}>
                      {l.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-2 mt-4 justify-center">
              {phase === 'tally' && !result.caught && (
                <Button variant="primary" onClick={() => setPhase('guess')}>The spy guesses</Button>
              )}
              <Button variant={phase === 'guess' ? 'primary' : 'ghost'} onClick={closeRound}>
                {round >= roundCount ? 'Finish the match' : 'Next round'}
              </Button>
            </div>
          </Panel>

          {log.length > 0 && (
            <Panel className="p-3">
              <p className="eyebrow mb-1">Earlier rounds</p>
              <ul className="flex flex-col gap-1">
                {log.map((line, i) => <li key={i} className="text-[11.5px] text-cream-400 leading-snug">{line}</li>)}
              </ul>
            </Panel>
          )}
        </div>
      )}

      {/* --------------------------------------------------------------- done */}
      {phase === 'done' && (
        <div className="w-full max-w-[560px] flex flex-col gap-3">
          <Panel className="p-5 text-center">
            <PikachuMascot state="victory" size={80} className="mx-auto" />
            <p className="display text-[22px] text-cream-100 mt-1">Match over</p>
            <ol className="mt-3 flex flex-col gap-1.5 text-left">
              {sorted.map((p) => (
                <li key={p.seat} className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl border-2 border-ink-500 bg-ink-800">
                  <span className="text-[13.5px] font-bold text-cream-100">{p.name}</span>
                  <span className="display text-[16px] text-volt-700 tabnum">{p.score}</span>
                </li>
              ))}
            </ol>
            <div className="flex gap-2 mt-4 justify-center">
              <Button variant="primary" onClick={startMatch}>Play again</Button>
              <Button variant="ghost" onClick={restart}>Change the table</Button>
            </div>
          </Panel>
        </div>
      )}
    </SoloShell>
  );
}

/** The card itself. Nothing else on screen while a card is open. */
function SpyCard({ deal, seat, onDone }: { deal: Deal; seat: number; onDone: () => void }) {
  const card = cardFor(deal, seat);
  return (
    <div>
      <p className="eyebrow">Private card · {seat + 1} of {deal.seats}</p>
      <p className={`display text-[24px] mt-1 ${card.spy ? 'text-blush-600' : 'text-cream-100'}`}>{card.title}</p>
      <p className="text-[13px] text-cream-500 mt-2 leading-relaxed">{card.body}</p>
      {card.spy && (
        <div className="mt-3 text-left rounded-xl border-2 border-dashed border-ink-400 p-2.5">
          <p className="eyebrow mb-1">Possible locations</p>
          <p className="text-[11.5px] leading-relaxed text-cream-400">{LOCATIONS.map((l) => l.name).join(' · ')}</p>
        </div>
      )}
      <Button variant="primary" className="mt-4" onClick={onDone}>Hide and pass</Button>
    </div>
  );
}
