import { useMemo, useState, useEffect } from 'react';
import { Chess } from 'chess.js';
import { load, type ChessState, type ChessMove } from '../../games/chess/rules';
import ChessPiece from './ChessPiece';
import type { BoardProps } from './types';
import { useStore } from '../../lib/store';

const FILES = 'abcdefgh';

export default function ChessBoard({ state, youSlot, onMove, interactive, hint = true }: BoardProps<ChessState>) {
  const { sfx } = useStore();
  const [sel, setSel] = useState<string | null>(null);
  const [promo, setPromo] = useState<{ from: string; to: string } | null>(null);

  const chess = useMemo(() => load(state.fen), [state.fen]);
  const flipped = youSlot === 1;
  const turnColour = state.fen.split(' ')[1] as 'w' | 'b';
  const myColour = youSlot === 0 ? 'w' : 'b';

  const legalFromSel = useMemo(() => {
    if (!sel || !interactive) return [];
    return chess.moves({ square: sel as any, verbose: true });
  }, [sel, chess, interactive]);

  const checkedSquare = useMemo(() => {
    if (!chess.inCheck()) return null;
    const board = chess.board();
    for (const row of board) for (const sq of row) if (sq && sq.type === 'k' && sq.color === turnColour) return sq.square;
    return null;
  }, [chess, turnColour]);

  useEffect(() => { if (chess.inCheck() && !state.over) sfx('check'); }, [state.fen]);
  useEffect(() => { setSel(null); setPromo(null); }, [state.fen, interactive]);

  const squares: string[] = [];
  for (let r = 8; r >= 1; r--) for (let f = 0; f < 8; f++) squares.push(`${FILES[f]}${r}`);
  const ordered = flipped ? [...squares].reverse() : squares;

  const tryMove = (from: string, to: string) => {
    const candidate = chess.moves({ square: from as any, verbose: true }).find((m) => m.to === to);
    if (!candidate) return;
    if (candidate.promotion) { setPromo({ from, to }); return; }
    sfx(candidate.captured ? 'capture' : 'move');
    onMove({ from, to } as ChessMove);
    setSel(null);
  };

  const onSquare = (sq: string) => {
    if (!interactive) return;
    const piece = chess.get(sq as any);
    if (sel && legalFromSel.some((m) => m.to === sq)) { tryMove(sel, sq); return; }
    if (piece && piece.color === myColour) { setSel(sq === sel ? null : sq); sfx('hover'); return; }
    setSel(null);
  };

  const sqSize = 'repeat(8, min(10.2vw, 62px))';

  return (
    <div className="relative inline-block">
      {/* chamber plinth */}
      <div className="relative p-2.5 sm:p-3.5"
        style={{ background: 'linear-gradient(170deg,#f6e0c0,#e8c9a0)', border: '3px solid #c99b78', borderRadius: 22, boxShadow: '0 26px 54px -28px rgba(140,94,70,.65), inset 0 2px 0 rgba(255,255,255,.7)' }}>
        <div className="grid board-shadow board-inner" style={{ gridTemplateColumns: sqSize }} role="grid" aria-label="Chess board">
          {ordered.map((sq) => {
            const f = FILES.indexOf(sq[0]);
            const r = Number(sq[1]);
            const dark = (f + r) % 2 === 0;
            const piece = chess.get(sq as any);
            const isSel = sel === sq;
            const target = legalFromSel.find((m) => m.to === sq);
            const isLast = state.lastMove && (state.lastMove.from === sq || state.lastMove.to === sq);
            const isCheck = checkedSquare === sq;
            const playable = !!target || (!!piece && piece.color === myColour);
            return (
              <button key={sq} role="gridcell" onClick={() => onSquare(sq)}
                aria-label={`${sq}${piece ? `, ${piece.color === 'w' ? 'white' : 'black'} ${piece.type}` : ', empty'}`}
                data-playable={interactive && playable ? 'true' : undefined}
                className="chess-sq relative grid place-items-center no-tap"
                style={{
                  aspectRatio: '1', width: '100%',
                  background: isSel ? '#ffd84f'
                    : isCheck ? 'linear-gradient(160deg,#d94f37,#9c2b1a)'
                    : isLast ? (dark ? '#efc39c' : '#ffe6cd')
                    : dark ? '#dcb38a' : '#fff6e6',
                  cursor: interactive && playable ? 'pointer' : 'default',
                }}>
                {/* a king in check gets the familiar red bloom, under the piece */}
                {isCheck && (
                  <span className="absolute inset-0 pointer-events-none"
                    style={{
                      background: 'radial-gradient(circle at 50% 46%, rgba(255,120,90,.95), rgba(214,52,28,.55) 46%, rgba(160,30,12,0) 76%)',
                      animation: 'pk-check 1.5s ease-in-out infinite',
                    }} />
                )}
                {/* coordinates — small, tucked into the corner, like a printed board */}
                {sq[1] === (flipped ? '8' : '1') && (
                  <span className="absolute bottom-[1px] right-[3px] text-[8.5px] font-extrabold leading-none pointer-events-none"
                    style={{ color: dark ? '#8a6448' : '#b08a63' }}>{sq[0]}</span>
                )}
                {sq[0] === (flipped ? 'h' : 'a') && (
                  <span className="absolute top-[1px] left-[3px] text-[8.5px] font-extrabold leading-none pointer-events-none"
                    style={{ color: dark ? '#8a6448' : '#b08a63' }}>{sq[1]}</span>
                )}

                {/* the piece itself — transparent artwork, sized like a real set */}
                {piece && (
                  <span className="relative z-[1] grid place-items-center w-[88%] h-[88%] pointer-events-none">
                    <ChessPiece type={piece.type} colour={piece.color} size="100%" lifted={isSel} />
                  </span>
                )}

                {/* legal-move markers: a soft dot on empty squares, a ring around a capture */}
                {hint && target && !target.captured && (
                  <span className="absolute w-[24%] h-[24%] rounded-full pointer-events-none z-[2]"
                    style={{ background: 'rgba(232,162,28,.55)', boxShadow: '0 1px 2px rgba(120,80,55,.25)' }} />
                )}
                {hint && target && target.captured && (
                  <span className="absolute inset-[5%] rounded-full pointer-events-none z-[2]"
                    style={{ border: '4px solid rgba(217,69,111,.62)' }} />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* promotion chooser */}
      {promo && (
        <div className="absolute inset-0 z-20 grid place-items-center bg-white/92" role="dialog" aria-label="Choose promotion piece">
          <div className="panel notch-sm p-4 text-center a-pop">
            <p className="eyebrow mb-2.5">Promote to</p>
            <div className="flex gap-2">
              {(['q', 'r', 'b', 'n'] as const).map((t) => (
                <button key={t} onClick={() => { sfx('select'); onMove({ from: promo.from, to: promo.to, promotion: t }); setPromo(null); setSel(null); }}
                  aria-label={`Promote to ${t}`}
                  className="w-14 h-14 grid place-items-center rounded-2xl bg-white border-2 border-ink-500 hover:border-blush-300 hover:bg-blush-100 no-tap transition-colors">
                  <ChessPiece type={t} colour={myColour} size={42} />
                </button>
              ))}
            </div>
            <button onClick={() => setPromo(null)} className="mt-2.5 text-[11px] uppercase tracking-wider font-bold text-cream-500 hover:text-cream-100">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Captured-material strip, shown either side of the clock. */
export function CapturedRow({ fen, colour }: { fen: string; colour: 'w' | 'b' }) {
  const missing = useMemo(() => {
    const start: Record<string, number> = { p: 8, r: 2, n: 2, b: 2, q: 1 };
    const c = new Chess();
    c.load(fen);
    const have: Record<string, number> = { p: 0, r: 0, n: 0, b: 0, q: 0 };
    for (const row of c.board()) for (const sq of row) if (sq && sq.color === colour && sq.type !== 'k') have[sq.type]++;
    const out: string[] = [];
    for (const [t, n] of Object.entries(start)) for (let i = 0; i < n - (have[t] ?? 0); i++) out.push(t);
    return out;
  }, [fen, colour]);
  if (!missing.length) return <span className="text-[10px] text-ink-400">—</span>;
  return (
    <span className="flex flex-wrap gap-[1px] items-center" aria-label={`Captured ${colour === 'w' ? 'white' : 'black'} pieces`}>
      {missing.map((t, i) => <ChessPiece key={i} type={t} colour={colour} size={18} />)}
    </span>
  );
}
