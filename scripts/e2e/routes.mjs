import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 950 }, reducedMotion: 'reduce' });
const page = await ctx.newPage();
const errs = [];
page.on('console', m => { if (m.type()==='error') errs.push('CONSOLE '+m.text().slice(0,220)); });
page.on('pageerror', e => errs.push('PAGEERROR '+String(e).slice(0,220)));
page.on('requestfailed', r => errs.push('REQFAIL '+r.url().slice(0,140)+' '+(r.failure()?.errorText??'')));
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => sessionStorage.setItem('pikachu.intro.v1','1'));

const routes = ['/','/library','/together','/solo','/challenges','/achievements','/profile','/settings',
  '/solo/chess-arena','/solo/tic-tac-toe-duel','/solo/connect-four','/solo/memory-match','/solo/reaction-duel',
  '/solo/snake-arena','/solo/battleship','/solo/checkers','/solo/puzzle-quest','/solo/electric-arcade',
  '/solo/spark-quiz','/solo/wild-eights','/solo/case-files','/solo/imposter','/solo/truth-or-dare','/retro'];
for (const r of routes) {
  const before = errs.length;
  await page.goto('http://127.0.0.1:5173'+r, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1600);
  const info = await page.evaluate(() => ({
    text: (document.body.innerText||'').replace(/\s+/g,' ').slice(0,110),
    nodes: document.body.querySelectorAll('*').length,
    buttons: document.querySelectorAll('button,a[href]').length,
    canvas: document.querySelectorAll('canvas').length,
    svg: document.querySelectorAll('svg').length,
    imgsBroken: [...document.images].filter(i => i.complete && i.naturalWidth === 0).length,
  }));
  const fresh = errs.slice(before);
  console.log(`${r.padEnd(26)} nodes=${String(info.nodes).padStart(4)} btn=${String(info.buttons).padStart(3)} svg=${String(info.svg).padStart(3)} cv=${info.canvas} brokenImg=${info.imgsBroken} ${fresh.length?'ERR:'+fresh.length:'ok'}`);
  if (info.nodes < 40) console.log('   !! suspiciously empty:', info.text);
  fresh.slice(0,2).forEach(e => console.log('   ', e));
}
console.log('\n--- all diagnostics ---');
console.log(errs.length ? [...new Set(errs)].slice(0,15).join('\n') : 'no console errors, no failed requests');
await b.close();
