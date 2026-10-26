/**
 * `npm run admin:doctor` — find out why the admin desk will not open, and fix it.
 *
 * The browser can only tell you what it was built with. This script can see the
 * other side of the project: whether it answers, whether the account exists at
 * all, at *which* address, whether that address is confirmed, and whether the
 * roster lists it. It reads the same `.env` the app builds with (plus
 * `.env.local`), prints no secret — the key is reported by *kind*, never by
 * value — and changes nothing unless you ask it to.
 *
 *   npm run admin:doctor                    diagnose
 *   npm run admin:doctor -- --users          list the project's accounts
 *   npm run admin:doctor -- --fix            confirm the email + allowlist an existing account
 *   npm run admin:doctor -- --setup          create-or-repair the account, confirm, allowlist
 *        ... -- --setup --generate           and mint a password, printed once
 *        ... -- --password                   and be prompted for one (TTY only)
 *
 * Two credentials, deliberately separate. `SUPABASE_SERVICE_ROLE_KEY` stays
 * **server-side**: it is what lets the doctor look up users, confirm an email or
 * write the roster row, and it must never appear in a `VITE_` variable where the
 * browser would ship it to everyone. The account's password is never read from a
 * file — only from a TTY prompt or `ADMIN_PASSWORD` in the environment, and it is
 * never written anywhere.
 */
import { createInterface } from 'node:readline/promises';
import { readFileSync, existsSync } from 'node:fs';
import { stdin, stdout } from 'node:process';

import { addressFor, isEmailLike } from '../src/lib/authAddress';
import {
  describeAccount,
  findAccount,
  generatePassword,
  nearMisses,
  type AccountRow,
} from '../src/lib/adminAccounts';

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

/** Classify a key without printing it: the prefix tells you what it is. */
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

/** Every account on the project, as far as the admin API will page. */
async function listUsers(limit = 1000): Promise<AccountRow[] | null> {
  const rows: AccountRow[] = [];
  for (let page = 1; rows.length < limit; page += 1) {
    const res = await api(`/auth/v1/admin/users?page=${page}&per_page=200`, { key: serviceKey });
    if (res.status !== 200) {
      say(false, 'list accounts', `answered ${res.status} — is the service key the right role?`);
      return null;
    }
    const users = ((res.body as { users?: unknown[] })?.users ?? res.body ?? []) as {
      id: string; email?: string; email_confirmed_at?: string | null; created_at?: string | null;
    }[];
    if (!users.length) break;
    for (const u of users) {
      rows.push({ id: u.id, email: u.email ?? null, confirmed: Boolean(u.email_confirmed_at), createdAt: u.created_at ?? null });
    }
    if (users.length < 200) break;
  }
  return rows;
}

async function readRoster(): Promise<Set<string> | null> {
  const res = await api('/rest/v1/admin_users?select=user_id,note', { key: serviceKey });
  if (res.status !== 200) {
    say(false, 'read public.admin_users', `answered ${res.status} — is 0004_admin.sql applied?`);
    return null;
  }
  return new Set(((res.body as { user_id: string }[]) ?? []).map((r) => r.user_id));
}

async function promptPassword(label: string): Promise<string | null> {
  if (!stdin.isTTY) return null;
  const rl = createInterface({ input: stdin, output: stdout });
  const answer = await rl.question(label);
  rl.close();
  return answer.trim() || null;
}

async function main() {
  console.log('\nPikachu admin doctor\n');

  /* 1 — configuration */
  say(Boolean(url), 'VITE_SUPABASE_URL', url || 'not set (copy .env.example to .env)');
  const anonKind = keyKind(anonKey);
  const anonOk = Boolean(anonKey) && anonKind !== 'secret (service-role class)' && anonKind !== 'missing';
  say(anonOk, 'publishable key', anonOk ? anonKind : `${anonKind} — the browser refuses secret keys`);
  say(serviceKey ? true : 'warn', 'service key (server only)', serviceKey ? keyKind(serviceKey) : 'not set — diagnosis is limited to public endpoints');
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

  /* 4 — which account is this supposed to be? */
  const account = (value('--account') || argv.find((a) => a.includes('@')) || env.ADMIN_EMAIL || '').trim();
  if (!account) {
    say('warn', 'account', 'none given — pass an address, set ADMIN_EMAIL, or use --users');
  } else {
    say(isEmailLike(account) ? true : 'warn', 'account', isEmailLike(account)
      ? account
      : `${account} is not an address — a username lives at ${addressFor(account)}`);
  }

  /* 5 — read the project. Without the service key, this is where the script stops
         being able to answer the actual question, so it says so and prints the
         dashboard steps instead of guessing. */
  if (!serviceKey) {
    console.log('\nWithout a service key the account list is not readable. Two ways forward:\n');
    console.log('  a) Supabase dashboard → Authentication → Users.');
    console.log('     That list is the answer: look for the exact address you typed, and whether');
    console.log('     the row says "Confirmed". If it is not there, the account does not exist.');
    console.log('\n  b) Put SUPABASE_SERVICE_ROLE_KEY (Project Settings → API → service_role) in .env');
    console.log('     and re-run. It is server-side only: never prefix it with VITE_, never commit it.\n');
    if (account) {
      console.log('  Once the account exists, allowlist it (copy the id from that same list):\n');
      console.log('    insert into public.admin_users (user_id, note)');
      console.log("    values ('paste-the-user-id', 'owner')");
      console.log('    on conflict (user_id) do nothing;\n');
      console.log('  Id, not email: an email that is spelled differently inserts nothing and');
      console.log('  reports success, which is how this becomes a mystery later.\n');
    }
    return;
  }

  const roster = await readRoster();
  const users = await listUsers();
  if (!users || !roster) { process.exitCode = 1; return; }
  for (const user of users) user.admin = roster.has(user.id);
  say(true, 'accounts', `${users.length} on this project · ${roster.size} on the roster`);

  const rosterButGone = [...roster].filter((id) => !users.some((u) => u.id === id));

  if (flag('--users') || !account) {
    console.log('');
    if (!users.length) say('warn', 'no accounts at all', 'create one below, or in Authentication → Users');
    for (const user of users) console.log(`        ${describeAccount(user)}`);
    if (rosterButGone.length) {
      say('warn', 'roster rows with no account', `${rosterButGone.length} — stale ids in public.admin_users`);
    }
    if (!account) {
      console.log('\nPass an address to check it: npm run admin:doctor -- you@example.com\n');
      return;
    }
  }

  const exact = findAccount(users, account);
  const misses = nearMisses(users, account);

  if (!exact) {
    say(false, `account ${account}`, 'does not exist on this project');
    if (misses.length) {
      console.log('\n        The closest accounts here are:\n');
      for (const user of misses) console.log(`          ${describeAccount(user)}`);
      console.log('\n        An address has to match exactly — a different spelling, a +tag or a');
      console.log('        different project all look like "invalid login credentials".\n');
    }
  } else {
    say(true, `account ${account}`, `exists · ${exact.confirmed ? 'confirmed' : 'EMAIL NOT CONFIRMED'} · id ${exact.id}`);
    say(Boolean(exact.admin), 'on the roster', exact.admin ? 'yes — /admin should open' : 'no — this is why the desk stays shut');
  }

  /* 6 — the password, if one was offered. Only the exact address can be tested. */
  const wanted = flag('--password') || flag('--setup');
  let password = env.ADMIN_PASSWORD ?? '';
  if (!flag('--generate') && wantHelpForPassword(wanted, password)) {
    password = await promptPassword(`password for ${account} (leave blank to generate): `) ?? '';
  }
  if (flag('--generate') && !password) password = generatePassword();

  if (password && exact && !flag('--setup')) {
    const signIn = await api('/auth/v1/token?grant_type=password', {
      method: 'POST',
      body: JSON.stringify({ email: exact.email, password }),
    });
    if (signIn.status === 200) say(true, 'password', 'accepted');
    else {
      const body = signIn.body as { msg?: string; error_code?: string; error_description?: string };
      const msg = String(body?.msg ?? body?.error_description ?? '');
      say(false, 'password', `${msg || 'refused'} ${body?.error_code ?? ''}`.trim());
      if (/not confirmed/i.test(msg)) console.log('        → npm run admin:doctor -- --fix');
      if (/invalid/i.test(msg)) console.log('        → npm run admin:doctor -- --setup --password   (set a new one)');
      process.exitCode = 1;
    }
  }

  /* 7 — --setup: make the account exist, work, and be on the roster. */
  if (flag('--setup')) {
    console.log('\n--setup\n');
    if (!account || !isEmailLike(account)) {
      say(false, 'account', 'a real email address is needed to create one');
      process.exitCode = 1;
      return;
    }
    let id = exact?.id ?? null;

    if (!id) {
      if (!password) {
        say(false, 'create the account', 'no password supplied — add --generate, or --password to be prompted');
        process.exitCode = 1;
        return;
      }
      const created = await api('/auth/v1/admin/users', {
        method: 'POST',
        key: serviceKey,
        body: JSON.stringify({
          email: account,
          password,
          email_confirm: true,
          user_metadata: { display_name: account.split('@')[0] },
        }),
      });
      const createdId = (created.body as { id?: string })?.id ?? null;
      if (created.status < 300 && createdId) {
        id = createdId;
        say(true, 'create the account', `id ${id}, email confirmed`);
      } else {
        say(false, 'create the account', `answered ${created.status}: ${JSON.stringify(created.body).slice(0, 160)}`);
        process.exitCode = 1;
        return;
      }
    } else {
      const patch: Dict = { email_confirm: true };
      if (password) patch.password = password;
      const updated = await api(`/auth/v1/admin/users/${id}`, {
        method: 'PUT',
        key: serviceKey,
        body: JSON.stringify(patch),
      });
      say(updated.status < 300, 'repair the account',
        updated.status < 300
          ? `${password ? 'new password set, ' : ''}email confirmed`
          : `answered ${updated.status}: ${JSON.stringify(updated.body).slice(0, 160)}`);
      if (updated.status >= 300) { process.exitCode = 1; return; }
    }

    const insert = await api('/rest/v1/admin_users', {
      method: 'POST',
      key: serviceKey,
      headers: { prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify([{ user_id: id, note: 'owner' }]),
    });
    say(insert.status < 300, 'allowlist the account', insert.status < 300 ? 'row written' : `answered ${insert.status}`);

    /* Prove it instead of assuming it: sign in as the account with the anon key. */
    if (password) {
      const check = await api('/auth/v1/token?grant_type=password', {
        method: 'POST',
        body: JSON.stringify({ email: account, password }),
      });
      say(check.status === 200, 'sign in as it', check.status === 200 ? 'works' : `answered ${check.status}`);
    }

    console.log(`\nOpen /admin and sign in as ${account}${password ? '' : ' (password unchanged)'}.`);
    if (password && flag('--generate')) {
      console.log(`\n  password: ${password}\n`);
      console.log('  Shown once, stored nowhere. Put it in a password manager now.\n');
    } else {
      console.log('');
    }
    return;
  }

  /* 8 — --fix: the narrower repair, for an account that exists. */
  if (flag('--fix')) {
    console.log('\n--fix\n');
    if (!exact) {
      say(false, 'fix', 'there is no account to repair — use --setup to create one');
      process.exitCode = 1;
      return;
    }
    const confirm = await api(`/auth/v1/admin/users/${exact.id}`, {
      method: 'PUT',
      key: serviceKey,
      body: JSON.stringify({ email_confirm: true }),
    });
    say(confirm.status < 300, 'confirm the email', confirm.status < 300 ? 'confirmed' : `answered ${confirm.status}`);
    const insert = await api('/rest/v1/admin_users', {
      method: 'POST',
      key: serviceKey,
      headers: { prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify([{ user_id: exact.id, note: 'owner' }]),
    });
    say(insert.status < 300, 'allowlist the account', insert.status < 300 ? 'row written' : `answered ${insert.status}`);
    console.log('\nReload /admin. The desk opens for that account only.\n');
    return;
  }

  /* 9 — nothing was asked for: print the exact next command. */
  if (!exact) {
    console.log('\nThe account has to exist before it can be allowlisted:\n');
    console.log(`  npm run admin:doctor -- --setup ${account} --generate\n`);
    console.log('  or add it in Supabase → Authentication → Users → Add user, then:');
    console.log(`  npm run admin:doctor -- --fix --account ${account}\n`);
    process.exitCode = 1;
    return;
  }
  if (!exact.admin) {
    console.log('\nThe account exists but is not allowlisted. Fix:\n');
    console.log(`  npm run admin:doctor -- --fix --account ${account}\n`);
    console.log(`  or: insert into public.admin_users (user_id, note) values ('${exact.id}', 'owner')`);
    console.log('      on conflict (user_id) do nothing;\n');
    process.exitCode = 1;
    return;
  }
  if (!exact.confirmed) {
    console.log('\nThe email is not confirmed, so no session can be issued. Fix:\n');
    console.log(`  npm run admin:doctor -- --fix --account ${account}\n`);
    process.exitCode = 1;
    return;
  }
  console.log('\nEverything checks out: the account exists, is confirmed and is on the roster.');
  console.log('Sign in at /admin. If the password is refused, set a new one:\n');
  console.log(`  npm run admin:doctor -- --setup ${account} --generate\n`);
}

/** A password is needed for --setup, or was explicitly asked for. */
function wantHelpForPassword(asked: boolean, supply: string): boolean {
  if (supply || !asked) return false;
  return stdin.isTTY;
}

main().catch((error) => {
  console.error('\ndoctor failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
