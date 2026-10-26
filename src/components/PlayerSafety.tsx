/**
 * The four things you may want to do about the person across the board.
 *
 * They are deliberately small and always in the same place — under the seats in
 * the lobby — rather than hidden behind a menu that only appears after something
 * has already gone wrong. What each one actually does:
 *
 *   • **Mute** — local. Hides their chat on this device, tells nobody, needs no
 *     account, works mid-match. It is the "not right now" button.
 *   • **Add friend** — a row in Postgres, only for signed-in players. Needs the
 *     opponent's *account* id, which the relay only gives out for verified
 *     players; a guest has nothing to friend.
 *   • **Block** — durable and enforced: you will not be matched with them again,
 *     their friend request cannot exist, they are not told, and the relay is
 *     handed the list before you press Find.
 *   • **Report** — a private note to the maintainer (`public.reports`), not the
 *     public feedback wall.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, ConfirmDialog, Icon, Panel } from './ui';
import { useStore } from '../lib/store';
import { useSession } from '../lib/session';
import { ACCOUNT_GAMES_ENABLED, blockPlayer, reportPlayer, requestFriend, type ReportCategory } from '../lib/friends';
import { isMuted, mute, unmute, useMuted } from '../lib/mute';

const CATEGORIES: { value: ReportCategory; label: string }[] = [
  { value: 'harassment', label: 'Harassment or abuse' },
  { value: 'cheating', label: 'Cheating' },
  { value: 'spam', label: 'Spam or advertising' },
  { value: 'other', label: 'Something else' },
];

interface Props {
  /** The opponent's relay player id — what muting is keyed on. */
  playerId: string | null;
  /** The opponent's verified account id, or null for a guest. */
  accountId: string | null;
  name: string;
  handle?: string | null;
  roomCode?: string | null;
  gameId?: string | null;
  onBlocked?: () => void;
}

export function PlayerSafety({ playerId, accountId, name, handle, roomCode, gameId, onBlocked }: Props) {
  const { toast, sfx } = useStore();
  const session = useSession();
  const muted = useMuted();
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  if (!playerId) return null;
  const signedIn = Boolean(session.userId);
  const thisMuted = muted(playerId);

  const friended = async () => {
    if (!accountId) return;
    setBusy('friend');
    try {
      await requestFriend(accountId);
      sfx('win');
      toast({ kind: 'success', title: `Asked ${name} to be friends`, body: 'They will see it on Play Together.' });
    } catch (err) {
      toast({ kind: 'error', title: 'Could not send that request', body: err instanceof Error ? err.message : undefined });
    } finally { setBusy(null); }
  };

  const doBlock = async () => {
    if (!accountId) return;
    setBusy('block');
    try {
      await blockPlayer(accountId, `blocked from room ${roomCode ?? ''}`);
      setConfirmBlock(false);
      toast({
        kind: 'success',
        title: `Blocked ${name}`,
        body: 'You will not be matched with them again. They are not told.',
      });
      onBlocked?.();
    } catch (err) {
      toast({ kind: 'error', title: 'Could not block them', body: err instanceof Error ? err.message : undefined });
    } finally { setBusy(null); }
  };

  return (
    <Panel className="p-3 mt-3 flex flex-wrap items-center gap-2">
      <span className="eyebrow text-[9.5px] mr-1 inline-flex items-center gap-1.5">
        <Icon name="shield" size={13} /> {name}
      </span>

      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          sfx('toggle');
          if (thisMuted) { unmute(playerId); } else { mute(playerId); }
        }}
        icon={<Icon name="mute" size={13} />}
      >
        {thisMuted ? 'Unmute' : 'Mute'}
      </Button>

      {ACCOUNT_GAMES_ENABLED() && (
        signedIn && accountId ? (
          <Button size="sm" variant="ghost" disabled={busy === 'friend'} onClick={() => void friended()}
            icon={<Icon name="users" size={13} />}>
            Add friend
          </Button>
        ) : !signedIn ? (
          <Link to="/settings" className="inline-flex">
            <Button size="sm" variant="ghost" icon={<Icon name="user" size={13} />} title="Sign in to add friends">
              Sign in to add friends
            </Button>
          </Link>
        ) : null
      )}

      {ACCOUNT_GAMES_ENABLED() && signedIn && accountId && (
        <Button size="sm" variant="ghost" disabled={busy === 'block'} onClick={() => setConfirmBlock(true)}
          icon={<Icon name="shield" size={13} />}>
          Block
        </Button>
      )}

      {ACCOUNT_GAMES_ENABLED() && (
        <Button size="sm" variant="ghost" onClick={() => setReportOpen(true)} icon={<Icon name="flag" size={13} />}>
          Report
        </Button>
      )}

      <ConfirmDialog
        open={confirmBlock}
        danger
        title={`Block ${name}?`}
        body="You will never be matched with them again, their invitations and friend requests cannot reach you, and they are not told. You can undo this on Play Together."
        confirmLabel={busy === 'block' ? 'Blocking…' : 'Block them'}
        onConfirm={() => void doBlock()}
        onCancel={() => setConfirmBlock(false)}
      />

      <ReportDialog
        open={reportOpen}
        name={name}
        onClose={() => setReportOpen(false)}
        onSubmitted={() => {
          setReportOpen(false);
          toast({
            kind: 'success',
            title: 'Report sent',
            body: 'Only the maintainer can read it. Thank you for saying something.',
          });
        }}
        submit={(category, message) => reportPlayer({
          reported: accountId,
          reportedName: name,
          reportedHandle: handle ?? null,
          roomCode: roomCode ?? null,
          gameId: gameId ?? null,
          category,
          message,
          context: { slot: playerId, source: 'room' },
        })}
      />
    </Panel>
  );
}

/** Reporting is one small form: a reason, and a sentence about what happened. */
function ReportDialog({
  open, name, onClose, onSubmitted, submit,
}: {
  open: boolean;
  name: string;
  onClose: () => void;
  onSubmitted: () => void;
  submit: (category: ReportCategory, message: string) => Promise<void>;
}) {
  const [category, setCategory] = useState<ReportCategory>('harassment');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open) return null;

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await submit(category, message.trim());
      setMessage('');
      onSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send that.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] grid place-items-center p-4 blur-heavy backdrop-blur-[3px]"
      style={{ background: 'rgba(92, 64, 53, .38)' }} onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="report-title"
        className="panel panel-notch w-full max-w-[460px] p-5 a-pop" onClick={(e) => e.stopPropagation()}>
        <h3 id="report-title" className="display text-[19px] text-cream-100">Report {name}</h3>
        <p className="text-[12.5px] text-cream-500 mt-1.5 leading-relaxed">
          This goes to the maintainer only — it is not posted anywhere, and nothing on the site shows
          it. Blocking them is what stops it happening again in the meantime.
        </p>

        <div className="mt-3.5 flex flex-col gap-1.5">
          <label htmlFor="report-category" className="eyebrow text-[9.5px]">What happened</label>
          <select
            id="report-category"
            value={category}
            onChange={(e) => setCategory(e.target.value as ReportCategory)}
            className="w-full bg-white border-2 border-ink-500 px-3 py-2 text-[13px] font-semibold text-cream-100 notch-sm focus:border-volt-500 outline-none"
          >
            {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <label htmlFor="report-message" className="eyebrow text-[9.5px] mt-1">What happened, briefly</label>
          <textarea
            id="report-message"
            value={message}
            onChange={(e) => setMessage(e.target.value.slice(0, 600))}
            rows={4}
            placeholder="A sentence or two is plenty."
            className="w-full bg-white border-2 border-ink-500 rounded-xl px-3 py-2 text-[13px] text-cream-100 placeholder:text-cream-400 focus:border-volt-500 outline-none resize-none"
          />
          {error && <p className="text-[12px] text-ember-600">{error}</p>}
        </div>

        <div className="flex gap-2.5 justify-end mt-4">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" disabled={busy || message.trim().length < 8} onClick={() => void send()}>
            {busy ? 'Sending…' : 'Send report'}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Re-exported so the lobby does not have to think about mute internals. */
export { isMuted };
