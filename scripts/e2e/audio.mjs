/**
 * Audio suite.
 *
 * "It is so silent" is not something a type-checker can catch: every cue can be
 * wired correctly and still never reach the speakers, because the Web Audio
 * context stays locked until a real gesture and a cry that fails to decode
 * silently falls back to a synth beep forever.
 *
 * So this counts actual AudioBufferSourceNodes — a real decoded cry being
 * played — by patching the constructor before the app boots.
 */
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:5173';
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(`${c ? ' ok ' : 'FAIL'}  ${m}`); };

const b = await chromium.launch({ args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await b.newContext({ viewport: { width: 1180, height: 860 } });
await ctx.addInitScript(() => {
  sessionStorage.setItem('pikachu.intro.v1', '1');
  // count every decoded buffer that actually gets played
  window.__cries = [];
  const realDecode = AudioContext.prototype.decodeAudioData;
  AudioContext.prototype.decodeAudioData = function (...a) {
    return realDecode.apply(this, a).then((buf) => { window.__decoded = (window.__decoded || 0) + 1; return buf; });
  };
  const realSrc = AudioContext.prototype.createBufferSource;
  AudioContext.prototype.createBufferSource = function () {
    const n = realSrc.call(this);
    const realStart = n.start.bind(n);
    n.start = (...a) => { if (n.buffer && n.buffer.duration > 0.3) window.__cries.push(+n.buffer.duration.toFixed(2)); return realStart(...a); };
    return n;
  };
});
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));

/* ---------- A. every audio file serves and decodes ---------- */
await p.goto(`${BASE}/`, { waitUntil: 'networkidle' });
const files = ['pika-hop.mp3', 'pika-yay.mp3', 'pika-chu.mp3', 'pika-pika.mp3', 'pika-zap.mp3',
  'pika-echo.mp3', 'pika-joy.mp3', 'pika-ask.mp3', 'pika-cry-retro.ogg', 'pika-gmax.ogg',
  'raichu.mp3', 'pichu.mp3', 'eevee.mp3', 'jigglypuff.mp3', 'clefairy.ogg', 'pawmi.ogg',
  'fidough.ogg', 'marill.ogg', 'togedemaru.ogg', 'mimikyu.ogg', 'minun.ogg', 'emolga.ogg',
  'plusle.ogg'];
const decoded = await p.evaluate(async (fs) => {
  const c = new OfflineAudioContext(1, 44100, 44100);
  const out = {};
  for (const f of fs) {
    try {
      const r = await fetch('/audio/' + f);
      if (!r.ok) { out[f] = 'HTTP ' + r.status; continue; }
      const buf = await c.decodeAudioData(await r.arrayBuffer());
      out[f] = +buf.duration.toFixed(2);
    } catch (e) { out[f] = 'ERR'; }
  }
  return out;
}, files);
const bad = Object.entries(decoded).filter(([, v]) => typeof v !== 'number');
ok(bad.length === 0, `A1 all ${files.length} voice files serve and decode (${bad.map(([k, v]) => k + '=' + v).join(', ') || 'all good'})`);
const tooShort = Object.entries(decoded).filter(([, v]) => typeof v === 'number' && v < 0.15);
ok(tooShort.length === 0, `A2 none is a truncated stub (${tooShort.map(([k]) => k).join(', ') || 'all have real length'})`);

/* ---------- B. the slices land inside their files, and the voice clips are tight ---------- */
const hop = decoded['pika-hop.mp3'], yay = decoded['pika-yay.mp3'], gmax = decoded['pika-gmax.ogg'];
ok(hop > 0.22, `B1 the "pi" slice (0–0.22s) fits inside pika-hop.mp3 (${hop}s)`);
ok(yay > 0.5, `B2 the pickup slice (0–0.5s) fits inside pika-yay.mp3 (${yay}s)`);
ok(gmax > 0.54 + 0.62, `B3 the Gmax finale slice (0.54–1.16s) fits inside pika-gmax.ogg (${gmax}s)`);
ok(hop < 0.5, `B4 the jump clip is short enough not to overlap the next jump (${hop}s)`);
// the raw downloads all opened with 0.1-0.5s of silence, which made cues fire late
const leads = await p.evaluate(async (fs) => {
  const c = new OfflineAudioContext(1, 44100, 44100); const out = {};
  for (const f of fs) {
    const buf = await c.decodeAudioData(await (await fetch('/audio/' + f)).arrayBuffer());
    const d = buf.getChannelData(0); let peak = 0;
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
    let lead = 0; while (lead < d.length && Math.abs(d[lead]) < peak * 0.06) lead++;
    out[f] = { lead: +(lead / buf.sampleRate).toFixed(3), peak: +peak.toFixed(3) };
  }
  return out;
}, ['pika-hop.mp3', 'pika-yay.mp3', 'pika-chu.mp3', 'pika-pika.mp3', 'pika-zap.mp3', 'pika-echo.mp3', 'pika-joy.mp3', 'pika-ask.mp3']);
const laggy = Object.entries(leads).filter(([, v]) => v.lead > 0.06);
ok(laggy.length === 0, `B5 no voice clip starts with dead air (${laggy.map(([k, v]) => `${k} +${v.lead}s`).join(', ') || 'all start immediately'})`);
const quiet = Object.entries(leads).filter(([, v]) => v.peak < 0.6);
ok(quiet.length === 0, `B6 every voice clip is level-matched (${quiet.map(([k, v]) => `${k}=${v.peak}`).join(', ') || 'all near full scale'})`);

/* ---------- C. a real cry reaches the output during play ---------- */
await p.goto(`${BASE}/solo/tic-tac-toe-duel`, { waitUntil: 'networkidle' });
await p.waitForTimeout(900);
await p.mouse.click(600, 400);                    // gesture unlocks the AudioContext
await p.waitForTimeout(700);
await p.evaluate(() => { window.__cries = []; });
const cells = p.getByRole('gridcell');
const n = await cells.count();
for (let i = 0; i < Math.min(n, 3); i++) {
  await cells.nth(i).click({ force: true }).catch(() => {});
  await p.waitForTimeout(650);                     // let the AI reply too
}
const played = await p.evaluate(() => window.__cries);
ok(played.length > 0, `C1 placing marks actually plays decoded cries (${played.length} fired: ${played.slice(0, 6).join(', ')}s)`);
const dec = await p.evaluate(() => window.__decoded || 0);
ok(dec > 0, `C2 cry files were decoded, not skipped (${dec} decoded)`);

/* ---------- D. the runner is voiced ---------- */
await p.goto(`${BASE}/solo/electric-arcade`, { waitUntil: 'networkidle' });
await p.waitForTimeout(1000);
await p.locator('canvas').first().click({ position: { x: 60, y: 30 } });
await p.waitForTimeout(500);
await p.evaluate(() => { window.__cries = []; });
await p.keyboard.press('Space');
await p.waitForTimeout(400);
for (let i = 0; i < 4; i++) { await p.keyboard.press('Space'); await p.waitForTimeout(420); }
const jumps = await p.evaluate(() => window.__cries);
ok(jumps.length > 0, `D1 jumping in Volt Runner is voiced (${jumps.length} cries)`);

/* ---------- E. the mute switch really is silent ---------- */
await p.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('pikachu.settings.v1') || '{}');
  s.muted = true; localStorage.setItem('pikachu.settings.v1', JSON.stringify(s));
});
await p.reload({ waitUntil: 'networkidle' });
await p.waitForTimeout(900);
await p.locator('canvas').first().click({ position: { x: 60, y: 30 } });
await p.waitForTimeout(400);
await p.evaluate(() => { window.__cries = []; });
await p.keyboard.press('Space');
await p.waitForTimeout(400);
for (let i = 0; i < 3; i++) { await p.keyboard.press('Space'); await p.waitForTimeout(380); }
const muted = await p.evaluate(() => window.__cries);
ok(muted.length === 0, `E1 muted really means silent (${muted.length} cries leaked)`);

ok(errs.length === 0, `F1 no page errors (${errs.slice(0, 2).join(' | ')})`);
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
process.exit(fail ? 1 : 0);
