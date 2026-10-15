import { chromium } from 'playwright';
import { readdirSync } from 'fs';
const files = readdirSync('public/audio/_probe').filter(f=>f.endsWith('.mp3'));
const b = await chromium.launch({ args:['--no-sandbox'] });
const p = await (await b.newContext()).newPage();
await p.goto('http://127.0.0.1:5173/', { waitUntil:'domcontentloaded' });
const out = await p.evaluate(async (fs)=>{
  const c = new OfflineAudioContext(1,44100,44100); const res={};
  for (const f of fs){
    try{
      const buf = await c.decodeAudioData(await (await fetch('/audio/_probe/'+encodeURIComponent(f))).arrayBuffer());
      const d=buf.getChannelData(0), sr=buf.sampleRate, bk=Math.floor(sr*0.025), env=[];
      let peak=0;
      for(let i=0;i<d.length;i+=bk){let s=0,n=0;for(let j=i;j<Math.min(i+bk,d.length);j++){s+=d[j]*d[j];n++;}
        const r=Math.sqrt(s/n); env.push(r); peak=Math.max(peak,r);}
      // trim: first and last bucket above 6% of peak
      const th=peak*0.06;
      let a=env.findIndex(v=>v>th); let z=env.length-1; while(z>0&&env[z]<=th)z--;
      res[f]={dur:+buf.duration.toFixed(2), peak:+peak.toFixed(3),
              start:+(a*0.025).toFixed(2), end:+((z+1)*0.025).toFixed(2),
              speech:+(((z+1-a)*0.025)).toFixed(2),
              env:env.map(v=>Math.round(v/ (peak||1) *9))};
    }catch(e){res[f]={err:String(e).slice(0,50)};}
  }
  return res;
},files);
for(const [f,v] of Object.entries(out)){
  if(v.err){console.log(f.padEnd(50),v.err);continue;}
  console.log(`\n${f}\n  dur=${v.dur}s  voice=${v.start}→${v.end} (${v.speech}s)  peak=${v.peak}`);
  console.log('  '+v.env.map(n=>' ▁▂▃▄▅▆▇██'[n]||' ').join(''));
}
await b.close();
