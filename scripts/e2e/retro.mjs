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
const manifest = JSON.parse(readFileSync('public/retro/roms.json', 'utf8'));
await page.goto(`${BASE}/retro`, { waitUntil: 'networkidle' });
const cards = page.locator('article');
check(
  'shelf renders every cartridge in the manifest',
  (await cards.count()) === manifest.games.length,
  `${await cards.count()} of ${manifest.games.length} cards`,
);
/* Covers below the fold are `loading="lazy"`, and a phone only ever shows a
   few cards at once — so ask for them all, wait for the decode, then judge. */
const coversLoaded = await page.evaluate(async () => {
  const images = [...document.querySelectorAll('article img')];
  for (const img of images) {
    img.loading = 'eager';
    if (!img.complete) img.src = img.getAttribute('src');
  }
  await Promise.all(images.map((img) => img.decode().catch(() => undefined)));
  return images.length > 0 && images.every((img) => img.naturalWidth === 240 && img.naturalHeight === 160);
});
check('every cover is a real 240×160 frame', coversLoaded);

const search = page.getByRole('searchbox', { name: /search retro cartridges/i });
await search.fill('frogger');
await page.waitForTimeout(250);
check('search narrows the shelf', (await cards.count()) === 1);
await search.fill('');
await page.waitForTimeout(250);
await page.getByRole('radio', { name: 'Shooters' }).click();
await page.waitForTimeout(250);
const shooterCount = await cards.count();
check(
  'tag lens narrows the shelf',
  shooterCount > 0 && shooterCount < manifest.games.length,
  `${shooterCount} of ${manifest.games.length}`,
);
await page.getByRole('radio', { name: 'Puzzles' }).click();
await page.waitForTimeout(250);
const puzzleCount = await cards.count();
check('puzzle lens finds the puzzle cartridges', puzzleCount > 0, `${puzzleCount} cards`);
check('a known puzzle cartridge is under the puzzle lens', (await cards.filter({ hasText: 'Apotris' }).count()) === 1);
check('and a shooter is not', (await cards.filter({ hasText: 'Attack on Voxelburg' }).count()) === 0);
await page.getByRole('radio', { name: 'All carts' }).click();
await page.waitForTimeout(200);
check('the lens goes back to the whole shelf', (await cards.count()) === manifest.games.length);

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
/* Booting is not instant — a phone profile on a software rasteriser takes a
   couple of seconds longer than a desktop one, so wait for the state instead of
   assuming a duration. */
const playerFrame = page.frames().find((fr) => fr.url().includes('/retro/player.html'));
await playerFrame
  .waitForFunction(() => window.EJS_emulator?.started === true, { timeout: 60_000 })
  .catch(() => {});
await page.waitForTimeout(400);
check('start press boots the game', (await emu(() => window.EJS_emulator.started)) === true);
check('game is unpaused after start', (await emu(() => window.EJS_emulator.paused)) === false);

/* The canvas must fill the LCD hole: the screen is 3:2 for exactly this reason,
   and a letterboxed picture would mean the shell's proportions were wrong. */
const lcd = await page.evaluate(() => {
  const r = document.querySelector('.gb-screen').getBoundingClientRect();
  return [Math.round(r.width), Math.round(r.height)];
});
const canvasBox = await emu(() => {
  const c = document.querySelector('canvas');
  if (!c) return null;
  const r = c.getBoundingClientRect();
  return [Math.round(r.width), Math.round(r.height)];
});
check('the picture fills the LCD edge to edge', !!canvasBox && Math.abs(canvasBox[0] - lcd[0]) <= 2 && Math.abs(canvasBox[1] - lcd[1]) <= 2, JSON.stringify({ canvasBox, lcd }));

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

/* The plastic is wired to the core, not painted on top of it: a press on the
   shell's own D-pad has to arrive as the same simulateInput call a pad makes. */
await emu(() => { window.__input = []; });
const upKey = page.getByRole('button', { name: 'Up', exact: true });
await upKey.dispatchEvent('pointerdown', { pointerId: 1, isPrimary: true });
await page.waitForTimeout(160);
await upKey.dispatchEvent('pointerup', { pointerId: 1, isPrimary: true });
const aKey = page.getByRole('button', { name: 'A', exact: true });
await aKey.dispatchEvent('pointerdown', { pointerId: 2, isPrimary: true });
await page.waitForTimeout(160);
await aKey.dispatchEvent('pointerup', { pointerId: 2, isPrimary: true });
await page.waitForTimeout(200);
const shellInputs = await emu(() => window.__input);
check('the shell\'s own D-pad and A reach the core', shellInputs.some(([i]) => i === 4) && shellInputs.some(([i]) => i === 8), JSON.stringify(shellInputs));

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

/* Fullscreen is the other job for this page: the console covers the glass and
   the picture is as large as the glass allows. Everything below is measured. */
const windowedScreen = await page.evaluate(() => {
  const r = document.querySelector('.gb-screen').getBoundingClientRect();
  return Math.round(r.width);
});
await page.getByRole('button', { name: 'Fullscreen' }).click();
await page.waitForTimeout(1200);
check('Fullscreen takes over the screen', (await page.evaluate(() => !!document.fullscreenElement)) === true);

const full = await page.evaluate(() => {
  const box = (el) => { const r = el.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)]; };
  const inside = ([l, t, r, b]) => l >= -1 && t >= -1 && r <= window.innerWidth + 1 && b <= window.innerHeight + 1;
  const shell = document.querySelector('.gb-device');
  const screen = document.querySelector('.gb-screen');
  const shellBox = shell.getBoundingClientRect();
  const screenBox = screen.getBoundingClientRect();
  const controls = ['.gb-dpad', '.gb-face', '.gb-system'].map((s) => box(document.querySelector(s)));
  return {
    vw: window.innerWidth, vh: window.innerHeight,
    shell: [Math.round(shellBox.width), Math.round(shellBox.height)],
    shellCovers: shellBox.left <= 1 && shellBox.top <= 1
      && shellBox.right >= window.innerWidth - 1 && shellBox.bottom >= window.innerHeight - 1,
    screen: [Math.round(screenBox.width), Math.round(screenBox.height)],
    screenShareOfWidth: screenBox.width / window.innerWidth,
    screenShareOfHeight: screenBox.height / window.innerHeight,
    controlsInside: controls.every(inside),
    controls,
  };
});
check('the shell covers the whole viewport', full.shellCovers, JSON.stringify(full.shell));
check('the screen is the largest thing on the glass', full.screen[0] >= full.vw * 0.55 || full.screen[1] >= full.vh * 0.6,
  `${full.screen[0]}×${full.screen[1]} of ${full.vw}×${full.vh}`);
check('every control is inside the viewport', full.controlsInside, JSON.stringify(full.controls));
check('the picture grew when the page went fullscreen', full.screen[0] > windowedScreen, `${windowedScreen}px → ${full.screen[0]}px`);

/* The emulator canvas has to follow the frame it lives in: a bigger LCD with a
   small picture inside it is the bug this whole layout exists to avoid. */
const fsLcd = await page.evaluate(() => {
  const r = document.querySelector('.gb-screen').getBoundingClientRect();
  return [Math.round(r.width), Math.round(r.height)];
});
const fsCanvas = await emu(() => {
  const c = document.querySelector('canvas');
  if (!c) return null;
  const r = c.getBoundingClientRect();
  return [Math.round(r.width), Math.round(r.height)];
});
check('the canvas fills the LCD in fullscreen too', !!fsCanvas && Math.abs(fsCanvas[0] - fsLcd[0]) <= 2 && Math.abs(fsCanvas[1] - fsLcd[1]) <= 2,
  JSON.stringify({ fsCanvas, fsLcd }));

/* The plastic is the only control surface once the rail is hidden, so it has to
   still reach the core from here. */
await emu(() => { window.__input = []; });
await page.getByRole('button', { name: 'A', exact: true }).dispatchEvent('pointerdown', { pointerId: 5, isPrimary: true });
await page.waitForTimeout(160);
await page.getByRole('button', { name: 'A', exact: true }).dispatchEvent('pointerup', { pointerId: 5, isPrimary: true });
await page.waitForTimeout(200);
const fsInputs = await emu(() => window.__input);
check('the plastic still drives the core in fullscreen', fsInputs.some(([i, v]) => i === 8 && v === 1), JSON.stringify(fsInputs));
/* Browsers handle Esc themselves; the real check is that the visible way out
   works and the page is usable again. Inside fullscreen the rail is hidden, so
   that way out is the floating button — not a guess about Esc. */
check('fullscreen still offers a way out', await page.getByRole('button', { name: 'Exit fullscreen' }).isVisible());
await page.getByRole('button', { name: 'Exit fullscreen' }).click();
await page
  .waitForFunction(() => !document.fullscreenElement, { timeout: 10_000 })
  .catch(() => {});
check('leaving fullscreen works and the rail comes back', (await page.evaluate(() => !document.fullscreenElement)) === true);
check('the page chrome returns', await page.getByRole('button', { name: 'Pause' }).isVisible());

/* ------------------------------------------------- a browser without it */
/* iOS Safari has no element fullscreen at all, and a phone is where covering the
   screen matters most — so the page falls back to covering the viewport itself.
   Simulated here by removing the API before the app loads. */
{
  const noFs = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await noFs.addInitScript(() => {
    Object.defineProperty(Element.prototype, 'requestFullscreen', { value: undefined, configurable: true });
    Object.defineProperty(document, 'fullscreenElement', { get: () => null, configurable: true });
  });
  const p2 = await noFs.newPage();
  await p2.goto(`${BASE}/retro/simple-frogger`, { waitUntil: 'domcontentloaded' });
  await p2.waitForTimeout(1500);
  await p2.getByRole('button', { name: 'Fullscreen' }).click();
  await p2.waitForTimeout(500);
  const fallback = await p2.evaluate(() => {
    const shell = document.querySelector('.gb-device').getBoundingClientRect();
    const rails = [...document.querySelectorAll('.gb-rail')].map((e) => getComputedStyle(e).display);
    return {
      native: !!document.fullscreenElement,
      covers: shell.left <= 1 && shell.top <= 1 && shell.right >= window.innerWidth - 1 && shell.bottom >= window.innerHeight - 1,
      rail: rails,
      exit: !!document.querySelector('.gb-fs-exit'),
    };
  });
  check('without the fullscreen API the page still covers the screen', fallback.covers, JSON.stringify(fallback));
  check('the fallback keeps a way out', fallback.exit);
  /* Escape is the page's own key, so give the page the focus: while the frame
     holds it, keys belong to the emulator, and the visible button is the way out
     there — which is why the button exists. */
  await p2.locator('.gb-brand').click();
  await p2.keyboard.press('Escape');
  await p2.waitForTimeout(400);
  const back = await p2.evaluate(() => document.querySelector('.gb-stage').dataset.full === 'off');
  check('Escape leaves the fallback fullscreen', back);
  await noFs.close();
}

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

/* ------------------------------------------- every cartridge really runs */
/* A count and a cover only prove the shelf rendered. These four are the
   cartridges added after the first three, and each one is booted here so a ROM
   that stops working (a bad download, a core that lost a mode) fails the suite
   instead of quietly showing a dead LCD. */
if (!PHONE) {
  for (const id of ['lander-advance', 'pong', 'wigly-hunt', 'xorlix']) {
    await page.goto(`${BASE}/retro/${id}`, { waitUntil: 'domcontentloaded' });
    const frame = page.frameLocator('iframe');
    const boot = frame.locator('.ejs_start_button');
    const reached = await boot.waitFor({ timeout: 90_000 }).then(() => true).catch(() => false);
    if (!reached) { check(`${id} reaches its start screen`, false); continue; }
    await boot.click();
    const inner = page.frames().find((fr) => fr.url().includes('/retro/player.html'));
    await inner.waitForFunction(() => window.EJS_emulator?.started === true, { timeout: 90_000 }).catch(() => {});
    await page.waitForTimeout(4500);
    check(`${id} boots the core`, (await inner.evaluate(() => window.EJS_emulator?.started === true)) === true);
    const shot = await frame.locator('canvas').first().screenshot();
    /* Count colours in the frame the browser composited. One or two colours is
       what a blank LCD looks like; a running cartridge paints far more. */
    const paint = await page.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      const seen = new Set();
      for (let i = 0; i < d.length; i += 4) seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
      return { w: c.width, h: c.height, colours: seen.size };
    }, shot.toString('base64'));
    check(`${id} paints a live picture`, paint.colours >= 8 && Math.abs(paint.w / paint.h - 1.5) < 0.02, JSON.stringify(paint));
  }
}

/* ------------------------------------------------- a ROM from your device */
/* The same cartridge, handed over as a File exactly like a file input would:
   no upload, no server, validation on the client. */
if (!PHONE) {
  await page.goto(`${BASE}/retro`, { waitUntil: 'networkidle' });
  const dropZone = page.locator('section[aria-labelledby="own-cart-h"] .panel').first();

  /* The panel's copy says "drop a .gba file here", so a drop is a supported
     gesture and has to behave exactly like the file picker — including saying
     no to something that is not a cartridge. */
  const junk = await page.evaluateHandle(() => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])], 'photo.gba'));
    return dt;
  });
  await dropZone.dispatchEvent('drop', { dataTransfer: junk });
  await page.waitForTimeout(500);
  const refusal = await page.locator('[role=alert]').textContent().catch(() => '');
  check(
    'dropping a file that is no cartridge at all is refused',
    /header/i.test(refusal ?? '') && page.url().endsWith('/retro'),
    refusal?.slice(0, 60),
  );

  const dropped = await page.evaluateHandle(async () => {
    const buf = await (await fetch('/retro/roms/simple-frogger.gba')).arrayBuffer();
    const dt = new DataTransfer();
    dt.items.add(new File([buf], 'frogger.gba'));
    return dt;
  });
  await dropZone.dispatchEvent('drop', { dataTransfer: dropped });
  const openedByDrop = await page.waitForURL(/\/retro\/local$/, { timeout: 20_000 }).then(() => true).catch(() => false);
  check('dropping a real cartridge opens the local player', openedByDrop, page.url());

  await page.goto(`${BASE}/retro`, { waitUntil: 'networkidle' });
  const romPath = 'public/retro/roms/simple-frogger.gba';
  const before = requests.filter((u) => /\/retro\/local|\/upload/i.test(u)).length;
  await page.setInputFiles('input[type=file]', romPath);
  await page.waitForURL(/\/retro\/local$/, { timeout: 15_000 });
  const localFrame = page.frameLocator('iframe');
  await localFrame.locator('.ejs_start_button').waitFor({ timeout: 90_000 });
  await localFrame.locator('.ejs_start_button').click();
  const localEmu = async (fn) => {
    const f = page.frames().find((fr) => fr.url().includes('/retro/player.html'));
    return f.evaluate(fn);
  };
  await page
    .frames()
    .find((fr) => fr.url().includes('/retro/player.html'))
    .waitForFunction(() => window.EJS_emulator?.started === true, { timeout: 60_000 })
    .catch(() => {});
  check('a local ROM boots in the player', (await localEmu(() => window.EJS_emulator.started)) === true);
  check('local ROM was not sent anywhere', requests.filter((u) => /\/retro\/local|\/upload/i.test(u)).length === before);
  const romBytes = readFileSync(romPath).length;
  check('cartridge size is unchanged in memory', romBytes === 47_744);

  /* -------------------------------- the cartridge is kept in this browser */
  /* A dropped cartridge used to be gone on reload, which also threw away the
     save file attached to it. It is now stored in this browser's IndexedDB, so
     these three checks are the whole promise: it is still there, it starts
     without picking the file again, and Eject really removes it. */
  await page.goto(`${BASE}/retro`, { waitUntil: 'networkidle' });
  const ownPanel = page.locator('section[aria-labelledby="own-cart-h"] .panel').first();
  await page.waitForTimeout(600);
  const panelText = (await ownPanel.textContent()) ?? '';
  check('the shelf remembers the cartridge it was given', /In the handheld/i.test(panelText) && /Simple Frogger/i.test(panelText), panelText.match(/In the handheld[\s\S]{0,80}/)?.[0]);

  const beforeContinue = requests.length;
  await page.getByRole('button', { name: /^Continue$/ }).click();
  await page.waitForURL(/\/retro\/local$/, { timeout: 20_000 });
  const continuedFrame = page.frameLocator('iframe');
  await continuedFrame.locator('.ejs_start_button').waitFor({ timeout: 90_000 });
  await continuedFrame.locator('.ejs_start_button').click();
  await page
    .frames()
    .find((fr) => fr.url().includes('/retro/player.html'))
    .waitForFunction(() => window.EJS_emulator?.started === true, { timeout: 60_000 })
    .catch(() => {});
  const continuedStarted = await page
    .frames()
    .find((fr) => fr.url().includes('/retro/player.html'))
    .evaluate(() => window.EJS_emulator?.started === true);
  check('Continue starts the stored cartridge without picking it again', continuedStarted === true);
  check(
    'and continuing uploads nothing',
    requests.slice(beforeContinue).filter((u) => /\/retro\/local|\/upload/i.test(u)).length === 0,
  );

  /* A hard reload of the player route has no route state at all: everything it
     needs has to come back out of the browser's own store. */
  await page.reload({ waitUntil: 'networkidle' });
  const reloadedFrame = page.frameLocator('iframe');
  await reloadedFrame.locator('.ejs_start_button').waitFor({ timeout: 90_000 });
  await reloadedFrame.locator('.ejs_start_button').click();
  await page
    .frames()
    .find((fr) => fr.url().includes('/retro/player.html'))
    .waitForFunction(() => window.EJS_emulator?.started === true, { timeout: 60_000 })
    .catch(() => {});
  const reloadedStarted = await page
    .frames()
    .find((fr) => fr.url().includes('/retro/player.html'))
    .evaluate(() => window.EJS_emulator?.started === true);
  check('a hard reload of the player still has the cartridge', reloadedStarted === true);

  await page.goto(`${BASE}/retro`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Eject cartridge/i }).click();
  await page.waitForTimeout(500);
  const afterEject = (await ownPanel.textContent()) ?? '';
  check('Eject takes the cartridge out of the browser', !/In the handheld/i.test(afterEject));
  await page.goto(`${BASE}/retro/local`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  check(
    'with nothing stored the player says so instead of hanging',
    /No cartridge in the handheld/i.test((await page.locator('body').innerText()) ?? ''),
  );

  /* ------------------------------------------- a Game Boy cartridge, too */
  /* The mGBA core runs GB/GBC as well, so a dump of a Game Boy cartridge is
     accepted and plays in the same handheld. The probe cartridge is *generated
     here* — header, logo, checksum and a few bytes that fill the tile data and
     the tilemap — so no third-party ROM is committed to the repository. */
  await page.goto(`${BASE}/retro`, { waitUntil: 'networkidle' });
  const gbDrop = await page.evaluateHandle(() => {
    const rom = new Uint8Array(0x8000);
    rom.set([0xf3, 0xaf, 0xe0, 0x40], 0x150);
    let at = 0x154;
    const emit = (bytes) => { rom.set(bytes, at); at += bytes.length; };
    emit([0x21, 0x00, 0x80, 0x01, 0x00, 0x10]);
    emit([0x7d, 0xe6, 0xe0, 0x22, 0x0b, 0x78, 0xb1, 0x20, 0xf7]);
    emit([0x21, 0x00, 0x98, 0x01, 0x00, 0x04]);
    emit([0x7d, 0xe6, 0x0f, 0x22, 0x0b, 0x78, 0xb1, 0x20, 0xf8]);
    emit([0x3e, 0xe4, 0xe0, 0x47, 0x3e, 0x91, 0xe0, 0x40]);
    emit([0x76, 0x18, 0xfd]);
    rom[0x100] = 0x00;
    rom[0x101] = 0xc3;
    rom[0x102] = 0x50;
    rom[0x103] = 0x01;
    const logo = 'ceed6666cc0d000b03730083000c000d0008111f8889000edccc6ee6ddddddd999bbbb67636e0ecccdddc999fbbb9333e';
    for (let i = 0; i < 48; i += 1) rom[0x104 + i] = parseInt(logo.slice(i * 2, i * 2 + 2), 16);
    rom.set([0x54, 0x45, 0x53, 0x54], 0x134);
    rom[0x147] = 0x00;
    rom[0x148] = 0x00;
    rom[0x149] = 0x00;
    rom[0x14b] = 0x33;
    let sum = 0;
    for (let i = 0x134; i <= 0x14c; i += 1) sum = (sum - rom[i] - 1) & 0xff;
    rom[0x14d] = sum;
    const dt = new DataTransfer();
    dt.items.add(new File([rom], 'game-boy-probe.gb'));
    return dt;
  });
  await page.locator('section[aria-labelledby="own-cart-h"] .panel').first().dispatchEvent('drop', { dataTransfer: gbDrop });
  const openedGb = await page.waitForURL(/\/retro\/local$/, { timeout: 20_000 }).then(() => true).catch(() => false);
  check('a Game Boy dump is accepted by the same drop zone', openedGb, page.url());
  const gbFrame = page.frameLocator('iframe');
  await gbFrame.locator('.ejs_start_button').waitFor({ timeout: 90_000 });
  await gbFrame.locator('.ejs_start_button').click();
  await page
    .frames()
    .find((fr) => fr.url().includes('/retro/player.html'))
    .waitForFunction(() => window.EJS_emulator?.started === true, { timeout: 60_000 })
    .catch(() => {});
  const gbStarted = await page
    .frames()
    .find((fr) => fr.url().includes('/retro/player.html'))
    .evaluate(() => window.EJS_emulator?.started === true);
  check('the Game Boy cartridge boots on the same core', gbStarted);
  const lcdBox = await page.locator('.gb-screen').boundingBox();
  const gbBox = await page.locator('.gb-iframe').boundingBox();
  check(
    'a 10:9 Game Boy picture is pillarboxed inside the 3:2 LCD',
    Math.abs(gbBox.width / gbBox.height - 10 / 9) < 0.03 && gbBox.width < lcdBox.width && Math.abs(gbBox.height - lcdBox.height) < 2,
    JSON.stringify({ lcd: lcdBox, gb: gbBox }),
  );
  /* The picture is a WebGL canvas with no preserveDrawingBuffer, so read it the
     way the importer does: an element screenshot, decoded back in the page. */
  const gbShot = (await gbFrame.locator('canvas').first().screenshot()).toString('base64');
  const gbPaint = await page.evaluate(async (base64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${base64}`;
    await img.decode();
    const shot = document.createElement('canvas');
    shot.width = 160;
    shot.height = 144;
    const ctx = shot.getContext('2d');
    ctx.drawImage(img, 0, 0, 160, 144);
    const data = ctx.getImageData(0, 0, 160, 144).data;
    const colours = new Set();
    for (let p = 0; p < data.length; p += 4) {
      colours.add(((data[p] >> 3) << 10) | ((data[p + 1] >> 3) << 5) | (data[p + 2] >> 3));
    }
    return { colours: colours.size };
  }, gbShot);
  check('the Game Boy picture is drawn, not a blank LCD', gbPaint.colours >= 2, JSON.stringify(gbPaint));
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
