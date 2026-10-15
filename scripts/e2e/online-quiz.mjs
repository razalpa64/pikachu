/**
 * Two real browsers playing online Spark Quiz.
 * Asserts the simultaneous flow and that neither tab's DOM reveals the other's
 * answer while the question is still open.
 */
import { chromium } from 'playwright';
const B = 'http://127.0.0.1:5173';
let pass = 0, fail = 0;
const t = (n, c, extra = '') => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (extra ? ' — ' + extra : ''))); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
/**
 * Poll until a condition holds. A fixed sleep before an assertion is a race:
 * the relay broadcast usually lands in ~200 ms, but under load (several suites
 * back to back) it can take seconds, and the check fails for no real reason.
 * This still fails honestly if the condition never arrives.
 */
const until = async (fn, ms = 10000, step = 120) => {
  const t0 = Date.now();
  for (;;) {
    try { if (await fn()) return true; } catch { /* mid-navigation */ }
    if (Date.now() - t0 > ms) return false;
    await sleep(step);
  }
};

const b = await chromium.launch({ args: ['--no-sandbox', '--disable-gpu'] });
const errs = [];
async function tab(label) {
  const p = await (await b.newContext({ viewport: { width: 1340, height: 950 } })).newPage();
  p.on('console', m => { if (m.type() === 'error') errs.push(`${label}: ${m.text()}`); });
  p.on('pageerror', e => errs.push(`${label} PAGEERROR: ${e.message}`));
  await p.goto(B + '/');
  await p.evaluate(() => sessionStorage.setItem('pikachu.intro.v1', '1'));
  return p;
}
const txt = p => p.evaluate(() => document.body.innerText);

const host = await tab('host');
const guest = await tab('guest');

await host.goto(B + '/together');
await host.waitForTimeout(1800);
const pick = host.getByRole('button', { name: /Spark Quiz/i }).first();
t('Spark Quiz is offered in Play Together', await pick.count() > 0);
await pick.click();
await host.waitForTimeout(500);
await host.getByRole('button', { name: 'Create private room', exact: true }).click();
await host.waitForTimeout(2600);

/* Read the code from its own element — a bare five-letter uppercase match
   also hits nav labels like "MUSIC". */
const code = await host.getAttribute('[data-room-code]', 'data-room-code')
  ?? ((await txt(host)).match(/\b[A-Z2-9]{5}\b/) || [])[0];
t('host got a room code', !!code);
await guest.goto(`${B}/room/${code}`);
await guest.waitForTimeout(3000);

for (const p of [host, guest]) {
  const r = p.getByRole('button', { name: /^(I'm )?ready/i }).first();
  if (await r.count()) { await r.click(); await p.waitForTimeout(650); }
}
await host.waitForTimeout(800);
const start = host.getByRole('button', { name: /^start/i }).first();
if (await start.count() && await start.isEnabled()) await start.click();
await host.waitForTimeout(5500);

const answers = p => p.locator('button[aria-label^="Answer "]');
t('both players see four answer buttons', await answers(host).count() === 4 && await answers(guest).count() === 4,
  `host=${await answers(host).count()} guest=${await answers(guest).count()}`);

const hdr = (await txt(host)).match(/question (\d+) of (\d+)/i);
t('the header shows the real question count, not the redacted one',
  !!hdr && Number(hdr[2]) > 1, hdr ? hdr[0] : 'no header');
const hq = (await txt(host)).match(/question \d+ of \d+/i)?.[0];
const gq = (await txt(guest)).match(/question \d+ of \d+/i)?.[0];
t('both are on the same question', !!hq && hq === gq, `${hq} vs ${gq}`);

const hostLabels = await answers(host).evaluateAll(e => e.map(x => x.getAttribute('aria-label')));
const guestLabels = await answers(guest).evaluateAll(e => e.map(x => x.getAttribute('aria-label')));
t('both see the options in the same order', JSON.stringify(hostLabels) === JSON.stringify(guestLabels));

// host answers; guest must not learn which one
await answers(host).nth(0).click();
const sawLock = await until(async () => /locked in/i.test(await txt(guest)));
const guestText = await txt(guest);
t('guest is told the host locked in', sawLock, guestText.slice(0, 200));
const guestHtml = await guest.content();
const correctMarks = (guestHtml.match(/correct/gi) || []).length;
t('guest is NOT shown the answer while still choosing', correctMarks === 0, `${correctMarks} "correct" markers leaked`);
t('host sees its own choice locked', /locked in/i.test(await txt(host)));

// guest answers -> reveal
await answers(guest).nth(1).click();
const revealed = await until(async () => /correct|no points|\+\d/i.test(await txt(guest)));
const afterBoth = await txt(guest);
t('the question reveals once both have answered', revealed, afterBoth.slice(0, 220));

// let the server drive to the end
let finished = false;
for (let i = 0; i < 40; i++) {
  const both = await Promise.all([txt(host), txt(guest)]);
  if (both.some(x => /victory|defeat|dead heat/i.test(x))) { finished = true; break; }
  for (const p of [host, guest]) {
    const a = p.locator('button[aria-label^="Answer "]:not([disabled])');
    if (await a.count()) { await a.nth(0).click().catch(() => {}); }
  }
  await sleep(900);
}
t('the quiz reached a verdict in both tabs', finished);
const both = await Promise.all([txt(host), txt(guest)]);
t('both players were shown a result', both.every(x => /victory|defeat|dead heat/i.test(x)));
t('no console errors', errs.length === 0, errs[0]);

console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
process.exit(fail ? 1 : 0);
