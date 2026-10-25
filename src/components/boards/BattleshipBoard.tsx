import { Fragment, useMemo, useState, useEffect, type CSSProperties } from 'react';
import { FLEET, autoPlace, validPlacement, rcOf, type BSState } from '../../games/battleship/rules';
import type { BoardProps } from './types';
import { Button, Icon } from '../ui';
import { BoardStage } from './BoardStage';
import { useStore } from '../../lib/store';

const LETTERS = 'ABCDEFGHIJ';

/**
 * One definition for a ship hull. A flat fill read as a coloured rectangle, so
 * it is now three things at once: a top-lit gradient, a hairline of foam along
 * the deck, and a soft shadow that seats it in the water.
 */
const SHIP: CSSProperties = {
  background: 'linear-gradient(180deg,#b9e4f8,#6fb9e4 46%,#3f92c6)',
  border: '1.5px solid #2f6f9e',
  boxShadow: 'inset 0 1.5px 0 rgba(255,255,255,.75), 0 2px 3px rgba(45,95,135,.35)',
};
const SUNK: CSSProperties = {
  background: 'linear-gradient(180deg,#ffc9d4,#f3869f 48%,#d9547a)',
  border: '1.5px solid #c73f5c',
  boxShadow: 'inset 0 1.5px 0 rgba(255,255,255,.55), 0 2px 3px rgba(150,50,80,.32)',
};

export default function BattleshipBoard({ state, youSlot, onMove, interactive, names }: BoardProps<BSState>) {
  const { sfx } = useStore();
  const size = state.size;
  const opp = youSlot === 0 ? 1 : 0;

  /* ---------------- placement phase ---------------- */
  const [draft, setDraft] = useState(() => autoPlace((Date.now() ^ 0x9e37) >>> 0, size));
  const [activeShip, setActiveShip] = useState(0);
  const [horiz, setHoriz] = useState(true);
  const [committed, setCommitted] = useState(false);

  useEffect(() => { if (state.phase !== 'placement') setCommitted(false); }, [state.phase]);

  const draftCells = useMemo(() => {
    const m = new Map<number, string>();
    draft.forEach((s) => s.cells.forEach((c) => m.set(c, s.id)));
    return m;
  }, [draft]);

  const placeAt = (cell: number) => {
    const spec = FLEET[activeShip];
    const [r, c] = rcOf(cell, size);
    const cells: number[] = [];
    for (let k = 0; k < spec.len; k++) {
      const rr = horiz ? r : r + k, cc = horiz ? c + k : c;
      if (rr >= size || cc >= size) return;
      cells.push(rr * size + cc);
    }
    const others = draft.filter((s) => s.id !== spec.id);
    if (others.some((s) => s.cells.some((x) => cells.includes(x)))) { sfx('error'); return; }
    sfx('place');
    setDraft([...others, { id: spec.id, cells }]);
    setActiveShip((i) => Math.min(FLEET.length - 1, i + 1));
  };

  const commit = () => {
    const err = validPlacement(draft, size);
    if (err) { sfx('error'); return; }
    sfx('select');
    setCommitted(true);
    onMove({ type: 'place', ships: draft });
    setTimeout(() => onMove({ type: 'ready' }), 40);
  };

  if (state.phase === 'placement') {
    const ready = state.ready[youSlot] || committed;
    return (
      <div className="w-full flex flex-col xl:flex-row gap-5 items-start">
        <div className="w-full min-w-0 xl:flex-1">
          <p className="eyebrow mb-2">Deploy your fleet</p>
          <Grid size={size} label="Your waters" cellRender={(cell) => {
            const id = draftCells.get(cell);
            return id ? <span className="absolute inset-[8%] rounded-[5px]" style={SHIP} /> : null;
          }} onCell={ready ? undefined : placeAt} />
        </div>
        <div className="panel notch-sm p-4 w-full xl:w-[290px] xl:shrink-0">
          <p className="eyebrow mb-2">Fleet manifest</p>
          <div className="flex flex-col gap-1.5 mb-3">
            {FLEET.map((f, i) => {
              const placed = draft.some((d) => d.id === f.id);
              return (
                <button key={f.id} onClick={() => { setActiveShip(i); sfx('hover'); }} disabled={ready}
                  className={`flex items-center justify-between gap-2 px-2.5 py-2 border text-left no-tap transition-colors
                    ${activeShip === i && !ready ? 'border-volt-400 bg-volt-400/10' : 'border-ink-600 bg-ink-800 hover:border-ink-400'}`}>
                  <span className="min-w-0">
                    <span className="block text-[12px] font-extrabold text-cream-100 truncate">{f.name}</span>
                    <span className="block text-[10px] text-cream-500">{f.len} cells</span>
                  </span>
                  <span className="flex gap-[2px] shrink-0">
                    {Array.from({ length: f.len }).map((_, k) => (
                      <span key={k} className="w-2 h-4 rounded-[1px]" style={{ background: placed ? '#4a9fd8' : '#e3d6c6', border: '1px solid #9cb6c9' }} />
                    ))}
                  </span>
                </button>
              );
            })}
          </div>
          {!ready ? (
            <div className="flex flex-col gap-2">
              <div className="grid grid-cols-2 gap-2">
                <Button size="sm" variant="ghost" onClick={() => setHoriz((v) => !v)} icon={<Icon name="rotate" size={13} />}>{horiz ? 'Across' : 'Down'}</Button>
                <Button size="sm" variant="ghost" onClick={() => { setDraft(autoPlace((Date.now() * 2654435761) >>> 0, size)); setActiveShip(0); sfx('toggle'); }} icon={<Icon name="sparkle" size={13} />}>Auto</Button>
              </div>
              <Button variant="primary" onClick={commit} disabled={draft.length < FLEET.length}>Lock in fleet</Button>
              <p className="text-[11px] text-cream-500 leading-snug">Click a cell to drop the selected ship from that point. Ships may not overlap.</p>
            </div>
          ) : (
            <div className="text-center py-2">
              <p className="text-[12.5px] font-extrabold text-leaf-700">Fleet locked</p>
              <p className="text-[11.5px] text-cream-500 mt-1">
                {state.ready[opp] ? 'Both fleets ready — battle starting.' : `Waiting for ${names[opp]} to deploy…`}
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  /* ---------------- battle phase ---------------- */
  const myShots = new Set(state.shots[youSlot]);
  const myHits = new Set(state.hits[youSlot]);
  const theirShots = new Set(state.shots[opp]);
  const theirHits = new Set(state.hits[opp]);
  const myShipCells = new Map<number, string>();
  state.fleets[youSlot].forEach((s) => s.cells.forEach((c) => myShipCells.set(c, s.id)));
  const sunkOfMine = new Set(state.sunk[opp]);
  const enemySunkCells = new Set(state.fleets[opp].flatMap((s) => (s.hits.length === s.len ? s.cells : [])));

  return (
    <div className="w-full grid gap-4 sm:gap-5 sm:grid-cols-2 items-start">
      <div className="min-w-0">
        <p className="eyebrow mb-2 text-blush-600">Enemy waters — fire here</p>
        <Grid size={size} label="Enemy radar" radar onCell={interactive ? (c) => { if (!myShots.has(c)) { onMove({ type: 'fire', cell: c }); } } : undefined}
          disabledCell={(c) => myShots.has(c)}
          cellLabel={(c) => (!myShots.has(c) ? 'not fired yet' : myHits.has(c) ? (enemySunkCells.has(c) ? 'hit, ship sunk' : 'hit') : 'miss')}
          cellRender={(cell) => {
            if (!myShots.has(cell)) return null;
            const hit = myHits.has(cell);
            const sunk = enemySunkCells.has(cell);
            return hit
              ? <span className={`absolute inset-[14%] grid place-items-center ${sunk ? 'opacity-100' : ''}`}>
                  <svg viewBox="0 0 24 24" className="w-full h-full" stroke={sunk ? '#ff8a6b' : '#e05a74'} strokeWidth="3.4" strokeLinecap="round" fill="none">
                    <path d="M4 4 20 20M20 4 4 20" />
                  </svg>
                </span>
              : <span className="absolute inset-[32%] rounded-full"
                  style={{ background: 'rgba(217,69,111,.5)', boxShadow: 'inset 0 1px 2px rgba(140,40,70,.45)' }} />;
          }} />
      </div>
      <div className="min-w-0">
        <p className="eyebrow mb-2 text-volt-700">Your waters</p>
        <Grid size={size} label="Your fleet"
          cellLabel={(c) => {
            const ship = myShipCells.get(c);
            const where = ship ? (sunkOfMine.has(ship) ? 'your ship, sunk' : 'your ship') : 'empty water';
            const hot = theirHits.has(c) ? ', hit' : theirShots.has(c) ? ', enemy missed here' : '';
            return `${where}${hot}`;
          }}
          cellRender={(cell) => {
            const ship = myShipCells.get(cell);
            const hit = theirHits.has(cell);
            const shot = theirShots.has(cell);
            return (
              <>
                {ship && <span className="absolute inset-[8%] rounded-[5px]"
                  style={sunkOfMine.has(ship) ? SUNK : SHIP} />}
                {hit && <span className="absolute inset-[22%]"><svg viewBox="0 0 24 24" className="w-full h-full" stroke="#e05a74" strokeWidth="4" strokeLinecap="round" fill="none"><path d="M4 4 20 20M20 4 4 20" /></svg></span>}
                {shot && !hit && (
                  <span className="absolute inset-[30%] rounded-full"
                    style={{ background: 'rgba(120,100,88,.55)', boxShadow: 'inset 0 1px 2px rgba(60,45,38,.5)' }} />
                )}
              </>
            );
          }} />
      </div>
    </div>
  );
}

/**
 * One 10x10 grid, drawn twice (theirs and yours).
 *
 * Each square used to be `min(8.2vw,38px)` — so a 10-wide grid was 380 px on any
 * screen, and the two grids side by side needed 800 px before a chat rail. The
 * stage owns the width now and the 11 tracks (row labels + 10 columns, header
 * row + 10 rows) are fractions of it, at an aspect ratio that keeps the squares
 * exactly square: the header row is declared as half a track, so the ratio is
 * (size + 1) : (size + 0.5).
 */
function Grid({
  size, label, onCell, cellRender, radar, disabledCell, cellLabel,
}: {
  size: number; label: string; onCell?: (c: number) => void;
  cellRender: (c: number) => React.ReactNode; radar?: boolean; disabledCell?: (c: number) => boolean;
  /** What the cell means, read after the coordinate: "B4, miss". A bare
   *  coordinate left a screen-reader user with 100 identical-sounding squares
   *  and no way to know which ones had already been fired at. */
  cellLabel?: (c: number) => string;
}) {
  const tracks = size + 1;
  return (
    <BoardStage ratio={tracks / (size + 0.5)} max={480} min={230} reserve={196} chrome={10}>
    <div className="relative w-full p-[clamp(4px,1.8%,10px)]"
      style={{ background: 'linear-gradient(170deg,#eaf4fb,#d9ebf7)', border: '3px solid #9cc4de', borderRadius: 'clamp(12px,3%,20px)', boxShadow: '0 22px 48px -26px rgba(90,110,130,.6), inset 0 2px 0 rgba(255,255,255,.8)' }}>
      {radar && <div className="absolute inset-[clamp(4px,1.8%,10px)] rounded-[10px] pointer-events-none overflow-hidden fx-heavy" aria-hidden
        style={{ background: 'conic-gradient(from 0deg, rgba(111,182,232,.26), transparent 28%)', animation: 'pk-spark-spin 4.4s linear infinite' }} />}
      <div className="relative grid" role="grid" aria-label={label}
        style={{
          gridTemplateColumns: `repeat(${tracks}, minmax(0, 1fr))`,
          gridTemplateRows: `0.5fr repeat(${size}, minmax(0, 1fr))`,
          aspectRatio: `${tracks} / ${size + 0.5}`,
        }}>
        <span aria-hidden />
        {Array.from({ length: size }).map((_, c) => (
          <span key={c} className="board-cell font-extrabold text-[#416a83]" style={{ fontSize: 'clamp(6px, 30cqw, 10px)' }}>{LETTERS[c]}</span>
        ))}
        {Array.from({ length: size }).map((_, r) => (
          <Fragment key={`row-${r}`}>
            <span className="board-cell font-extrabold text-[#416a83]" style={{ fontSize: 'clamp(6px, 30cqw, 10px)' }}>{r + 1}</span>
            {Array.from({ length: size }).map((__, c) => {
              const cell = r * size + c;
              const dis = disabledCell?.(cell);
              return (
                <button key={cell} role="gridcell" disabled={!onCell || dis} onClick={() => onCell?.(cell)}
                  aria-label={`${LETTERS[c]}${r + 1}${cellLabel ? `, ${cellLabel(cell)}` : ''}`}
                  className={`board-cell border border-[#b9d6e8] transition-colors ${onCell && !dis ? 'hover:bg-[#bfe0f5] cursor-crosshair' : ''}`}
                  style={{ background: 'rgba(255,255,255,.72)' }}>
                  {cellRender(cell)}
                </button>
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
    </BoardStage>
  );
}
