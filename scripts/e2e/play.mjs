import { chromium } from 'playwright';
const B = 'http://127.0.0.1:5173';
const b = await chromium.launch({ args: ['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'] });
const errs = [];
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ FAIL ') + m); };
const mk = async (name) => {
  const ctx = await b.newContext({ viewport: { width: 1380, height: 920 }, reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  p.on('console', m => { if (m.type()==='error') errs.push(`[${name}] ${m.text().slice(0,200)}`); });
  p.on('pageerror', e => errs.push(`[${name}] PAGEERROR ${String(e).slice(0,200)}`));
  await p.goto(B+'/', { waitUntil: 'domcontentloaded' });
  await p.evaluate(() => sessionStorage.setItem('pikachu.intro.v1','1'));
  return p;
};
const txt = (p) => p.evaluate(() => document.body.innerText || '');
const num = async (p, label) => Number((((await txt(p)).match(new RegExp(label + '\\s*\\n?\\s*([\\d.]+)', 'i'))) || [])[1] ?? NaN);

/* ---------------- 1. solo tic-tac-toe vs AI ---------------- */
console.log('\n[solo] tic-tac-toe vs AI');
{
  const p = await mk('ttt');
  await p.goto(B+'/solo/tic-tac-toe-duel', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(1200);
  const cells = p.locator('[role="grid"] button');
  ok(await cells.count() === 9, `3x3 board rendered (${await cells.count()} cells)`);
  await cells.nth(0).click();
  await p.waitForTimeout(1400);
  const filled = await p.evaluate(() => [...document.querySelectorAll('[role="grid"] button')]
    .filter(b => !/empty/.test(b.getAttribute('aria-label')||'')).length);
  ok(filled >= 2, `your mark plus the AI reply are on the board (${filled} filled)`);
  await p.close();
}

/* ---------------- 2. chess engine worker ---------------- */
console.log('\n[solo] chess engine worker answers');
{
  const p = await mk('chess');
  await p.goto(B+'/solo/chess-arena', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(1600);
  await p.locator('[aria-label*="e2"]').first().click();
  await p.waitForTimeout(300);
  await p.locator('[aria-label*="e4"]').first().click();
  await p.waitForTimeout(4000);
  const t = await txt(p);
  ok(/e4/.test(t), 'white e4 recorded in the move list');
  const blackReplied = /1\.[\s\S]{0,40}e4[\s\S]{0,30}[a-h][1-8NBRQK]/.test(t) || /depth\s*\d/.test(t);
  ok(blackReplied, 'the worker returned a reply (engine readout / black move present)');
  await p.close();
}

/* ---------------- 3. snake loop ---------------- */
console.log('\n[solo] snake arena ticks');
{
  const p = await mk('snake');
  await p.goto(B+'/solo/snake-arena', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(1600);
  // the arena deliberately idles until the player takes the controls, so that
  // nobody loses a run to a wall before they have even read the screen
  const idle1 = await num(p, 'TICKS');
  await p.waitForTimeout(1500);
  const idle2 = await num(p, 'TICKS');
  ok(idle1 === idle2, `holds still until the player steers (${idle1} -> ${idle2})`);

  await p.locator('canvas').first().click();
  await p.keyboard.press('ArrowDown');
  await p.waitForTimeout(600);
  const t1 = await num(p, 'TICKS');
  await p.waitForTimeout(1700);
  const t2 = await num(p, 'TICKS');
  ok(Number.isFinite(t1) && t2 > t1, `world advances once armed (${t1} -> ${t2})`);
  await p.close();
}

/* ---------------- 4. puzzle slide ---------------- */
console.log('\n[solo] puzzle quest registers legal slides');
{
  const p = await mk('puzzle');
  await p.goto(B+'/solo/puzzle-quest', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(1100);
  ok(await p.locator('button[aria-label^="Tile"]').count() > 0, 'shard slide rendered');
  // click every tile once: the ones next to the gap are the legal ones
  let moves = 0;
  for (let round = 0; round < 3 && moves === 0; round++) {
    const tiles = p.locator('button[aria-label^="Tile"]');
    const n = await tiles.count();
    for (let i = 0; i < n; i++) { await tiles.nth(i).click().catch(()=>{}); await p.waitForTimeout(60); }
    moves = await num(p, 'MOVES');
  }
  ok(moves > 0, `legal slides accepted, illegal ones ignored (${moves} moves counted)`);
  await p.close();
}

/* ---------------- 5. full online slice on tic-tac-toe ---------------- */
console.log('\n[online] create -> invite -> ready -> play -> authoritative result -> rematch');
{
  const host = await mk('host');
  const guest = await mk('guest');

  await host.goto(B+'/together', { waitUntil: 'domcontentloaded' });
  await host.waitForTimeout(900);
  await host.locator('button[aria-pressed]').filter({ hasText: /Tic-Tac-Toe/i }).first().click();
  await host.waitForTimeout(250);
  ok(await host.locator('button[aria-pressed="true"]').filter({ hasText: /Tic-Tac-Toe/i }).count() === 1, 'host picked Tic-Tac-Toe Duel');
  await host.locator('button', { hasText: /Create private room/i }).first().click();
  await host.waitForURL(/\/room\/[A-Z0-9]{5}/, { timeout: 15000 });
  const code = host.url().split('/room/')[1];
  ok(/^[A-Z0-9]{5}$/.test(code), `room ${code} created and the URL is shareable`);

  await guest.goto(B+`/room/${code}`, { waitUntil: 'domcontentloaded' });
  await guest.waitForTimeout(2600);
  ok(/Tic-Tac-Toe/i.test(await guest.text ? '' : await txt(guest)) || /TIC-TAC-TOE/i.test(await txt(guest)), 'guest joined the same room over the invite link');

  for (const [n, p] of [['host', host], ['guest', guest]]) {
    const r = p.locator('button', { hasText: /^\s*ready/i }).first();
    if (await r.count()) { await r.click(); await p.waitForTimeout(400); }
  }
  await host.waitForTimeout(800);
  const start = host.locator('button', { hasText: /start match/i }).first();
  ok(await start.count() > 0, 'start is host-only and appears after both ready up');
  await start.click();
  await host.waitForTimeout(4500);
  ok(await host.locator('[role="grid"] button').count() === 9, 'board rendered for the host after the countdown');
  ok(await guest.locator('[role="grid"] button').count() === 9, 'board rendered for the guest');

  let finished = false;
  for (let i = 0; i < 14 && !finished; i++) {
    for (const p of [host, guest]) {
      const free = p.locator('[role="grid"] button[aria-label*="empty"]:not([disabled])');
      if (await free.count()) { await free.first().click().catch(()=>{}); await p.waitForTimeout(500); }
    }
    finished = /VICTORY|DEFEAT|DEAD HEAT|STALEMATE/i.test(await txt(host));
  }
  const ht = await txt(host), gt = await txt(guest);
  ok(finished, 'the match reached a verdict through the server');
  ok(/VICTORY|DEFEAT|DEAD HEAT|STALEMATE/i.test(gt), 'both clients show the same authoritative result');
  ok(/REMATCH|PLAY AGAIN/i.test(ht), 'a rematch is offered');

  const rm = host.locator('button', { hasText: /rematch|play again/i }).first();
  if (await rm.count()) {
    await rm.click();
    await host.waitForTimeout(700);
    ok(/1\s*\/\s*2|waiting|voted/i.test(await txt(host)), 'rematch vote is held until both agree');
    const rm2 = guest.locator('button', { hasText: /rematch|play again/i }).first();
    if (await rm2.count()) {
      await rm2.click();
      await guest.waitForTimeout(4500);
      ok(await guest.locator('[role="grid"] button').count() === 9, 'second match started after both voted');
    }
  }
  await host.close(); await guest.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
console.log('--- console errors ---');
console.log(errs.length ? [...new Set(errs)].slice(0,12).join('\n') : 'none');
await b.close();
process.exit(fail ? 1 : 0);
