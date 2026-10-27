import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  SITE_CONTENT_KEYS,
  adminConfigured,
  recordDosDecision,
  uploadDosGame,
  adminReadiness,
  probeAdmin,
  deleteGame,
  listAllGames,
  loadSiteContent,
  saveSiteContent,
  setGameStatus,
  signInAdmin,
  slugify,
  updateGame,
  uploadGame,
  validateUpload,
  type RetroRow,
  type UploadDraft,
} from '../lib/admin';
import { describeAuthError, notOnRosterProblem, type AdminAuthProblem, type RawAuthError } from '../lib/adminAuth';
import { cartridgeKind, resetRetroLibrary } from '../lib/retro';
import {
  BUNDLE_MESSAGE,
  MAX_BUNDLE_BYTES,
  STAGE_LABEL,
  countStages,
  genresOf,
  inspectBundle,
  loadDosIndex,
  resetDosShelf,
  searchIndex,
  type DosCandidate,
  type DosCatalog,
  type DosStage,
} from '../lib/dos';
import { readZipDirectory, readZipEntry } from '../lib/zip';
import { resetSiteContent } from '../lib/content';
import { signInWithEmail, signOut, supabase } from '../lib/supabase';
import { Button, ConfirmDialog, CopyField, Icon, Panel, SectionTitle, Segmented, Stat, Toggle } from '../components/ui';
import { useStore } from '../lib/store';

/**
 * `/admin` — the maintainer's desk.
 *
 * The route is not linked from anywhere, is not in the sitemap, and is noindex.
 * That is *tidiness*, not security: the page renders nothing privileged until it
 * has asked Postgres whether the signed-in account is an admin, and every write
 * it then attempts is authorised again by row-level security. An ordinary
 * visitor who guesses the URL gets a sign-in box and, past that, a polite refusal.
 */

type Phase = 'checking' | 'offline' | 'locked' | 'broken' | 'denied' | 'ready';
type Tab = 'shelf' | 'dos' | 'copy';

const LICENCES = ['MIT', 'GPL-3.0-only', 'GPL-3.0-or-later', 'MPL-2.0', 'Zlib', 'BSD-2-Clause', 'Apache-2.0', 'CC-BY-4.0'];

const emptyDraft = (): UploadDraft => ({
  title: '',
  accent: '#ffd24d',
  tagline: '',
  description: '',
  author: '',
  year: null,
  license: 'MIT',
  licenseUrl: '',
  sourceUrl: '',
  tags: [],
  bytes: 0,
  rightsNote: '',
});

const kb = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] font-bold uppercase tracking-[.07em] text-cream-500">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-cream-500 mt-1">{hint}</span>}
    </label>
  );
}

const inputClass =
  'mt-1 w-full rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-[13px] text-cream-100 placeholder:text-cream-500 focus:border-volt-400 focus:outline-none';

export default function Admin() {
  const nav = useNavigate();
  const [phase, setPhase] = useState<Phase>(adminConfigured() ? 'checking' : 'offline');
  const [who, setWho] = useState('');
  const [tab, setTab] = useState<Tab>('shelf');
  /* Why the door is shut, kept so the screen can say something specific rather
     than "not allowed". */
  const [problem, setProblem] = useState<AdminAuthProblem | null>(null);
  const [identity, setIdentity] = useState<{ id: string | null; email: string | null }>({ id: null, email: null });

  /* ------------------------------------------------------------ the gate */
  useEffect(() => {
    if (!adminConfigured()) { setPhase('offline'); return; }
    let alive = true;
    void supabase().then(async (sb) => {
      if (!sb) { if (alive) setPhase('offline'); return; }
      const { data } = await sb.auth.getUser();
      if (!alive) return;
      if (!data.user) { setPhase('locked'); return; }
      const probe = await probeAdmin();
      if (!alive) return;
      setWho((data.user.user_metadata?.display_name as string) || data.user.email || 'signed in');
      setIdentity({ id: data.user.id, email: data.user.email ?? null });
      if (probe.state === 'yes') { setPhase('ready'); return; }
      setProblem(probe.state === 'no' ? notOnRosterProblem(data.user.id, data.user.email ?? null) : probe.problem ?? null);
      setPhase(probe.state === 'no' ? 'denied' : 'broken');
    });
    return () => { alive = false; };
  }, []);

  if (phase === 'checking') {
    return <div className="mx-auto max-w-[900px] px-[var(--shell-pad)] py-16 text-[13px] text-cream-400">Checking this account…</div>;
  }

  if (phase === 'offline') {
    const ready = adminReadiness();
    return (
      <DoorShell
        title="This build has no Supabase project, so there is nothing to sign in to"
        body={ready.missing.length
          ? `Missing from the build: ${ready.missing.join(', ')}.`
          : 'The environment names are set but do not form a usable project URL and key.'}
        hint="Copy .env.example to .env, fill both values in, restart the dev server, then reload this page. The rest of the arcade works without any of this."
        onBack={() => nav('/')}
      />
    );
  }

  if (phase === 'broken') {
    return (
      <DoorShell
        title={problem?.title ?? 'The desk could not check this account'}
        body={problem?.body ?? 'The database did not answer the question.'}
        hint={problem?.hint}
        sql={problem?.sql}
        onBack={() => nav('/')}
      />
    );
  }

  if (phase === 'locked') {
    const ready = adminReadiness();
    return (
      <SignIn
        projectHost={ready.projectHost}
        onDone={(result) => {
          setWho(result.name);
          setIdentity({ id: result.userId ?? null, email: result.email ?? null });
          setProblem(result.problem ?? null);
          setPhase(result.admin ? 'ready' : result.ok ? 'denied' : 'locked');
        }}
      />
    );
  }

  if (phase === 'denied') {
    return (
      <DoorShell
        title={problem?.title ?? `Signed in as ${who} — but this account is not on the roster`}
        body={problem?.body ?? 'Admin rights come from a row in public.admin_users, so an ordinary account cannot open this page even with the URL.'}
        hint={problem?.hint}
        sql={problem?.sql}
        extra={
          <p className="text-[12px] text-cream-500">
            Signed in as <strong className="text-cream-100">{who}</strong>
            {identity.email ? <> ({identity.email})</> : null}
            {identity.id ? <> · id <span className="font-mono text-[11px]">{identity.id}</span></> : null}
          </p>
        }
        actions={
          <Button onClick={async () => { await signOut(); setProblem(null); setPhase('locked'); }}>
            Sign in as someone else
          </Button>
        }
        onBack={() => nav('/')}
      />
    );
  }

  return (
    <div className="mx-auto max-w-[1100px] px-[var(--shell-pad)] py-7">
      <div className="flex items-end gap-4 mb-5 flex-wrap">
        <div className="flex-1 min-w-[220px]">
          <p className="eyebrow mb-1">Maintainer</p>
          <h1 className="display text-[clamp(24px,4.4vw,38px)] text-cream-100 leading-none">The desk</h1>
          <p className="text-[13px] text-cream-400 mt-2 max-w-[560px]">
            Signed in as {who}. Everything here writes through Postgres row-level security — the page is a convenient
            front end, not the authority.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => { resetRetroLibrary(); nav('/retro'); }} icon={<Icon name="play" size={12} />}>
            View the shelf
          </Button>
          <Button size="sm" onClick={async () => { await signOut(); resetRetroLibrary(); nav('/'); }}>Sign out</Button>
        </div>
      </div>

      <Segmented
        value={tab}
        onChange={(v) => setTab(v as Tab)}
        label="Admin section"
        options={[
          { value: 'shelf', label: 'GBA shelf' },
          { value: 'dos', label: 'DOS desk' },
          { value: 'copy', label: 'Site copy' },
        ]}
      />

      {tab === 'shelf' ? <ShelfDesk /> : tab === 'dos' ? <DosDesk /> : <CopyDesk />}
    </div>
  );
}

/* --------------------------------------------------------------- sign in */

/**
 * A door that explains why it is shut.
 *
 * Every state here has a different cause and a different fix, so the copy is
 * never "access denied": it says which variable is missing, which address was
 * tried, whether the password or the address was wrong, or which SQL pastes the
 * account onto the roster. The SQL is prefilled with the session's own id,
 * because a `where lower(email) = …` that silently matches nothing is one of the
 * ways people arrive at this page.
 */
function DoorShell({
  title, body, hint, sql, extra, actions, onBack,
}: {
  title: string;
  body: string;
  hint?: string;
  sql?: string;
  extra?: React.ReactNode;
  actions?: React.ReactNode;
  onBack: () => void;
}) {
  return (
    <div className="mx-auto max-w-[640px] px-[var(--shell-pad)] py-12">
      <Panel className="p-5">
        <p className="eyebrow mb-1">Restricted</p>
        <h1 className="display text-[23px] text-cream-100 leading-tight">{title}</h1>
        <p className="text-[13px] text-cream-400 mt-2 leading-relaxed">{body}</p>
        {hint && <p className="text-[12.5px] text-cream-500 mt-2 leading-relaxed">{hint}</p>}
        {sql && (
          <div className="mt-4">
            <CopyField label="Run this in the Supabase SQL editor" value={sql} />
          </div>
        )}
        {extra && <div className="mt-3">{extra}</div>}
        <div className="flex flex-wrap gap-2 mt-5">
          {actions}
          <Button variant="ghost" onClick={onBack} icon={<Icon name="back" size={14} />}>
            Back to the arcade
          </Button>
        </div>
        <p className="text-[11.5px] text-cream-500 mt-4 leading-relaxed">
          Or run <code className="font-mono text-[11px] text-volt-700">npm run admin:doctor</code> — it checks the
          project itself and can confirm the email and allowlist the account in one step.
        </p>
      </Panel>
    </div>
  );
}

function SignIn({
  onDone, projectHost,
}: {
  onDone: (result: { ok: boolean; admin: boolean; name: string; userId?: string | null; email?: string | null; problem?: AdminAuthProblem }) => void;
  projectHost: string | null;
}) {
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<AdminAuthProblem | null>(null);
  const [tried, setTried] = useState<string[]>([]);
  /* The second way in. A password can be forgotten, mistyped or rotated; an
     emailed link only needs an inbox, and it produces the same session. */
  const [link, setLink] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [linkProblem, setLinkProblem] = useState<AdminAuthProblem | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setProblem(null);
    setTried([]);
    setLink('idle');
    setLinkProblem(null);
    const result = await signInAdmin(account, password);
    setBusy(false);
    setTried(result.tried ?? []);
    if (!result.ok) {
      setProblem(result.problem ?? { code: 'unknown', title: 'Sign-in failed', body: 'Nothing was returned.' });
      return;
    }
    setPassword('');
    onDone(result);
  };

  const sendLink = async () => {
    setLink('sending');
    setLinkProblem(null);
    try {
      await signInWithEmail(account.trim());
      setLink('sent');
    } catch (error) {
      setLink('idle');
      setLinkProblem(describeAuthError(error as RawAuthError));
    }
  };

  return (
    <div className="mx-auto max-w-[430px] px-[var(--shell-pad)] py-14">
      <Panel className="p-5">
        <p className="eyebrow mb-1">Restricted</p>
        <h1 className="display text-[24px] text-cream-100 leading-tight">Sign in to continue</h1>
        <p className="text-[12.5px] text-cream-400 mt-2">
          This page only opens for accounts on the admin roster.
          {projectHost && <> Project <span className="font-mono text-[11px] text-cream-300">{projectHost}</span>.</>}
        </p>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <Field label="Email or username">
            <input
              className={inputClass}
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              autoComplete="username"
              spellCheck={false}
              autoFocus
            />
          </Field>
          <Field label="Password">
            <input
              className={inputClass}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </Field>
          {problem && (
            <div role="alert" className="border-[1.5px] border-blush-300 bg-blush-100 rounded-lg p-3">
              <p className="text-[12.5px] font-extrabold text-cream-100">{problem.title}</p>
              <p className="text-[12px] text-cream-300 mt-1 leading-relaxed">{problem.body}</p>
              {problem.hint && <p className="text-[11.5px] text-cream-500 mt-1.5 leading-relaxed">{problem.hint}</p>}
              {projectHost && (
                <p className="text-[11px] text-cream-500 mt-1.5">
                  Asked project <span className="font-mono">{projectHost}</span> — if the account was created
                  in a different Supabase project, this is the wrong one.
                </p>
              )}
              {tried.length > 0 && problem.code === 'invalid_credentials' && (
                <p className="text-[11.5px] text-cream-500 mt-1.5">
                  Tried: {tried.map((t) => <span key={t} className="font-mono">{t}</span>).reduce<React.ReactNode[]>(
                    (acc, node, i) => (i ? [...acc, ', ', node] : [node]), [],
                  )}
                </p>
              )}
            </div>
          )}
          <Button type="submit" disabled={busy} className="w-full justify-center">
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>

        <div className="mt-4 border-t-[1.5px] border-black/10 pt-3">
          {link === 'sent' ? (
            <div role="status">
              <p className="text-[12.5px] font-extrabold text-cream-100">Link sent to {account.trim()}</p>
              <p className="text-[12px] text-cream-400 mt-1 leading-relaxed">
                Open it on this device, then come back to <span className="font-mono">/admin</span> — the link
                signs this browser in and the desk asks the roster who you are.
              </p>
              <p className="text-[11px] text-cream-500 mt-1 leading-relaxed">
                Nothing yet? Supabase's built-in mailer allows only a few messages an hour, and a project with
                no SMTP configured sends none at all.
              </p>
            </div>
          ) : (
            <>
              <Button
                type="button"
                variant="ghost"
                className="w-full justify-center"
                disabled={link === 'sending' || !account.includes('@')}
                onClick={sendLink}
              >
                {link === 'sending' ? 'Sending…' : 'Email me a sign-in link instead'}
              </Button>
              <p className="text-[11px] text-cream-500 mt-1.5 leading-relaxed">
                {account.includes('@')
                  ? 'No password needed. The link only works in this browser, and only for the address above.'
                  : 'Type the full email address first — a link has to be sent somewhere real.'}
              </p>
              {linkProblem && (
                <p role="alert" className="text-[11.5px] text-blush-300 mt-1.5">
                  {linkProblem.title}. {linkProblem.hint ?? linkProblem.body}
                </p>
              )}
            </>
          )}
        </div>
        <p className="text-[11px] text-cream-500 mt-4 leading-relaxed">
          A bare username is looked up as <span className="font-mono">name@pikachu.arcade</span> — an account
          created in the dashboard with a real address needs the whole address typed out. Forgot the password?
          Use the link above, or run{' '}
          <code className="font-mono text-[11px] text-volt-700">npm run admin:doctor</code> to see exactly
          which account this project holds.
        </p>
      </Panel>
    </div>
  );
}

/* ----------------------------------------------------------- retro shelf */

function ShelfDesk() {
  const { toast } = useStore();
  const [rows, setRows] = useState<RetroRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<UploadDraft>(emptyDraft);
  const [file, setFile] = useState<File | null>(null);
  const [fileNote, setFileNote] = useState<string | null>(null);
  const [attested, setAttested] = useState(false);
  const [busy, setBusy] = useState(false);
  /* Editing is a small draft of the three fields a card actually shows. The id
     never changes: it is the storage folder and the URL of the player page. */
  const [editing, setEditing] = useState<string | null>(null);
  const [edit, setEdit] = useState({ title: '', tagline: '', description: '' });
  const [confirmDelete, setConfirmDelete] = useState<RetroRow | null>(null);

  const refresh = useCallback(async () => {
    try {
      setRows(await listAllGames());
      setLoadError(null);
    } catch (e) {
      setRows([]);
      setLoadError(e instanceof Error ? e.message : 'Could not read the shelf.');
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const takenIds = useMemo(() => (rows ?? []).map((r) => r.id), [rows]);

  const pickFile = async (picked: File | undefined) => {
    setFileNote(null);
    if (!picked) { setFile(null); return; }
    const kind = await cartridgeKind(picked);
    if (kind !== 'gba') {
      setFile(null);
      setFileNote(
        kind === 'gb'
          ? 'That is a Game Boy cartridge. The shelf is the GBA shelf — byte-for-byte it will not boot in the GBA core path. (Players can still use it through “your own cartridge”.)'
          : 'That file has no GBA cartridge header, so it is not a cartridge the emulator can run.',
      );
      return;
    }
    if (picked.size > 32 * 1024 * 1024) { setFile(null); setFileNote('Cartridges are capped at 32 MB.'); return; }
    setFile(picked);
    setDraft((d) => ({
      ...d,
      bytes: picked.size,
      title: d.title || picked.name.replace(/\.[a-z0-9]{1,5}$/i, '').replace(/[-_]+/g, ' ').replace(/\s{2,}/g, ' ').trim(),
    }));
  };

  const problems = useMemo(
    () => validateUpload({ ...draft, bytes: file?.size ?? 0 }, { takenIds }),
    [draft, file, takenIds],
  );
  /* An untouched form is not five mistakes — the button is simply disabled
     until there is something to judge. */
  const begun = Boolean(file || draft.title.trim() || draft.author.trim());

  const publish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) { toast({ kind: 'error', title: 'Pick a ROM first' }); return; }
    if (!attested) { toast({ kind: 'error', title: 'Confirm the rights statement' }); return; }
    setBusy(true);
    try {
      const { id } = await uploadGame({ draft: { ...draft, bytes: file.size }, file, takenIds });
      toast({ kind: 'success', title: 'Published', body: `${draft.title} is on the shelf as ${id}.` });
      setDraft(emptyDraft());
      setFile(null);
      setAttested(false);
      await refresh();
    } catch (err) {
      toast({ kind: 'error', title: 'Upload failed', body: err instanceof Error ? err.message : 'Unknown error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 space-y-5">
      <Panel className="p-4">
        <SectionTitle eyebrow="Add" title="Upload a cartridge" />
        <p className="text-[12px] text-cream-400 mt-1 max-w-[70ch]">
          The ROM goes to the <code className="font-mono text-volt-700">retro</code> storage bucket and a catalogue row to{' '}
          <code className="font-mono text-volt-700">retro_games</code>; the public shelf merges published rows in. The
          licence gate is the same one the importer uses — a build with no redistributable licence cannot be listed.
        </p>

        <form onSubmit={publish} className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Cartridge file" hint=".gba / .agb, up to 32 MB. Checked for a real GBA header before upload.">
              <input
                type="file"
                accept=".gba,.agb,.bin"
                onChange={(e) => { void pickFile(e.target.files?.[0]); e.currentTarget.value = ''; }}
                className="mt-1 block w-full text-[12.5px] text-cream-300 file:mr-3 file:rounded-md file:border-0 file:bg-volt-400 file:px-3 file:py-1.5 file:text-[12px] file:font-bold file:text-ink-950"
              />
            </Field>
            {file && <p className="text-[11.5px] text-cream-400 mt-1">{file.name} · {kb(file.size)} · header verified</p>}
            {fileNote && <p role="alert" className="text-[12px] font-bold text-blush-600 mt-1">{fileNote}</p>}
          </div>

          <Field label="Title">
            <input className={inputClass} value={draft.title} maxLength={60} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </Field>
          <Field label="Author / studio">
            <input className={inputClass} value={draft.author} maxLength={60} onChange={(e) => setDraft({ ...draft, author: e.target.value })} />
          </Field>

          <Field label="Tagline" hint="One line on the card. 80 characters.">
            <input className={inputClass} value={draft.tagline} maxLength={80} onChange={(e) => setDraft({ ...draft, tagline: e.target.value })} />
          </Field>
          <Field label="Tags" hint="Comma separated: puzzle, arcade, action…">
            <input
              className={inputClass}
              value={draft.tags.join(', ')}
              onChange={(e) => setDraft({ ...draft, tags: e.target.value.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 6) })}
            />
          </Field>

          <Field label="Description" hint="600 characters.">
            <textarea className={`${inputClass} min-h-[84px]`} value={draft.description} maxLength={600} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          </Field>
          <div className="space-y-3">
            <Field label="Licence" hint="Only redistributable licences are accepted.">
              <select className={inputClass} value={draft.license} onChange={(e) => setDraft({ ...draft, license: e.target.value })}>
                {LICENCES.map((l) => <option key={l} value={l}>{l}</option>)}
                <option value="BSD-3-Clause">BSD-3-Clause</option>
                <option value="CC0-1.0">CC0-1.0</option>
              </select>
            </Field>
            <Field label="Year (optional)">
              <input
                className={inputClass}
                inputMode="numeric"
                value={draft.year ?? ''}
                onChange={(e) => setDraft({ ...draft, year: e.target.value ? Number(e.target.value) : null })}
              />
            </Field>
          </div>

          <Field label="Licence link" hint="https:// — where the licence text lives.">
            <input className={inputClass} value={draft.licenseUrl} onChange={(e) => setDraft({ ...draft, licenseUrl: e.target.value })} placeholder="https://github.com/you/game/blob/main/LICENSE" />
          </Field>
          <Field label="Source link" hint="https:// — repository or the author's page.">
            <input className={inputClass} value={draft.sourceUrl} onChange={(e) => setDraft({ ...draft, sourceUrl: e.target.value })} placeholder="https://github.com/you/game" />
          </Field>

          <div className="sm:col-span-2">
            <Field label="Rights note" hint="Optional, but recorded: e.g. “MIT, the author's own repo, build from the README.”">
              <input className={inputClass} value={draft.rightsNote} maxLength={400} onChange={(e) => setDraft({ ...draft, rightsNote: e.target.value })} />
            </Field>
          </div>

          <div className="sm:col-span-2 rounded-lg border border-ink-600 bg-ink-900/60 p-3">
            <Toggle
              checked={attested}
              onChange={setAttested}
              label="I have the right to redistribute this build under that licence"
            />
            <p className="text-[11.5px] text-cream-500 mt-2">
              No commercial ROMs. Uploading one — Pokémon, Mario, Contra, or any other all-rights-reserved title — is not
              something this site can host, whatever the upload says. People can still play their own dumps through
              “your own cartridge”, where the file never leaves their browser.
            </p>
          </div>

          {begun && problems.length > 0 && (
            <ul className="sm:col-span-2 text-[12px] text-cream-400 space-y-1" aria-live="polite">
              {problems.map((p) => <li key={p}>• {p}</li>)}
            </ul>
          )}

          <div className="sm:col-span-2 flex items-center gap-3">
            <Button type="submit" disabled={busy || problems.length > 0 || !attested || !file}>
              {busy ? 'Uploading…' : 'Publish to the shelf'}
            </Button>
            <span className="text-[11.5px] text-cream-500">
              {file ? `${kb(file.size)} · ${slugify(draft.title)}` : 'No file chosen'}
            </span>
          </div>
        </form>
      </Panel>

      <Panel className="p-4">
        <SectionTitle eyebrow="Manage" title="Cartridges on the shelf" />
        {loadError && <p role="alert" className="text-[12.5px] font-bold text-blush-600 mt-2">{loadError}</p>}
        {rows === null ? (
          <p className="text-[13px] text-cream-400 mt-3">Reading…</p>
        ) : rows.length === 0 ? (
          <p className="text-[13px] text-cream-400 mt-3">Nothing uploaded yet. The 22 committed cartridges are not rows here — they live in the repo.</p>
        ) : (
          <ul className="mt-3 divide-y divide-ink-600">
            {rows.map((row) => (
              <li key={row.id} className="py-3 flex flex-wrap items-start gap-3">
                <div className="min-w-[200px] flex-1">
                  <p className="text-[13.5px] font-bold text-cream-100">
                    {row.title}{' '}
                    <span className={`ml-1 text-[10.5px] font-bold uppercase tracking-wide ${row.status === 'published' ? 'text-volt-700' : 'text-cream-500'}`}>
                      {row.status}
                    </span>
                  </p>
                  <p className="text-[11.5px] text-cream-500">
                    {row.id} · {row.author} · {kb(row.bytes)} · {row.license}
                  </p>
                  {editing === row.id ? (
                    <div className="mt-2 space-y-2 max-w-[52ch]">
                      <Field label="Title">
                        <input
                          className={inputClass}
                          value={edit.title}
                          maxLength={60}
                          onChange={(e) => setEdit({ ...edit, title: e.target.value })}
                        />
                      </Field>
                      <Field label="Tagline">
                        <input
                          className={inputClass}
                          value={edit.tagline}
                          maxLength={80}
                          onChange={(e) => setEdit({ ...edit, tagline: e.target.value })}
                        />
                      </Field>
                      <Field label="Description">
                        <textarea
                          className={`${inputClass} min-h-[84px]`}
                          value={edit.description}
                          maxLength={600}
                          onChange={(e) => setEdit({ ...edit, description: e.target.value })}
                        />
                      </Field>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          disabled={!edit.title.trim()}
                          onClick={async () => {
                            try {
                              await updateGame(row.id, {
                                title: edit.title.trim(),
                                tagline: edit.tagline.trim(),
                                description: edit.description.trim(),
                              });
                              toast({ kind: 'success', title: 'Saved', body: `${edit.title.trim()} updated.` });
                              setEditing(null);
                              await refresh();
                            } catch (e) {
                              toast({ kind: 'error', title: 'Could not save', body: e instanceof Error ? e.message : '' });
                            }
                          }}
                        >
                          Save
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-[12px] text-cream-400 mt-1 max-w-[60ch]">{row.description || 'No description yet.'}</p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setEditing(row.id);
                      setEdit({ title: row.title, tagline: row.tagline, description: row.description });
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      try {
                        await setGameStatus(row.id, row.status === 'published' ? 'draft' : 'published');
                        await refresh();
                      } catch (e) {
                        toast({ kind: 'error', title: 'Could not change that', body: e instanceof Error ? e.message : '' });
                      }
                    }}
                  >
                    {row.status === 'published' ? 'Unpublish' : 'Publish'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(row)}>Delete</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-3 mt-3 flex-wrap">
          <Stat label="Rows" value={rows?.length ?? '—'} />
          <Stat label="Published" value={rows?.filter((r) => r.status === 'published').length ?? '—'} />
          <Stat label="Bytes" value={rows ? kb(rows.reduce((n, r) => n + r.bytes, 0)) : '—'} />
        </div>
      </Panel>

      <ConfirmDialog
        open={confirmDelete !== null}
        title={confirmDelete ? `Delete ${confirmDelete.title}?` : 'Delete'}
        body="The catalogue row and the stored ROM and cover are removed. This cannot be undone."
        confirmLabel="Delete"
        onCancel={() => setConfirmDelete(null)}
        onConfirm={async () => {
          if (!confirmDelete) return;
          const row = confirmDelete;
          setConfirmDelete(null);
          try {
            await deleteGame(row.id);
            await refresh();
          } catch (e) {
            toast({ kind: 'error', title: 'Could not delete', body: e instanceof Error ? e.message : '' });
          }
        }}
      />
    </div>
  );
}

/* ---------------------------------------------------------------- DOS desk */

/**
 * The second platform's desk.
 *
 * Three things live here, and they are deliberately separate:
 *
 *   1. **The review queue** — 1,499 discovery records read from
 *      `/retro/dos/catalog.json`. Each one carries the label its source gave it
 *      ("Freeware", "Shareware") and nothing more; approval means an admin wrote
 *      down what the right to redistribute rests on, and that is stored in
 *      `site_content` under `dos.perm.<id>` so it survives a redeploy and is
 *      readable by anyone who audits the database.
 *   2. **The upload form** — a `.jsdos` bundle, checked in the browser against
 *      the same structural rules the shelf applies, then stored and inserted as a
 *      `platform: 'dos'` row.
 *   3. **The DOS rows** — publish/unpublish/delete, so taking a game down is a
 *      button and not a maintenance window.
 *
 * What is *not* here: a "download everything" button. The importer script is a
 * developer tool on purpose — it takes an id allowlist, and it cannot mark a game
 * playable without a bundle it fetched itself.
 */
type Decision = { decision: 'approved' | 'blocked'; evidence: string; at: string };

function parseDecisions(rows: Record<string, string>): Record<string, Decision> {
  const out: Record<string, Decision> = {};
  for (const [key, value] of Object.entries(rows)) {
    if (!key.startsWith('dos.perm.')) continue;
    try {
      const parsed = JSON.parse(value) as Decision;
      if (parsed && (parsed.decision === 'approved' || parsed.decision === 'blocked')) {
        out[key.slice('dos.perm.'.length)] = parsed;
      }
    } catch {
      /* A hand-edited row that is not JSON is simply not a decision. */
    }
  }
  return out;
}

function DosDesk() {
  const { toast } = useStore();
  const nav = useNavigate();
  const [rows, setRows] = useState<RetroRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [index, setIndex] = useState<DosCatalog | null>(null);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [query, setQuery] = useState('');
  const [genre, setGenre] = useState<string | null>(null);
  const [only, setOnly] = useState<'all' | 'pending' | 'approved' | 'blocked'>('all');
  const [showAll, setShowAll] = useState(false);
  const [reviewing, setReviewing] = useState<{ id: string; decision: 'approved' | 'blocked' } | null>(null);
  const [evidence, setEvidence] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const [draft, setDraft] = useState<UploadDraft>(emptyDraft);
  const [file, setFile] = useState<File | null>(null);
  const [fileNote, setFileNote] = useState<string | null>(null);
  const [report, setReport] = useState<ReturnType<typeof inspectBundle> | null>(null);
  const [attested, setAttested] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const all = await listAllGames();
      setRows(all.filter((r) => r.platform === 'dos'));
      setLoadError(null);
    } catch (e) {
      setRows([]);
      setLoadError(e instanceof Error ? e.message : 'Could not read the DOS rows.');
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  /* The index is 536 KB of JSON. It is fetched only when this tab is opened, and
     never on a visitor's path. */
  useEffect(() => {
    let alive = true;
    loadDosIndex()
      .then((catalog) => { if (alive) setIndex(catalog); })
      .catch(() => { if (alive) setIndexError('The discovery index at /retro/dos/catalog.json did not load.'); });
    loadSiteContent()
      .then((values) => { if (alive) setDecisions(parseDecisions(values)); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const counts = useMemo(() => countStages(index?.entries ?? []), [index]);
  const genres = useMemo(() => genresOf(index?.entries ?? []).slice(0, 14), [index]);

  const decisionOf = (id: string): Decision['decision'] | 'pending' => decisions[id]?.decision ?? 'pending';

  const results = useMemo(() => {
    const base = searchIndex(index?.entries ?? [], query, genre);
    return base.filter((entry) => {
      if (only === 'all') return true;
      const d = decisions[entry.id]?.decision ?? 'pending';
      return d === only;
    });
  }, [index, query, genre, only, decisions]);

  const shown = showAll ? results : results.slice(0, 40);

  const decide = async (id: string, decision: 'approved' | 'blocked', text: string) => {
    setBusy(id);
    try {
      await recordDosDecision({ id, decision, evidence: text });
      setDecisions((prev) => ({ ...prev, [id]: { decision, evidence: text, at: new Date().toISOString() } }));
      setReviewing(null);
      setEvidence('');
      toast({
        kind: 'success',
        title: decision === 'approved' ? 'Permission recorded' : 'Refused',
        body:
          decision === 'approved'
            ? `${id} may now be hosted — the next step is a bundle and a test run, which is a separate decision.`
            : `${id} stays out of every shelf. The evidence you wrote is kept with the refusal.`,
      });
    } catch (e) {
      toast({ kind: 'error', title: 'Could not record that', body: e instanceof Error ? e.message : '' });
    } finally {
      setBusy(null);
    }
  };

  const takeFile = async (picked: File | undefined) => {
    setFileNote(null);
    setReport(null);
    if (!picked) { setFile(null); return; }
    if (picked.size > MAX_BUNDLE_BYTES) {
      setFile(null);
      setFileNote(`That file is ${kb(picked.size)}. Bundles are capped at ${MAX_BUNDLE_BYTES / (1024 * 1024)} MB.`);
      return;
    }
    const bytes = new Uint8Array(await picked.arrayBuffer());
    const zipEntries = readZipDirectory(bytes);
    const confBytes = zipEntries ? await readZipEntry(bytes, '.jsdos/dosbox.conf') : null;
    const result = inspectBundle({
      bytes,
      entries: zipEntries,
      conf: confBytes ? new TextDecoder().decode(confBytes) : null,
    });
    setReport(result);
    if (!result.ok) {
      setFile(null);
      setFileNote(BUNDLE_MESSAGE[result.problems[0]]);
      return;
    }
    setFile(picked);
    setDraft((d) => ({
      ...d,
      bytes: picked.size,
      title: d.title || picked.name.replace(/\.jsdos$/i, '').replace(/[-_]+/g, ' ').trim(),
    }));
  };

  const problems = useMemo(
    () => validateUpload({ ...draft, bytes: file?.size ?? 0 }, { takenIds: (rows ?? []).map((r) => r.id), platform: 'dos' }),
    [draft, file, rows],
  );
  const begun = Boolean(file || draft.title.trim() || draft.author.trim());

  const publish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) { toast({ kind: 'error', title: 'Pick a .jsdos bundle first' }); return; }
    if (!attested) { toast({ kind: 'error', title: 'Confirm the rights statement' }); return; }
    setBusy('upload');
    try {
      const { id, autoexec } = await uploadDosGame({
        draft: { ...draft, bytes: file.size },
        file,
        takenIds: (rows ?? []).map((r) => r.id),
      });
      resetDosShelf();
      toast({
        kind: 'success',
        title: 'Published to the DOS shelf',
        body: autoexec ? `${id} · runs: ${autoexec.split('\n').slice(-1)[0]}` : `${id} is on the shelf.`,
      });
      setDraft(emptyDraft());
      setFile(null);
      setReport(null);
      setAttested(false);
      await refresh();
    } catch (err) {
      toast({ kind: 'error', title: 'Upload failed', body: err instanceof Error ? err.message : 'Unknown error' });
    } finally {
      setBusy(null);
    }
  };

  const stageOf = (entry: DosCandidate): DosStage => entry.stage;

  return (
    <div className="mt-4 space-y-5">
      {/* ---------------- the queue ---------------- */}
      <Panel className="p-4">
        <SectionTitle eyebrow="Review queue" title="Discovery records waiting for a decision" />
        <p className="text-[12px] text-cream-400 mt-1 max-w-[78ch]">
          Read from <code className="font-mono text-volt-700">public/retro/dos/catalog.json</code> — a record of what a
          source repository contains, not a library. “Freeware” and “Shareware” are how those games were sold; they are
          not a grant to redistribute. Only a decision written here moves a title toward the shelf, and the evidence
          you type is stored with your name attached.
        </p>

        {indexError ? (
          <p role="alert" className="text-[12.5px] font-bold text-blush-600 mt-3">{indexError}</p>
        ) : !index ? (
          <p className="text-[13px] text-cream-400 mt-3">Reading the index…</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2 mt-3">
              {(['discovered', 'metadata-only', 'pending-rights-review', 'permission-approved', 'ready-for-testing', 'playable', 'failed', 'disabled'] as DosStage[])
                .filter((stage) => (counts[stage] ?? 0) > 0)
                .map((stage) => (
                  <Stat key={stage} label={STAGE_LABEL[stage]} value={counts[stage] ?? 0} />
                ))}
            </div>

            <div className="flex flex-col sm:flex-row gap-2 mt-3">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search the index by title, genre or year…"
                aria-label="Search the DOS discovery index"
                className={`${inputClass} flex-1`}
              />
              <select
                value={genre ?? ''}
                onChange={(e) => setGenre(e.target.value || null)}
                aria-label="Filter by genre"
                className={`${inputClass} sm:w-[190px]`}
              >
                <option value="">Every genre</option>
                {genres.map((g) => <option key={g.genre} value={g.genre}>{g.genre} ({g.count})</option>)}
              </select>
              <select
                value={only}
                onChange={(e) => setOnly(e.target.value as typeof only)}
                aria-label="Filter by decision"
                className={`${inputClass} sm:w-[170px]`}
              >
                <option value="all">Any decision</option>
                <option value="pending">Undecided</option>
                <option value="approved">Approved</option>
                <option value="blocked">Refused</option>
              </select>
            </div>

            <p className="text-[11.5px] text-cream-500 mt-2">
              {results.length} of {index.entries.length} records match · showing {shown.length}
              {index.generatedAt ? ` · index built ${index.generatedAt.slice(0, 10)}` : ''}
            </p>

            {/* The discovery half of "Sync games" is a maintainer script, not a
                button: it clones nothing, downloads nothing, and can only add an
                index row. Saying so here is cheaper than a server that pretends
                to sync. */}
            <div className="mt-2 rounded-lg border border-ink-600 bg-ink-900/60 p-2.5">
              <p className="text-[11.5px] text-cream-400">
                Discovery is re-run with{' '}
                <code className="font-mono text-volt-700">npm run dos:import</code> (plan only:{' '}
                <code className="font-mono text-volt-700">npm run dos:import:plan</code>);
                it writes <code className="font-mono text-volt-700">public/retro/dos/catalog.json</code> and
                downloads nothing.
                {index.source ? (
                  <>
                    {' '}Source: <span className="text-cream-300">{index.source.repo}</span>
                    {index.source.commit ? <span className="text-cream-500"> @ {index.source.commit.slice(0, 12)}</span> : null}.
                  </>
                ) : null}
              </p>
              <p className="text-[11px] text-cream-500 mt-1">
                A sync can add or rename an index record. It cannot approve one, publish one, or replace a bundle:
                those are the decisions above and the uploads below.
              </p>
            </div>

            <ul className="mt-2 divide-y divide-ink-600 max-h-[520px] overflow-auto pr-1">
              {shown.map((entry) => {
                const decision = decisionOf(entry.id);
                const stage = stageOf(entry);
                return (
                  <li key={entry.id} className="py-2.5">
                    <div className="flex flex-wrap items-start gap-2">
                      <div className="min-w-[220px] flex-1">
                        <p className="text-[13px] font-bold text-cream-100">
                          {entry.title}
                          {entry.year ? <span className="text-cream-500 font-normal"> · {entry.year}</span> : null}
                        </p>
                        <p className="text-[11.5px] text-cream-500 break-all">
                          {entry.id} · {entry.genre} · source says <em>{entry.sourceLicense}</em> ·{' '}
                          <a href={entry.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-volt-700 hover:underline">
                            original source
                          </a>
                        </p>
                        <p className="text-[11px] mt-0.5">
                          <span className="font-bold uppercase tracking-wide text-cream-400">{STAGE_LABEL[stage]}</span>
                          {' · '}
                          <span className={
                            decision === 'approved' ? 'text-leaf-400 font-bold'
                              : decision === 'blocked' ? 'text-blush-600 font-bold'
                                : 'text-cream-400'
                          }>
                            {decision === 'approved' ? 'permission recorded' : decision === 'blocked' ? 'refused' : 'no permission evidence'}
                          </span>
                          {decisions[entry.id]?.evidence ? (
                            <span className="text-cream-500"> — {decisions[entry.id].evidence.slice(0, 90)}</span>
                          ) : null}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy === entry.id}
                          onClick={() => { setReviewing({ id: entry.id, decision: 'approved' }); setEvidence(decisions[entry.id]?.evidence ?? ''); }}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy === entry.id}
                          onClick={() => { setReviewing({ id: entry.id, decision: 'blocked' }); setEvidence(''); }}
                        >
                          Refuse
                        </Button>
                      </div>
                    </div>

                    {reviewing?.id === entry.id && (
                      <div className="mt-2 rounded-lg border border-ink-500 bg-ink-900/70 p-2.5">
                        <Field
                          label={reviewing.decision === 'approved' ? 'What the permission rests on' : 'Why it is refused'}
                          hint={
                            reviewing.decision === 'approved'
                              ? 'A URL, a quote from the author, a dated email — at least 12 characters. This is stored verbatim.'
                              : 'Optional, but useful later: “shareware, no redistribution grant”, “commercial title”.'
                          }
                        >
                          <textarea
                            className={`${inputClass} min-h-[64px]`}
                            value={evidence}
                            maxLength={300}
                            onChange={(e) => setEvidence(e.target.value)}
                          />
                        </Field>
                        <div className="flex gap-2 mt-2">
                          <Button
                            size="sm"
                            disabled={reviewing.decision === 'approved' && evidence.trim().length < 12}
                            onClick={() => { void decide(entry.id, reviewing.decision, evidence.trim()); }}
                          >
                            {busy === entry.id ? 'Saving…' : reviewing.decision === 'approved' ? 'Record permission' : 'Record refusal'}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setReviewing(null)}>Cancel</Button>
                        </div>
                        {reviewing.decision === 'approved' && (
                          <p className="text-[11px] text-cream-500 mt-2">
                            This records the right to host. It does not host anything and it does not make a Play button:
                            the bundle still has to be uploaded below, checked, and run once.
                          </p>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
              {shown.length === 0 && (
                <li className="py-4 text-[13px] text-cream-400">Nothing in the index matches that.</li>
              )}
            </ul>
            {results.length > shown.length && (
              <Button size="sm" variant="ghost" className="mt-2" onClick={() => setShowAll(true)}>
                Show all {results.length}
              </Button>
            )}
          </>
        )}
      </Panel>

      {/* ---------------- upload ---------------- */}
      <Panel className="p-4">
        <SectionTitle eyebrow="Publish" title="Upload a .jsdos bundle" />
        <p className="text-[12px] text-cream-400 mt-1 max-w-[78ch]">
          A bundle is a ZIP whose <code className="font-mono text-volt-700">.jsdos/dosbox.conf</code> tells js-dos how to
          boot it. The file is checked here for the same things the shelf checks — it is a ZIP, the config is present, no
          entry escapes the archive — and then stored as{' '}
          <code className="font-mono text-volt-700">&lt;id&gt;/game.jsdos</code> with a <code className="font-mono text-volt-700">platform&nbsp;=&nbsp;dos</code> row.
        </p>

        <form onSubmit={publish} className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Bundle" hint=".jsdos, up to 48 MB, containing .jsdos/dosbox.conf.">
              <input
                type="file"
                accept=".jsdos,application/zip"
                onChange={(e) => { void takeFile(e.target.files?.[0]); e.currentTarget.value = ''; }}
                className="mt-1 block w-full text-[12.5px] text-cream-300 file:mr-3 file:rounded-md file:border-0 file:bg-volt-400 file:px-3 file:py-1.5 file:text-[12px] file:font-bold file:text-ink-950"
              />
            </Field>
            {report?.ok && file && (
              <div className="mt-2 rounded-lg border border-ink-600 bg-ink-900/60 p-2.5">
                <p className="text-[11.5px] text-cream-300">
                  {file.name} · {kb(file.size)} · {report.entries} entries · <span className="text-leaf-400 font-bold">dosbox.conf found</span>
                </p>
                {report.autoexec && (
                  <pre className="mt-1.5 text-[11px] text-cream-400 whitespace-pre-wrap font-mono">{report.autoexec}</pre>
                )}
              </div>
            )}
            {fileNote && <p role="alert" className="text-[12px] font-bold text-blush-600 mt-1">{fileNote}</p>}
          </div>

          <Field label="Title">
            <input className={inputClass} value={draft.title} maxLength={60} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </Field>
          <Field label="Author / studio">
            <input className={inputClass} value={draft.author} maxLength={60} onChange={(e) => setDraft({ ...draft, author: e.target.value })} />
          </Field>

          <Field label="Tagline" hint="One line on the card. 80 characters.">
            <input className={inputClass} value={draft.tagline} maxLength={80} onChange={(e) => setDraft({ ...draft, tagline: e.target.value })} />
          </Field>
          <Field label="Tags" hint="Comma separated: puzzle, arcade, action…">
            <input
              className={inputClass}
              value={draft.tags.join(', ')}
              onChange={(e) => setDraft({ ...draft, tags: e.target.value.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 6) })}
            />
          </Field>

          <Field label="Description" hint="600 characters.">
            <textarea className={`${inputClass} min-h-[84px]`} value={draft.description} maxLength={600} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          </Field>
          <div className="space-y-3">
            <Field label="Licence" hint="Only redistributable licences are accepted.">
              <select className={inputClass} value={draft.license} onChange={(e) => setDraft({ ...draft, license: e.target.value })}>
                {LICENCES.map((l) => <option key={l} value={l}>{l}</option>)}
                <option value="BSD-3-Clause">BSD-3-Clause</option>
                <option value="CC0-1.0">CC0-1.0</option>
              </select>
            </Field>
            <Field label="Year (optional)">
              <input
                className={inputClass}
                inputMode="numeric"
                value={draft.year ?? ''}
                onChange={(e) => setDraft({ ...draft, year: e.target.value ? Number(e.target.value) : null })}
              />
            </Field>
          </div>

          <Field label="Licence link" hint="https:// — where the licence text lives.">
            <input className={inputClass} value={draft.licenseUrl} onChange={(e) => setDraft({ ...draft, licenseUrl: e.target.value })} placeholder="https://creativecommons.org/publicdomain/zero/1.0/" />
          </Field>
          <Field label="Source link" hint="https:// — the original release, not a mirror.">
            <input className={inputClass} value={draft.sourceUrl} onChange={(e) => setDraft({ ...draft, sourceUrl: e.target.value })} placeholder="https://example.com/the-game" />
          </Field>

          <div className="sm:col-span-2">
            <Field label="Why it may be hosted" hint="Required for DOS. Say what the right rests on — “author released it CC0 in 2019”, “written for this site”.">
              <input className={inputClass} value={draft.rightsNote} maxLength={400} onChange={(e) => setDraft({ ...draft, rightsNote: e.target.value })} />
            </Field>
          </div>

          <div className="sm:col-span-2 rounded-lg border border-ink-600 bg-ink-900/60 p-3">
            <Toggle
              checked={attested}
              onChange={setAttested}
              label="I have the right to redistribute this bundle, and it is not a commercial title"
            />
            <p className="text-[11.5px] text-cream-500 mt-2">
              A DOS game that was sold commercially is refused here even when an aggregator labels it “freeware”:
              that label describes how it was distributed in 1993, not who may serve it today. Uploading a bundle
              nobody can verify is also how a dead Play button gets made.
            </p>
          </div>

          {begun && problems.length > 0 && (
            <ul className="sm:col-span-2 text-[12px] text-cream-400 space-y-1" aria-live="polite">
              {problems.map((p) => <li key={p}>• {p}</li>)}
            </ul>
          )}

          <div className="sm:col-span-2 flex items-center gap-3">
            <Button type="submit" disabled={busy === 'upload' || problems.length > 0 || !attested || !file}>
              {busy === 'upload' ? 'Uploading…' : 'Publish to the DOS shelf'}
            </Button>
            <span className="text-[11.5px] text-cream-500">{file ? `${kb(file.size)} · ${slugify(draft.title)}` : 'No bundle chosen'}</span>
          </div>
        </form>
      </Panel>

      {/* ---------------- the rows ---------------- */}
      <Panel className="p-4">
        <SectionTitle eyebrow="Manage" title="DOS games this site hosts" />
        {loadError && <p role="alert" className="text-[12.5px] font-bold text-blush-600 mt-2">{loadError}</p>}
        {rows === null ? (
          <p className="text-[13px] text-cream-400 mt-3">Reading…</p>
        ) : rows.length === 0 ? (
          <p className="text-[13px] text-cream-400 mt-3">
            No DOS rows yet. The calibration cartridge ships with the site in <code className="font-mono text-volt-700">public/retro/dos/</code>,
            so it is not a row here.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-ink-600">
            {rows.map((row) => (
              <li key={row.id} className="py-3 flex flex-wrap items-start gap-3">
                <div className="min-w-[220px] flex-1">
                  <p className="text-[13.5px] font-bold text-cream-100">
                    {row.title}{' '}
                    <span className={`ml-1 text-[10.5px] font-bold uppercase tracking-wide ${row.status === 'published' ? 'text-volt-700' : 'text-cream-500'}`}>
                      {row.status}
                    </span>
                  </p>
                  <p className="text-[11.5px] text-cream-500 break-all">
                    {row.id} · {row.author} · {kb(row.bytes)} · {row.license} · {row.rom_path}
                  </p>
                  <p className="text-[12px] text-cream-400 mt-1 max-w-[60ch]">{row.rights_note || 'No rights note recorded.'}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="ghost" onClick={() => nav(`/retro/dos/${row.id}`)} icon={<Icon name="play" size={12} />}>
                    Test player
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      try {
                        await setGameStatus(row.id, row.status === 'published' ? 'draft' : 'published');
                        resetDosShelf();
                        await refresh();
                      } catch (e) {
                        toast({ kind: 'error', title: 'Could not change that', body: e instanceof Error ? e.message : '' });
                      }
                    }}
                  >
                    {row.status === 'published' ? 'Unpublish' : 'Publish'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      try {
                        await deleteGame(row.id);
                        resetDosShelf();
                        await refresh();
                      } catch (e) {
                        toast({ kind: 'error', title: 'Could not delete', body: e instanceof Error ? e.message : '' });
                      }
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-3 mt-3 flex-wrap">
          <Stat label="DOS rows" value={rows?.length ?? '—'} />
          <Stat label="Published" value={rows?.filter((r) => r.status === 'published').length ?? '—'} />
          <Stat label="Bytes" value={rows ? kb(rows.reduce((n, r) => n + r.bytes, 0)) : '—'} />
        </div>
      </Panel>
    </div>
  );
}

/* -------------------------------------------------------------- site copy */

function CopyDesk() {
  const { toast } = useStore();
  const [values, setValues] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    void loadSiteContent().then((rows) => { setValues(rows); setLoaded(true); });
  }, []);

  return (
    <div className="mt-4">
      <Panel className="p-4">
        <SectionTitle eyebrow="Words" title="Headings and intro copy" />
        <p className="text-[12px] text-cream-400 mt-1 max-w-[70ch]">
          Leave a field blank to use the copy that ships with the site. Saved values live in{' '}
          <code className="font-mono text-volt-700">site_content</code> and are read on the next page load.
        </p>
        <div className="space-y-4 mt-4">
          {SITE_CONTENT_KEYS.map((entry) => (
            <div key={entry.key}>
              <Field label={entry.label} hint={`key: ${entry.key}`}>
                <textarea
                  className={`${inputClass} min-h-[64px]`}
                  value={values[entry.key] ?? ''}
                  placeholder={`Ships as: ${entry.fallback}`}
                  maxLength={1200}
                  onChange={(e) => setValues({ ...values, [entry.key]: e.target.value })}
                  disabled={!loaded}
                />
              </Field>
              <Button
                size="sm"
                className="mt-2"
                disabled={busy !== null}
                onClick={async () => {
                  setBusy(entry.key);
                  try {
                    await saveSiteContent(entry.key, values[entry.key] ?? '');
                    resetSiteContent();
                    toast({ kind: 'success', title: 'Saved', body: entry.label });
                  } catch (e) {
                    toast({ kind: 'error', title: 'Could not save', body: e instanceof Error ? e.message : '' });
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                {busy === entry.key ? 'Saving…' : 'Save'}
              </Button>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
