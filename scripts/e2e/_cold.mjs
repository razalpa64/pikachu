import { chromium } from 'playwright';
const B='http://127.0.0.1:5173';
const b = await chromium.launch({ args:['--no-sandbox','--disable-gpu'] });
// cold, empty profile, exactly like a first-time visitor
const ctx = await b.newContext({ viewport:{width:1280,height:800} });
const p = await ctx.newPage();
const fails=[], errs=[];
p.on('requestfailed', r => fails.push(r.url().replace(B,'') + ' :: ' + (r.failure()?.errorText||'')));
p.on('response', r => { if (r.status() >= 400) fails.push(r.status()+' '+r.url().replace(B,'')); });
p.on('pageerror', e => errs.push(String(e).slice(0,180)));
p.on('console', m => { if (m.type()==='error') errs.push(m.text().slice(0,180)); });
await p.goto(B+'/', { waitUntil:'load' });
await p.waitForTimeout(7000);
const d = await p.evaluate(() => ({ n: document.body.querySelectorAll('*').length, t:(document.body.innerText||'').replace(/\s+/g,' ').slice(0,90) }));
console.log('cold first visit → nodes', d.n);
console.log('text:', d.t);
console.log('failed/4xx:', fails.length ? fails.join('\n  ') : 'NONE');
console.log('js errors :', errs.length ? errs.join('\n  ') : 'NONE');
// second navigation, warm
await p.goto(B+'/library', { waitUntil:'load' }); await p.waitForTimeout(2500);
console.log('library nodes:', await p.evaluate(()=>document.body.querySelectorAll('*').length), '| extra failures:', fails.length);
await b.close();
