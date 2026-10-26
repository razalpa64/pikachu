/**
 * Friends, as a panel on Play Together.
 *
 * Three states, and the panel is honest about which one it is in:
 *
 *   • no Supabase project configured — friends are simply not part of this build,
 *     and the panel says so once instead of pretending to load forever;
 *   • configured but signed out — a sign-in prompt, because a friend list that
 *     lives only in this browser is not a friend list;
 *   • signed in — your handle, the people who asked, the people you kept, and the
 *     people you blocked.
 *
 * "Play" sends an invitation over the relay rather than a five-letter code: the
 * friend list is a database fact, but the *invitation* is a live socket, so the
 * relay only opens the room when the person answers.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Icon, Panel } from './ui';
import { PikachuMascot } from '../mascot';
import { MASCOT_ART } from '../lib/identity';
import { useStore } from '../lib/store';
import { useSession } from '../lib/session';
import {
  acceptFriend, declineFriend, findPlayerByHandle, listBlocked, listFriends, myHandle,
  removeFriend, requestFriend, setHandle, unblockPlayer, ACCOUNT_GAMES_ENABLED,
  type BlockedPlayer, type Friend, type FoundPlayer,
} from '../lib/friends';

interface Props {
  /** Invite a friend into this game with the settings chosen above. */
  onPlay: (playerId: string) => void;
  /** Disabled while a match is already in progress. */
  canPlay: boolean;
}

export function FriendsPanel({ onPlay, canPlay }: Props) {
  const { toast, sfx } = useStore();
  const session = useSession();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [blocked, setBlocked] = useState<BlockedPlayer[]>([]);
  const [handle, setHandleState] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<FoundPlayer | null>(null);
  const [searched, setSearched] = useState(false);

  const reload = useCallback(async () => {
    if (!session.userId) { setFriends([]); setBlocked([]); setHandleState(null); return; }
    setLoading(true);
    try {
      const [nextFriends, nextBlocked, mine] = await Promise.all([listFriends(), listBlocked(), myHandle()]);
      setFriends(nextFriends);
      setBlocked(nextBlocked);
      setHandleState(mine);
    } catch (err) {
      /* A missing table (migration not run) must not break the lobby. */
      toast({ kind: 'error', title: 'Friends unavailable', body: err instanceof Error ? err.message : undefined });
    } finally {
      setLoading(false);
    }
  }, [session.userId, toast]);

  useEffect(() => { void reload(); }, [reload]);

  if (!ACCOUNT_GAMES_ENABLED()) {
    return (
      <Panel className="p-4">
        <p className="eyebrow mb-1.5">Friends</p>
        <p className="text-[12.5px] text-cream-500 leading-relaxed">
          A friend list needs an identity that survives a cleared browser, so it needs cloud sync.
          Random opponents work without it — press <strong className="text-cream-100">Find an opponent</strong>.
        </p>
        <p className="text-[11.5px] text-cream-400 mt-2">
          See <Link to="/settings" className="underline hover:text-volt-700">Settings → Cloud sync</Link>.
        </p>
      </Panel>
    );
  }

  if (!session.userId) {
    return (
      <Panel className="p-4">
        <p className="eyebrow mb-1.5">Friends</p>
        <div className="flex gap-3 items-start">
          <PikachuMascot state="waiting" size={64} className="hidden sm:block shrink-0" />
          <div className="min-w-0">
            <p className="text-[13px] font-extrabold text-cream-100">Sign in to keep a friend list</p>
            <p className="text-[12px] text-cream-500 mt-1 leading-relaxed">
              Friends and blocks are tied to an account, so they follow you to another device and a
              blocked player cannot simply clear their browser.
            </p>
            <Link to="/settings" className="inline-flex mt-2.5">
              <Button size="sm" variant="blue" icon={<Icon name="user" size={14} />}>Sign in</Button>
            </Link>
          </div>
        </div>
      </Panel>
    );
  }

  const incoming = friends.filter((f) => f.status === 'pending' && f.direction === 'incoming');
  const outgoing = friends.filter((f) => f.status === 'pending' && f.direction === 'outgoing');
  const accepted = friends.filter((f) => f.status === 'accepted');

  const run = async (key: string, fn: () => Promise<void>, done?: string) => {
    setBusy(key);
    try {
      await fn();
      if (done) toast({ kind: 'success', title: done });
      await reload();
    } catch (err) {
      toast({ kind: 'error', title: 'That did not work', body: err instanceof Error ? err.message : undefined });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel className="p-4 flex flex-col gap-3.5">
      <div>
        <p className="eyebrow mb-1">Friends</p>
        {handle ? (
          <p className="text-[12px] text-cream-500">
            Your handle is <span className="font-mono text-volt-700">{handle}</span> — that is what a
            friend types to find you.
          </p>
        ) : (
          <HandleForm onSaved={(h) => { setHandleState(h); toast({ kind: 'success', title: `Your handle is ${h}` }); }} />
        )}
      </div>

      {/* ------------------------------------------------ add by handle */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const clean = query.trim();
          if (clean.length < 3) return;
          void (async () => {
            setBusy('find');
            try {
              const player = await findPlayerByHandle(clean);
              setFound(player);
              setSearched(true);
            } catch (err) {
              toast({ kind: 'error', title: 'Could not look that up', body: err instanceof Error ? err.message : undefined });
            } finally { setBusy(null); }
          })();
        }}
        className="flex flex-col gap-1.5"
      >
        <label htmlFor="friend-handle" className="eyebrow text-[9.5px]">Add a friend</label>
        <div className="flex gap-2">
          <input
            id="friend-handle"
            value={query}
            onChange={(e) => { setQuery(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20)); setFound(null); setSearched(false); }}
            placeholder="their handle"
            autoComplete="off"
            spellCheck={false}
            className="flex-1 min-w-0 bg-white border-2 border-ink-500 rounded-full px-3.5 py-2 text-[13px] text-cream-100 placeholder:text-cream-400 focus:border-blush-300 outline-none"
          />
          <Button type="submit" size="sm" variant="ghost" disabled={busy === 'find' || query.length < 3}>
            {busy === 'find' ? '…' : 'Find'}
          </Button>
        </div>
        {searched && !found && (
          <p className="text-[11.5px] text-cream-400">
            Nobody with that handle is findable. Handles are exact, so ask them to check the spelling.
          </p>
        )}
        {found && (
          <div className="flex items-center gap-2.5 bg-white/60 border-2 border-ink-500 rounded-xl px-2.5 py-2">
            <img src={MASCOT_ART[found.mascot] ?? MASCOT_ART.classic} alt="" width={28} height={28} className="w-7 h-7 object-contain" />
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] font-extrabold text-cream-100 truncate">{found.name}</p>
              <p className="text-[11px] font-mono text-cream-500 truncate">@{found.handle}</p>
            </div>
            <Button
              size="sm"
              variant="primary"
              disabled={busy === 'ask'}
              onClick={() => void run('ask', () => requestFriend(found.playerId), 'Request sent')}
            >
              {busy === 'ask' ? '…' : 'Add'}
            </Button>
          </div>
        )}
      </form>

      {/* ------------------------------------------------------- requests */}
      {incoming.length > 0 && (
        <div>
          <p className="eyebrow text-[9.5px] mb-1.5">Asked to be friends</p>
          <div className="flex flex-col gap-1.5">
            {incoming.map((f) => (
              <div key={f.friendshipId} className="flex items-center gap-2">
                <span className="text-[12.5px] font-extrabold text-cream-100 truncate flex-1">{f.name}</span>
                <Button size="sm" variant="primary" disabled={busy !== null}
                  onClick={() => void run(`a${f.friendshipId}`, async () => {
                    sfx('win'); await acceptFriend(f.friendshipId);
                  }, `${f.name} is a friend now`)}>Accept</Button>
                <Button size="sm" variant="ghost" disabled={busy !== null}
                  onClick={() => void run(`d${f.friendshipId}`, () => declineFriend(f.friendshipId))}>Ignore</Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* -------------------------------------------------------- friends */}
      <div>
        <p className="eyebrow text-[9.5px] mb-1.5">Your friends</p>
        {loading && accepted.length === 0 && <p className="text-[12px] text-cream-400">Loading…</p>}
        {!loading && accepted.length === 0 && (
          <p className="text-[12px] text-cream-400">
            Nobody yet. Meet somebody in a match, or add them by handle above.
          </p>
        )}
        <div className="flex flex-col gap-1.5">
          {accepted.map((f) => (
            <div key={f.friendshipId} className="flex items-center gap-2.5">
              <img src={MASCOT_ART[f.mascot] ?? MASCOT_ART.classic} alt="" width={26} height={26} className="w-[26px] h-[26px] object-contain" />
              <span className="text-[12.5px] font-extrabold text-cream-100 truncate flex-1">{f.name}</span>
              <Button size="sm" variant="blue" disabled={!canPlay || busy !== null}
                onClick={() => { sfx('select'); onPlay(f.playerId); }}>Play</Button>
              <button
                type="button"
                aria-label={`Remove ${f.name} from your friends`}
                className="text-cream-400 hover:text-ember-600 transition-colors cursor-pointer"
                onClick={() => void run(`r${f.friendshipId}`, () => removeFriend(f.friendshipId), 'Friend removed')}
              >
                <Icon name="x" size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {outgoing.length > 0 && (
        <p className="text-[11.5px] text-cream-400">
          Waiting for {outgoing.map((f) => f.name).join(', ')} to answer.
        </p>
      )}

      {/* --------------------------------------------------------- blocked */}
      {blocked.length > 0 && (
        <div>
          <p className="eyebrow text-[9.5px] mb-1.5">Blocked ({blocked.length})</p>
          <p className="text-[11.5px] text-cream-500 leading-relaxed">
            You will not be matched with them, and they are not told. Unblocking does not re-add a
            friendship — you both have to ask again.
          </p>
          <div className="flex flex-col gap-1 mt-1.5">
            {blocked.map((b) => (
              <div key={b.accountId} className="flex items-center gap-2">
                <span className="text-[11.5px] font-mono text-cream-500 truncate flex-1">{b.accountId.slice(0, 8)}…</span>
                <Button size="sm" variant="ghost" disabled={busy !== null}
                  onClick={() => void run(`u${b.accountId}`, () => unblockPlayer(b.accountId), 'Unblocked')}>Unblock</Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}

/** Pick the name friends type. Only shown when the account has none yet. */
function HandleForm({ onSaved }: { onSaved: (handle: string) => void }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        setHandle(value)
          .then((saved) => { onSaved(saved); setValue(''); })
          .catch((err) => setError(err instanceof Error ? err.message : 'Could not save that.'))
          .finally(() => setBusy(false));
      }}
      className="flex flex-col gap-1.5"
    >
      <p className="text-[12px] text-cream-500 leading-relaxed">
        Choose a handle so friends can find you. 3–20 characters: lowercase letters, numbers and
        underscores. It is shown to anyone you let add you.
      </p>
      <div className="flex gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20))}
          aria-label="Your handle"
          placeholder="ash_ketchum"
          className="flex-1 min-w-0 bg-white border-2 border-ink-500 rounded-full px-3.5 py-2 text-[13px] font-mono text-cream-100 placeholder:text-cream-400 focus:border-blush-300 outline-none"
        />
        <Button type="submit" size="sm" variant="primary" disabled={busy || value.length < 3}>
          {busy ? '…' : 'Save'}
        </Button>
      </div>
      {error && <p className="text-[11.5px] text-ember-600">{error}</p>}
    </form>
  );
}
