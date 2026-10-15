/**
 * Two real browsers playing online Wild Eights against the relay.
 * Proves the lobby → match → verdict path, and that neither tab can see the
 * other's cards in its own DOM.
 */
import { chromium } from 'playwright';
const B = 'http://127.0.0.1:5173';
let pass = 0, fail = 0;
const t = (n, c, extra = '') => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (extra ? ' — ' + extra : ''))); };

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
const sleepMs = ms => new Promise(r => setTimeout(r, ms));
/** poll instead of guessing a delay — see the note in online-quiz.mjs */
const until = async (fn, ms = 12000, step = 150) => {
  const t0 = Date.now();
  for (;;) {
    try { if (await fn()) return true; } catch { /* mid-navigation */ }
    if (Date.now() - t0 > ms) return false;
    await sleepMs(step);
  }
};

const host = await tab('host');
const guest = await tab('guest');

// ---- host creates a Wild Eights room ----
await host.goto(B + '/together');
await host.waitForTimeout(1800);
const picker = host.getByRole('button', { name: /Wild Eights/i }).first();
t('Wild Eights is offered in Play Together', await picker.count() > 0);
if (await picker.count()) await picker.click();
await host.waitForTimeout(500);

const createBtn = host.getByRole('button', { name: 'Create private room', exact: true });
t('a room can be created', await createBtn.count() > 0);
await createBtn.click();
await host.waitForTimeout(2600);

const hostText = await txt(host);
/* Read the code from its own element. Scraping `/\b[A-Z2-9]{5}\b/` out of the
   whole page text picks up any five-letter uppercase word in the chrome — the
   nav label "MUSIC" broke this, and the guest cheerfully joined /room/MUSIC. */
const code = await host.getAttribute('[data-room-code]', 'data-room-code')
  ?? (hostText.match(/\b[A-Z2-9]{5}\b/) || [])[0];
t('host got a room code', !!code, hostText.slice(0, 160));

// ---- guest joins ----
await guest.goto(`${B}/room/${code}`);
await guest.waitForTimeout(3000);
t('guest reached the lobby', /ready|lobby|waiting|start/i.test(await txt(guest)));

// ---- both ready, host starts ----
for (const [p, who] of [[host, 'host'], [guest, 'guest']]) {
  const r = p.getByRole('button', { name: /^(I'm )?ready/i }).first();
  if (await r.count()) { await r.click(); await p.waitForTimeout(700); }
}
await host.waitForTimeout(900);
const start = host.getByRole('button', { name: /^start/i }).first();
if (await start.count() && await start.isEnabled()) { await start.click(); }
const dealt = await until(async () => /your hand/i.test(await txt(host)));

const hv = await txt(host);
t('the match started and dealt a hand', dealt, hv.slice(0, 200));
// the guest's board must be dealt too before the hidden-information checks read it
await until(async () => /your hand/i.test(await txt(guest)));

// ---- hidden information: neither DOM contains the other's cards ----
const handOf = async p => p.locator('[role="group"][aria-label="Your hand"] [aria-label]')
  .evaluateAll(els => els.map(e => e.getAttribute('aria-label')));
const hHand = await handOf(host);
const gHand = await handOf(guest);
t('host sees its own 7 cards', hHand.length === 7, `${hHand.length}`);
t('guest sees its own 7 cards', gHand.length === 7, `${gHand.length}`);
const overlap = hHand.filter(c => gHand.includes(c));
t('the two hands share no card', overlap.length === 0, overlap.join(', '));

const guestDom = await guest.content();
const leaked = hHand.map(l => l.replace(' — not playable', '')).filter(name => guestDom.includes(name));
t('the guest DOM does not contain the host\u2019s cards', leaked.length === 0, leaked.join(', '));

// ---- play it out ----
let finished = false, actions = 0, idle = 0;
for (let i = 0; i < 260; i++) {
  const texts = await Promise.all([txt(host), txt(guest)]);
  if (texts.some(x => /victory|defeat/i.test(x))) { finished = true; break; }
  let moved = false;
  for (const p of [host, guest]) {
    const suit = p.locator('button[aria-label^="Call "]').first();
    if (await suit.count()) { await suit.click(); moved = true; actions++; break; }
    const pick = p.getByRole('button', { name: /Pick up \d/ }).first();
    if (await pick.count()) { await pick.click(); moved = true; actions++; break; }
    const ps = p.getByRole('button', { name: /Pass the turn/ }).first();
    if (await ps.count()) { await ps.click(); moved = true; actions++; break; }
    const card = p.locator('[role="group"][aria-label="Your hand"] button:not([disabled])').first();
    if (await card.count()) { await card.click(); moved = true; actions++; break; }
    const dr = p.locator('button[aria-label="Draw a card from the stock"]');
    if (await dr.count() && await dr.isEnabled()) { await dr.click(); moved = true; actions++; break; }
  }
  if (!moved) { idle++; if (idle > 20) break; }
  else idle = 0;
  await new Promise(r => setTimeout(r, 300));
}

t('a full online hand reached a verdict', finished, `${actions} actions, idle ${idle}`);
const both = await Promise.all([txt(host), txt(guest)]);
t('both players were shown the result', both.every(x => /victory|defeat/i.test(x)));
t('exactly one of them won', both.filter(x => /victory/i.test(x)).length === 1,
  `host=${/victory/i.test(both[0])} guest=${/victory/i.test(both[1])}`);
t('no console errors', errs.length === 0, errs[0]);

console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
process.exit(fail ? 1 : 0);
