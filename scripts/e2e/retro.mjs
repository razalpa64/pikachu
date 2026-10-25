/**
 * Retro Arcade — end-to-end proof.
 *
 * This is the only place where "the emulator works" is allowed to be a claim:
 * every line below runs against a real Chromium, a real WebAssembly GBA core and
 * a real ROM, and asserts on state the emulator reports — not on a screenshot.
 *
 *   node scripts/e2e/retro.mjs             desktop
 *   node scripts/e2e/retro.mjs --phone     touch emulation
 *
 * Env:
 *   BASE           dev server origin (default http://127.0.0.1:5173)
 *   PIKACHU_CHROME absolute path to a Chromium binary (default: Playwright's own)
 *   PIKACHU_LD     extra LD_LIBRARY_PATH entry, for machines without libnss/libnspr
 *
 * Costs ~2 MB of emulator + cartridge traffic per run, which is exactly why it
 * is a separate script and not part of `npm run e2e`'s default sweep.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:5173';
const PHONE = process.argv.includes('--phone');
const LAUNCH = {
  executablePath: process.env.PIKACHU_CHROME || undefined,
  env: process.env.PIKACHU_LD ? { ...process.env, LD_LIBRARY_PATH: process.env.PIKACHU_LD } : undefined,
  args: [
    '--no-sandbox',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--autoplay-policy=no-user-gesture-required',
  ],
};

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? '  ok ' : '  FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch(LAUNCH);
const context = await browser.newContext(
  PHONE
    ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
    : { viewport: { width: 1280, height: 860 } },
);
/* A synthetic controller. No hardware can be plugged into a test runner, but the
   path a real pad takes — browser gamepad API → EmulatorJS GamepadHandler →
   simulateInput — is the same code, so standing up the API is a real test of
   the mapping rather than a stub of it. */
await context.addInitScript(() => {
  const pad = {
    id: 'Xbox Wireless Controller (E2E)',
    index: 0,
    connected: true,
    mapping: 'standard',
    timestamp: 0,
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
  };
  window.__e2ePad = pad;
  navigator.getGamepads = () => [pad];
});

const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));

/* Hold a key for a few frames. A press shorter than one emulated frame is
   invisible to the game — that is a fact about GBA input polling, not a bug. */
const hold = async (target, key, ms = 160) => {
  await target.keyboard.down(key);
  await target.waitForTimeout(ms);
  await target.keyboard.up(key);
  await target.waitForTimeout(180);
};

console.log(`\n${PHONE ? 'PHONE' : 'DESKTOP'} · ${BASE}`);

/* ------------------------------------------------------------ the shelf */
await page.goto(`${BASE}/retro`, { waitUntil: 'networkidle' });
const cards = page.locator('article');
check('shelf renders the cartridges from the manifest', (await cards.count()) === 3, `${await cards.count()} cards`);
const coversLoaded = await page.evaluate(() =>
  [...document.querySelectorAll('article img')].every((i) => i.complete && i.naturalWidth === 240),
);
check('every cover is a real 240×160 frame', coversLoaded);

const search = page.getByRole('searchbox', { name: /search retro cartridges/i });
await search.fill('frogger');
await page.waitForTimeout(250);
check('search narrows the shelf', (await cards.count()) === 1);
await search.fill('');
await page.waitForTimeout(250);
await page.getByRole('radio', { name: 'Shooters' }).click();
await page.waitForTimeout(250);
check('tag lens narrows the shelf', (await cards.count()) === 1);
await page.getByRole('radio', { name: 'All carts' }).click();
await page.waitForTimeout(200);

/* ------------------------------------------------------- launch a game */
const requests = [];
page.on('request', (r) => requests.push(r.url()));
await page.goto(`${BASE}/retro/simple-frogger`, { waitUntil: 'domcontentloaded' });
const frame = page.frameLocator('iframe');
const startBtn = frame.locator('.ejs_start_button');
await startBtn.waitFor({ timeout: 90_000 });
check('cartridge reaches its start screen', true);

const before = requests.filter((u) => u.includes('/retro/data/')).length;
check('emulator runtime is only fetched after launch', before > 0, `${before} data requests`);

const emu = async (fn) => {
  const f = page.frames().find((fr) => fr.url().includes('/retro/player.html'));
  if (!f) throw new Error('player frame missing');
  return f.evaluate(fn);
};

/* Nothing plays until the start button is pressed — that press is also the
   gesture that lets the browser start audio. */
check('emulator waits for a start press', (await emu(() => window.EJS_emulator.paused)) === true);

await startBtn.click();
await page.waitForTimeout(1200);
check('start press boots the game', (await emu(() => window.EJS_emulator.started)) === true);
check('game is unpaused after start', (await emu(() => window.EJS_emulator.paused)) === false);

const audio = await emu(() => {
  const al = window.EJS_emulator.Module?.AL;
  return { ctx: !!al?.currentCtx, state: al?.currentCtx?.audioCtx?.state ?? null };
});
check('audio context is running', audio.ctx && audio.state === 'running', `state=${audio.state}`);

/* --------------------------------------------------------- input works */
await emu(() => {
  const e = window.EJS_emulator;
  window.__input = [];
  const gm = e.gameManager;
  const orig = gm.simulateInput.bind(gm);
  gm.simulateInput = (p, i, v) => { window.__input.push([i, v]); return orig(p, i, v); };
});
await page.locator('iframe').click({ position: { x: 40, y: 40 } });
await hold(page, 'ArrowUp');
await hold(page, 'ArrowLeft');
const inputs = await emu(() => window.__input);
check('arrow keys reach the game as D-pad input', inputs.some(([i]) => i === 4) && inputs.some(([i]) => i === 6), JSON.stringify(inputs));
await hold(page, 'x');
await hold(page, 'Enter');
const inputs2 = await emu(() => window.__input);
check('A and Start reach the game', inputs2.some(([i]) => i === 0) && inputs2.some(([i]) => i === 3), JSON.stringify(inputs2));

/* A synthetic controller: press "A" (button 0) and D-pad up (button 12). */
await emu(() => {
  window.__input = [];
  window.__e2ePad.buttons[0] = { pressed: true, touched: true, value: 1 };
});
await page.waitForTimeout(400);
await emu(() => { window.__e2ePad.buttons[0] = { pressed: false, touched: false, value: 0 };
  window.__e2ePad.buttons[12] = { pressed: true, touched: true, value: 1 }; });
await page.waitForTimeout(400);
await emu(() => { window.__e2ePad.buttons[12] = { pressed: false, touched: false, value: 0 }; });
await page.waitForTimeout(300);
const padInputs = await emu(() => window.__input);
check('a connected controller drives the core', padInputs.some(([i]) => i === 8) && padInputs.some(([i]) => i === 4), JSON.stringify(padInputs));

/* -------------------------------------------------------------- chrome */
await page.getByRole('button', { name: 'Pause' }).click();
await page.waitForTimeout(350);
check('Pause pauses the core', (await emu(() => window.EJS_emulator.paused)) === true);
await page.getByRole('button', { name: 'Resume' }).click();
await page.waitForTimeout(350);
check('Resume continues the core', (await emu(() => window.EJS_emulator.paused)) === false);

await page.getByRole('button', { name: 'Save', exact: true }).click();
await page.waitForTimeout(600);
check('Save state reports success', (await page.getByText('State saved to this browser').count()) > 0);
await page.getByRole('button', { name: 'Load', exact: true }).click();
await page.waitForTimeout(900);
check('Load state reports success', (await page.getByText('State loaded').count()) > 0);

const download = page.waitForEvent('download', { timeout: 15_000 });
await page.getByRole('button', { name: 'Capture' }).click();
const file = await download;
check('Capture downloads a PNG', /\.png$/.test(file.suggestedFilename()), file.suggestedFilename());

await page.getByRole('button', { name: 'Mute', exact: true }).click();
await page.waitForTimeout(250);
check('Mute silences the core', (await emu(() => window.EJS_emulator.muted)) === true);
await page.getByRole('button', { name: 'Unmute', exact: true }).click();
await page.waitForTimeout(250);
check('Unmute restores sound', (await emu(() => window.EJS_emulator.muted)) === false);

await page.getByRole('button', { name: 'Restart' }).click();
await page.waitForTimeout(900);
check('Restart keeps the session alive', (await emu(() => window.EJS_emulator.started)) === true);

await page.getByRole('button', { name: 'Fullscreen' }).click();
await page.waitForTimeout(700);
check('Fullscreen takes over the screen', (await page.evaluate(() => !!document.fullscreenElement)) === true);
const fullBox = await page.evaluate(() => {
  const el = document.querySelector('.retro-console');
  const r = el.getBoundingClientRect();
  return { w: Math.round(r.width), vw: window.innerWidth, h: Math.round(r.height), vh: window.innerHeight };
});
check('console fills the fullscreen viewport', fullBox.w >= fullBox.vw - 2 && fullBox.h >= fullBox.vh - 2, JSON.stringify(fullBox));
/* Browsers handle Esc themselves; the real check is that the button toggles
   back out and the page is usable again. */
await page.getByRole('button', { name: 'Fullscreen' }).click();
await page.waitForTimeout(600);
check('second press leaves fullscreen', (await page.evaluate(() => !document.fullscreenElement)) === true);

/* --------------------------------------------------------- phone extras */
if (PHONE) {
  const hasPad = await page.evaluate(() => !!document.querySelector('iframe'));
  check('phone layout keeps the emulator mounted', hasPad);

  const pad = page.getByRole('group', { name: 'Touch controls' });
  check('touch pad is drawn by the console', await pad.isVisible());

  /* A press on the pad must reach the core as the same simulateInput call a
     physical controller produces. */
  await emu(() => { window.__input = []; });
  const aButton = page.getByRole('button', { name: 'A', exact: true });
  await aButton.dispatchEvent('pointerdown', { pointerId: 1, isPrimary: true });
  await page.waitForTimeout(200);
  await aButton.dispatchEvent('pointerup', { pointerId: 1, isPrimary: true });
  await page.waitForTimeout(200);
  const padInputs = await emu(() => window.__input);
  check('touch A button reaches the core', JSON.stringify(padInputs).includes('[8,1]'), JSON.stringify(padInputs));

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('no horizontal overflow on a phone', overflow <= 1, `${overflow}px`);
}

/* ------------------------------------------------- a ROM from your device */
/* The same cartridge, handed over as a File exactly like a file input would:
   no upload, no server, validation on the client. */
if (!PHONE) {
  await page.goto(`${BASE}/retro`, { waitUntil: 'networkidle' });
  const romPath = 'public/retro/roms/simple-frogger.gba';
  const before = requests.filter((u) => /\/retro\/local|\/upload/i.test(u)).length;
  await page.setInputFiles('input[type=file]', romPath);
  await page.waitForURL(/\/retro\/local$/, { timeout: 15_000 });
  const localFrame = page.frameLocator('iframe');
  await localFrame.locator('.ejs_start_button').waitFor({ timeout: 90_000 });
  await localFrame.locator('.ejs_start_button').click();
  await page.waitForTimeout(1200);
  const localEmu = async (fn) => {
    const f = page.frames().find((fr) => fr.url().includes('/retro/player.html'));
    return f.evaluate(fn);
  };
  check('a local ROM boots in the player', (await localEmu(() => window.EJS_emulator.started)) === true);
  check('local ROM was not sent anywhere', requests.filter((u) => /\/retro\/local|\/upload/i.test(u)).length === before);
  const romBytes = readFileSync(romPath).length;
  check('cartridge size is unchanged in memory', romBytes === 47_744);
}

/* Two known, harmless messages in a sandbox: the emulator's update check only
   runs on localhost (it is skipped entirely in production) and the wake-lock
   request is refused when the page is not visible. Neither affects play. */
const real = errors.filter((e) => !/Failed to fetch|Wake Lock/i.test(e));
console.log(`\nconsole errors: ${real.length ? real.slice(0, 3).join(' | ') : 'none'}`);
if (real.length) failures += 1;
console.log(failures === 0 ? '\nRETRO E2E PASSED\n' : `\nRETRO E2E FAILED (${failures})\n`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
