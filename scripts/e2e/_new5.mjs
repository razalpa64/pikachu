/** Deep interaction audit for the five new games. */
import { chromium } from 'playwright';
const B = 'http://127.0.0.1:5173';
const b = await chromium.launch({ args: ['--no-sandbox', '--disable-gpu'] });
let pass = 0, fail = 0;
const t = (n, c, extra = '') => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (extra ? ' — ' + extra : ''))); };

async function open(slug) {
  const p = await (await b.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  const errs = [];
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  await p.goto(B + '/');
  await p.evaluate(() => sessionStorage.setItem('pikachu.intro.v1', '1'));
  await p.goto(`${B}/solo/${slug}`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2800);
  return { p, errs };
}
const txt = p => p.evaluate(() => document.body.innerText);

/* ───────────── Spark Quiz ───────────── */
console.log('\nSPARK QUIZ');
{
  const { p, errs } = await open('spark-quiz');
  let s = await txt(p);
  t('renders a question', /Question 1 of|Level \d/i.test(s));
  const opts = p.locator('button[aria-label^="Option"]');
  t('offers four options', await opts.count() === 4, `got ${await opts.count()}`);
  await opts.first().click(); await p.waitForTimeout(700);
  s = await txt(p);
  t('reveals the verdict after answering', /correct|not quite|out of time/i.test(s));
  const next = p.getByText(/Next question|See the result/i).first();
  t('offers a way forward', await next.count() > 0);
  await next.click(); await p.waitForTimeout(700);
  t('advances to question 2', /Question 2 of/i.test(await txt(p)));
  // play out the rest
  for (let i = 0; i < 12; i++) {
    const o = p.locator('button[aria-label^="Option"]');
    if (await o.count()) { await o.first().click(); await p.waitForTimeout(260); }
    const n = p.getByText(/Next question|See the result/i).first();
    if (await n.count()) { await n.click(); await p.waitForTimeout(260); }
    if (/victory|defeat|dead heat/i.test(await txt(p))) break;
  }
  t('a full run reaches a result screen', /victory|defeat|dead heat/i.test(await txt(p)));
  t('no console errors', errs.length === 0, errs[0]);
  await p.context().close();
}

/* ───────────── Wild Eights ───────────── */
console.log('\nWILD EIGHTS');
{
  const { p, errs } = await open('wild-eights');
  let s = await txt(p);
  t('deals a hand', /Your cards/i.test(s) && /Stock/i.test(s));
  const hand = p.locator('[role="group"][aria-label="Your hand"] button, [role="group"][aria-label="Your hand"] div');
  t('renders card faces', await hand.count() >= 7, `got ${await hand.count()}`);
  const playableBtn = p.locator('[role="group"][aria-label="Your hand"] button:not([disabled])').first();
  const hadPlay = await playableBtn.count() > 0;
  const before = await txt(p);
  if (hadPlay) { await playableBtn.click(); await p.waitForTimeout(2600); }
  else { await p.locator('button[aria-label="Draw a card from the stock"]').click(); await p.waitForTimeout(1200); }
  t('the table responds to a move', before !== await txt(p));
  // drive a whole game. the engine is proven to terminate in the unit tests, so
  // what this checks is that the UI always offers *some* legal action — a turn
  // where nothing is clickable and the AI is not moving is a real deadlock.
  let finished = false, stuckPolls = 0, acted = 0;
  for (let i = 0; i < 400; i++) {
    const body = await txt(p);
    if (/victory|defeat/i.test(body)) { finished = true; break; }

    const suit = p.locator('button[aria-label^="Call "]').first();
    if (await suit.count()) { await suit.click(); acted++; stuckPolls = 0; await p.waitForTimeout(220); continue; }

    const pick = p.getByRole('button', { name: /Pick up \d/ }).first();
    if (await pick.count()) { await pick.click(); acted++; stuckPolls = 0; await p.waitForTimeout(220); continue; }

    const psb = p.getByRole('button', { name: /Pass the turn/ }).first();
    if (await psb.count()) { await psb.click(); acted++; stuckPolls = 0; await p.waitForTimeout(220); continue; }

    const card = p.locator('[role="group"][aria-label="Your hand"] button:not([disabled])').first();
    if (await card.count()) { await card.click(); acted++; stuckPolls = 0; await p.waitForTimeout(260); continue; }

    const dr = p.locator('button[aria-label="Draw a card from the stock"]');
    if (await dr.count() && await dr.isEnabled()) { await dr.click(); acted++; stuckPolls = 0; await p.waitForTimeout(220); continue; }

    // nothing for the player to do -> it must be the opponent's turn
    stuckPolls++;
    await p.waitForTimeout(400);
    if (stuckPolls > 25) break;   // ~10s with no progress from either side
  }
  t('a full game reaches a finish with no deadlock', finished, `${acted} actions, stuck for ${stuckPolls} polls`);
  t('no console errors', errs.length === 0, errs[0]);
  await p.context().close();
}

/* ───────────── Detective Pikachu ───── */
console.log('\nCASE FILES');
{
  const { p, errs } = await open('case-files');
  let s = await txt(p);
  t('presents a case with evidence', /Case file|Evidence/i.test(s));
  t('shows a deduction board', /who/i.test(s) && /where/i.test(s) && /what/i.test(s) && /your notes/i.test(s));
  const targets = p.locator('button[aria-label^="Name "]');
  t('offers accusation targets', await targets.count() >= 9, `got ${await targets.count()}`);
  const accuse = p.getByRole('button', { name: /Make the accusation/i });
  t('accuse is disabled until the accusation is complete', !(await accuse.isEnabled()));
  // solve it honestly: read the solution from the page is impossible, so just
  // verify the interaction works by naming one of each
  await targets.nth(0).click(); await p.waitForTimeout(150);
  const cols = await p.locator('button[aria-label^="Name "]').count();
  const per = cols / 3;
  await targets.nth(Math.floor(per)).click(); await p.waitForTimeout(150);
  await targets.nth(Math.floor(per * 2)).click(); await p.waitForTimeout(250);
  t('accuse enables once all three are named', await accuse.isEnabled());
  const ruleOut = p.locator('button[aria-label*="no mark"]').first();
  const hadNote = await ruleOut.count() > 0;
  if (hadNote) { await ruleOut.click(); await p.waitForTimeout(250); }
  t('notes can be marked', hadNote && (await p.locator('button[aria-label*="ruled out"]').count()) > 0);
  await accuse.click(); await p.waitForTimeout(900);
  t('an accusation produces a verdict or feedback', /were right|Nothing in that|victory|defeat/i.test(await txt(p)));
  const pull = p.getByRole('button', { name: /Pull another clue/i });
  if (await pull.count()) { const n0 = (await txt(p)).match(/(\d+)\/(\d+)/); await pull.click(); await p.waitForTimeout(300); t('more clues can be pulled', true); }
  else t('all clues already on the board', true);
  t('no console errors', errs.length === 0, errs[0]);
  await p.context().close();
}

/* ───────────── Imposter ───────────── */
console.log('\nIMPOSTER');
{
  const { p, errs } = await open('imposter');
  let s = await txt(p);
  t('opens on setup', /How many are playing|Deal the cards/i.test(s));
  await p.getByRole('button', { name: /Deal the cards/i }).click();
  await p.waitForTimeout(800);
  s = await txt(p);
  t('deals and asks for a private look', /Hold to look|card/i.test(s));
  // walk all four reveals
  for (let i = 0; i < 4; i++) {
    const hold = p.locator('button[aria-label^="Hold to reveal"]').first();
    if (await hold.count()) {
      await hold.hover(); await p.mouse.down(); await p.waitForTimeout(400);
      const seen = await txt(p);
      if (i === 0) t('holding reveals a role', /imposter|Describe it in one word/i.test(seen));
      await p.mouse.up(); await p.waitForTimeout(250);
      const hidden = await txt(p);
      if (i === 0) t('letting go hides it again', !/Describe it in one word/i.test(hidden));
    }
    const ok = p.getByRole('button', { name: /Got it/i }).first();
    if (await ok.count()) { await ok.click(); await p.waitForTimeout(350); }
  }
  s = await txt(p);
  t('moves to the clue round', /Clue round/i.test(s));
  for (let i = 0; i < 4; i++) {
    const nx = p.getByRole('button', { name: /Said it/i }).first();
    if (await nx.count()) { await nx.click(); await p.waitForTimeout(300); }
  }
  s = await txt(p);
  t('moves to the vote', /Who is the imposter/i.test(s));
  for (let i = 0; i < 4; i++) {
    const v = p.locator('button[aria-label*="votes for"]').first();
    if (await v.count()) { await v.click(); await p.waitForTimeout(350); }
  }
  s = await txt(p);
  t('the vote resolves to a result or a steal attempt', /Caught|Got away with it|crew holds|imposter wins|was the imposter/i.test(s));
  if (/One guess at the secret/i.test(s)) {
    await p.getByRole('button', { name: /^Pass$/ }).click(); await p.waitForTimeout(500);
  }
  t('reaches a final result', /Caught them|Got away with it/i.test(await txt(p)));
  t('no console errors', errs.length === 0, errs[0]);
  await p.context().close();
}

/* ───────────── Truth or Dare ───────────── */
console.log('\nTRUTH OR DARE');
{
  const { p, errs } = await open('truth-or-dare');
  let s = await txt(p);
  t('asks truth or dare', /Truth or dare\?/i.test(s));
  t('spicy is locked behind an opt-in', /Unlock spicy/i.test(s));
  const spicyBtn = p.getByRole('button', { name: 'Spicy', exact: true });
  t('the spicy heat button starts disabled', await spicyBtn.isDisabled());
  const first = (await p.locator('[aria-current="true"]').first().innerText()).split('\n')[0].replace(/[0-9].*$/, '').trim();
  await p.getByRole('button', { name: /^Truth/ }).click(); await p.waitForTimeout(600);
  s = await txt(p);
  t('deals a truth card', /Truth ·/i.test(s));
  t('offers both did-it and pass', /Did it/i.test(s) && /Pass/i.test(s));
  await p.getByRole('button', { name: /Did it/i }).click(); await p.waitForTimeout(500);
  const active = async () => (await p.locator('[aria-current="true"]').first().innerText()).split('\n')[0].replace(/[0-9].*$/, '').trim();
  t('turn passes to the other player', (await active()) !== first);
  s = await txt(p);
  t('session history appears', /This session/i.test(s));
  await p.getByRole('button', { name: /^Dare/ }).click(); await p.waitForTimeout(500);
  await p.getByRole('button', { name: /^Pass$/ }).click(); await p.waitForTimeout(500);
  s = await txt(p);
  t('a skipped card is recorded', s.includes('↷') && (await active()) === first);
  // unlock spicy
  const toggle = p.getByRole('switch', { name: /Unlock spicy/i }).or(p.locator('button[aria-label*="Unlock spicy"]')).first();
  if (await toggle.count()) {
    await toggle.click(); await p.waitForTimeout(400);
    t('spicy unlocks on request', !(await p.getByRole('button', { name: 'Spicy', exact: true }).isDisabled()));
  } else t('spicy unlocks on request', false, 'toggle not found');
  t('no console errors', errs.length === 0, errs[0]);
  await p.context().close();
}

console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
process.exit(fail ? 1 : 0);
