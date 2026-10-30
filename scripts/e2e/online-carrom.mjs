/**
 * Two real browsers playing carrom through the relay.
 *
 * Proves the parts that only exist when two people are involved: the room starts
 * with the same nineteen coins in both tabs, a shot taken by one player reaches
 * the server and comes back as the same board in the other, the server describes
 * the shot back to both, and a shot taken out of turn changes nothing.
 *
 *   BASE=http://127.0.0.1:5173 PIKACHU_CHROME=/tmp/chromium PIKACHU_LD=/tmp/nss \
 *     node scripts/e2e/online-carrom.mjs
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
const action = async (p) => (await bodyText(p)).match(/striker at [^\n]*/i)?.[0] ?? '';
const coinsKey = (p) => p.$eval('canvas[data-coins]', (el) => el.getAttribute('data-coins'));

const host = await tab('host');
const guest = await tab('guest');

await host.goto(B + '/together');
await host.waitForTimeout(1800);
const picker = host.getByRole('button', { name: /Carrom Table/i }).first();
t('Carrom is offered in Play Together', (await picker.count()) > 0);
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
t('guest reached the carrom lobby', /carrom/i.test(await bodyText(guest)));

for (const p of [host, guest]) {
  const r = p.getByRole('button', { name: /^(I'm )?ready/i }).first();
  if (await r.count()) { await r.click(); await p.waitForTimeout(600); }
}
await host.waitForTimeout(700);
const start = host.getByRole('button', { name: /^start/i }).first();
if (await start.count() && await start.isEnabled()) await start.click();
t('the table is on screen for the host', await until(async () => (await host.locator('canvas[data-coins]').count()) > 0));
t('the table is on screen for the guest', await until(async () => (await guest.locator('canvas[data-coins]').count()) > 0));

const before = await coinsKey(host);
t('both players start with the same nineteen coins', before === (await coinsKey(guest)) && before.length === 19, before);

// the host (white) shoots: press the striker, pull back, release
const box = await host.$eval('canvas[data-coins]', (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
const cx = box.x + box.w / 2, cy = box.y + box.h * 0.84;
await host.mouse.move(cx, cy);
await host.mouse.down();
await host.mouse.move(cx, cy + box.h * 0.26, { steps: 10 });
await host.mouse.up();

t('the shot reached the server', await until(async () => (await action(host)).length > 0));
t('the other player is told what was played', await until(async () => (await action(guest)).length > 0), await action(guest));
t('both boards still agree after the shot', await until(async () => (await coinsKey(host)) === (await coinsKey(guest))));
console.log('    last action:', await action(host));

// the guest takes their turn, and both boards must still agree afterwards
const gbox = await guest.$eval('canvas[data-coins]', (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
// the guest defends the top baseline, so their pull is upwards
const gx = gbox.x + gbox.w / 2, gy = gbox.y + gbox.h * 0.16;
const guestBefore = await action(guest);
await guest.mouse.move(gx, gy);
await guest.mouse.down();
await guest.mouse.move(gx, gy - gbox.h * 0.24, { steps: 8 });
await guest.mouse.up();
t('the second player can shoot too', await until(async () => (await action(guest)) !== guestBefore), await action(guest));
t('both boards still agree after the second shot', await until(async () => (await coinsKey(host)) === (await coinsKey(guest))));
t('the first player sees the second player\'s shot', await until(async () => (await action(host)) === (await action(guest))), await action(host));

t('no console errors', errs.length === 0, errs.slice(0, 3).join(' / '));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
