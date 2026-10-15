/**
 * Volt Runner — the Chrome-dino-style endless runner.
 *
 * The question this suite answers is not "does it draw" but "is it a real,
 * fair game": a bot that knows only what a player can see has to be able to
 * survive a long run, and a player who does nothing has to die quickly. It also
 * re-pins the Close-button regression that was reported three separate times.
 *
 * The bot runs INSIDE the page on requestAnimationFrame. Driving it over CDP
 * from node added ~250ms of latency per decision, which made a perfectly fair
 * game look unwinnable.
 */
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:5173';
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(`${c ? ' ok ' : 'FAIL'}  ${m}`); };

const b = await chromium.launch({ args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const PHONE = process.argv.includes('--phone');
const ctx = await b.newContext(PHONE
  ? { viewport: { width: 393, height: 727 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
      userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36' }
  : { viewport: { width: 1180, height: 860 } });
if (PHONE) console.log('--- running the suite at 393x727 (phone zoom) ---');
await ctx.addInitScript(() => sessionStorage.setItem('pikachu.intro.v1', '1'));
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(String(e).slice(0, 180)));
p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 180)); });

await p.goto(`${BASE}/solo/electric-arcade`, { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);
const cv = p.locator('canvas').first();
await cv.click({ position: { x: 60, y: 40 } });

const W = () => p.evaluate(() => {
  const w = document.querySelector('canvas').__world;
  return { over: w.over, dist: Math.floor(w.dist), score: Math.floor(w.score), y: Math.round(w.y),
           air: w.airborne, duck: w.ducking, night: +w.night.toFixed(2), charges: w.charges };
});

/** Play one run in-page until death or `budget` ms elapse. */
const play = (budget) => p.evaluate(async (ms) => {
  const cv = document.querySelector('canvas');
  /* Read the tuning off the live world instead of hardcoding the desktop
     numbers: the phone build zooms in, which changes the player's x, gravity
     and therefore airtime. A bot using desktop constants would mistime every
     jump and "prove" the zoom broke the game. */
  const t0w = cv.__world;
  const TUNE = (t0w && t0w.tune) || { px: 820 * 0.17, grav: 2650 };
  const PX = TUNE.px;
  const G = TUNE.grav, JV = 860, AIR = (2 * JV) / G;
  const t0 = performance.now();
  let minGapSec = 99;
  return await new Promise((res) => {
    const step = () => {
      const w = cv.__world;
      if (!w) { requestAnimationFrame(step); return; }
      if (w.over) {
        const k = w.obs.find((o) => o.hit && o.kind !== 'charge');
        return res({ over: true, dist: Math.floor(w.dist), killer: k ? k.kind : '?', y: Math.round(w.y), air: w.airborne, minGapSec });
      }
      if (performance.now() - t0 > ms) {
        return res({ over: false, dist: Math.floor(w.dist), score: Math.floor(w.score), charges: w.charges, night: +w.night.toFixed(2), minGapSec });
      }
      const sp = w.base * Math.min(2.45, 1 + w.dist / 2800);

      // Tightest spacing between PATTERNS, in seconds. Anything within 140px is
      // one pattern (the double-bush cluster is deliberately tight) so the floor
      // measures reaction time, not sprite spacing.
      const hz = w.obs.filter((o) => o.kind !== 'charge' && !o.hit).map((o) => o.x).sort((a, c) => a - c);
      const groups = [];
      for (const x of hz) { if (!groups.length || x - groups[groups.length - 1] > 140) groups.push(x); }
      for (let i = 1; i < groups.length; i++) minGapSec = Math.min(minGapSec, (groups[i] - groups[i - 1]) / sp);

      // Time until the obstacle's centre reaches the player's centre. Jumping
      // when that equals half the airtime puts the apex exactly on the obstacle,
      // which is the only timing that clears a wide one at low speed.
      let duck = false, wantJump = false, blocked = false;
      for (const o of w.obs) {
        if (o.hit) continue;
        const c = (o.x - PX) / sp;
        if (c < -0.25) continue;
        if (o.kind === 'drone-low') { if (c < 0.22 && c > -0.18) duck = true; }
        else if (o.kind === 'drone-high') { if (c > -0.10 && c < AIR) blocked = true; }
        else if (o.kind === 'charge') { if (c > 0 && c <= AIR / 2) wantJump = true; }
        else if (c > 0 && c <= AIR / 2) wantJump = true;
      }
      if (wantJump && !blocked && !w.airborne) { w.vy = -JV; w.airborne = true; w.ducking = false; }
      if (!w.airborne) w.ducking = duck;
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}, budget);

/* ---------------- A. assets and a painted frame ---------------- */
ok(await p.evaluate(() => Promise.all(['runner.png', 'charge.webp', 'drone.webp', 'tree.webp', 'wall.webp']
  .map((n) => fetch('/art/run/' + n).then((x) => x.ok))).then((r) => r.every(Boolean))),
  'A1 all five runner sprites serve 200');
const painted = await p.evaluate(() => {
  const c = document.querySelector('canvas');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const seen = new Set();
  for (let i = 0; i < d.length; i += 4000) seen.add(`${d[i]},${d[i + 1]},${d[i + 2]}`);
  return seen.size;
});
ok(painted > 6, `A2 canvas is painted, not blank (${painted} distinct samples)`);

/* ---------------- B. a run opens in daylight ---------------- */
await p.keyboard.press('Space');
await p.waitForTimeout(300);
ok((await W()).night < 0.25, `B1 a run starts in daylight (night=${(await W()).night})`);

/* ---------------- C. the game is actually clearable ---------------- */
const r1 = await play(55000);
ok(!r1.over, `C1 a sighted bot survives 55s (${r1.over ? `died ${r1.dist}m on a ${r1.killer}, y=${r1.y}` : `${r1.dist}m`})`);
ok(r1.dist > 1800, `C2 that run covered real ground (${r1.dist} m, score ${r1.score})`);
ok(r1.charges > 0, `C3 floating charges sit inside a normal jump arc (${r1.charges} collected)`);
ok(r1.night > 0.3, `C4 the day/night cycle turns over (night=${r1.night})`);
ok(r1.minGapSec >= 0.95, `C5 no two hazards ever arrive closer than one jump + reaction (${r1.minGapSec.toFixed(2)}s, floor 0.95)`);

/* ---------------- D. doing nothing kills you ---------------- */
await p.reload({ waitUntil: 'networkidle' });
await p.waitForTimeout(1300);
await cv.click({ position: { x: 60, y: 40 } });
await p.keyboard.press('Space');
await p.waitForTimeout(16000);
const idle = await W();
ok(idle.over, `D1 an idle run ends — collision is real (died at ${idle.dist} m)`);
ok(await p.getByRole('dialog').count() > 0, 'D2 the run end raises the result card');

/* ---------------- E. the Close regression, again ---------------- */
const bestOf = () => p.evaluate(() => JSON.parse(localStorage.getItem('pikachu.progress.v1') || '{}')?.stats?.arcade?.best ?? 0);
const b1 = await bestOf();
await p.getByRole('button', { name: /close/i }).click();
await p.waitForTimeout(500);
ok(await p.getByRole('dialog').count() === 0, 'E1 Close dismisses the result card');
await p.waitForTimeout(1800);
ok(await p.getByRole('dialog').count() === 0, 'E2 it stays dismissed (no re-open)');
ok(await bestOf() === b1, 'E3 dismissing does not bank the score a second time');
await p.keyboard.press('Space');
await p.waitForTimeout(900);
const re = await W();
ok(!re.over && re.dist < 400, 'E4 space after closing starts a fresh run');

/* ---------------- F. jump and duck are real ---------------- */
await p.keyboard.down('ArrowDown');
await p.waitForTimeout(250);
const d1 = await W();
await p.keyboard.up('ArrowDown');
await p.waitForTimeout(250);
ok(d1.duck && !(await W()).duck, 'F1 holding down ducks, releasing stands back up');
await p.keyboard.press('Space');
await p.waitForTimeout(170);
const j = await W();
ok(j.air && j.y > 40, `F2 space leaves the ground (y=${j.y})`);
// airtime depends on the zoom, so wait for the world's own airtime, not 900ms
const airMs = await p.evaluate(() => ((document.querySelector('canvas').__world?.tune?.air) ?? 0.649) * 1000);
await p.waitForTimeout(airMs + 500);
ok(!(await W()).air, `F3 and gravity brings it back down (airtime ${Math.round(airMs)}ms)`);

/* ---------------- G. pace switch resets ---------------- */
// below `sm` the game settings are collapsed behind a disclosure
const disc = p.getByRole('button', { name: /game settings/i });
if (await disc.count() && await disc.isVisible()) { await disc.click(); await p.waitForTimeout(300); }
await p.getByRole('radio', { name: 'Frantic' }).click();
await p.waitForTimeout(500);
const g = await W();
ok(g.dist === 0 && !g.over, `G1 changing pace resets the run and stops the sim dead (dist=${g.dist})`);
await p.keyboard.press('Space');
await p.waitForTimeout(600);
ok((await W()).dist > 0, 'G2 and it launches again at the new pace');

/* ---------------- H. frantic is also clearable ---------------- */
const r2 = await play(26000);
ok(!r2.over, `H1 the bot survives 26s on Frantic too (${r2.over ? `died ${r2.dist}m on a ${r2.killer}` : `${r2.dist}m`})`);
ok(r2.minGapSec >= 0.95, `H2 frantic keeps the fairness floor (${r2.minGapSec.toFixed(2)}s)`);

ok(errs.length === 0, `I1 no console or page errors (${errs.slice(0, 2).join(' | ')})`);

console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
process.exit(fail ? 1 : 0);
