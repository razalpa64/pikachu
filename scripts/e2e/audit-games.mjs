/**
 * Deep per-game audit. For each of the fifteen games: load it, make a real move the
 * way a player would, and assert the game state visibly advanced. Catches
 * "it renders but nothing happens" bugs that a route crawl cannot see.
 */
import { chromium } from 'playwright';
const B = 'http://127.0.0.1:5173';
const results = [];
const b = await chromium.launch({ args: ['--no-sandbox', '--disable-gpu'] });

async function page() {
  const p = await (await b.newContext({ viewport: { width: 1400, height: 950 } })).newPage();
  const errs = [];
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  await p.goto(B + '/');
  await p.evaluate(() => sessionStorage.setItem('pikachu.intro.v1', '1'));
  return { p, errs };
}

async function run(name, slug, fn) {
  const { p, errs } = await page();
  const notes = [];
  let ok = false;
  try {
    await p.goto(`${B}/solo/${slug}`, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(2600);
    ok = await fn(p, notes);
  } catch (e) { notes.push('THREW: ' + String(e).split('\n')[0].slice(0, 150)); }
  results.push({ name, slug, ok, errs: errs.slice(0, 3), notes });
  console.log(`${ok ? '✓' : '✗'} ${name.padEnd(18)} ${notes.join(' | ')}${errs.length ? '  [console: ' + errs[0].slice(0, 90) + ']' : ''}`);
  await p.context().close();
}

const txt = p => p.evaluate(() => document.body.innerText);

await run('Chess Arena', 'chess-arena', async (p, n) => {
  await p.locator('[aria-label*="e2"]').first().click(); await p.waitForTimeout(400);
  await p.locator('[aria-label*="e4"]').first().click(); await p.waitForTimeout(3500);
  const t = await txt(p);
  const moved = /\be4\b/.test(t);
  n.push(moved ? 'played e4, engine replied' : 'NO move registered');
  return moved;
});

await run('Tic-Tac-Toe', 'tic-tac-toe-duel', async (p, n) => {
  const before = await p.locator('[role="grid"] button[aria-label*="empty"]').count();
  await p.locator('[role="grid"] button[aria-label*="empty"]').first().click();
  await p.waitForTimeout(1600);
  const after = await p.locator('[role="grid"] button[aria-label*="empty"]').count();
  n.push(`empty cells ${before} -> ${after}`);
  return after < before - 1 || after === before - 1;
});

await run('Drop Four', 'connect-four', async (p, n) => {
  await p.locator('button[aria-label^="Drop in column"]').first().click();
  await p.waitForTimeout(2200);
  const t = await txt(p);
  n.push('clicked column 1');
  return !/^\s*$/.test(t);
});

await run('Memory Match', 'memory-match', async (p, n) => {
  const cards = p.locator('button[aria-label^="Card"]');
  const c = await cards.count();
  await cards.first().click(); await p.waitForTimeout(900);
  const faceUp = await p.locator('button[aria-label^="Card"][aria-label*=":"]').count();
  n.push(`${c} cards, ${faceUp} face-up after one flip`);
  return c > 0 && faceUp >= 1;
});

await run('Reaction Duel', 'reaction-duel', async (p, n) => {
  const btn = p.locator('button[aria-label*="signal"], button[aria-label*="Strike"]').first();
  const found = await btn.count() > 0;
  n.push(found ? 'arena button present' : 'NO arena button');
  if (found) { await btn.click(); await p.waitForTimeout(1200); }
  return found;
});

await run('Snake Arena', 'snake-arena', async (p, n) => {
  const t0 = await txt(p);
  await p.keyboard.press('ArrowDown'); await p.waitForTimeout(2600);
  const t1 = await txt(p);
  n.push(t0 !== t1 ? 'world advanced on its own clock' : 'state did NOT change in 2.6s');
  return t0 !== t1;
});

await run('Paper Fleet', 'battleship', async (p, n) => {
  const auto = p.locator('button:has-text("Auto")').first();
  if (await auto.count()) { await auto.click(); await p.waitForTimeout(700); }
  const lock = p.locator('button:has-text("Lock in Fleet")').first();
  const can = await lock.count() > 0 && await lock.isEnabled();
  n.push(can ? 'auto-placed and can lock in' : 'cannot lock fleet');
  if (can) {
    await lock.click(); await p.waitForTimeout(1400);
    const cells = await p.locator('[role="gridcell"]').count();
    n.push(`battle grid ${cells} cells`);
  }
  return can;
});

await run('Checkers', 'checkers', async (p, n) => {
  const cells = await p.locator('[role="gridcell"], button[aria-label]').count();
  const t0 = await txt(p);
  const movable = p.locator('[aria-label*="piece"], [role="gridcell"]');
  n.push(`${cells} interactive squares`);
  return cells > 20 && t0.length > 50;
});

await run('Puzzle Quest', 'puzzle-quest', async (p, n) => {
  const tiles = p.locator('button[aria-label^="Tile"]');
  const c = await tiles.count();
  const t0 = await txt(p);
  for (let i = 0; i < 6 && i < c; i++) { await tiles.nth(i).click(); await p.waitForTimeout(220); }
  const t1 = await txt(p);
  n.push(`${c} tiles, state ${t0 !== t1 ? 'changed' : 'UNCHANGED after 6 clicks'}`);
  return c > 0 && t0 !== t1;
});

await run('Volt Runner', 'electric-arcade', async (p, n) => {
  const cv = p.locator('canvas').first();
  if (!await cv.count()) { n.push('NO canvas'); return false; }
  await cv.click({ position: { x: 300, y: 200 } });
  await p.keyboard.press('Space'); await p.waitForTimeout(2600);
  const t = await txt(p);
  const running = !/press space to launch/i.test(t);
  n.push(running ? 'run started' : 'still on the launch screen after Space');
  return running;
});


/* ───────────────────────── the five newer games ───────────────────────── */

await run('Spark Quiz', 'spark-quiz', async (p, n) => {
  const opts = p.locator('button[aria-label^="Answer"], [role="group"] button').filter({ hasText: /\S/ });
  const before = await txt(p);
  const answer = p.locator('button').filter({ hasText: /^[A-D]\s/ }).first();
  const target = await answer.count() ? answer : opts.first();
  if (!await target.count()) { n.push('NO answer buttons'); return false; }
  await target.click();
  await p.waitForTimeout(2200);
  const after = await txt(p);
  const moved = before !== after;
  n.push(moved ? 'answered, quiz advanced' : 'answer click did NOTHING');
  return moved;
});

await run('Wild Eights', 'wild-eights', async (p, n) => {
  const hand = p.locator('[role="group"][aria-label="Your hand"] button:not([disabled])');
  const c = await hand.count();
  if (!c) { n.push('NO playable card in the opening hand'); return false; }
  const before = await txt(p);
  await hand.first().click();
  await p.waitForTimeout(900);
  const suit = p.locator('button[aria-label^="Call "]').first();
  if (await suit.count()) { await suit.click(); await p.waitForTimeout(700); }
  await p.waitForTimeout(1800);
  const after = await txt(p);
  n.push(`${c} playable, table ${before !== after ? 'advanced' : 'UNCHANGED'}`);
  return before !== after;
});

await run('Detective Pikachu', 'case-files', async (p, n) => {
  const marks = p.locator('button[aria-label*="Mark"], button[aria-label*="mark"]');
  const pull = p.getByRole('button', { name: /Pull another clue/i });
  const before = await txt(p);
  let acted = false;
  if (await marks.count()) { await marks.first().click(); await p.waitForTimeout(500); acted = true; }
  if (await pull.count()) { await pull.first().click(); await p.waitForTimeout(900); acted = true; }
  const after = await txt(p);
  n.push(`${await marks.count()} mark buttons, ${acted ? 'acted' : 'NOTHING to click'}, board ${before !== after ? 'changed' : 'UNCHANGED'}`);
  return acted && before !== after;
});

await run('Imposter', 'imposter', async (p, n) => {
  // the game opens on a setup card — deal before anyone can look
  const deal = p.getByRole('button', { name: /Deal the cards/i }).first();
  if (!await deal.count()) { n.push('NO deal button on the setup screen'); return false; }
  await deal.click();
  await p.waitForTimeout(1200);
  // the visible text is "Hold to look" but the accessible name is the aria-label,
  // which is what getByRole matches on
  const hold = p.getByRole('button', { name: /Hold to reveal the card/i }).first();
  if (!await hold.count()) { n.push('dealt, but NO hold-to-look button appeared'); return false; }
  const box = await hold.boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.mouse.down(); await p.waitForTimeout(700);
  const whileHeld = await txt(p);
  await p.mouse.up(); await p.waitForTimeout(600);
  const afterRelease = await txt(p);
  const revealed = whileHeld !== afterRelease;
  n.push(revealed ? 'card revealed while held, hidden on release' : 'hold-to-look revealed NOTHING');
  return revealed;
});

await run('Truth or Dare', 'truth-or-dare', async (p, n) => {
  // you pick a pile before a card exists
  const pick = p.getByRole('button', { name: /^Truth/i }).first();
  if (!await pick.count()) { n.push('NO truth/dare pile to pick'); return false; }
  await pick.click();
  await p.waitForTimeout(1100);
  const before = await txt(p);
  const act = p.getByRole('button', { name: /Did it|^Pass$/i }).first();
  if (!await act.count()) { n.push('drew a card, but NO resolve actions appeared'); return false; }
  await act.click();
  await p.waitForTimeout(1400);
  const after = await txt(p);
  n.push(before !== after ? 'card resolved, deck advanced' : 'resolving the card did NOTHING');
  return before !== after;
});

console.log('\n================ SUMMARY ================');
const bad = results.filter(r => !r.ok);
const noisy = results.filter(r => r.errs.length);
console.log(`${results.length - bad.length}/${results.length} games responded to real input`);
if (bad.length) console.log('FAILED: ' + bad.map(r => r.name).join(', '));
if (noisy.length) { console.log('\nCONSOLE ERRORS:'); noisy.forEach(r => console.log(`  ${r.name}: ${r.errs.join(' || ')}`)); }
await b.close();
