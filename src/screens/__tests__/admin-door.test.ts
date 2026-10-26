// @vitest-environment jsdom
/**
 * The admin door, as a person sees it.
 *
 * The unit suite proves the error mapping. This drives the actual screen,
 * because the failure the bug report described was not a wrong mapping — it was
 * a *dead end*: a red line with no cause and no next step. Each test therefore
 * asserts what the page says and what it offers, not just which branch ran.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { StoreProvider } from '../../lib/store';

const state = {
  configured: true,
  signIn: vi.fn(),
  getUser: vi.fn(),
  rpc: vi.fn(),
  signOut: vi.fn(),
};

vi.mock('../../lib/supabase', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/supabase')>();
  return {
  ...actual,
  supabaseEnabled: () => state.configured,
  supabaseConfigState: () => ({
    configured: state.configured,
    hasUrl: state.configured,
    hasKey: state.configured,
    secretRefused: false,
    projectHost: state.configured ? 'demo.supabase.co' : null,
  }),
  supabase: async () => ({
    auth: {
      signInWithPassword: state.signIn,
      getUser: state.getUser,
      signOut: state.signOut,
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    rpc: state.rpc,
    from: () => ({ select: async () => ({ data: [], error: null }) }),
    storage: { from: () => ({ remove: async () => ({ error: null }), upload: async () => ({ error: null }), getPublicUrl: () => ({ data: { publicUrl: '' } }) }) },
  }),
  signOut: vi.fn(async () => {}),
  usernameToEmail: (u: string) => `${u.toLowerCase()}@pikachu.arcade`,
  };
});

let host: HTMLDivElement;
let root: Root;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  /* jsdom has no layout; the panel is happy with the defaults. */
  window.matchMedia = window.matchMedia || ((q: string) => ({
    matches: false, media: q, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  } as unknown as MediaQueryList));
});

const flush = async () => {
  for (let i = 0; i < 12; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};

async function mount() {
  const { default: Admin } = await import('../Admin');
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root.render(
      createElement(StoreProvider, null, createElement(MemoryRouter, null, createElement(Admin))),
    );
  });
  await flush();
}

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove();
  state.configured = true;
  state.signIn.mockReset();
  state.getUser.mockReset();
  state.rpc.mockReset();
  document.body.innerHTML = '';
});

const text = () => document.body.textContent ?? '';

async function signInWith(account: string, password: string) {
  const inputs = Array.from(document.querySelectorAll('input'));
  const set = (el: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  await act(async () => { set(inputs[0], account); set(inputs[1], password); });
  const form = document.querySelector('form')!;
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await flush();
}

describe('/admin door', () => {
  it('names the missing environment variable instead of "not wired up"', async () => {
    state.configured = false;
    await mount();
    const t = text();
    expect(t).toContain('no Supabase project');
    expect(t).toContain('VITE_SUPABASE_URL');
    expect(t).toContain('VITE_SUPABASE_PUBLISHABLE_KEY');
  });

  it('shows the form, the project, and how a bare username is read', async () => {
    state.getUser.mockResolvedValue({ data: { user: null } });
    await mount();
    expect(text()).toContain('Sign in to continue');
    expect(text()).toContain('demo.supabase.co');
    expect(text()).toContain('name@pikachu.arcade');
  });

  it('says the password and the address did not match — and which address was tried', async () => {
    state.getUser.mockResolvedValue({ data: { user: null } });
    state.signIn.mockResolvedValue({ data: { user: null }, error: { message: 'Invalid login credentials', status: 400 } });
    await mount();
    await signInWith('Razal', 'wrong');
    const t = text();
    expect(t).toContain('do not match an account');
    expect(t).toMatch(/razal@pikachu\.arcade/);
    /* Still on the form: a failed attempt must not look like a refusal. */
    expect(t).toContain('Sign in to continue');
  });

  it('tells you to confirm an unconfirmed email, not to try again', async () => {
    state.getUser.mockResolvedValue({ data: { user: null } });
    state.signIn.mockResolvedValue({ data: { user: null }, error: { message: 'Email not confirmed', code: 'email_not_confirmed' } });
    await mount();
    await signInWith('razalpa64@gmail.com', 'Razal@2006');
    expect(text()).toContain('has not confirmed its email');
    expect(text()).toContain('--fix');
  });

  it('hands over the exact SQL when the account is not on the roster', async () => {
    state.getUser.mockResolvedValue({ data: { user: null } });
    state.signIn.mockResolvedValue({ data: { user: { id: 'u-9', email: 'razalpa64@gmail.com', user_metadata: { display_name: 'Razal' } } }, error: null });
    state.rpc.mockResolvedValue({ data: false, error: null });
    await mount();
    await signInWith('razalpa64@gmail.com', 'Razal@2006');
    const t = text();
    expect(t).toContain('not on the roster');
    expect(t).toContain("insert into public.admin_users");
    expect(t).toContain("'u-9'");
    expect(t).toContain('Sign in as someone else');
  });

  it('reports a missing migration as an unfinished install, not as a refusal', async () => {
    state.getUser.mockResolvedValue({ data: { user: { id: 'u-9', email: 'a@b.c', user_metadata: {} } } });
    state.rpc.mockResolvedValue({ data: null, error: { message: 'Could not find the function public.is_admin', code: 'PGRST202' } });
    await mount();
    const t = text();
    expect(t).toContain('admin schema is not installed');
    expect(t).toContain('0004_admin.sql');
    /* The misleading sentence must be gone. */
    expect(t).not.toContain('not on the roster');
  });

  it('opens the desk for a roster account', async () => {
    state.getUser.mockResolvedValue({ data: { user: { id: 'u-1', email: 'razalpa64@gmail.com', user_metadata: { display_name: 'Razal' } } } });
    state.rpc.mockResolvedValue({ data: true, error: null });
    await mount();
    expect(text()).not.toContain('Sign in to continue');
    expect(text()).toMatch(/Razal/);
  });
});
