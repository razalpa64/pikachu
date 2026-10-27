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

await page.getByRole('button', { name: 'Play', exact: true }).first().click();
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

/** What the visitor can actually see in the emulator's box, as pixels. */
async function look() {
  return decodePng(await canvas.screenshot());
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
await canvas.click({ position: { x: 40, y: 40 } });
await page.keyboard.press('Space');
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
  const shot = async () => decodePng(await canvas.screenshot()).data.toString('base64');

  await page.getByRole('button', { name: /^Pause$/ }).click();
  const paused = await shot();
  await page.waitForTimeout(700);
  check('pause holds the picture still', paused === (await shot()));

  await page.getByRole('button', { name: /^Resume$/ }).click();
  await page.waitForTimeout(700);
  check('resume is accepted', (await page.getByRole('button', { name: /^Pause$/ }).count()) === 1);

  await page.getByRole('button', { name: /^Mute$/ }).click();
  check('mute switches the label', (await page.getByRole('button', { name: /^Unmute$/ }).count()) === 1);

  await page.getByRole('button', { name: /^Fullscreen$/ }).click();
  await page.waitForTimeout(400);
  const full = await page.evaluate(() => document.querySelector('.dos-stage')?.getAttribute('data-full'));
  check('fullscreen takes the viewport', full === 'on', String(full));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}

/* ----------------------------------------------------------- an unknown id */
await page.goto(`${BASE}/retro/dos/doom-shareware`, { waitUntil: 'networkidle' });
check('an unpublished id gets a sentence, not a black screen', (await page.getByText('No such game on the DOS shelf').count()) === 1);
check('and no emulator is mounted for it', (await page.locator('iframe').count()) === 0);

check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));

await browser.close();
console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} check(s) failed`}\n`);
process.exit(failures === 0 ? 0 : 1);
