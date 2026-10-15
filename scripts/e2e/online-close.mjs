/**
 * The defeat screen in an ONLINE room.
 *
 * All nine online games share `Room.tsx`, so this one path covers every one of
 * them. It is a different code path from the solo views: online, the result
 * card's exit does not reset anything — it opens a "Leave this arena?" confirm
 * on top of the card. That stacking is where close bugs hide.
 *
 * Reaching a real defeat is done by resigning rather than playing a game out:
 * the server records the loss for real, and it is deterministic.
 *
 * Checks:
 *   1. the loser actually gets a result card
 *   2. Escape on the card opens the leave confirm
 *   3. Escape again DISMISSES that confirm   ← two dialogs, two Escape handlers
 *   4. the card's own exit button opens the confirm
 *   5. confirming actually leaves the room
 */
import { chromium } from 'playwright';

const B = 'http://127.0.0.1:5173';
let pass = 0, fail = 0;
const t = (n, c, extra = '') => {
  c ? (pass += 1, console.log('  ✓ ' + n)) : (fail += 1, console.log('  ✗ ' + n + (extra ? ' — ' + extra : '')));
};

const b = await chromium.launch({ args: ['--no-sandbox', '--disable-gpu'] });
const errs = [];
async function tab(label) {
  const p = await (await b.newContext({ viewport: { width: 1340, height: 950 } })).newPage();
  p.on('console', (m) => { if (m.type() === 'error') errs.push(`${label}: ${m.text()}`); });
  p.on('pageerror', (e) => errs.push(`${label} PAGEERROR: ${e.message}`));
  await p.goto(B + '/');
  await p.evaluate(() => sessionStorage.setItem('pikachu.intro.v1', '1'));
  return p;
}
const txt = (p) => p.evaluate(() => document.body.innerText);
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 12000, step = 150) => {
  const t0 = Date.now();
  for (;;) {
    try { if (await fn()) return true; } catch { /* mid-navigation */ }
    if (Date.now() - t0 > ms) return false;
    await sleepMs(step);
  }
};
const dialogs = (p) => p.locator('[role="dialog"]').count();

const host = await tab('host');
const guest = await tab('guest');

// ---- host opens a Tic-Tac-Toe room ----
await host.goto(B + '/together');
await host.waitForTimeout(1800);
const picker = host.getByRole('button', { name: /Tic-Tac-Toe/i }).first();
if (await picker.count()) { await picker.click(); await host.waitForTimeout(500); }
await host.getByRole('button', { name: 'Create private room', exact: true }).click();
await host.waitForTimeout(2600);
const code = await host.getAttribute('[data-room-code]', 'data-room-code');
t('host got a room code', !!code, String(code));

await guest.goto(`${B}/room/${code}`);
await guest.waitForTimeout(3000);

for (const p of [host, guest]) {
  const r = p.getByRole('button', { name: /^(I'm )?ready/i }).first();
  if (await r.count()) { await r.click(); await p.waitForTimeout(700); }
}
await host.waitForTimeout(900);
const start = host.getByRole('button', { name: /^start/i }).first();
if (await start.count() && await start.isEnabled()) await start.click();

const live = await until(async () => /resign/i.test(await txt(host)));
t('the match reached the board', live);

// ---- host resigns: host is now genuinely defeated, server-side ----
await host.getByRole('button', { name: /^Resign$/i }).first().click();
await host.waitForTimeout(500);
await host.getByRole('button', { name: /^Resign$/i }).last().click();   // confirm
const lost = await until(async () => /defeat|defeated/i.test(await txt(host)));
t('1. the loser gets a result card', lost, (await txt(host)).slice(0, 120));

// ---- 2. Escape on the result card opens the leave confirm ----
await host.keyboard.press('Escape');
await host.waitForTimeout(700);
const leaveOpen = /leave this arena/i.test(await txt(host));
t('2. Escape on the result card opens the leave confirm', leaveOpen);
t('   (two dialogs are now stacked)', await dialogs(host) === 2, `${await dialogs(host)} dialog(s)`);

// ---- 3. Escape again must DISMISS the confirm, not be eaten by the card ----
await host.keyboard.press('Escape');
await host.waitForTimeout(700);
const confirmGone = !/leave this arena/i.test(await txt(host));
t('3. Escape dismisses the leave confirm', confirmGone,
  'the result card swallowed the key before the confirm could see it');
t('   the result card is still there underneath', /defeat/i.test(await txt(host)));

// ---- 4. the card's own exit button opens the confirm ----
const exitBtn = host.getByRole('button', { name: /Back to lobby|Leave/i }).last();
if (await exitBtn.count()) { await exitBtn.click(); await host.waitForTimeout(700); }
t('4. the exit button opens the leave confirm', /leave this arena/i.test(await txt(host)));

// ---- 5. confirming actually leaves ----
// NB the header also has an aria-label="Leave room"; the confirm's is the later one
await host.getByRole('button', { name: /^Leave room$/i }).last().click();
const left = await until(async () => !/\/room\//.test(host.url()), 8000);
t('5. confirming leaves the room', left, host.url().replace(B, ''));

console.log(`\n  ${errs.length ? 'console errors:\n   ' + errs.slice(0, 5).join('\n   ') : '✓ no console errors'}`);
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
process.exit(fail === 0 ? 0 : 1);
