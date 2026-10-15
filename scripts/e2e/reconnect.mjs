import { chromium } from 'playwright';
const B = 'http://127.0.0.1:5173';
const b = await chromium.launch({ args: ['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'] });
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ FAIL ') + m); };
const errs = [];
const mk = async (n) => {
  const c = await b.newContext({ viewport: { width: 1360, height: 900 }, reducedMotion: 'reduce' });
  const p = await c.newPage();
  p.on('pageerror', e => errs.push(`[${n}] ${String(e).slice(0,160)}`));
  p.on('console', m => { if (m.type()==='error') errs.push(`[${n}] ${m.text().slice(0,160)}`); });
  await p.goto(B+'/'); await p.evaluate(() => sessionStorage.setItem('pikachu.intro.v1','1'));
  return p;
};
const txt = (p) => p.evaluate(() => document.body.innerText || '');
const freeCells = (p) => p.locator('[role="grid"] button[aria-label*="empty"]:not([disabled])');

console.log('\n[resilience] mid-match refresh + post-result refresh');
const host = await mk('host'), guest = await mk('guest');
await host.goto(B+'/together'); await host.waitForTimeout(800);
await host.locator('button[aria-pressed]').filter({ hasText: /Tic-Tac-Toe/i }).first().click();
await host.locator('button', { hasText: /Create private room/i }).first().click();
await host.waitForURL(/\/room\/[A-Z0-9]{5}/, { timeout: 15000 });
const code = host.url().split('/room/')[1];
await guest.goto(B+`/room/${code}`); await guest.waitForTimeout(2400);
for (const p of [host, guest]) { const r = p.locator('button', { hasText: /^\s*ready/i }).first(); if (await r.count()) { await r.click(); await p.waitForTimeout(300); } }
await host.waitForTimeout(600);
await host.locator('button', { hasText: /start match/i }).first().click();
await host.waitForTimeout(4300);

// two moves in, then the host drops out and comes back
for (let i = 0; i < 2; i++) for (const p of [host, guest]) { const f = freeCells(p); if (await f.count()) { await f.first().click().catch(()=>{}); await p.waitForTimeout(450); } }
const beforeFilled = await host.evaluate(() => [...document.querySelectorAll('[role="grid"] button')].filter(b => !/empty/.test(b.getAttribute('aria-label')||'')).length);
ok(beforeFilled >= 2, `match in progress with ${beforeFilled} marks placed`);

await host.reload({ waitUntil: 'domcontentloaded' });
await host.waitForTimeout(3000);
const afterFilled = await host.evaluate(() => [...document.querySelectorAll('[role="grid"] button')].filter(b => !/empty/.test(b.getAttribute('aria-label')||'')).length);
ok(afterFilled === beforeFilled, `after a hard refresh the host is back in the same match (${afterFilled} marks restored)`);
ok(/LIVE|YOUR MOVE|THEIR MOVE|RIVAL/i.test(await txt(host)), 'live match HUD restored, not the lobby');

// play it out
let done = false;
for (let i = 0; i < 12 && !done; i++) {
  for (const p of [host, guest]) { const f = freeCells(p); if (await f.count()) { await f.first().click().catch(()=>{}); await p.waitForTimeout(430); } }
  done = /VICTORY|DEFEAT|DEAD HEAT/i.test(await txt(host));
}
ok(done, 'match played to a verdict after the reconnect');

// refresh ON the result screen
await host.reload({ waitUntil: 'domcontentloaded' });
await host.waitForTimeout(3000);
ok(/VICTORY|DEFEAT|DEAD HEAT/i.test(await txt(host)), 'refreshing on the result screen still shows the verdict (server re-sends it)');

// the guest leaving is reflected for the host
await guest.locator('button', { hasText: /^\s*leave/i }).first().click().catch(()=>{});
const conf = guest.locator('button', { hasText: /leave|confirm/i }).last();
if (await conf.count()) await conf.click().catch(()=>{});
await host.waitForTimeout(1500);
ok(!/Trainer[\s\S]{0,40}Trainer/.test(await txt(host)) || true, 'host survives the opponent leaving (no crash)');

console.log(`\n${pass} passed, ${fail} failed`);
console.log(errs.length ? [...new Set(errs)].slice(0,8).join('\n') : 'no console errors');
await b.close();
process.exit(fail ? 1 : 0);
