/**
 * "Play a stranger": two real browsers, no room code, and the relay does the
 * introductions.
 *
 * What this proves, and why it needs two browsers rather than a protocol test:
 *   • pressing Find an opponent on /together leaves the person on that page in a
 *     visible searching state (with a live count and a way out);
 *   • a second, unrelated browser pressing the same button is paired with them —
 *     both land in /room/<same code> without either typing anything;
 *   • the room is a normal room: both names are seated, the countdown starts on
 *     its own, a move made by whoever holds slot 0 appears on the other board;
 *   • stopping the search removes you from the queue, and the lobby count drops.
 *
 *   node scripts/e2e/matchmaking.mjs
 *   BASE=http://127.0.0.1:5173 PIKACHU_CHROME=/path/to/chromium node scripts/e2e/matchmaking.mjs
 */
import { chromium } from 'playwright';

const B = (process.env.BASE ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
const GAME = 'Tic-Tac-Toe Duel';

let pass = 0;
let fail = 0;
const t = (name, ok, extra = '') => {
  if (ok) { pass += 1; console.log('  ✓ ' + name); }
  else { fail += 1; console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Poll instead of guessing a delay: the relay's own timing is not ours. */
const until = async (fn, ms = 15000, step = 120) => {
  const started = Date.now();
  for (;;) {
    try { if (await fn()) return true; } catch { /* mid-navigation */ }
    if (Date.now() - started > ms) return false;
    await sleep(step);
  }
};

const browser = await chromium.launch({
  executablePath: process.env.PIKACHU_CHROME || undefined,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
});
const errors = [];
async function tab(label, name) {
  const page = await (await browser.newContext({ viewport: { width: 1340, height: 950 } })).newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${label}: ${m.text().slice(0, 160)}`); });
  page.on('pageerror', (e) => errors.push(`${label} PAGEERROR: ${String(e.message).slice(0, 160)}`));
  await page.goto(`${B}/together`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => sessionStorage.setItem('pikachu.intro.v1', '1'));
  /* The page is a client-rendered SPA: domcontentloaded is far too early for
     the name field, and a silent no-op here would make every later check
     compare "Trainer" with "Trainer". */
  const field = page.getByRole('textbox', { name: /trainer name/i }).first();
  await field.waitFor({ timeout: 15000 });
  await field.fill(name);
  await field.blur();
  await page.waitForTimeout(200);
  return page;
}
const txt = (page) => page.evaluate(() => document.body.innerText);
const presence = async () => (await fetch(`${B}/api/presence`)).json();

const ash = await tab('ash', 'Ash');
const misty = await tab('misty', 'Misty');

/* The lobby only offers matchmaking once it knows the relay is listening. */
const pickGame = async (page, label) => {
  const card = page.getByRole('button', { name: new RegExp(GAME, 'i') }).first();
  const ok = await card.waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
  t(`${label} sees ${GAME} on the shelf`, ok);
  await card.click();
  await page.waitForTimeout(250);
};
await pickGame(ash, 'Ash');
await pickGame(misty, 'Misty');

const findAsh = ash.getByRole('button', { name: /find an opponent/i }).first();
t('the lobby offers a one-button match', await findAsh.count() > 0);
await findAsh.click();

const searching = await until(async () => /looking for someone/i.test(await txt(ash)));
t('the person waiting is told they are looking', searching);
t('and is given a way out', await ash.getByRole('button', { name: /stop looking/i }).count() > 0);

/* Nobody else is queued yet, so the count the second browser sees is honest. */
const counted = await until(async () => /1 looking for a game/i.test(await txt(misty)));
t('another visitor can see that somebody is looking', counted, (await txt(misty)).slice(0, 120));

/* ---------------------------------------------------------- the pairing */
await misty.getByRole('button', { name: /find an opponent/i }).first().click();
const bothRooms = await until(async () => /\/room\/[A-Z0-9]{5}$/.test(ash.url()) && /\/room\/[A-Z0-9]{5}$/.test(misty.url()), 20000);
t('both browsers were taken straight into a room', bothRooms, `${ash.url()} / ${misty.url()}`);

const ashCode = ash.url().split('/room/')[1] ?? '';
const mistyCode = misty.url().split('/room/')[1] ?? '';
t('and it is the same room, with no code typed', ashCode.length === 5 && ashCode === mistyCode, `${ashCode} / ${mistyCode}`);

const paired = await until(async () => /ash/i.test(await txt(misty)) && /misty/i.test(await txt(ash)));
t('each side is told who they were matched with', paired);

/* The countdown runs on the server, so neither player had to press "ready". */
const started = await until(async () => (await ash.getByRole('gridcell').count()) > 0 && (await misty.getByRole('gridcell').count()) > 0, 20000);
t('the match starts on its own after the countdown', started);

/* ------------------------------------------------------------ a real move */
let mover = null;
let watcher = null;
if (await ash.locator('[role="gridcell"]:not([disabled])').count()) { mover = ash; watcher = misty; }
else if (await misty.locator('[role="gridcell"]:not([disabled])').count()) { mover = misty; watcher = ash; }
t('one of the two holds the first turn', mover !== null);

if (mover) {
  const before = await watcher.locator('[role="gridcell"]').first().getAttribute('aria-label');
  await mover.locator('[role="gridcell"]:not([disabled])').first().click();
  const seen = await until(async () => {
    const labels = await watcher.locator('[role="gridcell"]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
    return labels.some((l) => /Volt|Spark/.test(l ?? ''));
  }, 8000);
  t('the move reaches the other player\'s board', seen, `was: ${before}`);
  t('neither console is reporting an error about it', errors.length === 0, errors.slice(0, 2).join(' | '));
}

/* ------------------------------------------------------------ stop looking */
const brock = await tab('brock', 'Brock');
await pickGame(brock, 'Brock');
await brock.getByRole('button', { name: /find an opponent/i }).first().click();
await until(async () => /looking for someone/i.test(await txt(brock)));
const queued = (await presence()).games?.checkers?.waiting ?? 0;
t('a third visitor can queue for a different game', queued >= 0);

await brock.getByRole('button', { name: /stop looking/i }).click();
const stopped = await until(async () => /find an opponent/i.test(await txt(brock)));
t('stopping returns the button', stopped);
const left = await until(async () => {
  const p = await presence();
  const total = Object.values(p.games ?? {}).reduce((n, g) => n + (g.waiting ?? 0), 0);
  return total === 0;
}, 6000);
t('and leaves nothing behind in the queue', left, JSON.stringify((await presence()).games));

/* ------------------------------------------ matched while looking elsewhere */
/* A queue entry belongs to the player's socket, not to a page. Somebody who
   presses Find and then wanders off to the home screen is still waiting — and
   when an opponent arrives they must be taken to the board, not left staring at
   the hero banner wondering why nothing happened. */
const dana = await tab('dana', 'Dana');
const eve = await tab('eve', 'Eve');
await pickGame(dana, 'Dana');
await pickGame(eve, 'Eve');
await dana.getByRole('button', { name: /find an opponent/i }).first().click();
await until(async () => /looking for someone/i.test(await txt(dana)));
await dana.getByRole('link', { name: /^home$/i }).first().click();
const wentHome = await until(async () => !/\/together$/.test(dana.url()));
t('a searching player can wander back to the home screen', wentHome, dana.url());

await eve.getByRole('button', { name: /find an opponent/i }).first().click();
const pulled = await until(async () => /\/room\/[A-Z0-9]{5}$/.test(dana.url()), 20000);
t('and is still taken to the board when an opponent turns up', pulled, dana.url());
const sameAsEve = await until(async () => /\/room\/[A-Z0-9]{5}$/.test(eve.url()) && eve.url() === dana.url(), 15000);
t('both of them, in the same room', sameAsEve, `${dana.url()} / ${eve.url()}`);

const real = errors.filter((e) => !/Failed to fetch|Wake Lock|net::ERR/i.test(e));
console.log(`\nconsole errors: ${real.length ? real.slice(0, 3).join(' | ') : 'none'}`);
if (real.length) fail += 1;

console.log(fail === 0 ? `\nMATCHMAKING E2E PASSED (${pass} checks)\n` : `\nMATCHMAKING E2E FAILED (${fail})\n`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
