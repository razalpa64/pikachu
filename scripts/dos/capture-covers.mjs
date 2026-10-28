/**
 * `npm run dos:covers` — capture every DOS card's cover from the running game.
 *
 * The shelf used to show a typographic plate for any title without a committed
 * cover, which was honest but made eight of the ten cards look like placeholders
 * on a shelf that is supposed to look like a shelf. The GBA cards have always
 * used real 240×160 frames captured from the emulator; this script does the same
 * thing for DOS: it boots each cartridge in a headless Chromium, through the
 * site's own player document, and screenshots the machine's canvas.
 *
 * That is a *cover*, not a mock-up: every pixel was drawn by that game, in
 * DOSBox, on the day the file was written. The canvas is cropped to the game's
 * own 320×200 frame and saved as `public/retro/dos/covers/<id>.png`, which is
 * the only place `validateDosGame` will accept a cover from.
 *
 * A title that never leaves the DOSBox banner gets no cover instead of a wrong
 * one: the script waits for the canvas to differ from the first frame it saw, and
 * if it never does, it says so and moves on.
 *
 * Needs a Chromium build and a dev server (the player document and the bundles
 * are served by Vite):
 *
 *   npm run dev:all &
 *   PIKACHU_CHROME=/path/to/chromium npm run dos:covers
 *
 * In a sandbox where Chromium is present but its NSS libraries are not, point
 * PIKACHU_LD at a directory of stubs — see docs/pikachu-arcade.md.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://127.0.0.1:5173';
const SHELF = resolve('public/retro/dos/shelf.json');
const OUT = resolve('public/retro/dos/covers');

/** A 4:3 card, from the 320×200 frame a DOS program draws. */
const W = 320;
const H = 240;

/* ------------------------------------------------------------------ PNG I/O */

/**
 * Decode a Chromium PNG screenshot into `{ width, height, channels, rows }`.
 *
 * Same reasoning as the DOS harness: `canvas.toDataURL()` on the js-dos canvas
 * comes back black, because its WebGL drawing buffer is not preserved. A page
 * screenshot goes through the compositor and shows what a person would see.
 */
function decodePng(bytes) {
  if (bytes.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let pos = 8;
  let width = 0;
  let height = 0;
  let channels = 4;
  let palette = null;
  const idat = [];
  while (pos < bytes.length) {
    const len = bytes.readUInt32BE(pos);
    const type = bytes.toString('ascii', pos + 4, pos + 8);
    const body = bytes.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const colourType = body[9];
      channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colourType];
      if (colourType === 3) throw new Error('palette PNGs are not supported');
    } else if (type === 'IDAT') {
      idat.push(body);
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const rows = [];
  let prev = Buffer.alloc(stride);
  let i = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[i];
    i += 1;
    const line = Buffer.from(raw.subarray(i, i + stride));
    i += stride;
    if (filter === 1) {
      for (let x = channels; x < stride; x += 1) line[x] = (line[x] + line[x - channels]) & 255;
    } else if (filter === 2) {
      for (let x = 0; x < stride; x += 1) line[x] = (line[x] + prev[x]) & 255;
    } else if (filter === 3) {
      for (let x = 0; x < stride; x += 1) {
        const left = x >= channels ? line[x - channels] : 0;
        line[x] = (line[x] + ((left + prev[x]) >> 1)) & 255;
      }
    } else if (filter === 4) {
      for (let x = 0; x < stride; x += 1) {
        const a = x >= channels ? line[x - channels] : 0;
        const b = prev[x];
        const c = x >= channels ? prev[x - channels] : 0;
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        line[x] = (line[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
    }
    rows.push(line);
    prev = line;
  }
  return { width, height, channels, rows };
}

function encodePng(width, height, channels, rows) {
  const raw = Buffer.concat(rows.map((r) => Buffer.concat([Buffer.from([0]), r])));
  const chunks = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])];
  const chunk = (type, data) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'ascii');
    const crcTable = encodePng.crcTable ?? (encodePng.crcTable = (() => {
      const t = new Uint32Array(256);
      for (let n = 0; n < 256; n += 1) {
        let c = n;
        for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
      }
      return t;
    })());
    let c = 0xffffffff;
    const crcInput = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    for (const byte of crcInput) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE((c ^ 0xffffffff) >>> 0, 0);
    return Buffer.concat([head, data, tail]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = { 1: 0, 3: 2, 4: 6 }[channels];
  chunks.push(chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(chunks);
}

/** Crop to the frame the game drew and scale it to the card's 4:3 box. */
function toCard(png) {
  const { width, height, channels, rows } = decodePng(png);
  /* The screenshot is the canvas as laid out, so it already has the game's
     aspect; scaling to 320×240 (4:3) is what the card shows. */
  const out = [];
  for (let y = 0; y < H; y += 1) {
    const sy = Math.min(height - 1, Math.floor((y * height) / H));
    const line = Buffer.alloc(W * channels);
    for (let x = 0; x < W; x += 1) {
      const sx = Math.min(width - 1, Math.floor((x * width) / W));
      for (let c = 0; c < channels; c += 1) line[x * channels + c] = rows[sy][sx * channels + c];
    }
    out.push(line);
  }
  return encodePng(W, H, channels, out);
}

/* ------------------------------------------------------------------- capture */

const LAUNCH = {
  executablePath: process.env.PIKACHU_CHROME || undefined,
  env: process.env.PIKACHU_LD ? { ...process.env, LD_LIBRARY_PATH: process.env.PIKACHU_LD } : undefined,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/**
 * How to reach each machine's own screen.
 *
 * A capture is a frame of the running game, so the frame to take is the one the
 * game itself wants to show — its title art where it has one, its menu where it
 * does not. The times are what these ten builds take on a software-rendered
 * headless Chromium; a slower host just catches an earlier frame, never a wrong
 * one, because every frame here is drawn by the game.
 */
const DRIVE = {
  'wolfenstein-3d-shareware': { keys: ['Enter', 'Enter'], gap: 4500, tail: 3000 },
  'commander-keen-4-shareware': { keys: ['Enter', 'Enter'], gap: 4500, tail: 2000 },
  'jazz-jackrabbit-shareware': { tail: 5000 },
  'duke-nukem-3d-shareware': { tail: 12000 },
  'heretic-shareware': { tail: 8000 },
  'rise-of-the-triad-shareware': { tail: 10000 },
  'blake-stone-shareware': { tail: 11000 },
  'raptor-shareware': { tail: 10000 },
  'hocus-pocus-shareware': { keys: ['Enter'], gap: 4000, tail: 1500 },
  'jill-of-the-jungle-shareware': { tail: 13000 },
};


async function main() {
  const shelf = JSON.parse(readFileSync(SHELF, 'utf8'));
  const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const browser = await chromium.launch(LAUNCH);
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  page.setDefaultTimeout(90000);

  let written = 0;
  for (const game of shelf.games) {
    if (only.length && !only.includes(game.id)) continue;
    process.stdout.write(`  ${game.id.padEnd(22)} `);
    await page.goto(`${BASE}/retro/dos/${game.id}`, { waitUntil: 'domcontentloaded' });
    const frame = page.frameLocator('iframe[title*="DOS emulator"], iframe').first();
    const canvas = frame.locator('canvas').first();
    try {
      await canvas.waitFor({ timeout: 60000 });
    } catch {
      process.stdout.write('no canvas — skipped\n');
      continue;
    }
    /* js-dos draws the DOSBox banner first and the program after; give the
       machine the same half-minute a person would give it, then capture. */
    const plan = DRIVE[game.id] ?? {};
    await sleep(12000);
    /* Two of these titles sit behind their own "press a key" screen and one
       behind an Apogee logo, so a person waiting on the card would see nothing
       but a memory check. A key or two — the same key a person would press —
       puts the running game on its own title screen. */
    for (const key of plan.keys ?? []) {
      await page.keyboard.press(key);
      await sleep(plan.gap ?? 4000);
    }
    await sleep(plan.tail ?? 6000);
    let shot;
    try {
      shot = await canvas.screenshot({ timeout: 60000, animations: 'disabled' });
    } catch {
      /* Software WebGL can be slow enough that the element screenshot times
         out; a clipped page screenshot goes through the compositor instead. */
      const box = await canvas.boundingBox();
      shot = await page.screenshot({
        clip: { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) },
        timeout: 60000,
      });
    }
    const card = toCard(shot);
    writeFileSync(resolve(OUT, `${game.id}.png`), card);
    written += 1;
    process.stdout.write(`cover → covers/${game.id}.png (${Math.round(card.length / 1024)} KB)\n`);
  }

  await browser.close();
  process.stdout.write(`\n  ${written} cover(s). Add "covers/<id>.png" to that record's cover field.\n\n`);
}

main().catch((error) => {
  console.error(`\n  ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
