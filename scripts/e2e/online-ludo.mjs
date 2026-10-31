/**
 * Two real browsers playing Ludo through the relay.
 *
 * The interesting part is that the dice belong to the server: a client can send
 * "roll" but it cannot send a number. So this checks that the die that appears is
 * the same in both tabs, that a token moved by one player shows up in the other,
 * and that the seat that is not on turn cannot act.
 *
 *   BASE=http://127.0.0.1:5173 PIKACHU_CHROME=/tmp/chromium PIKACHU_LD=/tmp/nss \
 *     node scripts/e2e/online-ludo.mjs
 */
import { chromium } from 'playwright';

const B = process.env.BASE || 'http://127.0.0.1:5173';
let pass = 0, fail = 0;
const t = (n, c, extra = '') => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (extra ? ' — ' + extra : ''))); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 15000, step = 150) => {
  const t0 = Date.now();
  for (;;) {
    try { if (await fn()) return true; } catch { /* mid-navigation */ }
    if (Date.now() - t0 > ms) return false;
    await sleep(step);
  }
};

const browser = await chromium.launch({
  executablePath: process.env.PIKACHU_CHROME || undefined,
  args: ['--no-sandbox'],
  env: process.env.PIKACHU_LD ? { ...process.env, LD_LIBRARY_PATH: process.env.PIKACHU_LD } : undefined,
});
const errs = [];
async function tab(label) {
  const p = await (await browser.newContext({ viewport: { width: 1280, height: 950 } })).newPage();
  p.on('console', (m) => { if (m.type() === 'error') errs.push(`${label}: ${m.text()}`); });
  p.on('pageerror', (e) => errs.push(`${label} PAGEERROR: ${e.message}`));
  await p.goto(B + '/');
  await p.evaluate(() => sessionStorage.setItem('pikachu.intro.v1', '1'));
  return p;
}
const bodyText = (p) => p.evaluate(() => document.body.innerText);

const host = await tab('host');
const guest = await tab('guest');

await host.goto(B + '/together');
await host.waitForTimeout(1800);
const picker = host.getByRole('button', { name: /Ludo Royale/i }).first();
t('Ludo is offered in Play Together', (await picker.count()) > 0);
if (await picker.count()) await picker.click();
await host.waitForTimeout(400);
const createBtn = host.getByRole('button', { name: 'Create private room', exact: true });
t('a room can be created', (await createBtn.count()) > 0);
await createBtn.click();
await host.waitForTimeout(2400);
const code = await host.getAttribute('[data-room-code]', 'data-room-code');
t('host got a room code', !!code, String(code));

await guest.goto(`${B}/room/${code}`);
await guest.waitForTimeout(2500);
t('guest reached the lobby', /ludo/i.test(await bodyText(guest)));

for (const p of [host, guest]) {
  const r = p.getByRole('button', { name: /^(I'm )?ready/i }).first();
  if (await r.count()) { await r.click(); await p.waitForTimeout(600); }
}
await host.waitForTimeout(700);
const start = host.getByRole('button', { name: /^start/i }).first();
if (await start.count() && await start.isEnabled()) await start.click();

const boardReady = (p) => p.locator('canvas[data-ludo-board]').count();
t('the board is on screen for the host', await until(async () => (await boardReady(host)) > 0));
t('the board is on screen for the guest', await until(async () => (await boardReady(guest)) > 0));

const attr = async (p, name) => p.$eval('canvas[data-ludo-board]', (el, n) => el.getAttribute(n), name);
const tokens = async (p) => JSON.parse(await attr(p, 'data-ludo-tokens'));

t('both players start with every token in its yard', (await tokens(host)).flat().every((v) => v === -1) && (await tokens(guest)).flat().every((v) => v === -1));

// the host rolls; the number must be the same in both tabs
const rollBtn = host.getByRole('button', { name: /^Roll$/ }).first();
t('the player on turn is offered a roll', await until(async () => (await rollBtn.count()) > 0));
await rollBtn.click();
const diceShown = await until(async () => (await attr(host, 'data-ludo-dice')) !== '');
t('the server rolled a die', diceShown, String(await attr(host, 'data-ludo-dice')));
const dice = await attr(host, 'data-ludo-dice');
t('the same number appears for both players', await until(async () => (await attr(guest, 'data-ludo-dice')) === dice), `host=${dice} guest=${await attr(guest, 'data-ludo-dice')}`);
t('the number is a real die', /^[1-6]$/.test(String(dice)), String(dice));

// the guest must not be able to roll out of turn
const guestRoll = guest.getByRole('button', { name: /^Roll$/ }).first();
t('the seat out of turn is not offered a roll', (await guestRoll.count()) === 0);

// play the host's turn if the roll allows it, then check the guest sees the board change
const hits = JSON.parse((await attr(host, 'data-ludo-hits')) || '[]');
if (hits.length) {
  const box = await host.$eval('canvas[data-ludo-board]', (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width };
  });
  const cell = (box.w * (1 - 0.07)) / 15;
  const x = box.x + box.w * 0.035 + hits[0].gx * cell;
  const y = box.y + box.w * 0.035 + hits[0].gy * cell;
  await host.mouse.click(x, y);
  t('the tokens moved for the player', await until(async () => (await tokens(host)).flat().some((v) => v >= 0)));
  t('the other player sees the same board', await until(async () => JSON.stringify(await tokens(host)) === JSON.stringify(await tokens(guest))), JSON.stringify(await tokens(guest)));
} else {
  const pass = host.getByRole('button', { name: /Nothing to move/ }).first();
  t('a roll with nothing to move offers a pass', (await pass.count()) > 0);
  if (await pass.count()) await pass.click();
  t('the turn passes to the other player', await until(async () => (await guest.getByRole('button', { name: /^Roll$/ }).count()) > 0));
}

t('no console errors', errs.length === 0, errs.slice(0, 3).join(' / '));
console.log(`\n${pass} passed, ${fail} failed`);
await host.screenshot({ path: '/tmp/sheets/ludo-online.png' });
await browser.close();
process.exit(fail ? 1 : 0);
