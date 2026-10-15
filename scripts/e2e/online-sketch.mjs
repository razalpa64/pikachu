/**
 * Guess & Draw, two real browsers.
 *
 * The assertion that matters: the guesser's page must never contain the word,
 * in any form — not in the DOM, not in a React prop. We read the word off the
 * DRAWER's screen and then hunt for it everywhere on the guesser's.
 */
import { chromium } from 'playwright';
const B = 'http://127.0.0.1:5173';
let pass = 0, fail = 0;
const t = (n, c, extra = '') => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (extra ? ' — ' + extra : ''))); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 12000, step = 120) => {
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

/* ---------- it is offered, and it launches ---------- */
await host.goto(B + '/library');
await host.waitForTimeout(1600);
t('Guess & Draw is listed in the library', /guess & draw/i.test(await txt(host)));

await host.goto(B + '/together');
await host.waitForTimeout(1800);
const pick = host.getByRole('button', { name: /Guess & Draw/i }).first();
t('Guess & Draw is offered in Play Together', await pick.count() > 0);
await pick.click();
await host.waitForTimeout(500);
await host.getByRole('button', { name: 'Create private room', exact: true }).click();
await host.waitForTimeout(2600);

const code = await host.getAttribute('[data-room-code]', 'data-room-code');
t('host got a room code', !!code, String(code));
await guest.goto(`${B}/room/${code}`);
await guest.waitForTimeout(3000);

for (const p of [host, guest]) {
  const r = p.getByRole('button', { name: /^(I'm )?ready/i }).first();
  if (await r.count()) { await r.click(); await p.waitForTimeout(650); }
}
await host.waitForTimeout(800);
const start = host.getByRole('button', { name: /^start/i }).first();
if (await start.count() && await start.isEnabled()) await start.click();

const upHost = await until(async () => await host.locator('canvas').count() > 0, 20000);
const upGuest = await until(async () => await guest.locator('canvas').count() > 0, 20000);
t('both players get a canvas', upHost && upGuest);
await sleep(600);

/* ---------- roles ---------- */
const roleOf = async p =>
  (await p.locator('[aria-label="Pen colour"]').count()) ? 'drawer'
    : (await p.locator('#sketch-guess').count()) ? 'guesser' : 'none';
const [rh, rg] = [await roleOf(host), await roleOf(guest)];
t('exactly one drawer and one guesser', (rh === 'drawer' && rg === 'guesser') || (rh === 'guesser' && rg === 'drawer'), `${rh}/${rg}`);
const drawer = rh === 'drawer' ? host : guest;
const guesser = rh === 'drawer' ? guest : host;

/* ---------- the word is hidden ---------- */
const wordLine = p => p.locator('canvas').locator('xpath=../..').locator('p.font-display').first().innerText();
const word = (await wordLine(drawer)).trim().toLowerCase();
t('the drawer can read the word', /^[a-z][a-z ]{2,}$/.test(word), JSON.stringify(word));

const hint = (await wordLine(guesser)).trim();
t('the guesser sees a mask instead', /^[_\s]+$/.test(hint), JSON.stringify(hint));
t('the mask has one underscore per letter',
  hint.replace(/\s/g, '').length === word.replace(/\s/g, '').length,
  `${hint.replace(/\s/g, '').length} vs ${word.replace(/\s/g, '').length}`);

const leak = await guesser.evaluate(w => {
  const hay = [document.documentElement.innerHTML];
  const walk = (n, d) => {
    if (!n || d > 60) return;
    try { hay.push(JSON.stringify(n.memoizedProps ?? '')); } catch { /* circular */ }
    walk(n.child, d + 1); walk(n.sibling, d + 1);
  };
  const root = document.getElementById('root');
  const k = root && Object.keys(root).find(x => x.startsWith('__reactContainer'));
  if (k) walk(root[k].current, 0);
  // whole-word match only: a short word like "eye" is a substring of the
  // `eyebrow` CSS class and that is not a leak
  return new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(hay.join('|'));
}, word);
t("the word is nowhere in the guesser's page, DOM or props", !leak, leak ? `"${word}" found` : '');

/* ---------- drawing crosses the wire ---------- */
const strokes = p => p.evaluate(() =>
  Number(document.querySelector('canvas')?.getAttribute('aria-label')?.match(/(\d+) strokes/)?.[1] ?? -1));
t('the canvas starts empty', await strokes(guesser) === 0);

const box = await drawer.locator('canvas').boundingBox();
for (let i = 0; i < 3; i++) {
  await drawer.mouse.move(box.x + 120 + i * 70, box.y + 90 + i * 40);
  await drawer.mouse.down();
  for (let s = 1; s <= 8; s++) {
    await drawer.mouse.move(box.x + 120 + i * 70 + s * 14, box.y + 90 + i * 40 + Math.sin(s) * 26);
    await sleep(16);
  }
  await drawer.mouse.up();
  await sleep(200);
}
const arrived = await until(async () => await strokes(guesser) >= 3);
t("the strokes arrive on the guesser's screen", arrived, `${await strokes(guesser)} strokes`);

const painted = await guesser.evaluate(() => {
  const c = document.querySelector('canvas');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const bg = [d[0], d[1], d[2]];
  let diff = 0;
  for (let i = 0; i < d.length; i += 40)
    if (Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) > 40) diff++;
  return diff;
});
t("there is real ink on the guesser's canvas", painted > 50, `${painted} differing samples`);

/* A stroke along the BOTTOM edge has to survive. Points are normalised per
   axis; scaling both by the width drops everything below y≈750 off a 4:3
   canvas, which silently deletes the lower quarter of every drawing. */
const bx = await drawer.locator('canvas').boundingBox();
await drawer.mouse.move(bx.x + 30, bx.y + bx.height - 14);
await drawer.mouse.down();
for (let i = 1; i <= 12; i++) { await drawer.mouse.move(bx.x + 30 + i * 22, bx.y + bx.height - 14); await sleep(14); }
await drawer.mouse.up();
await sleep(800);
const halves = await guesser.evaluate(() => {
  const c = document.querySelector('canvas'); const ctx = c.getContext('2d');
  const band = (y0, y1) => {
    const d = ctx.getImageData(0, y0, c.width, y1 - y0).data; let n = 0;
    for (let i = 0; i < d.length; i += 4)
      if (Math.abs(d[i] - 255) + Math.abs(d[i + 1] - 253) + Math.abs(d[i + 2] - 247) > 40) n++;
    return n;
  };
  return { bottom: band(Math.floor(c.height / 2), c.height) };
});
t('a stroke along the bottom edge actually renders there', halves.bottom > 200, `${halves.bottom} px of ink`);

const before = await strokes(guesser);
await drawer.getByRole('button', { name: /undo/i }).click();
const undone = await until(async () => await strokes(guesser) === before - 1);
t('undo removes a stroke on both screens', undone, `${before} -> ${await strokes(guesser)}`);

/* ---------- guessing ---------- */
await guesser.fill('#sketch-guess', 'absolutely not the word');
await guesser.press('#sketch-guess', 'Enter');
t("a wrong guess reaches the drawer's screen", await until(async () => /absolutely not the word/i.test(await txt(drawer))));
t('a wrong guess does not end the round', await guesser.locator('#sketch-guess').count() === 1);
const scores = p => p.locator('[data-score-slot]').evaluateAll(es => es.map(e => Number(e.textContent)));
t('a wrong guess scores nothing', (await scores(guesser)).every(n => n === 0), (await scores(guesser)).join(','));

await guesser.fill('#sketch-guess', word);
await guesser.press('#sketch-guess', 'Enter');
t('a correct guess ends the round', await until(async () => /got it/i.test(await txt(guesser))));
t('the word is revealed to the guesser afterwards', new RegExp(`\\b${word}\\b`, 'i').test(await txt(guesser)));
t('the drawer sees the reveal too', await until(async () => /got it/i.test(await txt(drawer))));

const finalScores = await scores(guesser);
t('both players scored on a correct guess', finalScores.length === 2 && finalScores.every(n => n > 0), finalScores.join(','));
// which row is "you" on the guesser's page? that slot should have the bigger score
const yourScore = await guesser.evaluate(() => {
  for (const el of document.querySelectorAll('[data-score-slot]')) {
    const row = el.parentElement;
    if (/\(you\)/i.test(row.textContent)) return Number(el.textContent);
  }
  return null;
});
t('the guesser out-scored the drawer', yourScore !== null && yourScore === Math.max(...finalScores) && yourScore > Math.min(...finalScores),
  `you=${yourScore} of ${finalScores.join(',')}`);

/* ---------- round 2 ---------- */
const swapped = await until(async () => {
  const [a2, b2] = [await roleOf(host), await roleOf(guest)];
  return a2 === rg && b2 === rh;
}, 14000);
t('the roles swap for round 2', swapped, `${await roleOf(host)}/${await roleOf(guest)}`);
t('round 2 starts on a clean canvas', await strokes(host) === 0 && await strokes(guest) === 0);
t('the round counter advanced', /round 2 of/i.test(await txt(host)));

/* ---------- play the match out to a verdict ---------- */
// every round: whoever is the drawer reveals the word, the other types it.
let rounds = 1;
let finished = false;
for (let i = 0; i < 8 && !finished; i++) {
  const d = (await roleOf(host)) === 'drawer' ? host : guest;
  const g = d === host ? guest : host;
  if (!(await d.locator('[aria-label="Pen colour"]').count())) { await sleep(900); continue; }
  const w = (await wordLine(d)).trim().toLowerCase();
  if (!/^[a-z][a-z ]*$/.test(w)) { await sleep(900); continue; }
  await g.fill('#sketch-guess', w).catch(() => {});
  await g.press('#sketch-guess', 'Enter').catch(() => {});
  rounds++;
  finished = await until(async () => /rematch|play again/i.test(await txt(host)), 9000);
}
t('a full match plays through to a result screen', finished, `stopped after ${rounds} rounds`);

const overlay = host.locator('[role="dialog"]');
t('the result screen is a real dialog', await overlay.count() > 0);
const htext = await txt(host);
t('the result names a verdict', /you win|you lose|draw|well played|good game/i.test(htext), htext.slice(0, 120).replace(/\n/g, ' | '));

const rematchBtn = host.getByRole('button', { name: /rematch|play again/i }).first();
await rematchBtn.click();
const guestVote = guest.getByRole('button', { name: /rematch|play again/i }).first();
t('the other player is asked to confirm the rematch', await until(async () => await guestVote.count() > 0));
await guestVote.click();
t('a rematch restarts the game on a clean canvas',
  await until(async () => (await strokes(host)) === 0 && /round 1 of/i.test(await txt(host)), 15000));

/* ---------- no console noise ---------- */
const real = errs.filter(e => !/ERR_ABORTED|favicon|Download the React/i.test(e));
t('no console or page errors', real.length === 0, real.slice(0, 3).join(' // '));

await b.close();
console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
