import { chromium } from 'playwright';
const B='http://127.0.0.1:5173';
const b = await chromium.launch({ args:['--no-sandbox','--disable-gpu'] });
for (const rm of ['no-preference','reduce']) {
  const ctx = await b.newContext({ viewport:{width:1280,height:800}, reducedMotion: rm });
  const p = await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push('PAGEERR '+String(e).slice(0,180)));
  p.on('console',m=>{ if(m.type()==='error') errs.push('CONSOLE '+m.text().slice(0,180)); });
  p.on('requestfailed',r=>errs.push('REQFAIL '+r.url().slice(0,100)));
  console.log(`\n=== fresh visit, prefers-reduced-motion: ${rm} ===`);
  await p.goto(B+'/', { waitUntil:'domcontentloaded' });
  for (const t of [500, 1500, 3000, 5000, 8000, 12000]) {
    await p.waitForTimeout(t === 500 ? 500 : t - (t===1500?500:t===3000?1500:t===5000?3000:t===8000?5000:8000));
    const d = await p.evaluate(() => ({
      nodes: document.body.querySelectorAll('*').length,
      txt: (document.body.innerText||'').replace(/\s+/g,' ').slice(0,80),
      btns: document.querySelectorAll('button').length,
      url: location.pathname,
    }));
    console.log(`  t=${String(t).padStart(5)}ms nodes=${String(d.nodes).padStart(4)} btn=${String(d.btns).padStart(2)} "${d.txt}"`);
  }
  console.log('  errors:', errs.length ? errs.slice(0,3).join(' | ') : 'none');
  await ctx.close();
}
await b.close();
