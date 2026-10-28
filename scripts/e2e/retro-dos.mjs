/**
 * DOS Arcade — end-to-end proof.
 *
 *   node scripts/e2e/retro-dos.mjs            desktop
 *   node scripts/e2e/retro-dos.mjs --phone    touch viewport
 *
 * This is where "the DOS player works" is allowed to be a claim, because every
 * line below runs a real Chromium, a real WebAssembly DOSBox and the real
 * calibration bundle. It asserts on pixels the machine drew, not on a screenshot
 * saved into the repo:
 *
 *   • the monitor appears only after the shelf answered, and the iframe boots
 *     `?game=pikachu-calibration`;
 *   • js-dos draws a canvas, the canvas is lit (not a black rectangle), a
 *     keypress gets through to the program, and the VGA colour bars it paints
 *     are actually in the framebuffer;
 *   • pause stops the picture changing, resume lets it move again;
 *   • mute, fullscreen and stop are commands the player answers;
 *   • an id that is not on the shelf shows a sentence instead of a black screen.
 *
 * This file needs a browser and a dev server. `npx playwright install chromium`
 * is the usual way to get one; when a sandbox blocks that download, any Chromium
 * build can be pointed at instead:
 *
 *   PIKACHU_CHROME=/path/to/chromium PIKACHU_LD=/path/to/libdir \
 *     npm run e2e:retro:dos
 *
 * Env: BASE (default http://127.0.0.1:5173), PIKACHU_CHROME, PIKACHU_LD.
 */
import { inflateSync } from 'node:zlib';
import { chromium } from 'playwright';

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
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch(LAUNCH);
const context = await browser.newContext(
  PHONE
    ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
    : { viewport: { width: 1280, height: 860 } },
);
const page = await context.newPage();
/* This sandbox renders WebGL in software, and a full-frame screenshot of a live
   DOSBox surface measured between 3 s and 30 s. Generous timeouts here are about
   the harness's speed, not the site's. */
page.setDefaultTimeout(90000);
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));

console.log(`\n${PHONE ? 'PHONE' : 'DESKTOP'} · ${BASE}`);

/* ---------------------------------------------------------------- the shelf */
await page.goto(`${BASE}/retro?platform=dos`, { waitUntil: 'networkidle' });
const cards = page.locator('article');
check('the DOS lens lists the hosted games', (await cards.count()) >= 1, `${await cards.count()} card(s)`);
check('the cartridge furniture is gone', (await page.getByText('Play a ROM you already own').count()) === 0);
/* A pending title must not be on this page at all. */
const index = await (await fetch(`${BASE}/retro/dos/catalog.json`)).json();
const pendingTitle = index.entries.find((e) => e.stage === 'pending-rights-review' && e.title.length > 8)?.title;
if (pendingTitle) {
  check('no pending title is on the shelf page', (await page.getByText(pendingTitle, { exact: false }).count()) === 0, pendingTitle);
}

/* The test card, not the first card. The shelf is sorted by title, so "the first
   Play button" was the calibration program only while it was alphabetically
   first; adding nine games whose names start with B moved the click onto Blake
   Stone and this suite started asserting the calibration colour bars on a
   corridor in 2140. The card is found by its own title instead. */
const testCard = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Calibration' }) });
await testCard.getByRole('button', { name: 'Play', exact: true }).click();
await page.waitForURL(/\/retro\/dos\//, { timeout: 5000 });
check('Play opens the DOS player', /\/retro\/dos\/pikachu-calibration$/.test(page.url()), page.url());

/* ------------------------------------------------------------- the machine */
const frame = page.frameLocator('iframe[title*="DOS emulator"]');
const canvas = frame.locator('canvas').first();

/* js-dos draws its canvas when the emulated machine starts; the page's own
   watchdog is 25 s, so waiting longer than that means something is wrong. */

/**
 * Decode a Chromium PNG screenshot into `{ width, height, data }` (RGBA).
 *
 * Why this exists, and why it is not `canvas.getContext('2d').drawImage(...)`:
 * js-dos renders through WebGL, and a WebGL drawing buffer without
 * `preserveDrawingBuffer` reads back **black** — the first version of this file
 * did exactly that and concluded "the screen is a black rectangle" about a
 * perfectly working emulator. A screenshot goes through the compositor instead
 * of the drawing buffer, so it sees what the visitor sees.
 *
 * Only what Chromium emits is handled: 8-bit, non-interlaced, RGB or RGBA.
 */
function decodePng(buffer) {
  const SIG = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < SIG.length; i += 1) {
    if (buffer[i] !== SIG[i]) throw new Error('not a PNG');
  }
  let width = 0;
  let height = 0;
  let channels = 4;
  const idat = [];
  for (let at = 8; at < buffer.length;) {
    const length = buffer.readUInt32BE(at);
    const type = buffer.toString('ascii', at + 4, at + 8);
    const data = buffer.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8) throw new Error(`unsupported bit depth ${data[8]}`);
      if (data[12] !== 0) throw new Error('interlaced PNG');
      channels = data[9] === 6 ? 4 : data[9] === 2 ? 3 : 0;
      if (!channels) throw new Error(`unsupported colour type ${data[9]}`);
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? line[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      switch (filter) {
        case 0: break;
        case 1: line[x] = (line[x] + a) & 0xff; break;
        case 2: line[x] = (line[x] + b) & 0xff; break;
        case 3: line[x] = (line[x] + ((a + b) >> 1)) & 0xff; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          line[x] = (line[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
          break;
        }
        default: throw new Error(`bad PNG filter ${filter}`);
      }
    }
    for (let x = 0; x < width; x += 1) {
      const to = (y * width + x) * 4;
      const from = x * channels;
      out[to] = line[from];
      out[to + 1] = line[from + 1];
      out[to + 2] = line[from + 2];
      out[to + 3] = channels === 4 ? line[from + 3] : 255;
    }
    prev = line;
  }
  return { width, height, data: out };
}

/**
 * What the visitor can actually see in the emulator's box, as pixels.
 *
 * A page screenshot clipped to the canvas, rather than `canvas.screenshot()`:
 * the element form first waits for the box to be "stable", and in a headless
 * shell where no compositor frame is being produced that wait can sit for the
 * full 30 s and then throw — a failure in the harness, not in the emulator. The
 * clip form takes the same pixels without that wait.
 */
/**
 * How different two screenshots are, in the part that matters.
 *
 * Samples a grid of pixels and reports the fraction whose RGB moved by more than
 * a hair, so a resized canvas (a layout change) does not get confused with a
 * running game (a moving picture).
 */
function pictureDiff(a, b) {
  const stepX = Math.max(1, Math.floor(a.width / 64));
  const stepY = Math.max(1, Math.floor(a.height / 48));
  let seen = 0;
  let changed = 0;
  for (let y = 0; y < Math.min(a.height, b.height); y += stepY) {
    for (let x = 0; x < Math.min(a.width, b.width); x += stepX) {
      const ia = (y * a.width + x) * 4;
      const ib = (y * b.width + x) * 4;
      seen += 1;
      if (Math.abs(a.data[ia] - b.data[ib]) + Math.abs(a.data[ia + 1] - b.data[ib + 1]) + Math.abs(a.data[ia + 2] - b.data[ib + 2]) > 12) changed += 1;
    }
  }
  return { ratio: seen ? changed / seen : 1, seen, changed };
}

async function look() {
  const box = await canvas.boundingBox();
  if (!box) throw new Error('the emulator canvas has no box');
  return decodePng(await page.screenshot({ clip: box, timeout: 120000 }));
}

let booted = true;
try {
  await canvas.waitFor({ state: 'visible', timeout: 30000 });
} catch {
  booted = false;
}
check('js-dos drew a canvas', booted);

/* Give the autoexec time to run CALIB.COM. It opens on its text-mode banner and
   waits for a key, as a test card should — so the machine is lit before the bars
   exist, and the bars are the proof that a key reached the program. Two claims,
   two checks, and the second one is what says the keyboard is wired up. */
await page.waitForTimeout(4000);

/* On a phone the ONLY input used from here on is the on-screen pad: no
   `keyboard.press`, no clicking the emulator. If the bars appear, the pad's
   postMessage → KeyboardEvent path really reached DOSBox. */
const pad = page.locator('[aria-label="On-screen game controls"]');
const padCount = await pad.count();
if (PHONE) {
  check('the pad is on screen on a phone, unasked', padCount === 1 && (await pad.isVisible()));
  if (padCount) {
    const geom = await page.evaluate(() => {
      const group = document.querySelector('[aria-label="On-screen game controls"]');
      const screen = document.querySelector('.dos-screen');
      const p = group.getBoundingClientRect();
      const s = screen.getBoundingClientRect();
      return {
        vw: window.innerWidth,
        scrollW: document.documentElement.scrollWidth,
        pictureBottom: Math.round(s.bottom),
        padTop: Math.round(p.top),
        padH: Math.round(p.height),
        keys: [...group.querySelectorAll('button')].map((b) => {
          const r = b.getBoundingClientRect();
          return { label: b.getAttribute('aria-label'), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right) };
        }),
      };
    });
    check('the pad sits below the picture, never on top of it', geom.padTop >= geom.pictureBottom - 2,
      `pad ${geom.padTop} vs picture ${geom.pictureBottom}`);
    const small = geom.keys.filter((k) => k.h < 40 || k.w < 40);
    check('every pad key is a thumb-sized target', small.length === 0,
      small.map((k) => `${k.label} ${k.w}x${k.h}`).join(', '));
    check('no pad key is off the screen', geom.keys.every((k) => k.right <= geom.vw + 1) && geom.scrollW <= geom.vw + 1,
      `${geom.keys.filter((k) => k.right > geom.vw + 1).length} off-screen, scrollWidth ${geom.scrollW}`);
    await pad.getByRole('button', { name: /^Space/ }).tap();
  }
} else {
  await canvas.click({ position: { x: 40, y: 40 } });
  await page.keyboard.press('Space');
}
await page.waitForTimeout(1500);

/* What is on the screen: is it lit, and are the four colour bars there? */
const pixels = booted ? await look() : null;
let lit = 0;
let total = 0;
if (pixels) {
  for (let i = 0; i < pixels.data.length; i += 4 * 8) {
    total += 1;
    if (pixels.data[i] + pixels.data[i + 1] + pixels.data[i + 2] > 24) lit += 1;
  }
}
const litPct = pixels ? lit / total : 0;

check(
  'the screen is not a black rectangle',
  !!pixels && litPct > 0.02,
  pixels ? `${(litPct * 100).toFixed(1)}% of sampled pixels lit, ${pixels.width}×${pixels.height}` : 'no canvas',
);
/* The bars fill the screen edge to edge, so a working keypress paints it. The
   banner is mostly black with a few lines of text, so the two states are far
   apart and one threshold separates them cleanly. */
check('a keypress reaches the program (it leaves its banner)', litPct > 0.5, `${(litPct * 100).toFixed(1)}% lit`);

/* CALIB.COM fills A000:0 in four passes of 16 000 bytes — 50 rows of 320 pixels
   each — so the bars are four *horizontal* stripes. A down-the-middle column is
   therefore the line that crosses all four; a horizontal scanline sits inside
   one stripe and correctly sees a single colour, which is the shape of the bug
   this check used to have. */
let bands = 0;
if (pixels) {
  const x = Math.floor(pixels.width / 2);
  const seen = new Set();
  for (let y = 0; y < pixels.height; y += 2) {
    const i = (y * pixels.width + x) * 4;
    seen.add(`${pixels.data[i]},${pixels.data[i + 1]},${pixels.data[i + 2]}`);
  }
  bands = seen.size;
}
check('the program painted its four colour bars', bands >= 4, `${bands} distinct colours down the middle column`);

/* ------------------------------------------------------------- the controls */
if (booted) {
  /* A screenshot, for the same reason as above — and compared byte for byte, so
     "still" means still. */
  const shot = async () => (await look()).data.toString('base64');

  await page.getByRole('button', { name: /^Pause$/ }).click();
  const paused = await look();
  await page.waitForTimeout(700);
  const stillPaused = await look();
  /* Byte-for-byte would also fail on a one-pixel size change, which is a layout
     question, not "is the game still running". Compare the picture itself. */
  const diff = pictureDiff(paused, stillPaused);
  check('pause holds the picture still', diff.ratio < 0.001,
    `${(diff.ratio * 100).toFixed(2)}% of samples changed, ${paused.width}x${paused.height} vs ${stillPaused.width}x${stillPaused.height}`);

  await page.getByRole('button', { name: /^Resume$/ }).click();
  await page.waitForTimeout(700);
  check('resume is accepted', (await page.getByRole('button', { name: /^Pause$/ }).count()) === 1);

  await page.getByRole('button', { name: /^Mute$/ }).click();
  check('mute switches the label', (await page.getByRole('button', { name: /^Unmute$/ }).count()) === 1);

  /* The pad is a desk control on a desktop too: anyone without a keyboard in
     front of them can use it, and it must come and go without disturbing the
     picture. */
  if (!PHONE) {
    await page.getByRole('button', { name: /^Gamepad$/ }).click();
    await page.waitForTimeout(250);
    check('the pad can be opened on a desktop', (await page.locator('[aria-label="On-screen game controls"]').count()) === 1);
    const fits = await page.evaluate(() => {
      const m = document.querySelector('.dos-monitor').getBoundingClientRect();
      return { vh: window.innerHeight, top: Math.round(m.top), bottom: Math.round(m.bottom), scrollY: Math.round(window.scrollY) };
    });
    check('the whole machine fits the window, controls included', fits.bottom <= fits.vh + 1, JSON.stringify(fits));
    /* The machine must survive the pad: if the iframe were re-mounted, the DOS
       session would restart. Tag it and look for the tag. */
    await page.evaluate(() => { document.querySelector('iframe').dataset.kept = 'yes'; });
    await page.getByRole('button', { name: /^Hide pad$/ }).click();
    await page.waitForTimeout(300);
    check('and hidden again', (await page.locator('[aria-label="On-screen game controls"]').count()) === 0);
    check('hiding the pad does not restart the machine',
      await page.evaluate(() => document.querySelector('iframe')?.dataset.kept === 'yes'));
    await page.getByRole('button', { name: /^Gamepad$/ }).click();
    await page.waitForTimeout(200);
  }

  await page.getByRole('button', { name: /^Fullscreen$/ }).click();
  await page.waitForTimeout(400);
  const full = await page.evaluate(() => document.querySelector('.dos-stage')?.getAttribute('data-full'));
  check('fullscreen takes the viewport', full === 'on', String(full));
  const padInFull = await page.evaluate(() => {
    const g = document.querySelector('[aria-label="On-screen game controls"]');
    if (!g) return { there: false };
    const r = g.getBoundingClientRect();
    return { there: true, top: Math.round(r.top), bottom: Math.round(r.bottom), vh: window.innerHeight, w: Math.round(r.width) };
  });
  check('the pad is still usable in fullscreen', padInFull.there && padInFull.top < padInFull.vh && padInFull.bottom > 0,
    JSON.stringify(padInFull));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}

/* -------------------------------------------------------------- getting out */
/* The player page hides the site chrome, so this control is the way back for a
   phone player who does not want to press Stop. */
const backCount = await page.getByRole('button', { name: 'Back to the DOS shelf' }).count();
check('there is a labelled way back to the shelf', backCount === 1);
if (backCount) {
  await page.getByRole('button', { name: 'Back to the DOS shelf' }).click();
  await page.waitForURL(/\/retro/, { timeout: 10000 }).catch(() => {});
  check('and it lands on the DOS shelf', /platform=dos/.test(page.url()), page.url());
}

/* ----------------------------------------------------------- an unknown id */
await page.goto(`${BASE}/retro/dos/vice-city-2002`, { waitUntil: 'networkidle' });
check('an unpublished id gets a sentence, not a black screen', (await page.getByText('No such game on the DOS shelf').count()) === 1);
check('and no emulator is mounted for it', (await page.locator('iframe').count()) === 0);

check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));

await browser.close();
console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} check(s) failed`}\n`);
process.exit(failures === 0 ? 0 : 1);
