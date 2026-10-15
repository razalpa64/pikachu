import { chromium } from 'playwright';
const B='http://127.0.0.1:5173';
let pass=0, fail=0;
const ok=(c,m)=>{ c?(pass++,console.log('  ✓',m)):(fail++,console.log('  ✗',m)); };

const b = await chromium.launch({ args:['--no-sandbox','--disable-gpu','--autoplay-policy=no-user-gesture-required'] });
const p = await (await b.newContext({ viewport:{width:1280,height:900} })).newPage();
const errs=[]; p.on('console', m=>{ if(m.type()==='error') errs.push(m.text()); });
p.on('pageerror', e=>errs.push('PAGEERROR '+e.message));

await p.goto(B+'/'); await p.evaluate(()=>sessionStorage.setItem('pikachu.intro.v1','1'));
await p.goto(B+'/settings'); await p.waitForTimeout(2200);
await p.mouse.click(600,400);                       // unlock audio with a real gesture
await p.waitForTimeout(400);

ok(await p.locator('text=Your music').count()>0, 'the "Your music" section renders');
ok(await p.locator('#song-upload').count()>0, 'a file input exists');

// upload two REAL audio files (the bundled cries are valid mp3/ogg)
await p.setInputFiles('#song-upload', ['public/audio/pika-cry.mp3','public/audio/raichu.mp3']);
await p.waitForTimeout(1600);

const items = await p.locator('ul li:has-text("pika-cry"), ul li').filter({ hasText:/pika-cry|raichu/ }).count();
ok(items>=2, `both songs appear in the list (found ${items})`);
ok(await p.locator('text=/2 songs/').count()>0, 'the footer counts 2 songs');
ok(await p.getByText("My music", { exact: true }).count()>0, "the \"My music\" source option is present");

// it should actually be playing through a real <audio> element
await p.waitForTimeout(1500);
const audio = await p.evaluate(()=>{
  const a=[...document.querySelectorAll('audio')];
  const el=a[0]; if(!el) return null;
  return { src: !!el.src, paused: el.paused, t: el.currentTime, dur: el.duration };
});
ok(audio!==null, 'an <audio> element was created');
ok(audio && audio.src, 'it has a source assigned');
ok(audio && !audio.paused, 'it is actually playing (not paused)');
ok(audio && audio.t>0, `playhead advanced (${audio?.t?.toFixed(2)}s)`);

// persistence across a reload
await p.reload(); await p.waitForTimeout(2600);
await p.mouse.click(600,300); await p.waitForTimeout(400);
ok(await p.locator('text=/2 songs/').count()>0, 'songs survive a page reload (IndexedDB)');

// removing one
const before = await p.locator('button[aria-label^="Remove "]').count();
await p.locator('button[aria-label^="Remove "]').first().click();
await p.waitForTimeout(1800);
const after = await p.locator('button[aria-label^="Remove "]').count();
ok(after===before-1, `removing a song works (${before} → ${after})`);

// reject a non-audio file
await p.setInputFiles('#song-upload', ['package.json']);
await p.waitForTimeout(900);
ok(await p.locator('text=/Skipped/').count()>0, 'a non-audio file is rejected with a reason');

console.log(`\n${pass} passed, ${fail} failed`);
console.log('--- console errors ---'); console.log(errs.length?errs.join('\n'):'none');
await b.close();
process.exit(fail?1:0);
