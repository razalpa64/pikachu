import { chromium } from 'playwright';
const B = 'http://127.0.0.1:5173';
const b = await chromium.launch({ args: ['--no-sandbox', '--disable-gpu'] });
const ctx = await b.newContext({ viewport: { width: 1400, height: 950 } });
const p = await ctx.newPage();
const errs = []; let pass = 0, fail = 0;
p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
const t = (n, c) => { c ? (pass++, console.log('✓ ' + n)) : (fail++, console.log('✗ ' + n)); };
const txt = () => p.evaluate(() => document.body.innerText);

await p.goto(B + '/'); await p.evaluate(() => sessionStorage.setItem('pikachu.intro.v1', '1'));
await p.evaluate(() => { try { Object.keys(localStorage).filter(k => k.startsWith('pikachu.snake.best')).forEach(k => localStorage.removeItem(k)); } catch {} });
await p.goto(B + '/solo/snake-arena'); await p.waitForTimeout(2600);

let s = await txt();
t('shows the start prompt instead of running', /take the controls/i.test(s));
t('prompt names the arrow keys', /press an arrow key/i.test(s));

await p.waitForTimeout(3000);
s = await txt();
t('still alive after 5.6s of no input (no ghost death)', !/victory|defeat|dead heat/i.test(s));

const before = s;
await p.locator('canvas').first().click();
await p.keyboard.press('ArrowDown'); await p.waitForTimeout(1800);
const after = await txt();
t('prompt disappears once armed', !/take the controls/i.test(after));
t('world advances after the first input', before !== after);

// steer the snake into a wall to reach the result overlay
for (let i = 0; i < 40; i++) { await p.keyboard.press('ArrowUp'); await p.waitForTimeout(90); }
await p.waitForTimeout(1600);
const dead = await txt();
const ended = /victory|defeat|dead heat|run over|crash/i.test(dead);
t('a crash ends the run with a verdict', ended);
t('a solo crash is NOT reported as a draw', !/dead heat/i.test(dead));
t('shows a real personal best row, not an em-dash', /best \(/i.test(dead) && !/Personal best[\s\S]{0,40}—/i.test(dead));

console.log('\nconsole errors:', errs.length ? errs.slice(0, 3) : 'none');
console.log(`${pass} passed, ${fail} failed`);
await b.close();
process.exit(fail ? 1 : 0);
