import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../lib/store';
import { DEFAULT_SETTINGS, suggestQuality, type Quality, type MusicMode } from '../lib/settings';
import {
  signInWithEmail, signUpWithPassword, signInWithPassword, signOut,
  fetchRemoteUserData, supabase, supabaseEnabled,
} from '../lib/supabase';
import { amIAdmin, resetRetroLibrary } from '../lib/admin';
import { resetSiteContent } from '../lib/content';
import { Button, ConfirmDialog, Icon, Panel, SectionTitle, Segmented, Stat, Toggle } from '../components/ui';
import { PikachuMascot } from '../mascot';
import * as jukebox from '../lib/jukebox';

const QUALITY_COPY: Record<Quality, string> = {
  performance: 'Particles off, single-DPI canvases, no blur layers. Best on integrated graphics.',
  balanced: 'Light particles and blur, capped at 2× pixel ratio. The recommended default.',
  high: 'Full effects: confetti, glow, parallax, animated scene layers.',
};

export default function Settings() {
  const { settings, setSettings, sfx, toast, cloud, identity, setIdentity, syncStats } = useStore();
  const nav = useNavigate();
  const [authMode, setAuthMode] = useState<'signup' | 'signin' | 'magic'>('signup');
  const [username, setUsername] = useState(identity.name || '');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [session, setSession] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    if (!supabaseEnabled()) return;
    let alive = true;
    let unsub: (() => void) | undefined;
    void supabase().then((sb) => {
      if (!sb || !alive) return;
      void sb.auth.getUser().then(({ data }) => {
        if (alive) {
          const u = data.user;
          setSession(u ? (u.user_metadata?.display_name || u.user_metadata?.username || u.email || 'Trainer') : null);
        }
      });
      const sub = sb.auth.onAuthStateChange((_e, s) => {
        const u = s?.user;
        setSession(u ? (u.user_metadata?.display_name || u.user_metadata?.username || u.email || 'Trainer') : null);
      });
      unsub = () => sub.data.subscription.unsubscribe();
      if (!alive) unsub();
    });
    return () => { alive = false; unsub?.(); };
  }, []);

  const handleSignUp = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const cleanUser = username.trim();
    if (!cleanUser || cleanUser.length < 2) {
      toast({ kind: 'error', title: 'Username required', body: 'Please choose a username with at least 2 characters.' });
      return;
    }
    if (!password || password.length < 6) {
      toast({ kind: 'error', title: 'Password too short', body: 'Password must be at least 6 characters.' });
      return;
    }
    setSubmitting(true);
    try {
      await signUpWithPassword(cleanUser, password, email.trim() || undefined);
      setIdentity({ name: cleanUser });
      setSession(cleanUser);
      setPassword('');
      sfx('win');
      toast({ kind: 'success', title: `Welcome, ${cleanUser}!`, body: 'Your account is ready and synced.' });
    } catch (err: any) {
      toast({ kind: 'error', title: 'Sign-up failed', body: err?.message || 'Could not create account.' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignIn = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const cleanUser = username.trim();
    if (!cleanUser) {
      toast({ kind: 'error', title: 'Username or email required' });
      return;
    }
    if (!password) {
      toast({ kind: 'error', title: 'Password required' });
      return;
    }
    setSubmitting(true);
    try {
      await signInWithPassword(cleanUser, password);
      const remote = await fetchRemoteUserData();
      const displayName = remote?.name || cleanUser;
      if (remote?.name) {
        setIdentity({ name: remote.name, mascot: remote.mascot || identity.mascot });
      } else {
        setIdentity({ name: cleanUser });
      }
      /* The cloud row is the whole point of signing in: pull the career in, keeping the
         better of each field so a device that played offline is not rolled back. */
      if (remote?.stats) syncStats(remote.stats);
      setSession(displayName);
      setPassword('');
      sfx('win');
      /* A maintainer's account lands on the desk; everybody else stays here and
         sees no trace of it. The answer comes from Postgres, not the client. */
      if (await amIAdmin()) {
        resetRetroLibrary();
        resetSiteContent();
        toast({ kind: 'success', title: `Signed in as ${displayName}`, body: 'Opening the maintainer desk.' });
        nav('/admin');
        return;
      }
      toast({ kind: 'success', title: 'Signed in!', body: `Welcome back, ${displayName}!` });
    } catch (err: any) {
      toast({ kind: 'error', title: 'Sign-in failed', body: err?.message || 'Incorrect username or password.' });
    } finally {
      setSubmitting(false);
    }
  };

  const sendLink = async () => {
    if (!email.includes('@')) { toast({ kind: 'error', title: 'That does not look like an email' }); return; }
    setSending(true);
    try {
      await signInWithEmail(email.trim());
      toast({ kind: 'success', title: 'Magic link sent', body: 'Check your inbox and open the link on this device.' });
    } catch (e) {
      toast({ kind: 'error', title: 'Sign-in failed', body: e instanceof Error ? e.message : 'Unknown error' });
    } finally { setSending(false); }
  };

  return (
    <div className="mx-auto max-w-[900px] px-[var(--shell-pad)] py-7">
      <div className="flex items-end gap-4 mb-6 flex-wrap">
        <div className="flex-1 min-w-[220px]">
          <p className="eyebrow mb-1">Preferences</p>
          <h1 className="display text-[clamp(24px,4.4vw,38px)] text-cream-100 leading-none">Settings</h1>
          <p className="text-[13px] text-cream-400 mt-2 max-w-[500px]">
            Everything here applies immediately and is stored on this device. Nothing is sent anywhere unless you connect cloud sync below.
          </p>
        </div>
        <PikachuMascot state="idle" size={96} />
      </div>

      {/* ---------- audio ---------- */}
      <SectionTitle eyebrow="Sound" title="Audio" />
      <Panel className="p-4 mt-3.5 space-y-4">
        <Toggle checked={!settings.muted} onChange={(v) => setSettings({ muted: !v })} label="Sound enabled" />
        <Slider label="Music" value={settings.music} disabled={settings.muted}
          onChange={(v) => setSettings({ music: v })} />
        <Slider label="Effects" value={settings.sfx} disabled={settings.muted}
          onChange={(v) => setSettings({ sfx: v })} onCommit={() => sfx('place')} />
        <p className="text-[11.5px] text-cream-400">
          Interface sounds are synthesised live in the browser; the big moments use seven real Pokémon cries (about 43 KB in total), loaded the first time you need them. Nothing plays until your first click or keypress, as browsers require.
        </p>
      </Panel>

      {/* ---------- your music ---------- */}
      <SectionTitle eyebrow="Soundtrack" title="Your music" />
      <Jukebox />

      {/* ---------- performance ---------- */}
      <SectionTitle eyebrow="Performance" title="Graphics quality" />
      <Panel className="p-4 mt-3.5 space-y-3.5">
        <Segmented value={settings.quality} onChange={(v) => setSettings({ quality: v as Quality })} label="Graphics quality"
          options={[{ value: 'performance', label: 'Performance' }, { value: 'balanced', label: 'Balanced' }, { value: 'high', label: 'High' }]} />
        <p className="text-[12.5px] text-cream-400">{QUALITY_COPY[settings.quality]}</p>
        <div className="flex gap-3 flex-wrap">
          <Stat label="Suggested here" value={suggestQuality()} accent="#8d5a05" />
          <Stat label="CPU threads" value={navigator.hardwareConcurrency ?? '—'} />
          <Stat label="Device memory" value={(navigator as any).deviceMemory ? `${(navigator as any).deviceMemory} GB` : '—'} />
        </div>
        <div className="pt-3 border-t border-ink-600 space-y-3">
          <Toggle checked={settings.motion === 'auto'} onChange={(v) => setSettings({ motion: v ? 'auto' : 'off' })} label="Animations" />
          <p className="text-[11.5px] text-cream-400">
            {reduced
              ? 'Your system requests reduced motion — large animations are already suppressed automatically.'
              : 'Turning this off removes transitions, idle loops and the mascot animation cycles.'}
          </p>
        </div>
      </Panel>

      {/* ---------- gameplay ---------- */}
      <SectionTitle eyebrow="Gameplay" title="Assistance" />
      <Panel className="p-4 mt-3.5 space-y-3.5">
        <Toggle checked={settings.showHints} onChange={(v) => setSettings({ showHints: v })} label="Show hints and legal-move markers" />
        <p className="text-[11.5px] text-cream-400">Affects move dots in Chess and Checkers, the drop preview in Four in a Row, and engine depth readouts.</p>
        <div className="pt-3 border-t border-ink-600">
          <span className="eyebrow block mb-2">Board theme</span>
          <Segmented value={settings.boardTheme} onChange={(v) => setSettings({ boardTheme: String(v) })} label="Board theme"
            options={[{ value: 'storm', label: 'Storm' }, { value: 'meadow', label: 'Meadow' }, { value: 'carbon', label: 'Carbon' }]} />
        </div>
      </Panel>

      {/* ---------- cloud ---------- */}
      <SectionTitle eyebrow="Optional" title="Cloud sync" />
      <Panel className="p-4 mt-3.5 space-y-3">
        {!cloud ? (
          <>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-ink-500" />
              <p className="text-[13px] text-cream-200 font-semibold">Not configured — the app is running fully offline.</p>
            </div>
            <p className="text-[12.5px] text-cream-400">
              Online rooms work without this: the bundled relay server handles them. Cloud sync only adds cross-device history. To enable it, copy <code className="font-mono text-volt-700">.env.example</code> to <code className="font-mono text-volt-700">.env</code>, fill in your Supabase project URL and anon key, run the SQL in <code className="font-mono text-volt-700">supabase/migrations</code>, and restart the dev server.
            </p>
          </>
        ) : session ? (
          <>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-leaf-400 animate-pulse" />
              <p className="text-[13px] text-cream-100 font-bold">Signed in as <span className="text-volt-700">{session}</span></p>
            </div>
            <p className="text-[12px] text-cream-400">Match results, XP, achievements and career stats are mirrored to Supabase under row-level security.</p>
            <div className="pt-1">
              <Button variant="ghost" size="sm" onClick={async () => { await signOut(); setSession(null); toast({ kind: 'info', title: 'Signed out' }); }}>Sign out</Button>
            </div>
          </>
        ) : (
          <div className="space-y-3.5">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-volt-400" />
                <p className="text-[13px] text-cream-200 font-semibold">Account & Cloud Sync</p>
              </div>
              <Segmented
                value={authMode}
                onChange={(v) => setAuthMode(v as 'signup' | 'signin' | 'magic')}
                label="Auth mode"
                options={[
                  { value: 'signup', label: 'Create Account' },
                  { value: 'signin', label: 'Sign In' },
                  { value: 'magic', label: 'Magic Link' },
                ]}
              />
            </div>

            {authMode === 'signup' && (
              <form onSubmit={handleSignUp} className="space-y-2.5">
                <div className="grid sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="text-[11px] font-bold text-cream-400 uppercase tracking-wider block mb-1">Username</label>
                    <input
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      type="text"
                      placeholder="e.g. AshKetchum"
                      autoComplete="username"
                      required
                      className="w-full bg-ink-800 border border-ink-600 px-3 py-2 text-[13px] text-cream-100 placeholder-ink-400 focus:border-volt-400 outline-none notch-sm"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-cream-400 uppercase tracking-wider block mb-1">Password</label>
                    <div className="relative">
                      <input
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        type={showPassword ? 'text' : 'password'}
                        placeholder="Min. 6 characters"
                        autoComplete="new-password"
                        required
                        className="w-full bg-ink-800 border border-ink-600 px-3 py-2 pr-12 text-[13px] text-cream-100 placeholder-ink-400 focus:border-volt-400 outline-none notch-sm"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-cream-500 hover:text-cream-200 text-[11px] font-bold cursor-pointer"
                      >
                        {showPassword ? 'Hide' : 'Show'}
                      </button>
                    </div>
                  </div>
                </div>
                <div>
                  <label className="text-[11px] font-bold text-cream-400 uppercase tracking-wider block mb-1">Email <span className="text-cream-400 font-normal lowercase">(optional, for account recovery)</span></label>
                  <input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    type="email"
                    placeholder="you@example.com"
                    autoComplete="email"
                    className="w-full bg-ink-800 border border-ink-600 px-3 py-2 text-[13px] text-cream-100 placeholder-ink-400 focus:border-volt-400 outline-none notch-sm"
                  />
                </div>
                <div className="flex items-center justify-between pt-1 flex-wrap gap-2">
                  <p className="text-[11px] text-cream-400">Creates your profile with username & password in Supabase.</p>
                  <Button type="submit" variant="primary" disabled={submitting} icon={<Icon name="bolt" size={14} />}>
                    {submitting ? 'Creating…' : 'Create Account'}
                  </Button>
                </div>
              </form>
            )}

            {authMode === 'signin' && (
              <form onSubmit={handleSignIn} className="space-y-2.5">
                <div className="grid sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="text-[11px] font-bold text-cream-400 uppercase tracking-wider block mb-1">Username or Email</label>
                    <input
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      type="text"
                      placeholder="Username or you@example.com"
                      autoComplete="username"
                      required
                      className="w-full bg-ink-800 border border-ink-600 px-3 py-2 text-[13px] text-cream-100 placeholder-ink-400 focus:border-volt-400 outline-none notch-sm"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-cream-400 uppercase tracking-wider block mb-1">Password</label>
                    <div className="relative">
                      <input
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        type={showPassword ? 'text' : 'password'}
                        placeholder="Your password"
                        autoComplete="current-password"
                        required
                        className="w-full bg-ink-800 border border-ink-600 px-3 py-2 pr-12 text-[13px] text-cream-100 placeholder-ink-400 focus:border-volt-400 outline-none notch-sm"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-cream-500 hover:text-cream-200 text-[11px] font-bold cursor-pointer"
                      >
                        {showPassword ? 'Hide' : 'Show'}
                      </button>
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between pt-1 flex-wrap gap-2">
                  <p className="text-[11px] text-cream-400">Sign in to restore your remote stats and career history.</p>
                  <Button type="submit" variant="primary" disabled={submitting} icon={<Icon name="user" size={14} />}>
                    {submitting ? 'Signing in…' : 'Sign In'}
                  </Button>
                </div>
              </form>
            )}

            {authMode === 'magic' && (
              <div className="space-y-2.5">
                <div className="flex gap-2 flex-wrap">
                  <input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    type="email"
                    placeholder="you@example.com"
                    autoComplete="email"
                    className="flex-1 min-w-[220px] bg-ink-800 border border-ink-600 px-3 py-2 text-[13px] text-cream-100 placeholder-ink-400 focus:border-volt-400 outline-none notch-sm"
                  />
                  <Button onClick={sendLink} disabled={sending} icon={<Icon name="bolt" size={14} />}>
                    {sending ? 'Sending…' : 'Email magic link'}
                  </Button>
                </div>
                <p className="text-[11.5px] text-cream-400">A passwordless login link is sent to your inbox.</p>
              </div>
            )}
          </div>
        )}
      </Panel>

      {/* ---------- about ---------- */}
      <SectionTitle eyebrow="About" title="This build" />
      <Panel className="p-4 mt-3.5 space-y-2.5">
        <Row k="Player" v={`${identity.name || 'Unnamed'} · ${identity.playerId.slice(0, 8)}`} />
        <Row k="Realtime transport" v={(import.meta.env.VITE_REALTIME_TRANSPORT as string) || 'relay'} />
        <Row k="Relay server" v={(import.meta.env.VITE_RELAY_URL as string) || 'Bundled (/rt)'} />
        <Row k="Cloud sync" v={cloud ? 'Supabase configured' : 'Local only'} />
        <Row k="Reduced motion" v={reduced ? 'Requested by system' : 'Not requested'} />
        <div className="pt-3 border-t border-ink-600 flex gap-2 flex-wrap">
          <Button variant="ghost" size="sm" onClick={() => setSettings({ ...DEFAULT_SETTINGS, quality: suggestQuality() })} icon={<Icon name="rotate" size={13} />}>
            Restore defaults
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setResetOpen(true)}>Replay the intro</Button>
        </div>
      </Panel>

      <ConfirmDialog open={resetOpen} title="Replay the opening sequence?" confirmLabel="Replay intro"
        body="The cinematic intro will play once more the next time the app loads."
        onConfirm={() => { try { sessionStorage.removeItem('pikachu.intro.v1'); } catch { /* ignore */ } window.location.href = '/'; }}
        onCancel={() => setResetOpen(false)} />
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3 text-[12.5px]">
      <span className="text-cream-400">{k}</span>
      <span className="text-cream-200 font-semibold text-right truncate">{v}</span>
    </div>
  );
}

function Slider({ label, value, onChange, onCommit, disabled }: {
  label: string; value: number; onChange: (v: number) => void; onCommit?: () => void; disabled?: boolean;
}) {
  return (
    <label className={`block ${disabled ? 'opacity-50' : ''}`}>
      <span className="flex justify-between eyebrow mb-1.5">
        <span>{label}</span><span className="tabnum">{Math.round(value * 100)}%</span>
      </span>
      <input type="range" min={0} max={1} step={0.05} value={value} disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))} onPointerUp={onCommit}
        className="w-full" aria-label={label} />
    </label>
  );
}

/**
 * Jukebox panel — upload your own songs.
 *
 * Files are stored in IndexedDB on this device and never leave it. Playback is
 * routed through the same music gain node as the built-in pads, so the Music
 * slider and the mute button apply to uploads too.
 */
function Jukebox() {
  const { settings, setSettings, sfx, audioReady } = useStore();
  const [st, setSt] = useState<jukebox.JukeboxState>(jukebox.getState());
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => jukebox.subscribe(setSt), []);
  useEffect(() => { void jukebox.refreshLibrary(); }, []);

  const onPick = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true);
    setNotice(null);
    const res = await jukebox.addFiles(list);
    setBusy(false);
    if (fileRef.current) fileRef.current.value = '';
    const bits: string[] = [];
    if (res.added.length) bits.push(`Added ${res.added.length} ${res.added.length === 1 ? 'song' : 'songs'}.`);
    for (const r of res.rejected) bits.push(`Skipped “${r.name}” — ${r.reason}.`);
    setNotice(bits.join(' ') || null);
    if (res.added.length) {
      sfx('select');
      if (settings.musicMode !== 'uploads') setSettings({ musicMode: 'uploads' });
    }
  };

  const total = st.tracks.reduce((n, t) => n + t.size, 0);
  const current = st.tracks.find((t) => t.id === st.currentId);

  return (
    <Panel className="p-4 mt-3.5 space-y-4">
      <Segmented value={settings.musicMode} label="Music source"
        onChange={(v) => { sfx('toggle'); setSettings({ musicMode: v as MusicMode }); }}
        options={[
          { value: 'pads', label: 'Built-in' },
          { value: 'uploads', label: 'My music' },
          { value: 'off', label: 'Off' },
        ]} />
      <p className="text-[12.5px] text-cream-400">
        {settings.musicMode === 'pads' && 'Two slow generative pads, written in code — no files, no loop points.'}
        {settings.musicMode === 'uploads' && (st.tracks.length
          ? 'Your own songs play across the whole arcade.'
          : 'Add a few songs below and they will start playing straight away.')}
        {settings.musicMode === 'off' && 'No background music. Sound effects still play.'}
      </p>

      <div className="flex flex-wrap items-center gap-2.5 pt-3 border-t border-ink-600">
        <input ref={fileRef} type="file" accept={jukebox.ACCEPT} multiple className="sr-only"
          id="song-upload" onChange={(e) => void onPick(e.target.files)} />
        <Button onClick={() => { sfx('click'); fileRef.current?.click(); }}
          icon={<Icon name="plus" size={14} />} disabled={busy}>
          {busy ? 'Adding…' : 'Add songs'}
        </Button>
        {st.tracks.length > 0 && (
          <>
            <Button variant="ghost" onClick={() => { sfx('click'); void jukebox.toggle(); }}
              icon={<Icon name={st.playing ? 'pause' : 'play'} size={14} />}>
              {st.playing ? 'Pause' : 'Play'}
            </Button>
            <Button variant="ghost" onClick={() => { sfx('click'); void jukebox.next(); }}>Skip</Button>
            <Toggle checked={settings.shuffle} onChange={(v) => setSettings({ shuffle: v })} label="Shuffle" />
          </>
        )}
      </div>

      {notice && <p className="text-[12px] text-blush-600 font-semibold">{notice}</p>}
      {st.error && <p className="text-[12px] text-ember-600 font-semibold" role="status">{st.error}</p>}
      {!audioReady && st.tracks.length > 0 && (
        <p className="text-[11.5px] text-cream-400">Click anywhere on the page once — browsers block audio until you do.</p>
      )}

      {st.tracks.length === 0 ? (
        <p className="text-[11.5px] text-cream-400">
          MP3, M4A, OGG, WAV or FLAC, up to 40&nbsp;MB each. Songs are saved on this device only —
          nothing is uploaded to any server.
        </p>
      ) : (
        <>
          <ul className="divide-y divide-ink-600 rounded-2xl border-2 border-ink-500 overflow-hidden bg-white">
            {st.tracks.map((t) => {
              const isCurrent = t.id === st.currentId;
              return (
                <li key={t.id} className={`flex items-center gap-2.5 px-3 py-2 ${isCurrent ? 'bg-blush-100' : ''}`}>
                  <button onClick={() => { sfx('click'); void jukebox.playTrack(t.id); }}
                    aria-label={`Play ${t.name}`}
                    className="w-7 h-7 shrink-0 grid place-items-center rounded-full border-2 border-ink-500 bg-volt-200 hover:bg-volt-400 no-tap">
                    <Icon name={isCurrent && st.playing ? 'pause' : 'play'} size={12} />
                  </button>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] font-bold text-cream-100 truncate">{t.name}</span>
                    <span className="block text-[10.5px] text-cream-400">{jukebox.humanSize(t.size)}</span>
                  </span>
                  {isCurrent && st.playing && (
                    <span className="text-[10px] font-extrabold uppercase tracking-wider text-blush-600 shrink-0">Playing</span>
                  )}
                  <button onClick={() => { sfx('back'); void jukebox.removeTrack(t.id); }}
                    aria-label={`Remove ${t.name}`}
                    className="w-7 h-7 shrink-0 grid place-items-center rounded-full text-cream-500 hover:text-ember-600 hover:bg-blush-100 no-tap">
                    <Icon name="x" size={14} />
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11.5px] text-cream-400">
              {st.tracks.length} {st.tracks.length === 1 ? 'song' : 'songs'} · {jukebox.humanSize(total)} on this device
              {current && st.playing ? ` · now playing “${current.name}”` : ''}
            </p>
            <Button variant="ghost" size="sm" onClick={() => { sfx('back'); void jukebox.clearAll(); }}>Remove all</Button>
          </div>
        </>
      )}
    </Panel>
  );
}
