import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  SITE_CONTENT_KEYS,
  adminConfigured,
  amIAdmin,
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
import { cartridgeKind, resetRetroLibrary } from '../lib/retro';
import { resetSiteContent } from '../lib/content';
import { signOut, supabase } from '../lib/supabase';
import { Button, ConfirmDialog, EmptyState, Icon, Panel, SectionTitle, Segmented, Stat, Toggle } from '../components/ui';
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

type Phase = 'checking' | 'offline' | 'locked' | 'denied' | 'ready';
type Tab = 'shelf' | 'copy';

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

  /* ------------------------------------------------------------ the gate */
  useEffect(() => {
    if (!adminConfigured()) { setPhase('offline'); return; }
    let alive = true;
    void supabase().then(async (sb) => {
      if (!sb || !alive) return;
      const { data } = await sb.auth.getUser();
      if (!data.user) { if (alive) setPhase('locked'); return; }
      const admin = await amIAdmin();
      if (!alive) return;
      setWho((data.user.user_metadata?.display_name as string) || data.user.email || 'signed in');
      setPhase(admin ? 'ready' : 'denied');
    });
    return () => { alive = false; };
  }, []);

  if (phase === 'checking') {
    return <div className="mx-auto max-w-[900px] px-[var(--shell-pad)] py-16 text-[13px] text-cream-400">Checking this account…</div>;
  }

  if (phase === 'offline') {
    return (
      <div className="mx-auto max-w-[900px] px-[var(--shell-pad)] py-12">
        <EmptyState
          mascot="waiting"
          title="The desk is not wired up on this build"
          body="Admin tools need the Supabase project: copy .env.example to .env, fill in VITE_SUPABASE_URL and the publishable key, run supabase/migrations (0004_admin.sql last) and restart. The site itself works without any of this."
          action={<Button onClick={() => nav('/')} icon={<Icon name="back" size={14} />}>Back to the arcade</Button>}
        />
      </div>
    );
  }

  if (phase === 'locked') {
    return (
      <SignIn
        onDone={(admin, name) => {
          setWho(name);
          setPhase(admin ? 'ready' : 'denied');
        }}
      />
    );
  }

  if (phase === 'denied') {
    return (
      <div className="mx-auto max-w-[900px] px-[var(--shell-pad)] py-12">
        <EmptyState
          mascot="waiting"
          title="That account is not on the roster"
          body={`Signed in as ${who}. Admin rights come from a row in public.admin_users, so an ordinary account cannot open this page even with the URL.`}
          action={
            <div className="flex gap-2 flex-wrap">
              <Button onClick={async () => { await signOut(); setPhase('locked'); }}>Sign in as someone else</Button>
              <Button variant="ghost" onClick={() => nav('/')}>Back to the arcade</Button>
            </div>
          }
        />
      </div>
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
          { value: 'shelf', label: 'Retro shelf' },
          { value: 'copy', label: 'Site copy' },
        ]}
      />

      {tab === 'shelf' ? <ShelfDesk /> : <CopyDesk />}
    </div>
  );
}

/* --------------------------------------------------------------- sign in */

function SignIn({ onDone }: { onDone: (admin: boolean, name: string) => void }) {
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = await signInAdmin(account, password);
    setBusy(false);
    if (!result.ok) { setError(result.error ?? 'Sign-in failed.'); return; }
    setPassword('');
    onDone(result.admin, result.name);
  };

  return (
    <div className="mx-auto max-w-[430px] px-[var(--shell-pad)] py-14">
      <Panel className="p-5">
        <p className="eyebrow mb-1">Restricted</p>
        <h1 className="display text-[24px] text-cream-100 leading-tight">Sign in to continue</h1>
        <p className="text-[12.5px] text-cream-400 mt-2">
          This page only opens for accounts on the admin roster.
        </p>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <Field label="Email or username">
            <input
              className={inputClass}
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              autoComplete="username"
              spellCheck={false}
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
          {error && <p role="alert" className="text-[12.5px] font-bold text-blush-600">{error}</p>}
          <Button type="submit" disabled={busy} className="w-full justify-center">
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
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
