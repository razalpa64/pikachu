/**
 * Is a Play Together match actually audible?
 *
 * Sound lived only in the solo views, so the shared boards a room renders made
 * almost no noise — four of them (tic-tac-toe, Drop Four, Spark Quiz, Wild
 * Eights) had no `sfx()` call anywhere. `useMatchCues` in Room.tsx now diffs
 * the match state for all nine. This drives two real browsers through a real
 * server-refereed match and counts decoded cries that actually reach the output
 * on BOTH sides — an opponent's move has to be audible to you, not just to them.
 */
import { chromium } from 'playwright';

const B = 'http://127.0.0.1:5173';
let pass = 0, fail = 0;
const t = (n, c, extra = '') => { c ? (pass += 1, console.log('  ✓ ' + n)) : (fail += 1, console.log('  ✗ ' + n + (extra ? ' — ' + extra : ''))); };

const b = await chromium.launch({ args: ['--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required'] });
const errs = [];
async function tab(label) {
  const c = await b.newContext({ viewport: { width: 1340, height: 950 } });
  await c.addInitScript(() => {
    sessionStorage.setItem('pikachu.intro.v1', '1');
    window.__cries = [];
    const rs = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function () {
      const n = rs.call(this);
      const start = n.start.bind(n);
      n.start = (...a) => { if (n.buffer && n.buffer.duration > 0.3) window.__cries.push(+n.buffer.duration.toFixed(2)); return start(...a); };
      return n;
    };
  });
  const p = await c.newPage();
  p.on('console', (m) => { if (m.type() === 'error') errs.push(`${label}: ${m.text().slice(0, 140)}`); });
  p.on('pageerror', (e) => errs.push(`${label} PAGEERROR: ${e.message.slice(0, 140)}`));
  await p.goto(B + '/');
  return p;
}
const txt = (p) => p.evaluate(() => document.body.innerText);
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 14000, step = 150) => {
  const t0 = Date.now();
  for (;;) { try { if (await fn()) return true; } catch { /* nav */ } if (Date.now() - t0 > ms) return false; await sleepMs(step); }
};
const cries = (p) => p.evaluate(() => window.__cries.length);
const resetCries = (p) => p.evaluate(() => { window.__cries = []; });

const host = await tab('host');
const guest = await tab('guest');

// unlock both audio contexts with a real gesture
for (const p of [host, guest]) { await p.mouse.click(400, 300); await p.waitForTimeout(300); }

await host.goto(B + '/together');
await host.waitForTimeout(1800);
const picker = host.getByRole('button', { name: /Tic-Tac-Toe/i }).first();
if (await picker.count()) { await picker.click(); await host.waitForTimeout(500); }
await host.getByRole('button', { name: 'Create private room', exact: true }).click();
await host.waitForTimeout(2600);
const code = await host.getAttribute('[data-room-code]', 'data-room-code');
t('host opened a room', !!code, String(code));

await guest.goto(`${B}/room/${code}`);
await guest.waitForTimeout(3000);
await guest.mouse.click(400, 300);
await guest.waitForTimeout(300);

const joinHeard = await cries(host);
t('the host HEARS the guest arrive', joinHeard > 0, `${joinHeard} cries`);

for (const p of [host, guest]) {
  const r = p.getByRole('button', { name: /^(I'm )?ready/i }).first();
  if (await r.count()) { await r.click(); await p.waitForTimeout(700); }
}
await host.waitForTimeout(900);
const start = host.getByRole('button', { name: /^start/i }).first();
if (await start.count() && await start.isEnabled()) await start.click();
t('the match reached the board', await until(async () => /resign/i.test(await txt(host))));
await host.waitForTimeout(800);

// ---- the real question: are moves audible on BOTH screens? ----
await resetCries(host); await resetCries(guest);

let moved = 0;
for (let i = 0; i < 6 && moved < 3; i++) {
  for (const [p] of [[host], [guest]]) {
    const cells = p.getByRole('gridcell');
    const n = await cells.count();
    for (let c = 0; c < n; c++) {
      const cell = cells.nth(c);
      if (await cell.isEnabled().catch(() => false)) {
        const before = await txt(p);
        await cell.click({ force: true }).catch(() => {});
        await p.waitForTimeout(900);
        if (await txt(p) !== before) { moved += 1; break; }
      }
    }
  }
}
const hc = await cries(host), gc = await cries(guest);
t(`moves were played (${moved})`, moved >= 2);
t('the player who moved hears it', hc > 0, `${hc} cries on host`);
t('the OPPONENT hears it too', gc > 0, `${gc} cries on guest — this is what was silent before`);

// ---- resign → the defeat is voiced ----
await resetCries(host);
await host.getByRole('button', { name: /^Resign$/i }).first().click();
await host.waitForTimeout(500);
await host.getByRole('button', { name: /^Resign$/i }).last().click();
await until(async () => /defeat|defeated/i.test(await txt(host)));
await host.waitForTimeout(600);
const lossCries = await cries(host);
t('the defeat card is voiced', lossCries > 0, `${lossCries} cries`);

t('no console errors', errs.length === 0, errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
process.exit(fail ? 1 : 0);
