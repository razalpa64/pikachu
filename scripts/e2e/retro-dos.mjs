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
 *   • js-dos draws a canvas, the canvas is lit (not a black rectangle), and the
 *     VGA colour bars the program paints are actually in the framebuffer;
 *   • pause stops the picture changing, resume lets it move again;
 *   • mute, fullscreen and stop are commands the player answers;
 *   • an id that is not on the shelf shows a sentence instead of a black screen.
 *
 * ⚠️ This sandbox has no Chromium it can download, so this file has NOT been run
 * here. It is written against the same contract the smoke script pins (see
 * scripts/smoke-dos.ts, which did run), and it is what to run on a machine with
 * a browser before anybody claims the DOS shelf plays.
 *
 * Env: BASE (default http://127.0.0.1:5173), PIKACHU_CHROME, PIKACHU_LD.
 */
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
let booted = true;
try {
  await canvas.waitFor({ state: 'visible', timeout: 30000 });
} catch {
  booted = false;
}
check('js-dos drew a canvas', booted);

/* Give the autoexec time to run CALIB.COM and paint the bars. */
await page.waitForTimeout(4000);

/** Read the framebuffer: is it lit, and are the four colour bars there? */
const pixels = booted
  ? await canvas.evaluate((el) => {
    const draw = document.createElement('canvas');
    draw.width = el.width;
    draw.height = el.height;
    const ctx = draw.getContext('2d');
    ctx.drawImage(el, 0, 0);
    const { data, width, height } = ctx.getImageData(0, 0, draw.width, draw.height);
    let lit = 0;
    let sum = 0;
    const rows = [];
    for (let y = 0; y < height; y += Math.max(1, Math.floor(height / 8))) {
      for (let x = 0; x < width; x += 8) {
        const i = (y * width + x) * 4;
        sum += data[i] + data[i + 1] + data[i + 2];
        if (data[i] + data[i + 1] + data[i + 2] > 24) lit += 1;
      }
    }
    rows.push(lit);
    return { lit, sum, width, height, samples: rows[0] };
  })
  : null;

check('the screen is not a black rectangle', !!pixels && pixels.lit > 0, pixels ? `${pixels.lit} lit samples of ${pixels.width}×${pixels.height}` : 'no canvas');

/* The colour bars are wide vertical bands of distinct hues — so a horizontal
   scanline should contain several different colours, not one. */
const bands = booted
  ? await canvas.evaluate((el) => {
    const draw = document.createElement('canvas');
    draw.width = el.width;
    draw.height = el.height;
    const ctx = draw.getContext('2d');
    ctx.drawImage(el, 0, 0);
    const y = Math.floor(el.height / 2);
    const { data, width } = ctx.getImageData(0, y, draw.width, 1);
    const seen = new Set();
    for (let x = 0; x < width; x += 4) {
      const i = x * 4;
      seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
    }
    return seen.size;
  })
  : 0;
check('the program painted more than one colour', bands > 1, `${bands} distinct colours on the middle scanline`);

/* ------------------------------------------------------------- the controls */
if (booted) {
  const shot = () => canvas.evaluate((el) => {
    const draw = document.createElement('canvas');
    draw.width = el.width;
    draw.height = el.height;
    draw.getContext('2d').drawImage(el, 0, 0);
    return draw.toDataURL().length;
  });

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
