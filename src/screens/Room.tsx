import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { ChatRail, MobileChat } from '../components/RoomChat';
import { HowToPlay } from '../components/HowToPlay';
import { useRoomSystemLines, type SystemLine } from '../lib/useRoomLines';
import { BOARDS } from '../components/boards/registry';

export default function Room() {
  const { code = '' } = useParams();
  const nav = useNavigate();
  const { room, you, match, finished, conn, rtt, error, clearError, join, ready, start, act, leave, rematch, resign, offerDraw, respondDraw, nudge, connect, changeGame, returnToLobby, messages, sendChat, sendTyping, peerTyping } = useRoom();
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

  /* ------------------------------------------------------------ arena chat
     One set of props for the docked rail and the phone sheet, so the two can
     never disagree about who is online, what was said or who is typing. */
  const systemLines: SystemLine[] = useRoomSystemLines({
    room, finished, slot, matchId: match?.matchId ?? null,
  });
  const chatProps = {
    messages,
    system: systemLines,
    sendChat,
    onTyping: sendTyping,
    peerTyping,
    me: { name: me?.name ?? 'You', mascot: me?.mascot ?? 'classic' },
    opp: { name: opp?.name ?? '', mascot: opp?.mascot, connected: opp?.connected ?? false },
  };

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
      {/* pb on phones reserves room for the chat peek bar, which is fixed to the
          bottom of the viewport — without it the last line of a board sits under it. */}
      <div className="flex-1 mx-auto w-full max-w-[1340px] px-[var(--shell-pad)] pt-2 pb-[74px] sm:py-5 sm:pb-[74px] lg:pb-5 relative">
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
          <Lobby room={room} slot={slot} inviteLink={inviteLink} onReady={ready} onStart={start} onChangeGame={changeGame} onOpenPicker={() => setPickerOpen(true)} chat={chatProps} />
        )}

        {room.status === 'STARTING' && room.startsAt && (
          <div className="relative min-h-[60vh]"><MatchCountdown startsAt={room.startsAt} names={names} /></div>
        )}

        {(room.status === 'IN_GAME' || (room.status === 'COMPLETED' && finished)) && match && Board && (
          <div className="relative lg:grid lg:grid-cols-[minmax(0,1fr)_324px] lg:gap-5 lg:items-start">
            <div className="min-w-0">
              <MatchHud game={room.gameId} state={match.state} slot={slot} names={names} myTurn={myTurn}
                lastAction={match.lastAction} onResign={() => setConfirmResign(true)}
                onDraw={offerDraw} canDraw={room.gameId === 'chess' || room.gameId === 'checkers'} />

              <div className="flex justify-center py-5 overflow-x-auto">
                <Suspense fallback={<ElectricLoader status="Loading the arena" compact />}>
                  <Board state={match.state} youSlot={slot} onMove={act} interactive={!!live && myTurn} names={names} hint />
                </Suspense>
              </div>

              <div className="max-w-[560px] mx-auto">
                <HowToPlay gameId={room.gameId} gameTitle={game?.title} compact />
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

            {/* The chat sits *beside* the board on desktop, so it can never cover
                a piece, a clock or the result card. */}
            <ChatRail {...chatProps}
              className="hidden lg:flex lg:sticky lg:top-[128px] h-[min(64vh,560px)]" />
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

      {/* Phones get a peek bar + sheet; desktop uses the docked rail. */}
      <MobileChat {...chatProps} />

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

/* ------------------------------------------------------------------ lobby */
function Lobby({ room, slot, inviteLink, onReady, onStart, _onChangeGame, onOpenPicker, chat }: any) {
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

        <div className="mt-4">
          <HowToPlay gameId={room.gameId} gameTitle={game?.title} defaultOpen={false} />
        </div>

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

        {/* the same chat surface as the in-game rail, just in the lobby column */}
        <div className="hidden lg:block">
          <ChatRail {...chat} className="h-[420px]" />
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
        <span className="px-2 py-0.5 rounded-full border-[1.5px] text-[9.5px] font-extrabold uppercase tracking-wider"
          style={
            member.ready
              ? { background: colour, borderColor: colour, color: '#4a2e18' }
              : { background: 'var(--color-ink-800)', borderColor: 'var(--color-ink-500)', color: 'var(--color-cream-500)' }
          }>
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
        {game === 'reversi' && (
          <>
            <Stat label={names[0]} value={state.counts?.[0] ?? 0} accent="#f0b429" />
            <Stat label={names[1]} value={state.counts?.[1] ?? 0} accent="#4a9fd8" />
            {state.passed !== null && state.passed !== undefined && <Stat label="Passed" value={names[state.passed]} accent="#e0a03c" />}
          </>
        )}
        {game === 'gomoku' && (
          <>
            <Stat label="Your stones" value={state.board?.filter((c: any) => c === slot).length ?? 0} accent="#f0b429" />
            <Stat label="Turns" value={state.history?.length ?? 0} />
          </>
        )}
        {game === 'dots' && (
          <>
            <Stat label={names[0]} value={state.scores?.[0] ?? 0} accent="#f0b429" />
            <Stat label={names[1]} value={state.scores?.[1] ?? 0} accent="#4a9fd8" />
            <Stat label="Boxes left" value={(state.boxes ?? []).filter((b: any) => b === null).length} />
          </>
        )}
        {game === 'mancala' && (
          <>
            <Stat label={names[0]} value={state.board?.[state.pits] ?? 0} accent="#f0b429" />
            <Stat label={names[1]} value={state.board?.[state.pits * 2 + 1] ?? 0} accent="#4a9fd8" />
            {state.lastCapture > 0 && <Stat label="Last capture" value={`+${state.lastCapture}`} accent="#3fae82" />}
          </>
        )}
      </div>
      <div className="flex-1" />
      {lastAction && <span className="text-[11px] text-cream-500 font-mono truncate max-w-[26ch]">{lastAction}</span>}
      {canDraw && <Button size="sm" variant="ghost" onClick={onDraw} icon={<Icon name="hand" size={13} />}>Offer draw</Button>}
      <Button size="sm" variant="ghost" onClick={onResign} icon={<Icon name="flag" size={13} />}>Resign</Button>
    </Panel>
  );
}

function TurnPill({ active, label }: { active: boolean; label: string }) {
  /* A polite live region, because in a turn-based game across two devices the single
     most useful thing a screen reader can say is "your move" — and it used to be a
     silent colour change. */
  return (
    <span role="status" aria-live="polite"
      className={`inline-flex items-center gap-2 px-3 py-1.5 border text-[11.5px] font-extrabold uppercase tracking-wider notch-sm
      ${active ? 'bg-volt-400 text-[#5a3a12] border-volt-200' : 'bg-ink-800 text-cream-500 border-ink-600'}`}>
      <span className={`w-2 h-2 rounded-full ${active ? 'bg-ink-900 animate-pulse' : 'bg-cream-500'}`} aria-hidden />{label}
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
    case 'reversi': return state.counts?.[s] ?? 0;
    case 'gomoku': return (state.board ?? []).filter((c: any) => c === s).length;
    case 'dots': return state.scores?.[s] ?? 0;
    // a player's store is the one past their own row of pits
    case 'mancala': return state.board?.[s === 0 ? state.pits : state.pits * 2 + 1] ?? 0;
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
