/**
 * `npm run admin:doctor` — find out why the admin desk will not open.
 *
 * The browser can only tell you what it was built with. This script can see the
 * other side: whether the project answers, whether the account exists, whether
 * its email is confirmed, and whether the roster lists it. It reads the same
 * `.env` the app builds with (plus `.env.local`), prints nothing secret — the
 * key is reported by *kind*, never by value — and changes nothing unless you ask
 * it to with `--fix`.
 *
 *   node --env-file=...                        no
 *   npm run admin:doctor                       diagnose
 *   npm run admin:doctor -- --fix              confirm the email + allowlist the account
 *   npm run admin:doctor -- you@example.com    test another account
 *
 * Node 20.6+ can read `.env` natively (`--env-file-if-exists`), so this needs no
 * dependency and no build step. Two credentials, deliberately separate:
 *
 *   - `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_SECRET_KEY`) stays **server-side**;
 *     it is what lets the doctor confirm an email or write the roster row. It must
 *     never appear in a `VITE_` variable — the browser would ship it to everyone.
 *   - the account's password is *never* read from this file. If you want the
 *     password checked too, the script asks for it on stdin, and only when a TTY
 *     is attached (`--password`), so nothing lands in shell history.
 */
import { createInterface } from 'node:readline/promises';
import { readFileSync, existsSync } from 'node:fs';
import { stdin, stdout } from 'node:process';

type Dict = Record<string, string>;

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const value = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] ?? null : null;
};

/** `.env` / `.env.local`, parsed by hand so the format is unambiguous. */
function readEnvFile(file: string): Dict {
  if (!existsSync(file)) return {};
  const out: Dict = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (v) out[m[1]] = v;
  }
  return out;
}

const env: Dict = {
  ...readEnvFile('.env'),
  ...readEnvFile('.env.local'),
  ...Object.fromEntries(Object.entries(process.env).filter(([, v]) => typeof v === 'string') as [string, string][]),
};

const url = (env.VITE_SUPABASE_URL || env.SUPABASE_URL || '').replace(/\/+$/, '');
const anonKey =
  env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY ||
  env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || '';
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || '';

/** Classify the key without printing it: the prefix tells you what it is. */
function keyKind(key: string): string {
  if (!key) return 'missing';
  if (key.startsWith('sb_secret_')) return 'secret (service-role class)';
  if (key.startsWith('sb_publishable_')) return 'publishable';
  const parts = key.split('.');
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as { role?: string };
      return `legacy JWT, role=${payload.role ?? '?'}`;
    } catch { return 'legacy JWT (unreadable)'; }
  }
  return 'unrecognised';
}

const say = (ok: boolean | 'warn', label: string, detail = '') =>
  console.log(`${ok === true ? '  ok  ' : ok === 'warn' ? ' warn ' : ' fail '} ${label}${detail ? `  —  ${detail}` : ''}`);

async function api(path: string, init: RequestInit & { key?: string } = {}): Promise<{ status: number; body: any }> {
  const res = await fetch(`${url}${path}`, {
    ...init,
    headers: {
      apikey: init.key ?? anonKey,
      authorization: `Bearer ${init.key ?? anonKey}`,
      'content-type': 'application/json',
      ...(init.headers as Dict | undefined),
    },
  });
  const text = await res.text();
  let body: unknown = text;
  try { body = text ? JSON.parse(text) : null; } catch { /* keep the text */ }
  return { status: res.status, body };
}

async function main() {
  console.log('\nPikachu admin doctor\n');

  /* 1 — configuration */
  say(url ? true : false, 'VITE_SUPABASE_URL', url || 'not set (copy .env.example to .env)');
  const anonKind = keyKind(anonKey);
  const anonOk = Boolean(anonKey) && anonKind !== 'secret (service-role class)' && anonKind !== 'missing';
  say(anonOk ? true : false, 'publishable key', anonOk ? anonKind : `${anonKind} — the browser refuses secret keys`);
  say(serviceKey ? true : 'warn', 'service key (server only)', serviceKey ? keyKind(serviceKey) : 'not set — --fix unavailable');
  if (!url || !anonOk) {
    console.log('\nNothing else can be checked until the build has a project URL and a publishable key.\n');
    process.exitCode = 1;
    return;
  }

  /* 2 — reachability */
  const health = await api('/auth/v1/health').catch(() => null);
  if (!health) {
    say(false, 'reach the project', `no answer from ${url} — wrong URL, no network, or the project is paused`);
    process.exitCode = 1;
    return;
  }
  say(health.status < 500, 'reach the project', `auth health ${health.status}`);

  /* 3 — schema: is 0004_admin.sql installed? */
  const rpc = await api('/rest/v1/rpc/is_admin', {
    method: 'POST',
    body: '{}',
    headers: { prefer: 'params=single-object' },
  });
  const rpcText = JSON.stringify(rpc.body);
  if (rpc.status === 404 || /could not find the function|schema cache|PGRST202/i.test(rpcText)) {
    say(false, 'public.is_admin()', 'missing — run supabase/migrations/0004_admin.sql');
    process.exitCode = 1;
  } else if (rpc.status === 401 || rpc.status === 403 || rpc.body === false) {
    say(true, 'public.is_admin()', 'installed (anonymous callers are not admins, correctly)');
  } else {
    say('warn', 'public.is_admin()', `answered ${rpc.status}: ${rpcText.slice(0, 120)}`);
  }

  /* 4 — the account */
  const account = value('--account') || argv.find((a) => a.includes('@')) || env.ADMIN_EMAIL || '';
  const passwordFlag = flag('--password');
  let password = env.ADMIN_PASSWORD ?? '';
  if (passwordFlag && !password && stdin.isTTY) {
    const rl = createInterface({ input: stdin, output: stdout });
    password = await rl.question(`password for ${account}: `);
    rl.close();
  }

  if (!account) {
    say('warn', 'account', 'none given — pass an address, or set ADMIN_EMAIL');
  }
  let userId: string | null = null;
  if (password) {
    const signIn = await api('/auth/v1/token?grant_type=password', {
      method: 'POST',
      body: JSON.stringify({ email: account, password }),
    });
    if (signIn.status === 200) {
      userId = (signIn.body as { user?: { id?: string } })?.user?.id ?? null;
      const confirmed = Boolean((signIn.body as { user?: { email_confirmed_at?: string } })?.user?.email_confirmed_at);
      say(confirmed ? true : 'warn', `password for ${account}`, `${confirmed ? 'confirmed' : 'NOT confirmed'} · id ${userId ?? '?'}`);
    } else {
      const msg = String((signIn.body as { msg?: string; error_description?: string; message?: string })?.msg ?? '');
      const code = (signIn.body as { error_code?: string })?.error_code ?? '';
      say(false, `password for ${account}`, `${msg || 'refused'} ${code}`.trim());
      if (/email not confirmed/i.test(msg)) console.log('        → run: npm run admin:doctor -- --fix');
      if (/invalid/i.test(msg)) console.log('        → the address or password is wrong; nothing else can be checked');
      process.exitCode = 1;
      if (!flag('--fix')) return;
    }
  } else {
    say('warn', `password for ${account}`, 'not checked (add --password to be prompted, or set ADMIN_PASSWORD)');
  }

  if (!serviceKey || !account) {
    console.log('\nNo service key, so the roster cannot be inspected. Check it by hand:\n');
    console.log(`  select user_id, note from public.admin_users;`);
    if (userId) console.log(`\n  insert into public.admin_users (user_id, note) values ('${userId}', 'owner') on conflict do nothing;`);
    console.log('\nOr set SUPABASE_SERVICE_ROLE_KEY in .env (server-side only) and re-run.\n');
    return;
  }

  /* 5 — is the account on the roster? */
  const roster = await api('/rest/v1/admin_users?select=user_id,note', { key: serviceKey });
  if (roster.status !== 200) {
    say(false, 'read public.admin_users', `answered ${roster.status} — is 0004_admin.sql applied?`);
    process.exitCode = 1;
    return;
  }
  const rows = (roster.body as { user_id: string; note: string | null }[]) ?? [];
  say(true, 'read public.admin_users', `${rows.length} row${rows.length === 1 ? '' : 's'}`);

  if (!userId) {
    /* Without knowing the id, look the account up by email with the service key. */
    const found = await api(`/rest/v1/auth_users?select=id,email&email=eq.${encodeURIComponent(account)}`, { key: serviceKey });
    const viaAdmin = await fetch(`${url}/auth/v1/admin/users?filter=${encodeURIComponent(account)}`, {
      headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
    }).catch(() => null);
    const listed = viaAdmin && viaAdmin.ok
      ? ((await viaAdmin.json()) as { users?: { id: string; email?: string; email_confirmed_at?: string }[] }).users ?? []
      : [];
    const hit = listed.find((u) => (u.email ?? '').toLowerCase() === account.toLowerCase()) ?? listed[0];
    if (hit) {
      userId = hit.id;
      say(hit.email_confirmed_at ? true : 'warn', `account ${account}`,
        hit.email_confirmed_at ? `exists · id ${hit.id}` : `exists but email is NOT confirmed · id ${hit.id}`);
    } else {
      say(false, `account ${account}`, `no user with that address ${found.status >= 400 ? '(admin lookup unavailable)' : ''}`.trim());
      console.log('        → create it in Supabase → Authentication → Users → Add user');
      process.exitCode = 1;
      return;
    }
  }

  const onRoster = rows.some((r) => r.user_id === userId);
  say(onRoster, 'on the roster', onRoster ? 'yes — /admin should open' : 'no — this is why the desk stays shut');

  if (flag('--fix')) {
    console.log('\n--fix\n');
    if (userId) {
      const confirm = await fetch(`${url}/auth/v1/admin/users/${userId}`, {
        method: 'PUT',
        headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ email_confirm: true }),
      });
      say(confirm.ok, 'confirm the email', confirm.ok ? 'confirmed' : `answered ${confirm.status}`);
      const insert = await api('/rest/v1/admin_users', {
        method: 'POST',
        key: serviceKey,
        headers: { prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify([{ user_id: userId, note: 'owner' }]),
      });
      say(insert.status < 300, 'allowlist the account', insert.status < 300 ? 'row written' : `answered ${insert.status}`);
    }
    console.log('\nReload /admin. The desk opens for that account only.\n');
    return;
  }

  if (!onRoster && userId) {
    console.log('\nFix, one of these two ways:\n');
    console.log(`  insert into public.admin_users (user_id, note)\n  values ('${userId}', 'owner')\n  on conflict (user_id) do nothing;\n`);
    console.log('  or: npm run admin:doctor -- --fix\n');
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('\ndoctor failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
