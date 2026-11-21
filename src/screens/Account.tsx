import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Icon, Panel } from '../components/ui';
import { PikachuMascot } from '../mascot';
import { describeAuthError } from '../lib/adminAuth';
import { amIAdmin } from '../lib/admin';
import {
  validateSignIn,
  validateSignUp,
  safeNext,
  checkPassword,
  checkEmail,
  type FieldProblem,
} from '../lib/accountForm';
import {
  fetchRemoteUserData,
  sendPasswordReset,
  setNewPassword,
  signInWithPassword,
  signUpWithPassword,
  signOut,
  supabase,
  supabaseEnabled,
} from '../lib/supabase';
import { useStore } from '../lib/store';

/**
 * `/account` — create an account, sign in, recover a password, or finish a recovery.
 *
 * This was a panel three-quarters down the Settings page, below the graphics
 * quality and above the feedback link, which is a strange place for the one thing
 * a returning player needs. It is a page now, and the header links to it.
 *
 * **One form for everyone.** There is no separate door for the maintainer: the
 * fields, the wording and the layout are a player's. When a sign-in succeeds the
 * app asks Postgres whether that account is on the admin roster, and if it is,
 * the browser goes to `/admin` — the decision is a server answer, never a
 * credential compiled into the bundle. See `lib/accountForm.ts` for the shape of
 * that rule and `screens/Admin.tsx` for the enforcement.
 */

type Mode = 'signin' | 'signup' | 'forgot' | 'reset';

const MODE_COPY: Record<Mode, { title: string; lead: string }> = {
  signin: {
    title: 'Welcome back',
    lead: 'Sign in to bring your career, saves and achievements across devices.',
  },
  signup: {
    title: 'Create your trainer',
    lead: 'An account keeps your stats, high scores and save states together. It is free and takes a minute.',
  },
  forgot: {
    title: 'Forgot your password?',
    lead: 'Enter the address on the account and we will send a link to set a new one.',
  },
  reset: {
    title: 'Choose a new password',
    lead: 'You followed a recovery link. Pick something you have not used here before.',
  },
};

export default function Account() {
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const { setIdentity, syncStats, toast, sfx, cloud } = useStore();

  const requested = (params.get('mode') ?? 'signin') as Mode;
  const mode: Mode = (['signin', 'signup', 'forgot', 'reset'] as const).includes(requested as Mode)
    ? (requested as Mode)
    : 'signin';
  const next = safeNext(params.get('next'));

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [problems, setProblems] = useState<FieldProblem[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [signedInAs, setSignedInAs] = useState<string | null>(null);
  const firstField = useRef<HTMLInputElement>(null);

  const problemFor = (field: FieldProblem['field']) => problems.find((p) => p.field === field)?.message;

  // Focus the first field on mount and whenever the mode changes — a page whose
  // only job is a form should not make you hunt for it with the mouse.
  useEffect(() => {
    firstField.current?.focus({ preventScroll: true });
  }, [mode]);

  useEffect(() => {
    if (!cloud) return;
    let alive = true;
    void supabase().then((sb) => {
      if (!sb || !alive) return;
      void sb.auth.getUser().then(({ data }) => {
        if (!alive) return;
        const u = data.user;
        setSignedInAs(u ? (u.user_metadata?.display_name || u.user_metadata?.username || u.email || 'Trainer') : null);
      });
    });
    return () => { alive = false; };
  }, [cloud]);

  const go = useCallback((m: Mode) => {
    const p = new URLSearchParams(params);
    p.set('mode', m);
    setParams(p, { replace: true });
    setProblems([]);
    setDone(null);
    setPassword('');
    setConfirm('');
  }, [params, setParams]);

  /* After a successful sign-in: pull the career, then decide where to land. The
     admin question is answered by the database, not by anything in this bundle. */
  const afterSignIn = useCallback(async (name: string) => {
    const remote = await fetchRemoteUserData().catch(() => null);
    if (remote?.stats) syncStats(remote.stats);
    const display = remote?.name || name;
    setIdentity({ name: display, ...(remote?.mascot ? { mascot: remote.mascot } : {}) });
    setSignedInAs(display);
    if (await amIAdmin().catch(() => false)) {
      sfx('win');
      toast({ kind: 'success', title: `Signed in as ${display}`, body: 'Taking you to the console.' });
      nav('/admin', { replace: true });
      return;
    }
    sfx('win');
    /* Signed in, but not on the roster, and they were asking for /admin: send
       them back there. That page already explains, in one sentence and with the
       account's own id, why the desk is shut — which is more use than dropping
       them on the home screen with no idea what happened. */
    if (next.startsWith('/admin')) {
      toast({ kind: 'info', title: `Signed in as ${display}`, body: 'This account does not have access to that page.' });
    } else {
      toast({ kind: 'success', title: `Signed in as ${display}` });
    }
    nav(next, { replace: true });
  }, [nav, next, setIdentity, sfx, syncStats, toast]);

  const submitSignIn = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const found = validateSignIn({ username, password });
    setProblems(found);
    if (found.length) { sfx('miss'); return; }
    setBusy(true);
    try {
      await signInWithPassword(username.trim(), password);
      await afterSignIn(username.trim());
    } catch (err: unknown) {
      const problem = describeAuthError({
        message: typeof (err as Error)?.message === 'string' ? (err as Error).message : '',
        code: (err as { code?: string })?.code,
        status: (err as { status?: number })?.status,
        name: (err as Error)?.name,
      });
      setProblems([{ field: 'form', message: [problem.title, problem.body, problem.hint].filter(Boolean).join(' ') }]);
      sfx('miss');
    } finally {
      setBusy(false);
    }
  };

  const submitSignUp = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const found = validateSignUp({ username, email, password, confirm });
    setProblems(found);
    if (found.length) { sfx('miss'); return; }
    setBusy(true);
    try {
      await signUpWithPassword(username.trim(), password, email.trim() || undefined);
      setIdentity({ name: username.trim() });
      sfx('win');
      /* A project with email confirmation on returns no session, and telling the
         player "you are in" would then be a lie they discover on the next page.
         Ask instead of assuming. */
      const sb = await supabase();
      const { data } = (await sb?.auth.getSession()) ?? { data: { session: null } };
      if (data?.session) {
        await afterSignIn(username.trim());
      } else {
        setDone(
          `Account created. Check ${email.trim() || 'your inbox'} for the confirmation link, then sign in.`,
        );
        setPassword('');
        setConfirm('');
        go('signin');
      }
    } catch (err: unknown) {
      const message = String((err as Error)?.message ?? '');
      const friendly = /already registered|already exists|user already/i.test(message)
        ? 'That trainer name or address is taken. Try signing in instead.'
        : /rate|too many/i.test(message)
          ? 'Too many attempts just now. Wait a minute and try again.'
          : message || 'Could not create the account.';
      setProblems([
        { field: /email/i.test(friendly) ? 'email' : 'form', message: friendly },
      ]);
      sfx('miss');
    } finally {
      setBusy(false);
    }
  };

  const submitForgot = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const problem = checkEmail(email);
    if (problem) { setProblems([problem]); sfx('miss'); return; }
    if (!email.trim()) {
      setProblems([{ field: 'email', message: 'Enter the email address on the account.' }]);
      sfx('miss');
      return;
    }
    setBusy(true);
    try {
      await sendPasswordReset(email);
      setDone('If an account uses that address, a recovery link is on its way. It can take a minute.');
      sfx('notify');
    } catch (err: unknown) {
      setProblems([{ field: 'form', message: (err as Error)?.message || 'Could not send the link.' }]);
      sfx('miss');
    } finally {
      setBusy(false);
    }
  };

  const submitReset = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const problem = checkPassword(password);
    if (problem) { setProblems([problem]); sfx('miss'); return; }
    if (password !== confirm) {
      setProblems([{ field: 'confirm', message: 'The two passwords do not match.' }]);
      sfx('miss');
      return;
    }
    setBusy(true);
    try {
      await setNewPassword(password);
      setDone('Password updated. You are signed in with the new one.');
      setPassword('');
      setConfirm('');
      sfx('win');
    } catch (err: unknown) {
      setProblems([{ field: 'form', message: (err as Error)?.message || 'Could not set the password.' }]);
      sfx('miss');
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = useMemo(
    () => (mode === 'signup' ? submitSignUp : mode === 'forgot' ? submitForgot : mode === 'reset' ? submitReset : submitSignIn),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, username, email, password, confirm, busy],
  );

  const copy = MODE_COPY[mode];

  return (
    <div className="mx-auto max-w-[1040px] px-[var(--shell-pad)] py-8">
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_340px] md:items-start">
        <div>
          <p className="eyebrow mb-1">Account</p>
          <h1 className="display text-[clamp(24px,4.4vw,38px)] text-cream-100 leading-none">{copy.title}</h1>
          <p className="text-[13px] text-cream-400 mt-2 max-w-[520px]">{copy.lead}</p>

          {!cloud ? (
            <Panel className="p-4 mt-5 space-y-2">
              <p className="text-[13px] font-bold text-cream-100">Accounts are not configured on this build.</p>
              <p className="text-[12.5px] text-cream-400">
                Everything still works and every score is kept on this device. To turn accounts on, add a
                Supabase project URL and anon key to <code className="font-mono text-volt-700">.env</code> and restart.
              </p>
            </Panel>
          ) : signedInAs && mode !== 'reset' ? (
            <Panel className="p-4 mt-5 space-y-3">
              <p className="text-[13px] font-bold text-cream-100">
                Signed in as <span className="text-volt-700">{signedInAs}</span>
              </p>
              <p className="text-[12.5px] text-cream-400">
                Your results sync across devices under row-level security. Signing out keeps this device's progress.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    await signOut();
                    setSignedInAs(null);
                    sfx('toggle');
                    toast({ kind: 'info', title: 'Signed out' });
                  }}
                >
                  Sign out
                </Button>
                <Button size="sm" onClick={() => nav(next)}>Back to the arcade</Button>
              </div>
            </Panel>
          ) : (
            <Panel className="p-4 sm:p-5 mt-5">
              {mode !== 'reset' && (
                <div className="flex gap-1.5 mb-4 flex-wrap" role="tablist" aria-label="Account action">
                  {([['signin', 'Sign in'], ['signup', 'Create account']] as const).map(([id, label]) => (
                    <button
                      key={id}
                      role="tab"
                      aria-selected={mode === id}
                      onClick={() => { sfx('click'); go(id); }}
                      className={`px-3 py-2 text-[12px] font-extrabold uppercase tracking-wider rounded-lg border-2 transition-colors ${
                        mode === id
                          ? 'bg-volt-400 text-ink-900 border-volt-600'
                          : 'bg-ink-800 text-cream-300 border-ink-600 hover:border-ink-500'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}

              <form onSubmit={onSubmit} className="space-y-3" noValidate>
                {mode !== 'reset' && (
                  <Field
                    label={mode === 'forgot' ? 'Email on the account' : 'Trainer name or email'}
                    autoComplete="username"
                    inputRef={firstField}
                    value={username}
                    onChange={setUsername}
                    placeholder={mode === 'forgot' ? 'you@example.com' : 'AshKetchum'}
                    problem={problemFor('username')}
                    inputMode={mode === 'forgot' ? 'email' : 'text'}
                  />
                )}

                {mode === 'signup' && (
                  <Field
                    label="Recovery email (optional)"
                    autoComplete="email"
                    type="email"
                    value={email}
                    onChange={setEmail}
                    placeholder="Optional — used only for recovery"
                    problem={problemFor('email')}
                    hint="Only used if you forget your password. Never shown to anyone."
                  />
                )}

                {mode === 'forgot' && email === username && null}

                {mode === 'forgot' && (
                  <p className="text-[11.5px] text-cream-400 -mt-1">
                    Use the address you signed up with. If you signed up with only a name, that address is
                    <code className="font-mono text-volt-700"> yourname@pikachu.arcade</code>.
                  </p>
                )}

                {mode !== 'forgot' && (
                  <Field
                    label={mode === 'reset' ? 'New password' : 'Password'}
                    autoComplete={mode === 'signup' || mode === 'reset' ? 'new-password' : 'current-password'}
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={setPassword}
                    placeholder={mode === 'signup' || mode === 'reset' ? 'At least 8 characters' : ''}
                    problem={problemFor('password')}
                    inputRef={mode === 'reset' ? firstField : undefined}
                    trailing={
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        className="text-[10.5px] font-extrabold uppercase tracking-wider text-cream-300 hover:text-volt-700 px-2"
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? 'Hide' : 'Show'}
                      </button>
                    }
                  />
                )}

                {(mode === 'signup' || mode === 'reset') && (
                  <Field
                    label="One more time"
                    autoComplete="new-password"
                    type={showPassword ? 'text' : 'password'}
                    value={confirm}
                    onChange={setConfirm}
                    problem={problemFor('confirm')}
                  />
                )}

                {problemFor('form') && (
                  <p className="text-[12.5px] font-semibold text-[#ffadc6] leading-snug" role="alert">
                    {problemFor('form')}
                  </p>
                )}
                {done && (
                  <p className="text-[12.5px] font-semibold text-leaf-400 leading-snug" role="status">
                    {done}
                  </p>
                )}

                <div className="flex items-center gap-2 flex-wrap pt-1">
                  <Button type="submit" disabled={busy} icon={busy ? undefined : <Icon name="check" size={14} />}>
                    {busy
                      ? 'Working…'
                      : mode === 'signup'
                        ? 'Create account'
                        : mode === 'forgot'
                          ? 'Send recovery link'
                          : mode === 'reset'
                            ? 'Set new password'
                            : 'Sign in'}
                  </Button>
                  {mode === 'signin' && (
                    <button
                      type="button"
                      onClick={() => { sfx('click'); go('forgot'); }}
                      className="text-[12px] font-bold text-cream-400 hover:text-volt-700 underline underline-offset-2"
                    >
                      Forgot password?
                    </button>
                  )}
                  {(mode === 'forgot' || mode === 'signup') && (
                    <button
                      type="button"
                      onClick={() => { sfx('click'); go('signin'); }}
                      className="text-[12px] font-bold text-cream-400 hover:text-volt-700 underline underline-offset-2"
                    >
                      Back to sign in
                    </button>
                  )}
                </div>
              </form>
            </Panel>
          )}
        </div>

        <aside className="hidden md:block">
          <Panel className="p-4 space-y-3">
            <div className="flex items-center gap-3">
              <PikachuMascot state="excited" size={72} />
              <div>
                <p className="text-[13px] font-extrabold text-cream-100">Why sign in?</p>
                <p className="text-[11.5px] text-cream-400">Three things, honestly.</p>
              </div>
            </div>
            <ul className="space-y-2.5 text-[12px] text-cream-300">
              <li className="flex gap-2"><Icon name="trophy" size={14} /><span>Your stats and achievements, on every device you play on.</span></li>
              <li className="flex gap-2"><Icon name="save" size={14} /><span>Save states that survive a new phone.</span></li>
              <li className="flex gap-2"><Icon name="users" size={14} /><span>A name your friends recognise in a private room.</span></li>
            </ul>
            <p className="text-[11px] text-cream-400 border-t border-ink-600 pt-2.5">
              Playing as a guest works everywhere. An account never gates a game.
            </p>
          </Panel>
        </aside>
      </div>
    </div>
  );
}

/** One labelled input, with its problem sentence underneath instead of a red border alone. */
function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  autoComplete,
  problem,
  hint,
  trailing,
  inputRef,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  autoComplete?: string;
  problem?: string;
  hint?: string;
  trailing?: React.ReactNode;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  inputMode?: 'text' | 'email';
}) {
  const id = `acct-${label.replace(/[^a-z]+/gi, '-').toLowerCase()}`;
  return (
    <div>
      <label htmlFor={id} className="text-[11px] font-bold text-cream-400 uppercase tracking-wider block mb-1">
        {label}
      </label>
      <div
        className={`flex items-center bg-ink-800 border-2 rounded-lg ${problem ? 'border-[#ef6a7f]' : 'border-ink-600 focus-within:border-volt-400'}`}
      >
        <input
          id={id}
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          type={type}
          inputMode={inputMode}
          autoComplete={autoComplete}
          placeholder={placeholder}
          aria-invalid={!!problem}
          aria-describedby={problem ? `${id}-problem` : undefined}
          /* `outline-none` was not enough: the field is focused on mount, and
             Chrome's own focus ring then drew a red box that read exactly like a
             validation error. The wrapper's border is the focus indicator. */
          className="w-full min-w-0 bg-transparent px-3 py-2.5 text-[13px] text-cream-100 placeholder-ink-400 outline-none focus:outline-none focus-visible:outline-none ring-0 focus:ring-0"
        />
        {trailing}
      </div>
      {problem ? (
        <p id={`${id}-problem`} className="text-[11.5px] font-semibold text-[#ffadc6] mt-1" role="alert">{problem}</p>
      ) : hint ? (
        <p className="text-[11px] text-cream-400 mt-1">{hint}</p>
      ) : null}
    </div>
  );
}
