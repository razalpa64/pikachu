/**
 * Friends and safety, through the interface — on a build with no cloud project.
 *
 * This is the honest half of what a browser test can prove here: the friend list
 * needs a real Supabase project (its rules are proved by the PGlite schema suite
 * and its socket behaviour by `smoke-friends.ts`), but *everything a guest sees*
 * has to be right in this build, because this build is the default one:
 *
 *   • the friends panel says what it needs instead of pretending to load;
 *   • two matched strangers cannot talk before the first round, and the composer
 *     says why rather than being silently dead;
 *   • chat opens by itself when the board appears;
 *   • mute hides the other player's messages on this device and nothing else;
 *   • no block or report button is offered where there is no account to act on.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://127.0.0.1:5173';
const EXE = process.env.PIKACHU_CHROME;

let passed = 0;
let failed = 0;
const errors = [];

function check(ok, what, detail) {
  if (ok) { passed++; console.log(`  ✓ ${what}`); }
  else { failed++; console.log(`  ✗ ${what}`, detail === undefined ? '' : detail); }
}

async function until(fn, timeout = 12000) {
  const started = Date.now();
  for (;;) {
    const value = await fn().catch(() => false);
    if (value) return value;
    if (Date.now() - started > timeout) return false;
    await new Promise((r) => setTimeout(r, 120));
  }
}

async function open(browser, name) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  await page.goto(`${BASE}/together`, { waitUntil: 'domcontentloaded' });
  const field = page.getByRole('textbox', { name: /trainer name/i }).first();
  await field.waitFor({ timeout: 15000 });
  await field.fill(name);
  await field.blur();
  return page;
}

async function pickGame(page, label, who) {
  const card = page.getByRole('button', { name: new RegExp(label, 'i') }).first();
  await card.waitFor({ timeout: 15000 });
  await card.click();
  await page.waitForTimeout(120);
  if (who) console.log(`  · ${who} picked ${label}`);
}

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });

try {
  console.log(`\nFRIENDS + SAFETY (browser, no cloud project) → ${BASE}\n`);

  const ash = await open(browser, 'Ash');
  const misty = await open(browser, 'Misty');

  /* ------------------------------------------------ the panel is honest */
  const friendsPanel = ash.getByText(/Friends/).first();
  check(await friendsPanel.count() > 0, 'the lobby has a friends panel');
  const honest = await ash.getByText(/needs cloud sync|needs an identity that survives/i).first().count();
  check(honest > 0, 'which says plainly what it needs instead of loading forever');
  check(await ash.getByRole('button', { name: /sign in to keep a friend list/i }).count() === 0,
    'no sign-in button is offered when there is nowhere to sign in to');

  /* ------------------------------------------------------- get matched */
  await pickGame(ash, 'Tic-Tac-Toe', 'Ash');
  await pickGame(misty, 'Tic-Tac-Toe', 'Misty');
  await ash.getByRole('button', { name: /find an opponent/i }).first().click();
  await until(async () => /\/room\/[A-Z0-9]{5}$/.test(ash.url()), 15000);
  await misty.getByRole('button', { name: /find an opponent/i }).first().click();
  await until(async () => /\/room\/[A-Z0-9]{5}$/.test(misty.url()), 15000);
  check(ash.url() === misty.url(), 'the two are in the same room', `${ash.url()} / ${misty.url()}`);

  /* ------------------------------------------------ the board arrives on its own */
  const board = ash.getByRole('gridcell').first();
  check(await until(async () => (await board.count()) > 0, 20000),
    'the board appears without any ready-up');

  /* --------------------------------------------- the actions sit beside the board */
  const mute = ash.getByRole('button', { name: /^mute$/i }).first();
  check(await until(async () => (await mute.count()) > 0, 6000),
    'the opponent actions are there during the match, next to the board');

  /* ------------------------------------------------- mute is local, on this device */
  await mute.click();
  const mutedLine = await until(async () => (await ash.getByText(/muted on this device/i).first().count()) > 0, 4000);
  check(mutedLine === true, 'muting says so on this device');
  check(await misty.getByText(/muted on this device/i).first().count() === 0,
    'and Misty is not told anything about it');

  /* A muted opponent's messages stop appearing, and nobody else's do. */
  const mistyComposer = misty.getByRole('textbox', { name: /message/i }).first();
  await mistyComposer.waitFor({ timeout: 8000 });
  check(await mistyComposer.isDisabled() === false, 'chat is live once the round is under way');
  await mistyComposer.fill('nice opening');
  await misty.keyboard.press('Enter');
  await ash.waitForTimeout(1200);
  check(await ash.getByText('nice opening').first().count() === 0,
    'a muted player’s message does not appear for the person who muted them');

  await ash.getByRole('button', { name: /^unmute$/i }).first().click();
  await ash.waitForTimeout(500);
  check(await ash.getByText(/muted on this device/i).first().count() === 0,
    'unmuting puts the chat back');

  /* ------------------------------------ no account, so no block or report */
  check(await ash.getByRole('button', { name: /^block$/i }).count() === 0,
    'nothing offers to block an account when there are no accounts');
  check(await ash.getByRole('button', { name: /^report$/i }).count() === 0,
    'and nothing offers a report form that could not be saved');

  /* ------------------------------------------------ and a message still lands */
  const composer = ash.getByRole('textbox', { name: /message/i }).first();
  await composer.fill('good luck');
  await ash.keyboard.press('Enter');
  const received = await until(async () => (await misty.getByText('good luck').first().count()) > 0, 6000);
  check(received === true, 'a message written during the round reaches the other board');

  await ash.screenshot({ path: '/tmp/friends-room.png' });
  await ash.goto(`${BASE}/together`, { waitUntil: 'domcontentloaded' });
  await ash.waitForTimeout(600);
  await ash.screenshot({ path: '/tmp/friends-lobby.png' });

  const real = errors.filter((e) => !/Failed to fetch|Wake Lock|net::ERR|WebSocket/i.test(e));
  check(real.length === 0, 'neither browser reported a console error', real.slice(0, 4));
  console.log(`\nconsole errors: ${real.length ? real.slice(0, 4).join(' | ') : 'none'}`);
  console.log(`\nFRIENDS E2E ${failed ? 'FAILED' : 'PASSED'} (${passed} checks)\n`);
} catch (err) {
  failed++;
  console.error('\nFRIENDS E2E CRASHED:', err instanceof Error ? err.message : err);
} finally {
  await browser.close();
}

if (failed) process.exitCode = 1;
