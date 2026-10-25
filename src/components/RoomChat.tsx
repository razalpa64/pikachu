import {
  useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode,
} from 'react';
import { Icon } from './ui';
import { PikachuMascot } from '../mascot';
import { MASCOT_ART } from '../lib/identity';
import { useStore } from '../lib/store';
import type { ChatMessage } from '../lib/useRoom';
import type { SystemLine } from '../lib/useRoomLines';
import { buildFeed, REACTIONS, unreadCount, type ReactionSpec } from '../lib/chatFeed';

/* ============================================================================
   ARENA CHAT — one surface, three placements
   ----------------------------------------------------------------------------
   Everything the room uses to talk lives in this file. The old screen had two
   almost-identical chat shells (a floating modal and an inline lobby panel)
   with their own hexes, their own shadow depths and their own padding, which
   is why the chat read as a widget bolted onto the arcade. There is now:

     • ChatRail    — the docked panel. Used beside the board on desktop and in
                     the lobby's right column. The parent owns the layout.
     • MobileChat  — a peek bar plus a sheet that leaves the board visible,
                     because the old modal covered the bottom third of a phone.

   Both render the same <ChatSurface>, so a change to bubbles, grouping or
   accessibility can never drift between the two.

   Design notes that matter:
   • Only existing tokens (--line, --line-strong, panels, .eyebrow, .btn).
     No new hexes, no shadow-xl / shadow-2xl, no 9.5px labels.
   • Reactions are drawn stickers, not OS emoji — Apple, Google and Windows
     each render ⚡ differently, which broke the hand-drawn look.
   • Consecutive messages from one person are grouped (5 minute window) and
     timestamps collapse into dividers, per the MUI/lichess pattern.
   • role="log" + aria-live="polite" so screen readers hear new messages.
   ========================================================================== */

/* ------------------------------------------------------------------ stickers
   The list of reactions lives in lib/chatFeed (label + legacy emoji form) so it
   can be unit-tested; this file only owns the artwork. Icons are drawn with the
   same hairline stroke as every other icon in the app, so they belong to the
   interface instead of looking like an OS emoji font.
------------------------------------------------------------------------------ */

const S = 18;

const STICKER_ICONS: Record<string, ReactNode> = {
  'GG!': <path d="M10 1.5 3 11h5l-1 6 8-10h-5z" />,
  'Nice move!': <path d="m9 1.8 2.2 4.7 5.1.7-3.7 3.5.9 5.1L9 13.4l-4.5 2.4.9-5.1L1.7 7.2l5.1-.7z" />,
  'Good luck!': <path d="M6.5 9.5V4.2a1.3 1.3 0 0 1 2.6 0v4.1m0 0V2.9a1.3 1.3 0 0 1 2.6 0v5.4m0 0V4.6a1.3 1.3 0 0 1 2.6 0v6.9c0 3.2-2 5.3-5 5.3-2.4 0-3.7-.9-5-2.9L1.9 10a1.3 1.3 0 0 1 2.1-1.5l2.5 2.4" />,
  'Thinking…': <><circle cx="9" cy="9" r="7.2" /><path d="M9 5.2V9l2.6 1.7" /></>,
  'Rematch?': <><circle cx="9" cy="9" r="6.6" /><circle cx="9" cy="9" r="2.4" /><path d="M9 1.2v2.2M9 14.6v2.2M1.2 9h2.2M14.6 9h2.2" /></>,
  'Oops!': <path d="M11.4 2.3a7 7 0 1 0 5.3 6.9c0-1-.2-1.9-.6-2.7-1.3.9-3.6 1.2-4.7-.4-1-1.5-.9-3.6 0-3.8z" />,
  'Wow!': <><path d="M9 1.4 10.9 7l5.7.2-4.5 3.5 1.6 5.5L9 12.9l-4.7 3.3 1.6-5.5L1.4 7.2 7.1 7z" /><path d="M15.4 1.6v3M13.9 3.1h3" /></>,
  'Pika pika!': <><path d="M6.8 1.6C4.6 5.2 3 8.4 3 10.4c0 3.4 2.7 6 6 6s6-2.6 6-6c0-2-1.6-5.2-3.7-8.6L9 5.6z" /><path d="M4 6.4 2 5.2M14 6.4l2-1.2" /></>,
};

/** what a screen reader says when the reaction is announced */
const STICKER_SAY: Record<string, string> = {
  'GG!': 'good game',
  'Nice move!': 'nice move',
  'Good luck!': 'good luck',
  'Thinking…': 'thinking',
  'Rematch?': 'rematch',
  'Oops!': 'oops',
  'Wow!': 'wow',
  'Pika pika!': 'pika pika',
};

function StickerGlyph({ spec, size = S }: { spec: ReactionSpec; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden
      className="shrink-0">
      {STICKER_ICONS[spec.label] ?? STICKER_ICONS['GG!']}
    </svg>
  );
}

/* ------------------------------------------------------------------ bubbles */

function Bubble({
  children, mine, tail, className = '',
}: { children: ReactNode; mine: boolean; tail?: boolean; className?: string }) {
  return (
    <div
      className={`max-w-[86%] px-3 py-1.5 text-[13px] leading-relaxed break-words border-2 rounded-2xl
        ${mine
          ? 'bg-gradient-to-br from-volt-300 to-volt-400 text-[#4a2e18] font-bold border-volt-600'
          : 'bg-white text-cream-100 font-semibold border-ink-500'}
        ${tail ? (mine ? 'rounded-tr-[7px]' : 'rounded-tl-[7px]') : ''}
        ${className}`}
      style={{ boxShadow: '0 1px 2px rgba(120,80,55,.14)' }}
    >
      {children}
    </div>
  );
}

function StickerBubble({ spec, mine }: { spec: ReactionSpec; mine: boolean }) {
  return (
    <div
      className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-2xl border-2 font-extrabold text-[12.5px]
        ${mine
          ? 'bg-gradient-to-br from-volt-300 to-volt-400 text-[#4a2e18] border-volt-600 rounded-tr-[7px]'
          : 'bg-white text-cream-100 border-ink-500 rounded-tl-[7px]'}`}
      style={{ boxShadow: '0 1px 2px rgba(120,80,55,.14)' }}
    >
      <StickerGlyph spec={spec} />
      {spec.label}
    </div>
  );
}

/* ------------------------------------------------------------------ feed */

function Feed({
  messages, system, oppName, oppMascot, ownMascot,
}: {
  messages: ChatMessage[];
  system: SystemLine[];
  oppName: string;
  oppMascot?: string;
  ownMascot?: string;
}) {
  // grouping, ordering and dividers are decided by the tested helper
  const rows = useMemo(() => buildFeed(messages, system), [messages, system]);

  if (!rows.length) {
    return (
      <div className="h-full min-h-[150px] flex flex-col items-center justify-center text-center px-5 select-none">
        <PikachuMascot state="idle" size={64} />
        <p className="display text-[14.5px] text-cream-100 mt-1.5">
          {oppName ? `Say hi to ${oppName}` : 'Waiting for your rival'}
        </p>
        <p className="text-[11.5px] text-cream-500 max-w-[210px] mt-0.5 leading-relaxed">
          Tap a reaction below, or type anything — it goes straight to the room.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {rows.map((row, i) => {
        const divider = row.divider && (
          <p key={`${row.key}-t`} className="eyebrow text-[10px] text-center py-1.5">{row.divider}</p>
        );

        if (row.kind === 'sys') {
          return (
            <div key={row.key} className={i === 0 ? 'pt-0.5' : 'pt-2.5'}>
              {divider}
              <div className="flex items-center justify-center gap-1.5 py-0.5">
                <span className="h-[2px] flex-1 max-w-8 rounded-full bg-ink-500/70" />
                <p className={`text-[10.5px] font-extrabold text-center leading-snug px-1
                  ${row.tone === 'result' ? 'text-volt-700'
                    : row.tone === 'leave' ? 'text-ember-600'
                    : 'text-cream-500'}`}>
                  {row.text}
                </p>
                <span className="h-[2px] flex-1 max-w-8 rounded-full bg-ink-500/70" />
              </div>
            </div>
          );
        }

        const mine = row.mine;
        const head = !row.grouped;
        return (
          <div key={row.key}>
            {divider}
            <div className={`flex items-end gap-2 ${mine ? 'justify-end' : 'justify-start'} ${row.grouped ? 'mt-[3px]' : 'mt-2'}`}>
              {!mine && (
                <span className={`w-7 h-7 shrink-0 rounded-full bg-white border-2 border-ink-500 grid place-items-center overflow-hidden ${row.grouped ? 'invisible' : ''}`}>
                  <img src={MASCOT_ART[oppMascot ?? 'classic'] ?? MASCOT_ART.classic} alt="" width={20} height={20}
                    className="w-5 h-5 object-contain" />
                </span>
              )}
              <div className={`flex flex-col flex-1 min-w-0 ${mine ? 'items-end' : 'items-start'}`}>
                {head && (
                  <span className="text-[10px] font-extrabold text-cream-500 px-1 mb-[2px]">
                    {mine ? 'You' : (row.from || oppName || 'Rival')}
                  </span>
                )}
                {row.reaction
                  ? <StickerBubble spec={row.reaction} mine={mine} />
                  : <Bubble mine={mine} tail={head}>{row.text}</Bubble>}
              </div>
              {mine && (
                <span className={`w-7 h-7 shrink-0 rounded-full bg-white border-2 border-ink-500 grid place-items-center overflow-hidden ${row.grouped ? 'invisible' : ''}`}>
                  <img src={MASCOT_ART[ownMascot ?? 'classic'] ?? MASCOT_ART.classic} alt="" width={20} height={20}
                    className="w-5 h-5 object-contain" />
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ composer */

function Composer({
  onSend, onTyping, oppName, disabled, disabledReason,
}: {
  onSend: (text: string) => void;
  onTyping?: (on: boolean) => void;
  oppName: string;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const { sfx } = useStore();
  const [draft, setDraft] = useState('');
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  const id = useId();
  const left = 200 - draft.length;

  const grow = () => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 78)}px`;
  };

  const submit = () => {
    const text = draft.trim();
    if (!text || disabled) return;
    onSend(text);
    setDraft('');
    onTyping?.(false);
    sfx('place');
    requestAnimationFrame(() => { if (areaRef.current) areaRef.current.style.height = 'auto'; });
    areaRef.current?.focus();
  };

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); submit(); }}
      className="shrink-0 px-2 pt-2 pb-2 border-t border-ink-600 bg-ink-850"
    >
      {disabled && disabledReason && (
        <p className="text-[10.5px] font-bold text-cream-500 px-1 pb-1.5">{disabledReason}</p>
      )}
      <div className="flex items-end gap-2">
        <label htmlFor={id} className="sr-only">Message {oppName || 'your rival'}</label>
        <textarea
          id={id}
          ref={areaRef}
          rows={1}
          value={draft}
          disabled={disabled}
          maxLength={200}
          placeholder={oppName ? `Message ${oppName}…` : 'Type a message…'}
          onChange={(e) => { setDraft(e.target.value); grow(); if (e.target.value.trim()) onTyping?.(true); }}
          onBlur={() => onTyping?.(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
          }}
          className="flex-1 min-w-0 resize-none bg-white border-2 border-ink-500 rounded-2xl px-3 py-2
            text-[13px] font-semibold leading-snug text-cream-100 placeholder:text-cream-500
            focus:border-volt-500 focus:outline-none transition-colors no-tap
            disabled:opacity-60 disabled:cursor-not-allowed"
          style={{ boxShadow: 'inset 0 1px 3px rgba(120,80,55,.12)', maxHeight: 78 }}
        />
        <button
          type="submit"
          disabled={disabled || !draft.trim()}
          aria-label="Send message"
          className="w-11 h-11 shrink-0 rounded-full grid place-items-center border-[2.5px] border-volt-600
            bg-gradient-to-b from-volt-300 to-volt-400 text-[#4a2e18] transition-transform
            hover:-translate-y-[1px] active:translate-y-[1px] disabled:opacity-45 disabled:translate-y-0
            no-tap cursor-pointer disabled:cursor-not-allowed"
          style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,.6), 0 3px 0 0 #e0a21f' }}
        >
          <Icon name="send" size={17} />
        </button>
      </div>
      {left <= 30 && (
        <p className={`text-[10px] font-extrabold text-right px-1 pt-1 ${left <= 0 ? 'text-ember-600' : 'text-cream-400'}`}
          aria-live="polite">
          {left} characters left
        </p>
      )}
    </form>
  );
}

/* ------------------------------------------------------------------ the surface */

interface SurfaceProps {
  messages: ChatMessage[];
  system: SystemLine[];
  sendChat: (text: string) => void;
  onTyping?: (on: boolean) => void;
  peerTyping?: boolean;
  me: { name: string; mascot: string };
  opp: { name: string; mascot?: string; connected: boolean };
  onClose?: () => void;
  className?: string;
  /** announced counter so both placements agree on what "unread" means */
  onRead?: () => void;
  /** sheet mode: start at the newest message and put the caret in the input */
  autoFocus?: boolean;
}

function ChatSurface({
  messages, system, sendChat, onTyping, peerTyping, me, opp, onClose, className = '', onRead, autoFocus,
}: SurfaceProps) {
  const logRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [pinned, setPinned] = useState(true);

  // Only follow new messages when the reader is already at the bottom. Yanking
  // someone back down while they reread a message is the classic chat bug.
  const distanceFromBottom = () => {
    const el = logRef.current;
    if (!el) return 0;
    return el.scrollHeight - el.scrollTop - el.clientHeight;
  };

  const toBottom = useCallback((smooth = false) => {
    const el = logRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  useEffect(() => {
    if (!pinned) return;
    // scrolling the log itself — scrollIntoView on a child would also drag the
    // page around, which is jarring mid-match
    toBottom();
  }, [messages.length, system.length, pinned, peerTyping, toBottom]);

  // when the sheet opens there is nothing to read yet at the bottom on a phone,
  // so start at the newest message and let the keyboard land in the input
  useEffect(() => {
    if (!autoFocus) return;
    toBottom();
    const el = rootRef.current?.querySelector<HTMLTextAreaElement>('textarea');
    el?.focus({ preventScroll: true });
  }, [autoFocus, toBottom]);

  useEffect(() => { onRead?.(); }, [messages.length, onRead]);

  const send = (text: string) => {
    sendChat(text);
    onTyping?.(false);
    setPinned(true);
  };

  return (
    <div ref={rootRef} className={`flex flex-col min-h-0 overflow-hidden panel panel-notch bg-ink-800 ${className}`}>
      {/* header */}
      <div className="shrink-0 px-3 py-2 border-b-2 border-ink-600 bg-gradient-to-b from-ink-800 to-ink-850 flex items-center gap-2.5">
        <span className="w-9 h-9 shrink-0 rounded-full bg-white border-2 border-ink-500 grid place-items-center overflow-hidden">
          <img src={MASCOT_ART[opp.mascot ?? 'classic'] ?? MASCOT_ART.classic} alt="" width={26} height={26}
            className="w-[26px] h-[26px] object-contain" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="eyebrow text-[9.5px] leading-none mb-0.5">Arena chat</p>
          <div className="flex items-center gap-1.5 min-w-0">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${opp.connected ? 'bg-[#3fae82]' : 'bg-cream-400'}`}
              aria-hidden />
            <p className="text-[13px] font-extrabold text-cream-100 truncate leading-tight">
              {opp.name || 'Waiting for your rival'}
            </p>
            <span className="text-[10px] font-bold text-cream-500 shrink-0">
              {opp.connected ? 'here' : 'idle'}
            </span>
          </div>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close chat"
            className="w-9 h-9 shrink-0 grid place-items-center rounded-full bg-white border-2 border-ink-500
              text-cream-300 hover:text-blush-600 hover:border-blush-300 transition-colors no-tap cursor-pointer"
          >
            <Icon name="x" size={14} />
          </button>
        )}
      </div>

      {/* log */}
      <div
        ref={logRef}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label="Chat messages"
        onScroll={() => setPinned(distanceFromBottom() < 48)}
        className="relative flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 py-2.5 bg-[#fffaf0]"
      >
        <Feed
          messages={messages}
          system={system}
          oppName={opp.name}
          oppMascot={opp.mascot}
          ownMascot={me.mascot}
        />
      </div>

      {/* typing + new-message affordance */}
      <div className="shrink-0 h-6 px-3 flex items-center justify-between gap-2 bg-[#fffaf0]">
        <p className="flex items-center gap-1.5 text-[10.5px] font-bold text-cream-500 truncate min-w-0">
          {peerTyping && (
            <span className="pk-typing shrink-0" aria-hidden>
              <i /><i /><i />
            </span>
          )}
          <span className="truncate">{peerTyping ? `${opp.name || 'Your rival'} is typing` : ''}</span>
        </p>
        {!pinned && messages.length > 0 && (
          <button
            type="button"
            onClick={() => { setPinned(true); toBottom(true); }}
            className="text-[10.5px] font-extrabold text-volt-700 hover:text-volt-600 shrink-0 no-tap cursor-pointer"
          >
            Newest ↓
          </button>
        )}
        <span className="sr-only" aria-live="polite">
          {peerTyping ? `${opp.name || 'Your rival'} is typing` : ''}
        </span>
      </div>

      {/* reactions — stickers, not OS emoji */}
      <div className="shrink-0 px-2 py-1.5 border-t-2 border-ink-600 bg-ink-850 flex gap-1.5 overflow-x-auto no-scrollbar">
        {REACTIONS.map((s) => (
          <button
            key={s.label}
            type="button"
            onClick={() => send(s.label)}
            aria-label={`Send reaction: ${STICKER_SAY[s.label] ?? s.label}`}
            title={s.label}
            className="shrink-0 inline-flex items-center gap-1 h-8 px-2.5 rounded-full bg-white border-2 border-ink-500
              text-cream-300 hover:text-volt-700 hover:border-volt-400 hover:bg-volt-100
              transition-colors no-tap cursor-pointer active:translate-y-[1px]"
          >
            <StickerGlyph spec={s} size={14} />
            <span className="text-[10.5px] font-extrabold whitespace-nowrap">{s.label}</span>
          </button>
        ))}
      </div>

      <Composer onSend={send} onTyping={onTyping} oppName={opp.name} />
    </div>
  );
}

/* ------------------------------------------------------------------ rail (desktop / lobby) */

export function ChatRail(props: SurfaceProps) {
  return <ChatSurface {...props} />;
}

/* ------------------------------------------------------------------ mobile sheet */

export function MobileChat(props: SurfaceProps) {
  const { messages, opp } = props;
  const [open, setOpen] = useState(false);
  const launcherRef = useRef<HTMLButtonElement | null>(null);
  const [readCount, setReadCount] = useState(messages.length);
  const unread = unreadCount(messages.length, readCount);
  const markRead = useCallback(() => setReadCount(messages.length), [messages.length]);
  const lastMsg = messages[messages.length - 1];

  // Esc closes the sheet and puts focus back on the launcher. Tab is kept inside
  // the sheet while it is open: it declares aria-modal, so it should behave like
  // one rather than letting focus wander onto the board behind the scrim.
  const sheetRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        requestAnimationFrame(() => launcherRef.current?.focus());
        return;
      }
      if (e.key !== 'Tab') return;
      const focusables = sheetRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), textarea, input, [href], [tabindex]:not([tabindex="-1"])',
      );
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0];
      const lastEl = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (!active || !sheetRef.current?.contains(active)) { e.preventDefault(); first.focus(); return; }
      if (e.shiftKey && active === first) { e.preventDefault(); lastEl.focus(); }
      else if (!e.shiftKey && active === lastEl) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  const close = useCallback(() => {
    setOpen(false);
    setReadCount(messages.length);
    requestAnimationFrame(() => launcherRef.current?.focus());
  }, [messages.length]);

  if (open) {
    return (
      <div className="lg:hidden">
        {/* A light scrim rather than a solid one: the board stays readable
            behind it. Decorative — Escape and the Close button are the
            accessible ways out, so this must not become a giant tab stop. */}
        <div aria-hidden onClick={close}
          className="fixed inset-0 z-40 bg-[#5c4035]/25 backdrop-blur-[1px]" />
        <div
          ref={sheetRef}
          role="dialog"
          aria-modal="true"
          aria-label="Arena chat"
          className="fixed z-50 left-2 right-2 sm:left-auto sm:right-3 sm:w-[380px] a-pop"
          style={{ bottom: 'calc(8px + env(safe-area-inset-bottom))', height: 'min(68vh, 560px)' }}
        >
          <ChatSurface
            {...props}
            onClose={close}
            onRead={markRead}
            autoFocus
            className="h-full"
          />
        </div>
      </div>
    );
  }

  return (
    <button
      ref={launcherRef}
      type="button"
      onClick={() => { setOpen(true); setReadCount(messages.length); }}
      aria-label={unread ? `Open arena chat, ${unread} new ${unread === 1 ? 'message' : 'messages'}` : 'Open arena chat'}
      aria-haspopup="dialog"
      className="lg:hidden fixed z-40 left-2 right-2 sm:left-auto sm:right-3 sm:w-[360px] flex items-center gap-2.5 px-2.5 py-2 rounded-2xl
        bg-white border-2 border-ink-500 text-left no-tap cursor-pointer active:translate-y-[1px]"
      style={{
        bottom: 'calc(8px + env(safe-area-inset-bottom))',
        boxShadow: '0 2px 4px -2px rgba(120,80,55,.2), 0 16px 30px -18px rgba(140,94,70,.6)',
      }}
    >
      <span className="w-9 h-9 shrink-0 rounded-full bg-blush-100 border-2 border-ink-500 grid place-items-center overflow-hidden relative">
        <img src={MASCOT_ART[opp.mascot ?? 'classic'] ?? MASCOT_ART.classic} alt="" width={24} height={24}
          className="w-6 h-6 object-contain" />
        <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white
          ${opp.connected ? 'bg-[#3fae82]' : 'bg-cream-400'}`} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] font-extrabold uppercase tracking-wider text-cream-500 leading-none mb-0.5">
          {opp.name ? `Arena chat · ${opp.name}` : 'Arena chat'}
        </span>
        <span className={`block text-[12.5px] truncate leading-tight ${lastMsg ? 'text-cream-100 font-bold' : 'text-cream-500 font-semibold'}`}>
          {lastMsg ? (lastMsg.isSelf ? `You: ${lastMsg.text}` : lastMsg.text) : 'Tap to say hello'}
        </span>
      </span>
      {unread > 0 ? (
        <span className="shrink-0 min-w-6 h-6 px-1.5 rounded-full bg-ember-600 text-white text-[11px] font-black grid place-items-center">
          {unread > 9 ? '9+' : unread}
        </span>
      ) : (
        <span className="shrink-0 w-9 h-9 rounded-full grid place-items-center bg-volt-400 border-2 border-volt-600 text-[#4a2e18]">
          <Icon name="chat" size={16} />
        </span>
      )}
    </button>
  );
}
