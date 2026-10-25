import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Difficulty, GameMeta } from '../games/types';
import { Button, Icon, Segmented, Stat } from './ui';
import { PikachuMascot, type MascotState } from '../mascot';
import { useStore, useAmbience } from '../lib/store';
import { GameArtwork } from './GameArtwork';
import { HowToPlay } from './HowToPlay';

export const DIFFS: { value: Difficulty; label: string }[] = [
  { value: 'beginner', label: 'Beginner' },
  { value: 'casual', label: 'Casual' },
  { value: 'intermediate', label: 'Inter' },
  { value: 'advanced', label: 'Advanced' },
  { value: 'expert', label: 'Expert' },
];

/** Shared chrome for every single-player game: title bar, mode rail, HUD slot, mascot commentary. */
export default function SoloShell({
  game, children, hud, controls, mascot = 'idle', mascotLine, onRestart, footer, wide,
}: {
  game: GameMeta;
  children: ReactNode;
  hud?: ReactNode;
  controls?: ReactNode;
  mascot?: MascotState;
  mascotLine?: string;
  onRestart?: () => void;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const nav = useNavigate();
  const { progress, favourite, sfx } = useStore();
  useAmbience('match');
  const fav = progress.favourites.includes(game.id);
  const stat = progress.stats[game.id];

  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div className="relative min-h-[calc(100dvh-58px)] flex flex-col">
      {/* atmosphere */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden>
        <div className="absolute inset-0 opacity-[0.22]"><GameArtwork artKey={game.artKey} /></div>
        <div className="absolute inset-0 bg-gradient-to-b from-ink-900/85 via-ink-900/94 to-ink-900" />
      </div>

      {/* Title bar. On a phone this wrapped onto two rows and, being sticky under
          a 58px header, permanently ate ~105px before a single pixel of game.
          Below `sm` it is one 44px row that scrolls away: back, title, restart.
          The tagline, the record chips and "Play online" return from `sm` up. */}
      <div className="relative border-b border-ink-600 bg-ink-850/88 backdrop-blur-md blur-heavy sm:sticky sm:top-[58px] z-30">
        <div className="mx-auto max-w-[1340px] px-[var(--shell-pad)] py-1.5 sm:py-2.5 flex items-center gap-2 sm:gap-3 sm:flex-wrap">
          {/* aria-label, not just the visible span: below `sm` the label is hidden and
              an icon-only button would otherwise have no accessible name at all. */}
          <Button size="sm" variant="ghost" cue="back" className="btn-iconish" aria-label="Library"
            onClick={() => nav('/library')} icon={<Icon name="back" size={14} />}>
            <span className="hidden sm:inline">Library</span>
          </Button>
          <div className="min-w-0">
            <h1 className="display text-[14px] sm:text-[15px] text-cream-100 leading-tight truncate">{game.title}</h1>
            <p className="hidden sm:block text-[10.5px] uppercase tracking-wider font-bold truncate" style={{ color: game.accent }}>{game.tagline}</p>
          </div>
          <div className="flex-1" />
          {stat?.played > 0 && <div className="hidden sm:block"><Stat label="Record" value={`${stat.wins}W ${stat.losses}L`} /></div>}
          {stat?.best > 0 && <div className="hidden sm:block"><Stat label="Best" value={stat.best} accent={game.accent} /></div>}
          <button onClick={() => favourite(game.id)} aria-pressed={fav} aria-label="Favourite"
            className={`hidden sm:block p-2 no-tap ${fav ? 'text-volt-700' : 'text-cream-500 hover:text-cream-100'}`}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill={fav ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round">
              <path d="m12 3 2.7 5.8 6.3.8-4.6 4.4 1.2 6.3L12 17.3 6.4 20.3l1.2-6.3L3 9.6l6.3-.8z" />
            </svg>
          </button>
          {game.modes.includes('online') && (
            <div className="hidden sm:block">
              <Button size="sm" variant="blue" onClick={() => { sfx('select'); nav(`/together?game=${game.id}`); }} icon={<Icon name="users" size={13} />}>Play online</Button>
            </div>
          )}
          {onRestart && (
            <Button size="sm" variant="ghost" className="btn-iconish" aria-label="Restart"
              onClick={onRestart} icon={<Icon name="rotate" size={13} />}>
              <span className="hidden sm:inline">Restart</span>
            </Button>
          )}
        </div>
      </div>

      {/* Controls rail. On a phone these settings were eating 300+ px above the
          board — on Spark Quiz they pushed two of the four answers off-screen
          while the timer ran. They collapse by default below `sm` and stay
          exactly as they were from `sm` up. */}
      {controls && (
        <div className="relative border-b border-ink-700 bg-ink-850/60">
          <div className="mx-auto max-w-[1340px] px-[var(--shell-pad)]">
            <button
              type="button"
              onClick={() => setSettingsOpen((v) => !v)}
              aria-expanded={settingsOpen}
              aria-controls="solo-settings"
              className="sm:hidden w-full flex items-center justify-between gap-2 py-2 min-h-[40px] text-cream-300"
            >
              <span className="eyebrow">Game settings</span>
              <Icon name={settingsOpen ? 'chevron-up' : 'chevron-down'} size={15} />
            </button>
            <div
              id="solo-settings"
              className={`${settingsOpen ? 'flex' : 'hidden'} sm:flex items-center gap-3 flex-wrap pb-2.5 sm:py-2.5`}
            >
              {controls}
            </div>
          </div>
        </div>
      )}

      {/* content */}
      <div className={`relative flex-1 mx-auto w-full ${wide ? 'max-w-[1340px]' : 'max-w-[1120px]'} px-[var(--shell-pad)] py-2 sm:py-5`}>
        {hud && <div className="hud-strip mb-2 sm:mb-4">{hud}</div>}
        <div className="flex flex-col items-center gap-3 sm:gap-5">{children}</div>
        {/* the rulebook sits under the board, closed: it never pushes the game down
            the screen, and it is where a puzzled player is already looking */}
        <div className="mt-3 sm:mt-5 w-full max-w-[560px] mx-auto">
          <HowToPlay gameId={game.id} gameTitle={game.title} />
        </div>
        {(mascotLine || footer) && (
          <div className="mt-3 sm:mt-7 flex flex-col-reverse sm:flex-row items-center gap-3 sm:gap-4 justify-center">
            {mascotLine && (
              <div className="flex items-end gap-2">
                {/* wrapped, not classed: PikachuMascot hardcodes `inline-block`,
                    which beats an unprefixed `hidden` in the cascade and renders
                    both copies at once. */}
                <span className="sm:hidden"><PikachuMascot state={mascot} size={58} /></span>
                <span className="hidden sm:inline-block"><PikachuMascot state={mascot} size={92} /></span>
                <div className="panel notch-sm px-3 py-2 max-w-[34ch]"><p className="text-[12.5px] text-cream-100 font-semibold leading-snug">{mascotLine}</p></div>
              </div>
            )}
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ mode + difficulty rail */
export function ModeRail({
  mode, setMode, modes, difficulty, setDifficulty, showDifficulty = true, extra,
}: {
  mode: string; setMode: (m: any) => void; modes: { value: string; label: string }[];
  difficulty?: Difficulty; setDifficulty?: (d: Difficulty) => void; showDifficulty?: boolean; extra?: ReactNode;
}) {
  return (
    <>
      <span className="eyebrow">Mode</span>
      <Segmented value={mode} onChange={setMode} options={modes} size="sm" label="Game mode" />
      {showDifficulty && difficulty && setDifficulty && (
        <>
          <span className="eyebrow ml-1">AI level</span>
          <Segmented value={difficulty} onChange={setDifficulty} options={DIFFS} size="sm" label="AI difficulty" />
        </>
      )}
      {extra}
    </>
  );
}

/** Small helper that debounces an AI move so it feels considered, and cancels on unmount. */
export function useAiTurn(active: boolean, compute: () => void, delay = 420) {
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const t = setTimeout(() => { if (!cancelled) compute(); }, delay);
    return () => { cancelled = true; clearTimeout(t); };
  }, [active, compute, delay]);
}

export function useSeries(bestOf: number) {
  const [wins, setWins] = useState<[number, number]>([0, 0]);
  const [draws, setDraws] = useState(0);
  const need = Math.floor(bestOf / 2) + 1;
  const decided = wins[0] >= need || wins[1] >= need;
  const reset = () => { setWins([0, 0]); setDraws(0); };
  const record = (w: 0 | 1 | null) => {
    if (w === null) setDraws((d) => d + 1);
    else setWins((p) => { const n = [...p] as [number, number]; n[w] += 1; return n; });
  };
  return { wins, draws, need, decided, record, reset };
}
