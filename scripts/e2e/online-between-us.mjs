/**
 * BETWEEN US — two real browsers in the signal room.
 *
 * This is the test that matters for a co-op game: that the two players really
 * do hold different halves of the puzzle. The listener's tab knows the glyphs
 * and not the digits; the operator's tab knows the digits and not the glyphs;
 * and between them, over the wire, they can carry the frequency.
 *
 *   BASE=http://127.0.0.1:5173 PIKACHU_CHROME=/tmp/chromium PIKACHU_LD=/tmp/nss \
 *     node scripts/e2e/online-between-us.mjs
 */
import { chromium } from 'playwright';

const B = process.env.BASE || 'http://127.0.0.1:5173';
let pass = 0, fail = 0;
const t = (n, c, extra = '') => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (extra ? ' — ' + extra : ''))); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, step = 150) => {
  const t0 = Date.now();
  for (;;) {
    try { if (await fn()) return true; } catch { /* mid-navigation */ }
    if (Date.now() - t0 > ms) return false;
    await sleep(step);
  }
};

const browser = await chromium.launch({
  executablePath: process.env.PIKACHU_CHROME || undefined,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  env: process.env.PIKACHU_LD ? { ...process.env, LD_LIBRARY_PATH: process.env.PIKACHU_LD } : undefined,
});
const errs = [];
async function tab(label) {
  const p = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  p.on('console', (m) => { if (m.type() === 'error') errs.push(`${label}: ${m.text()}`); });
  p.on('pageerror', (e) => errs.push(`${label} PAGEERROR: ${e.message}`));
  await p.goto(B + '/');
  await p.evaluate(() => sessionStorage.setItem('pikachu.intro.v1', '1'));
  return p;
}
const attr = (p, name) => p.$eval('canvas[data-between-us]', (el, n) => el.getAttribute(n), name);
const boardThere = (p) => p.locator('canvas[data-between-us]').count();

const host = await tab('host');
const guest = await tab('guest');

await host.goto(B + '/together', { waitUntil: 'networkidle' });
const picker = host.getByRole('button', { name: /Between Us/i }).first();
const onShelf = await until(async () => (await picker.count()) > 0, 20000);
t('Between Us is on the shelf', onShelf);
await picker.click();
await host.waitForTimeout(500);
const createBtn = host.getByRole('button', { name: 'Create private room', exact: true });
t('a private room can be opened', await until(async () => (await createBtn.count()) > 0, 10000));
await createBtn.click();
const code = await until(async () => {
  const c = await host.getAttribute('[data-room-code]', 'data-room-code');
  return c || false;
}, 20000).then(() => host.getAttribute('[data-room-code]', 'data-room-code'));
t('a room was created', !!code, String(code));

await guest.goto(`${B}/room/${code}`, { waitUntil: 'networkidle' });
await guest.waitForTimeout(1200);
await until(async () => (await guest.getByRole('button', { name: /^(I'm )?ready/i }).count()) > 0, 15000);
for (const p of [host, guest]) {
  const r = p.getByRole('button', { name: /^(I'm )?ready/i }).first();
  if (await r.count()) { await r.click(); await p.waitForTimeout(500); }
}
await host.waitForTimeout(600);
const start = host.getByRole('button', { name: /^start/i }).first();
if (await start.count() && await start.isEnabled()) await start.click();

t('the room renders in 3D for the host', await until(async () => (await boardThere(host)) > 0, 30000));
t('the room renders in 3D for the guest', await until(async () => (await boardThere(guest)) > 0, 30000));
await sleep(2500);

const hostStation = await attr(host, 'data-station');
const guestStation = await attr(guest, 'data-station');
t('the two players are at different stations', hostStation !== guestStation, `${hostStation} / ${guestStation}`);

const listener = hostStation === 'listener' ? host : guest;
const operator = hostStation === 'listener' ? guest : host;
const lName = hostStation === 'listener' ? 'host' : 'guest';

/* the halves of the truth */
const codeAttr = await attr(listener, 'data-code');
const legendAttr = await attr(operator, 'data-legend');
t('the listener can see three glyphs', (codeAttr ?? '').split(',').filter(Boolean).length === 3, String(codeAttr));
t('the operator cannot see the glyphs', (await attr(operator, 'data-code')) === null || (await attr(operator, 'data-code')) === '');
t('the operator has the legend plate', (legendAttr ?? '').split(',').filter(Boolean).length === 8, String(legendAttr));

/* and the operator really does not have the answer anywhere in what it was sent */
const operatorWire = await operator.evaluate(() => document.body.innerHTML + JSON.stringify(performance.getEntriesByType('resource').length));
t('the answer is not in the operator’s page', !new RegExp(`data-code="${codeAttr}"`).test(operatorWire));

await listener.screenshot({ path: '/tmp/sheets/beu-listener.png' });
await operator.screenshot({ path: '/tmp/sheets/beu-operator.png' });

/* ---- carry all three frequencies, by keyboard, as a person would ---- */
const digitsFor = (glyphs, legend) => glyphs.split(',').map((g) => Number(legend.split(',')[Number(g)]));

async function solveRound(n) {
  const glyphs = await attr(listener, 'data-code');
  const legend = await attr(operator, 'data-legend');
  const digits = digitsFor(glyphs, legend);
  await operator.bringToFront();
  for (let i = 0; i < 3; i++) {
    for (let k = 0; k < digits[i]; k++) {
      await operator.keyboard.press(String(i + 1));
      await sleep(45);
    }
  }
  // the round trip to the relay is not instant: wait for the console to show
  // what was actually set before reaching for the lever
  const set = await until(async () => {
    const d = (await attr(operator, 'data-dials')).split(',').map(Number);
    return d.every((v, i) => v === digits[i]);
  }, 8000, 100);
  const dials = (await attr(operator, 'data-dials')).split(',').map(Number);
  t(`round ${n}: the operator set the dials the listener described`, set, `${dials} vs ${digits}`);
  await operator.keyboard.press('Enter');
  return true;
}

await solveRound(1);
t('carrying a frequency moves the room to the next one', await until(async () => (await attr(listener, 'data-round')) === '2' && (await attr(operator, 'data-round')) === '2'), await attr(listener, 'data-round'));
t('both players see the same dials', (await attr(listener, 'data-dials')) === (await attr(operator, 'data-dials')));
t('the new round starts with the dials back at zero', (await attr(operator, 'data-dials')) === '0,0,0');

/* a wrong pull costs a strike and is visible to both */
await operator.keyboard.press('Enter');
t('a wrong pull costs a strike', await until(async () => (await attr(operator, 'data-strikes')) === '1'));
t('the listener is told about the strike too', await until(async () => (await attr(listener, 'data-strikes')) === '1'));

await solveRound(2);
await solveRound(3);
t('three frequencies open the door', await until(async () => (await attr(operator, 'data-solved')) === '1' && (await attr(listener, 'data-solved')) === '1'));
t('and both players are told the run is over', await until(async () => /door is open/i.test(await listener.evaluate(() => document.body.innerText))));

/* the buttons are the phone path, so they have to work too — not just the keys */
await operator.screenshot({ path: '/tmp/sheets/beu-solved.png' });
console.log('    (final dials ' + (await attr(operator, 'data-dials')) + ', strikes ' + (await attr(operator, 'data-strikes')) + ')');
t('no console errors', errs.length === 0, errs.slice(0, 4).join(' / '));
console.log(`\n${pass} passed, ${fail} failed  (listener = ${lName})`);
await browser.close();
process.exit(fail ? 1 : 0);
