import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useRoom } from '../lib/useRoom';
import { useStore, useAmbience } from '../lib/store';
import { useMatchCues } from '../lib/matchCues';
import { gameById, onlineGames, defaultGameSettings } from '../games/registry';
import { GameArtwork } from '../components/GameArtwork';
import { Button, ConfirmDialog, ConnectionIndicator, CopyField, EmptyState, ErrorState, Icon, Panel, Stat } from '../components/ui';
import { PikachuMascot, ElectricLoader, BoltRule } from '../mascot';
import { ResultOverlay, MatchCountdown, type Verdict } from '../components/Overlays';
import { MASCOT_ART } from '../lib/identity';
import type { BoardProps } from '../components/boards/types';

const BOARDS: Record<string, React.LazyExoticComponent<React.ComponentType<BoardProps<any>>>> = {
  tictactoe: lazy(() => import('../components/boards/TicTacToeBoard')),
  connect4: lazy(() => import('../components/boards/ConnectFourBoard')),
  memory: lazy(() => import('../components/boards/MemoryBoard')),
  chess: lazy(() => import('../components/boards/ChessBoard')),
  checkers: lazy(() => import('../components/boards/CheckersBoard')),
  battleship: lazy(() => import('../components/boards/BattleshipBoard')),
  cards: lazy(() => import('../components/boards/WildEightsBoard')),
  trivia: lazy(() => import('../components/boards/SparkQuizBoard')),
  reaction: lazy(() => import('../components/boards/ReactionBoard')),
  sketch: lazy(() => import('../components/boards/SketchBoard')),
};

export default function Room() {
  const { code = '' } = useParams();
  const nav = useNavigate();
  const { room, you, match, finished, conn, rtt, error, clearError, join, ready, start, act, leave, rematch, resign, offerDraw, respondDraw, nudge, connect, changeGame, returnToLobby, messages, sendChat } = useRoom();
  const { sfx, finishMatch, visit } = useStore();
  useAmbience(room?.status === 'IN_GAME' ? 'match' : 'hub');

  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmResign, setConfirmResign] = useState(false);
  const [confirmReturnLobby, setConfirmReturnLobby] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const recorded = useRef<string | null>(null);
  const joinAttempted = useRef(false);

  useEffect(() => { connect(); }, [connect]);
  useEffect(() => {
    if (!code || joinAttempted.current) return;
    if (room?.code === code.toUpperCase()) { joinAttempted.current = true; return; }
    const t = setTimeout(() => { joinAttempted.current = true; join(code); }, 260);
    return () => clearTimeout(t);
  }, [code, room?.code, join]);

  const game = room ? gameById(room.gameId) : null;
  useEffect(() => { if (game) visit(game.id, 'online'); }, [game?.id]);

  const slot = you?.slot ?? 0;

  /* Online matches used to be almost silent — the shared boards carry no audio
     of their own. One diff of the match state voices all nine of them. */
  useMatchCues(room?.gameId, match?.state, slot as 0 | 1, sfx);
  const oppSlot = slot === 0 ? 1 : 0;
  const members = useMemo(() => [...(room?.members ?? [])].sort((a, b) => a.slot - b.slot), [room]);
  const me = members.find((m) => m.slot === slot);
  const opp = members.find((m) => m.slot === oppSlot);
  const names: [string, string] = [members[0]?.name ?? 'Player 1', members[1]?.name ?? 'Waiting…'];

  /* a real voice the moment the other seat fills — once per arrival, not per render */
  const seatCount = useRef(members.length);
  useEffect(() => {
    if (members.length > seatCount.current) sfx('join');
    seatCount.current = members.length;
  }, [members.length, sfx]);

  /* persist the verdict exactly once per match */
  useEffect(() => {
    if (!finished || !game) return;
    if (recorded.current === finished.matchId) return;
    recorded.current = finished.matchId;
    const verdict: Verdict = finished.winnerSlot === null ? 'draw' : finished.winnerSlot === slot ? 'win' : 'loss';
    finishMatch({ gameId: game.id, mode: 'online', result: verdict === 'win' ? 'win' : verdict === 'loss' ? 'loss' : 'draw', opponent: opp?.name, meta: metaFor(game.id, match?.state, slot) });
  }, [finished?.matchId]);

  const inviteLink = useMemo(() => `${location.origin}/room/${room?.code ?? code}`, [room?.code, code]);

  const doLeave = useCallback(() => { leave(); nav('/together'); }, [leave, nav]);

  /* ------------------------------------------------ error / loading gates */
  if (error && !room) {
    return (
      <div className="mx-auto max-w-[760px] px-[var(--shell-pad)] py-14">
        <Panel className="p-2">
          <ErrorState title={error.message} body={`Room code ${code.toUpperCase()}`} recovery={error.recovery}
            onRetry={() => { clearError(); joinAttempted.current = false; join(code); }} retryLabel="Try that code again" />
          <div className="flex justify-center gap-2 pb-6">
            <Button variant="ghost" size="sm" onClick={() => nav('/together')} cue="back">Back to Play Together</Button>
          </div>
        </Panel>
      </div>
    );
  }
  if (!room || !you) {
    return (
      <div className="mx-auto max-w-[760px] px-[var(--shell-pad)] py-14">
        <Panel>
          {conn === 'offline'
            ? <ErrorState title="Relay unreachable" body="The match server is not responding." recovery="Check that the relay process is running, then retry." onRetry={connect} />
            : <ElectricLoader status={conn === 'reconnecting' ? 'Reconnecting' : 'Finding your arena'} detail={`Room ${code.toUpperCase()}`} />}
        </Panel>
      </div>
    );
  }

  const Board = BOARDS[room.gameId];
  const live = room.status === 'IN_GAME' && match && !finished;
  const myTurn = !!(live && match && isMyTurn(room.gameId, match.state, slot));
  const verdict: Verdict | null = finished ? (finished.winnerSlot === null ? 'draw' : finished.winnerSlot === slot ? 'win' : 'loss') : null;

  return (
    <div className="relative min-h-[calc(100dvh-58px)] flex flex-col">
      {/* ---------------- room header ---------------- */}
      <div className="border-b border-ink-600 bg-ink-850/90 sticky top-[58px] z-30 backdrop-blur-md blur-heavy">
        {/* One row on a phone. Wrapped, this bar was 116px and, stacked under the
            58px header, permanently covered a sixth of the screen during play.
            The room name and the series chip return from `sm` up; the code stays
            because it is the one thing you read out loud. */}
        <div className="mx-auto max-w-[1340px] px-[var(--shell-pad)] py-1.5 sm:py-2.5 flex items-center gap-2 sm:gap-3 sm:flex-wrap">
          <button onClick={() => setConfirmLeave(true)} className="btn btn-sm btn-ghost btn-iconish" aria-label="Leave room">
            <Icon name="back" size={14} /><span className="hidden sm:inline">Leave</span>
          </button>
          <button onClick={() => { sfx('select'); setPickerOpen(true); }} className="btn btn-sm btn-ghost btn-iconish text-cream-200 hover:text-volt-700" aria-label="Change game">
            <Icon name="sparkle" size={14} /><span className="hidden sm:inline">Change Game</span>
          </button>
          {room.status === 'IN_GAME' && (
            <button onClick={() => setConfirmReturnLobby(true)} className="btn btn-sm btn-ghost btn-iconish text-volt-700" aria-label="Return to lobby">
              <Icon name="spark" size={14} /><span className="hidden sm:inline">Lobby</span>
            </button>
          )}
          <div className="min-w-0">
            <p className="hidden sm:block text-[13px] font-extrabold text-cream-100 truncate leading-tight">{room.roomName}</p>
            <p className="text-[10.5px] text-cream-500 truncate">
              <span className="hidden sm:inline">{game?.title} · </span>
              <span className="font-mono text-volt-700">{room.code}</span>
              <span className="hidden sm:inline"> · {statusLabel(room.status)}</span>
            </p>
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-2">
            <div className="hidden sm:block">
              <Stat label="Series" value={`${room.series.wins[slot]}–${room.series.wins[oppSlot]}${room.series.draws ? ` · ${room.series.draws}D` : ''}`} accent="#f0b429" />
            </div>
            <ConnectionIndicator state={conn} rtt={rtt} />
          </div>
        </div>
      </div>

      {/* ---------------- body ---------------- */}
      <div className="flex-1 mx-auto w-full max-w-[1340px] px-[var(--shell-pad)] py-2 sm:py-5 relative">
        {/* reconnection banner */}
        {opp && !opp.connected && room.status !== 'WAITING' && (
          <Panel className="p-3 mb-4 border-volt-600/70 flex items-center gap-3" role="status">
            <PikachuMascot state="waiting" size={56} />
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-extrabold text-volt-700">{opp.name} dropped out</p>
              <p className="text-[11.5px] text-cream-500">Their slot is held for 45 seconds — the board is preserved exactly as it is.</p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => { nudge('Still there?'); sfx('spark'); }}>Nudge</Button>
          </Panel>
        )}

        {(room.status === 'WAITING' || room.status === 'READY_CHECK' || (room.status === 'COMPLETED' && !finished)) && (
          <Lobby room={room} slot={slot} inviteLink={inviteLink} onReady={ready} onStart={start} onChangeGame={changeGame} onOpenPicker={() => setPickerOpen(true)} messages={messages} sendChat={sendChat} />
        )}

        {room.status === 'STARTING' && room.startsAt && (
          <div className="relative min-h-[60vh]"><MatchCountdown startsAt={room.startsAt} names={names} /></div>
        )}

        {(room.status === 'IN_GAME' || (room.status === 'COMPLETED' && finished)) && match && Board && (
          <div className="relative">
            <MatchHud game={room.gameId} state={match.state} slot={slot} names={names} myTurn={myTurn}
              lastAction={match.lastAction} onResign={() => setConfirmResign(true)}
              onDraw={offerDraw} canDraw={room.gameId === 'chess' || room.gameId === 'checkers'} />

            <div className="flex justify-center py-5 overflow-x-auto">
              <Suspense fallback={<ElectricLoader status="Loading the arena" compact />}>
                <Board state={match.state} youSlot={slot} onMove={act} interactive={!!live && myTurn} names={names} hint />
              </Suspense>
            </div>

            {/* draw offer */}
            {match.state?.drawOfferBy !== undefined && match.state?.drawOfferBy !== null && match.state.drawOfferBy !== slot && !finished && (
              <Panel className="p-3.5 max-w-[420px] mx-auto flex items-center gap-3">
                <PikachuMascot state="thinking" size={56} />
                <div className="flex-1"><p className="text-[13px] font-extrabold text-cream-100">{opp?.name} offers a draw</p></div>
                <Button size="sm" variant="primary" onClick={() => respondDraw(true)}>Accept</Button>
                <Button size="sm" variant="ghost" onClick={() => respondDraw(false)}>Decline</Button>
              </Panel>
            )}

            {verdict && (
              <ResultOverlay
                verdict={verdict} reason={finished?.reason}
                playerA={{ name: names[0], score: scoreFor(room.gameId, match.state, 0), you: slot === 0 }}
                playerB={{ name: names[1], score: scoreFor(room.gameId, match.state, 1), you: slot === 1 }}
                rows={[{ label: 'Series', a: room.series.wins[0], b: room.series.wins[1] }, { label: 'Draws', a: room.series.draws, b: room.series.draws }]}
                rematchPending={!!me?.rematchVote && !opp?.rematchVote}
                onRematch={() => { sfx('select'); rematch(!me?.rematchVote); }}
                onChangeGame={() => { sfx('select'); setPickerOpen(true); }}
                changeGameLabel="Change Game"
                onExit={() => setConfirmLeave(true)}
                extra={<p className="text-[11.5px] text-cream-500">{opp?.rematchVote ? `${opp.name} wants a rematch!` : 'Both trainers must vote to run it back.'}</p>}
              />
            )}
          </div>
        )}

        {room.status === 'EXPIRED' && (
          <Panel><EmptyState mascot="sleeping" title="This arena went quiet" body="Rooms close after 90 minutes without activity."
            action={<Button variant="primary" onClick={() => nav('/together')}>Open a new room</Button>} /></Panel>
        )}
      </div>

      <ConfirmDialog open={confirmReturnLobby} title="Return to lobby?"
        body="This will stop the active match and return both players to the lobby so you can pick a different game together."
        confirmLabel="Return to lobby" onConfirm={() => { returnToLobby(); setConfirmReturnLobby(false); }} onCancel={() => setConfirmReturnLobby(false)} />
      <ConfirmDialog open={confirmLeave} title="Leave this arena?"
        body={room.status === 'IN_GAME' ? 'The match is still running. Your opponent will be told you left.' : 'You can rejoin any time with the same code.'}
        confirmLabel="Leave room" danger onConfirm={doLeave} onCancel={() => setConfirmLeave(false)} />
      <ConfirmDialog open={confirmResign} title="Resign this match?" body="Your opponent takes the win and the result is recorded."
        confirmLabel="Resign" danger onConfirm={() => { resign(); setConfirmResign(false); }} onCancel={() => setConfirmResign(false)} />

      {/* In-game and lobby live chat */}
      <RoomChatWidget
        messages={messages}
        sendChat={sendChat}
        oppName={opp?.name ?? ''}
        oppMascot={opp?.mascot}
        oppConnected={opp?.connected ?? false}
        isLobbyDesktop={room.status === 'WAITING' || room.status === 'READY_CHECK' || (room.status === 'COMPLETED' && !finished)}
      />

      {/* Seamless game switcher */}
      <GamePickerModal
        open={pickerOpen}
        currentGameId={room.gameId}
        onClose={() => setPickerOpen(false)}
        onSelect={(gameId, settings) => changeGame(gameId, settings)}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ game picker modal */
function GamePickerModal({
  open,
  currentGameId,
  onClose,
  onSelect,
}: {
  open: boolean;
  currentGameId: string;
  onClose: () => void;
  onSelect: (gameId: string, settings: Record<string, unknown>) => void;
}) {
  const { sfx } = useStore();
  const games = onlineGames();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-3 sm:p-5 bg-ink-900/85 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label="Choose a game"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          sfx('toggle');
          onClose();
        }
      }}
    >
      <div className="relative panel panel-notch w-full max-w-[680px] p-4 sm:p-6 max-h-[88vh] flex flex-col shadow-2xl a-pop overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between pb-3.5 border-b-2 border-ink-600 mb-4 shrink-0">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-2xl bg-volt-300/40 border-2 border-volt-500 text-volt-700 grid place-items-center shadow-xs">
              <Icon name="spark" size={19} />
            </span>
            <div>
              <p className="eyebrow text-volt-700 leading-none mb-1">Switch Arena</p>
              <h3 className="display text-[22px] sm:text-[25px] text-cream-100 leading-none">Choose a Game</h3>
            </div>
          </div>
          <button
            onClick={() => { sfx('toggle'); onClose(); }}
            className="w-8 h-8 rounded-full bg-white hover:bg-blush-100 border-2 border-ink-500 text-cream-400 hover:text-blush-600 grid place-items-center transition-colors cursor-pointer"
            aria-label="Close dialog"
          >
            <Icon name="x" size={15} />
          </button>
        </div>

        {/* Scrollable grid of games */}
        <div className="overflow-y-auto flex-1 pr-1.5 grid gap-3 sm:grid-cols-2">
          {games.map((g) => {
            const isCurrent = g.id === currentGameId;
            return (
              <button
                key={g.id}
                onClick={() => {
                  sfx('select');
                  onSelect(g.id, defaultGameSettings(g));
                  onClose();
                }}
                className={`group relative flex items-center gap-3.5 p-3 rounded-2xl border-2 text-left transition-all no-tap cursor-pointer shadow-xs
                  ${isCurrent
                    ? 'border-volt-500 bg-volt-200/50 ring-2 ring-volt-400/40'
                    : 'border-ink-500 bg-white hover:border-blush-300 hover:bg-blush-100/60 hover:-translate-y-0.5 hover:shadow-sm'
                  }`}
              >
                {/* Fixed thumbnail container with relative positioning so artwork cannot bleed out */}
                <div className="relative w-14 h-14 rounded-2xl overflow-hidden shrink-0 bg-ink-850 border-2 border-ink-500 shadow-xs grid place-items-center">
                  <GameArtwork
                    artKey={g.artKey}
                    className="w-full h-full object-cover pointer-events-none group-hover:scale-108 transition-transform duration-300"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-display text-[15px] font-bold text-cream-100 truncate group-hover:text-blush-600 transition-colors">
                    {g.title}
                  </p>
                  <p className="text-[11.5px] text-cream-400 truncate">{g.tagline}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[9.5px] font-extrabold px-2 py-0.5 rounded-full bg-ink-850 border border-ink-500 text-cream-300 uppercase tracking-wider">
                      {g.genre}
                    </span>
                    <span className="text-[10.5px] text-volt-700 font-extrabold">~{g.duration}m</span>
                  </div>
                </div>
                {isCurrent && (
                  <span className="px-2.5 py-1 rounded-full bg-volt-400 border border-volt-600 text-[#4a2e18] text-[10.5px] font-extrabold shrink-0 shadow-xs flex items-center gap-1">
                    <Icon name="check" size={11} /> Active
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ live room chat components */
const QUICK_CHIPS = ['⚡ GG!', '🔥 Nice move!', '⚡ Pika Pika!', '🤔 Thinking...', '🎯 Rematch?', '👋 Good luck!', '😅 Oops!', '✨ Wow!'];

function QuickChipsBar({ onChip }: { onChip: (chip: string) => void }) {
  return (
    <div className="px-2.5 py-1.5 bg-ink-850 border-b border-ink-600 flex items-center gap-1.5 overflow-x-auto no-scrollbar shrink-0">
      {QUICK_CHIPS.map((chip) => (
        <button
          key={chip}
          type="button"
          onClick={() => onChip(chip)}
          className="shrink-0 text-[11px] font-extrabold px-2.5 py-1 rounded-full bg-white hover:bg-volt-200 text-cream-100 hover:text-[#4a2e18] border-2 border-ink-500 hover:border-volt-500 transition-all shadow-xs cursor-pointer active:scale-95"
        >
          {chip}
        </button>
      ))}
    </div>
  );
}

function ChatInputBar({
  draft,
  setDraft,
  onSend,
}: {
  draft: string;
  setDraft: (v: string) => void;
  onSend: (e?: React.FormEvent) => void;
}) {
  return (
    <form onSubmit={onSend} className="p-2 sm:p-2.5 bg-ink-850 border-t-2 border-ink-600 flex items-center gap-2 shrink-0">
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Send message to arena..."
        maxLength={200}
        className="flex-1 min-w-0 bg-white border-2 border-ink-500 px-3.5 py-1.5 text-[12.5px] font-semibold text-cream-100 placeholder:text-cream-500 rounded-full focus:border-volt-500 focus:outline-none transition-colors shadow-inner"
      />
      <Button
        type="submit"
        size="sm"
        variant="primary"
        disabled={!draft.trim()}
        icon={<Icon name="send" size={13} />}
        className="!w-8 !h-8 !p-0 !rounded-full shrink-0 grid place-items-center"
      />
    </form>
  );
}

function ChatMessagesList({
  messages,
  oppName,
  oppMascot,
  scrollRef,
}: {
  messages: any[];
  oppName: string;
  oppMascot?: string;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
  if (!messages || messages.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center p-5 select-none min-h-[160px]">
        <div className="w-14 h-14 rounded-full bg-volt-200/50 border-2 border-volt-400/60 grid place-items-center mb-2.5">
          <PikachuMascot state="idle" size={48} />
        </div>
        <p className="font-display text-[14.5px] font-extrabold text-cream-100">
          Say hi to {oppName || 'your rival'}!
        </p>
        <p className="text-[11px] text-cream-500 max-w-[210px] mt-0.5 leading-relaxed">
          Tap a reaction above or type a message below.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {messages.map((m) => {
        const timeStr = new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        if (m.isSelf) {
          return (
            <div key={m.id} className="flex flex-col items-end text-right">
              <span className="text-[9.5px] font-bold text-cream-500 mb-0.5 px-1 tracking-tight">
                You · {timeStr}
              </span>
              <div className="max-w-[82%] px-3.5 py-1.5 rounded-2xl rounded-tr-xs bg-gradient-to-br from-volt-300 to-volt-400 text-[#4a2e18] text-[13px] font-bold border-2 border-volt-600 shadow-xs break-words leading-relaxed text-left">
                {m.text}
              </div>
            </div>
          );
        }

        return (
          <div key={m.id} className="flex items-end gap-2 text-left">
            <div className="w-7 h-7 rounded-full bg-white border-2 border-ink-500 overflow-hidden shrink-0 grid place-items-center mb-0.5 shadow-xs">
              <img
                src={MASCOT_ART[oppMascot ?? 'classic'] ?? MASCOT_ART.classic}
                alt=""
                className="w-5 h-5 object-contain"
              />
            </div>
            <div className="max-w-[80%] flex flex-col items-start">
              <span className="text-[9.5px] font-bold text-cream-500 mb-0.5 px-1 tracking-tight">
                {m.from || oppName || 'Rival'} · {timeStr}
              </span>
              <div className="px-3.5 py-1.5 rounded-2xl rounded-tl-xs bg-white text-cream-100 text-[13px] font-semibold border-2 border-ink-500 shadow-xs break-words leading-relaxed">
                {m.text}
              </div>
            </div>
          </div>
        );
      })}
      <div ref={scrollRef} />
    </div>
  );
}

function RoomChatWidget({
  messages,
  sendChat,
  oppName,
  oppMascot,
  oppConnected,
  isLobbyDesktop,
}: {
  messages: any[];
  sendChat: (text: string) => void;
  oppName: string;
  oppMascot?: string;
  oppConnected?: boolean;
  isLobbyDesktop?: boolean;
}) {
  const { sfx } = useStore();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [toastSnippet, setToastSnippet] = useState<string | null>(null);
  const [readCount, setReadCount] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const prevMsgCount = useRef(0);

  const unreadCount = !open ? Math.max(0, (messages?.length ?? 0) - readCount) : 0;

  // Show quick incoming message preview when chat is closed, or auto-scroll when open
  useEffect(() => {
    const curLen = messages?.length ?? 0;
    if (curLen > prevMsgCount.current) {
      const last = messages[curLen - 1];
      if (open) {
        setReadCount(curLen);
        scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
      } else if (last && !last.isSelf) {
        setToastSnippet(last.text);
        const timer = setTimeout(() => setToastSnippet(null), 4500);
        return () => clearTimeout(timer);
      }
    }
    prevMsgCount.current = curLen;
  }, [messages, open]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    setToastSnippet(null);
    setReadCount(messages?.length ?? 0);
    if (next) {
      setTimeout(() => scrollRef.current?.scrollIntoView({ behavior: 'smooth' }), 60);
    }
  };

  const onSend = (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = draft.trim();
    if (!text) return;
    sendChat(text);
    setDraft('');
    sfx('place');
  };

  const onChip = (chip: string) => {
    sendChat(chip);
    sfx('place');
  };

  return (
    <>
      {/* Toast snippet for incoming messages when chat is closed */}
      {toastSnippet && !open && (
        <div
          onClick={toggle}
          className={`fixed bottom-16 right-3 sm:bottom-18 sm:right-5 z-40 max-w-[280px] p-2.5 rounded-2xl bg-white border-2 border-volt-500 shadow-xl cursor-pointer a-pop flex items-center gap-2 hover:bg-volt-50 transition-all ${isLobbyDesktop ? 'lg:hidden' : ''}`}
        >
          <span className="w-6 h-6 rounded-full bg-volt-300 border border-volt-500 text-[11px] grid place-items-center shrink-0">⚡</span>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-extrabold text-volt-700 leading-tight truncate">{oppName || 'Rival'}</p>
            <p className="text-[12px] font-bold text-cream-100 truncate">{toastSnippet}</p>
          </div>
        </div>
      )}

      {/* Floating launcher button */}
      {!open && (
        <button
          onClick={toggle}
          className={`fixed bottom-3 right-3 sm:bottom-5 sm:right-5 z-40 flex items-center gap-2 px-3.5 py-2 sm:px-4 sm:py-2.5 rounded-full bg-volt-400 text-[#4a2e18] font-bold shadow-xl hover:bg-volt-300 active:scale-95 transition-all border-2 border-ink-600 focus:outline-none no-tap a-pop cursor-pointer ${isLobbyDesktop ? 'lg:hidden' : ''}`}
          aria-label="Open arena chat"
        >
          <Icon name="chat" size={17} />
          <span className="text-[13px] font-extrabold tracking-wide">Chat</span>
          {unreadCount > 0 && (
            <span className="w-5 h-5 rounded-full bg-ember-600 text-white text-[10.5px] font-black grid place-items-center animate-bounce shadow-xs">
              {unreadCount}
            </span>
          )}
        </button>
      )}

      {/* Expanded chat window - perfectly centered & padded on mobile, cleanly pinned on desktop */}
      {open && (
        <div
          className={`fixed bottom-3 inset-x-3 sm:inset-x-auto sm:right-5 sm:bottom-5 z-40 w-auto sm:w-[370px] h-[490px] max-h-[82vh] panel panel-notch p-0 flex flex-col shadow-2xl bg-[#fffefb] border-2 border-ink-500 backdrop-blur-md a-pop overflow-hidden ${isLobbyDesktop ? 'lg:hidden' : ''}`}
        >
          {/* Header */}
          <div className="p-3 bg-gradient-to-r from-ink-850 via-[#fff8ec] to-ink-850 border-b-2 border-ink-600 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="w-8 h-8 rounded-full bg-white border-2 border-ink-500 overflow-hidden grid place-items-center shrink-0 shadow-xs">
                <img
                  src={MASCOT_ART[oppMascot ?? 'classic'] ?? MASCOT_ART.classic}
                  alt=""
                  className="w-6 h-6 object-contain"
                />
              </span>
              <div className="min-w-0">
                <p className="font-display text-[13.5px] font-extrabold text-cream-100 leading-tight">Arena Chat</p>
                <div className="flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${oppConnected ? 'bg-mint-400' : 'bg-cream-400'}`} />
                  <p className="text-[10px] font-bold text-cream-500 truncate">
                    {oppName ? (oppConnected ? `with ${oppName}` : `${oppName} (idle)`) : 'Waiting for rival'}
                  </p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={toggle}
                className="w-7 h-7 rounded-full bg-white hover:bg-blush-100 border-2 border-ink-500 text-cream-400 hover:text-blush-600 flex items-center justify-center transition-colors cursor-pointer"
                aria-label="Close chat"
              >
                <Icon name="x" size={13} />
              </button>
            </div>
          </div>

          {/* Quick chips bar */}
          <QuickChipsBar onChip={onChip} />

          {/* Messages list */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2.5 bg-[#fffcf5]">
            <ChatMessagesList
              messages={messages}
              oppName={oppName}
              oppMascot={oppMascot}
              scrollRef={scrollRef}
            />
          </div>

          {/* Input form */}
          <ChatInputBar draft={draft} setDraft={setDraft} onSend={onSend} />
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ desktop lobby inline chat */
function LobbyInlineChat({
  messages,
  sendChat,
  oppName,
  oppMascot,
  oppConnected,
}: {
  messages: any[];
  sendChat: (text: string) => void;
  oppName: string;
  oppMascot?: string;
  oppConnected?: boolean;
}) {
  const { sfx } = useStore();
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages?.length]);

  const onSend = (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = draft.trim();
    if (!text) return;
    sendChat(text);
    setDraft('');
    sfx('place');
  };

  const onChip = (chip: string) => {
    sendChat(chip);
    sfx('place');
  };

  return (
    <Panel className="p-0 flex flex-col h-[360px] overflow-hidden shadow-sm">
      {/* Header */}
      <div className="p-3 bg-gradient-to-r from-ink-850 via-[#fff8ec] to-ink-850 border-b-2 border-ink-600 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <span className="w-7 h-7 rounded-full bg-volt-300/40 border-2 border-volt-500 text-volt-700 grid place-items-center shrink-0">
            <Icon name="chat" size={13} />
          </span>
          <div>
            <p className="font-display text-[13px] font-extrabold text-cream-100 leading-tight">Arena Chat</p>
            <p className="text-[10px] text-cream-500 truncate">
              {oppName ? (oppConnected ? `Live with ${oppName}` : `${oppName} (waiting)`) : 'Chat with your rival'}
            </p>
          </div>
        </div>
        <span className="text-[9.5px] font-extrabold px-2 py-0.5 rounded-full bg-white border border-ink-500 text-cream-300 uppercase tracking-wider">
          Lobby
        </span>
      </div>

      {/* Quick chips bar */}
      <QuickChipsBar onChip={onChip} />

      {/* Messages list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5 bg-[#fffcf5]">
        <ChatMessagesList
          messages={messages}
          oppName={oppName}
          oppMascot={oppMascot}
          scrollRef={scrollRef}
        />
      </div>

      {/* Input form */}
      <ChatInputBar draft={draft} setDraft={setDraft} onSend={onSend} />
    </Panel>
  );
}

/* ------------------------------------------------------------------ lobby */
function Lobby({ room, slot, inviteLink, onReady, onStart, _onChangeGame, onOpenPicker, messages, sendChat }: any) {
  const { sfx } = useStore();
  const members = [...room.members].sort((a: any, b: any) => a.slot - b.slot);
  const me = members.find((m: any) => m.slot === slot);
  const opp = members.find((m: any) => m.slot !== slot);
  const game = gameById(room.gameId);
  const bothReady = members.length === 2 && members.every((m: any) => m.ready && m.connected);
  const isHost = me?.isHost;

  return (
    <div className="grid lg:grid-cols-[1fr_360px] gap-5 items-start">
      <div>
        <Panel className="p-5 sm:p-7 relative overflow-hidden">
          <div className="absolute inset-0 inset-grid opacity-20 pointer-events-none" aria-hidden />
          <div className="relative">
            <p className="eyebrow text-volt-700 mb-1">Private arena</p>
            <h1 className="display text-[26px] sm:text-[32px] text-cream-100 mb-1">{room.roomName}</h1>
            <div className="flex items-center gap-3 mb-6 flex-wrap">
              <p className="text-[13px] text-cream-500">{game?.title} · {game?.tagline}</p>
              <Button size="sm" variant="blue" onClick={() => { sfx('toggle'); onOpenPicker?.(); }} icon={<Icon name="spark" size={13} />}>
                Change game
              </Button>
            </div>

            <div className="grid sm:grid-cols-[1fr_auto_1fr] gap-4 items-center">
              <PlayerSeat member={members[0]} you={slot === 0} colour="#f0b429" />
              <div className="hidden sm:flex flex-col items-center gap-1">
                <span className="display text-[18px] text-ink-400">VS</span>
                <span className="w-px h-10 bg-ink-600" />
              </div>
              <PlayerSeat member={members[1]} you={slot === 1} colour="#4a9fd8" />
            </div>

            <BoltRule className="my-6" />

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(room.settings ?? {}).filter(([k]) => !['cols', 'rows'].includes(k)).map(([k, v]) => (
                  <span key={k} className="px-2 py-1 bg-ink-800 border border-ink-600 text-[10px] font-bold uppercase tracking-wider text-cream-300">
                    {k}: {String(v)}
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <Button variant={me?.ready ? 'ghost' : 'primary'} onClick={() => { sfx('toggle'); onReady(!me?.ready); }}
                  icon={<Icon name={me?.ready ? 'check' : 'bolt'} size={15} />}>
                  {me?.ready ? 'Ready ✓' : 'Ready up'}
                </Button>
                {isHost && (
                  <Button variant="blue" onClick={onStart} disabled={!bothReady} icon={<Icon name="play" size={15} />}>
                    Start match
                  </Button>
                )}
              </div>
            </div>
            {!bothReady && (
              <p className="text-[11.5px] text-cream-500 mt-3">
                {members.length < 2 ? 'Waiting for a second trainer to join.' : 'Both trainers must ready up before the host can start.'}
                {!isHost && members.length === 2 && ' The host presses start.'}
              </p>
            )}
          </div>
        </Panel>

        {room.history?.length > 0 && (
          <Panel className="p-4 mt-4">
            <p className="eyebrow mb-2.5">Match history in this room</p>
            <div className="flex flex-col gap-1.5">
              {room.history.slice().reverse().map((h: any) => (
                <div key={h.matchId} className="flex items-center justify-between gap-3 text-[12px] py-1 border-b border-ink-700 last:border-0">
                  <span className={`font-extrabold ${h.winnerSlot === null ? 'text-cream-500' : h.winnerSlot === slot ? 'text-[#2f9c71]' : 'text-ember-600'}`}>
                    {h.winnerSlot === null ? 'Draw' : h.winnerSlot === slot ? 'You won' : 'You lost'}
                  </span>
                  <span className="text-cream-500 flex-1 truncate">{h.reason}</span>
                  <span className="text-ink-400 tabnum">{new Date(h.finishedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              ))}
            </div>
          </Panel>
        )}
      </div>

      <div className="lg:sticky lg:top-[112px] flex flex-col gap-4">
        <Panel className="p-4">
          <p className="eyebrow mb-2.5">Invite your rival</p>
          <div className="text-center py-3 mb-3 bg-ink-800 border border-ink-600 notch-sm">
            <p className="eyebrow text-[9px] mb-1">Room code</p>
            <p data-room-code={room.code} className="font-mono text-[38px] tracking-[.26em] text-volt-700 glow-text leading-none">{room.code}</p>
          </div>
          <CopyField label="Invite link" value={inviteLink} />
          <p className="text-[11.5px] text-cream-500 mt-2.5 leading-relaxed">
            Anyone with this code can take the open seat — it never exposes your account details.
          </p>
        </Panel>

        <Panel className="p-4 flex items-center gap-3">
          <PikachuMascot state={opp ? 'excited' : 'waiting'} size={opp ? 64 : 84} />
          <div className="min-w-0">
            <p className="text-[13px] font-extrabold text-cream-100">{opp ? `${opp.name} is here!` : 'Waiting for your rival'}</p>
            <p className="text-[11.5px] text-cream-500 mt-0.5">{opp ? 'Ready up and the host can start.' : 'Send them the code above.'}</p>
          </div>
        </Panel>

        {/* Embedded Arena Chat for Lobby */}
        <div className="hidden lg:block">
          <LobbyInlineChat
            messages={messages}
            sendChat={sendChat}
            oppName={opp?.name ?? ''}
            oppMascot={opp?.mascot}
            oppConnected={opp?.connected ?? false}
          />
        </div>
      </div>
    </div>
  );
}

function PlayerSeat({ member, you, colour }: { member: any; you: boolean; colour: string }) {
  if (!member) {
    return (
      <div className="panel notch-sm p-4 flex flex-col items-center gap-2 border-dashed opacity-80">
        <PikachuMascot state="sleeping" size={78} />
        <p className="text-[12.5px] font-extrabold text-cream-500">Open seat</p>
        <p className="text-[10.5px] text-ink-400">Share the room code</p>
      </div>
    );
  }
  return (
    <div className="panel notch-sm p-4 flex flex-col items-center gap-2 relative" style={{ borderColor: member.ready ? colour : undefined }}>
      <span className="absolute top-2 right-2 flex items-center gap-1 text-[9px] font-extrabold uppercase tracking-wider"
        style={{ color: member.connected ? '#3fae82' : '#e05a74' }}>
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: member.connected ? '#3fae82' : '#e05a74' }} />
        {member.connected ? 'Online' : 'Away'}
      </span>
      <img src={MASCOT_ART[member.mascot] ?? MASCOT_ART.classic} alt="" width={64} height={64} className="w-16 h-16 object-contain" />
      <p className="text-[14px] font-extrabold text-cream-100 text-center max-w-[16ch] truncate">{member.name}{you ? ' (you)' : ''}</p>
      <div className="flex items-center gap-1.5">
        {member.isHost && <span className="px-1.5 py-0.5 bg-blush-100 border border-ink-500 text-[9px] font-extrabold uppercase tracking-wider text-cream-300">Host</span>}
        <span className="px-2 py-0.5 text-[9.5px] font-extrabold uppercase tracking-wider"
          style={{ background: member.ready ? colour : '#27231a', color: member.ready ? '#15130f' : '#a89f88' }}>
          {member.ready ? 'Ready' : 'Not ready'}
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ HUD */
function MatchHud({ game, state, slot, names, myTurn, lastAction, onResign, onDraw, canDraw }: any) {
  const oppSlot = slot === 0 ? 1 : 0;
  return (
    <Panel className="p-3 flex flex-wrap items-center gap-3">
      <TurnPill
        active={myTurn}
        label={
          game === 'trivia'
            ? state.phase === 'reveal' ? 'Answer revealed'
              : myTurn ? 'Answer now' : 'Locked in'
            : game === 'reaction' ? 'Both of you, ready'
            : game === 'sketch'
              ? state.phase === 'reveal' ? 'Round over'
                : state.drawer === slot ? 'Draw it' : 'Guess it'
            : myTurn ? 'Your move' : `${names[oppSlot]}’s move`
        }
      />
      <div className="flex items-center gap-2 flex-wrap">
        {game === 'chess' && state.clock && (
          <>
            <Stat label={names[0]} value={clockText(state.clock[0])} accent={slot === 0 ? '#f0b429' : undefined} />
            <Stat label={names[1]} value={clockText(state.clock[1])} accent={slot === 1 ? '#f0b429' : undefined} />
          </>
        )}
        {game === 'memory' && (
          <>
            <Stat label={names[0]} value={state.score?.[0] ?? 0} accent="#f0b429" />
            <Stat label={names[1]} value={state.score?.[1] ?? 0} accent="#4a9fd8" />
            <Stat label="Streak" value={state.streak?.[slot] ?? 0} accent="#3fae82" />
          </>
        )}
        {game === 'battleship' && (
          <>
            <Stat label="Your hits" value={state.hits?.[slot]?.length ?? 0} accent="#e05a74" />
            <Stat label="Sunk" value={`${state.sunk?.[slot]?.length ?? 0}/5`} accent="#3fae82" />
          </>
        )}
        {game === 'cards' && (
          <>
            <Stat label="Your cards" value={state.hands?.[slot]?.length ?? 0} accent="#f0b429" />
            <Stat label={names[slot === 0 ? 1 : 0]} value={state.hands?.[slot === 0 ? 1 : 0]?.length ?? 0} accent="#4a9fd8" />
            <Stat label="In play" value={state.suit ?? '—'} />
          </>
        )}
        {game === 'trivia' && (
          <>
            <Stat label={names[0]} value={state.score?.[0] ?? 0} accent="#f0b429" />
            <Stat label={names[1]} value={state.score?.[1] ?? 0} accent="#4a9fd8" />
            <Stat label="Streak" value={state.streak?.[slot] ?? 0} accent="#3fae82" />
          </>
        )}
        {game === 'tictactoe' && <Stat label="Moves" value={state.moves?.length ?? 0} />}
        {game === 'connect4' && <Stat label="Discs" value={state.history?.length ?? 0} />}
        {game === 'checkers' && <Stat label="Pieces" value={`${state.board?.filter((b: any) => b?.p === slot).length ?? 0}`} accent="#f0b429" />}
      </div>
      <div className="flex-1" />
      {lastAction && <span className="text-[11px] text-cream-500 font-mono truncate max-w-[26ch]">{lastAction}</span>}
      {canDraw && <Button size="sm" variant="ghost" onClick={onDraw} icon={<Icon name="hand" size={13} />}>Offer draw</Button>}
      <Button size="sm" variant="ghost" onClick={onResign} icon={<Icon name="flag" size={13} />}>Resign</Button>
    </Panel>
  );
}

function TurnPill({ active, label }: { active: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-2 px-3 py-1.5 border text-[11.5px] font-extrabold uppercase tracking-wider notch-sm
      ${active ? 'bg-volt-400 text-[#5a3a12] border-volt-200' : 'bg-ink-800 text-cream-500 border-ink-600'}`}>
      <span className={`w-2 h-2 rounded-full ${active ? 'bg-ink-900 animate-pulse' : 'bg-cream-500'}`} />{label}
    </span>
  );
}

/* ------------------------------------------------------------------ helpers */
const clockText = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const statusLabel = (s: string) => ({
  WAITING: 'Waiting for trainers', READY_CHECK: 'Ready check', STARTING: 'Starting', IN_GAME: 'Live',
  COMPLETED: 'Match complete', EXPIRED: 'Expired', CANCELLED: 'Cancelled', DISCONNECTED: 'Reconnecting',
} as Record<string, string>)[s] ?? s;

function isMyTurn(gameId: string, state: any, slot: 0 | 1): boolean {
  if (!state || state.over) return false;
  switch (gameId) {
    case 'chess': return (state.fen?.split(' ')[1] === 'w' ? 0 : 1) === slot;
    case 'reaction': return true;                                     // both may press
    // simultaneous: the drawer draws and the guesser guesses, all round long
    case 'sketch': return state.phase === 'draw';
    // simultaneous: you may act whenever a question is open and you have not answered
    case 'trivia': return state.phase === 'question' && state.picked?.[slot] == null;
    case 'battleship': return state.phase === 'placement' ? !state.ready[slot] : state.turn === slot;
    default: return state.turn === slot;
  }
}
function scoreFor(gameId: string, state: any, s: 0 | 1) {
  if (!state) return '—';
  switch (gameId) {
    case 'memory': return state.score?.[s] ?? 0;
    case 'reaction': return state.wins?.[s] ?? 0;
    case 'trivia': return state.score?.[s] ?? 0;
    case 'sketch': return state.scores?.[s] ?? 0;
    case 'battleship': return `${state.sunk?.[s]?.length ?? 0}/5`;
    case 'chess': return state.pgnMoves ? Math.ceil(state.pgnMoves.length / 2) : 0;
    case 'connect4': return state.history?.filter((_: any, i: number) => i % 2 === s).length ?? 0;
    case 'checkers': return state.board?.filter((b: any) => b?.p === s).length ?? 0;
    // hand size survives redaction (the cards are -1, the length is real)
    case 'cards': return state.hands?.[s]?.length ?? 0;
    default: return state.cells ? state.cells.filter((c: any) => c === s).length : 0;
  }
}
function metaFor(gameId: string, state: any, slot: 0 | 1): Record<string, unknown> {
  if (!state) return {};
  if (gameId === 'memory') return { memoryStreak: state.streak?.[slot] ?? 0 };
  if (gameId === 'chess') return { moves: state.pgnMoves?.length ?? 0 };
  if (gameId === 'reaction') {
    const best = (state.rounds ?? []).map((r: any) => r.responses?.[slot]).filter((x: any) => typeof x === 'number');
    return { reactionMs: best.length ? Math.min(...best) : undefined };
  }
  if (gameId === 'battleship') {
    const mine = state.fleets?.[slot] ?? [];
    return { flawlessFleet: mine.every((s: any) => s.hits.length === 0) };
  }
  if (gameId === 'checkers') return { kings: (state.board ?? []).filter((b: any) => b?.p === slot && b.king).length };
  if (gameId === 'trivia') return { quizBestStreak: state.bestStreak?.[slot] ?? 0, quizScore: state.score?.[slot] ?? 0 };
  if (gameId === 'cards') return { cardsLeft: state.hands?.[slot]?.length ?? 0 };
  if (gameId === 'sketch') return { sketchScore: state.scores?.[slot] ?? 0, sketchRounds: state.rounds ?? 0 };
  return {};
}
