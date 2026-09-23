import {launchOptions} from 'camoufox-js';
import {firefox} from 'playwright-core';
const log=(event:string,data:Record<string,unknown>)=>console.log(JSON.stringify({event,...data}));
const browser=await firefox.launch({...await launchOptions({headless:false,geoip:true,locale:'en-GB'}),timeout:60000});
let failed=false;
try {
 for(const [cinema,slug] of [['Leicester Square','x06v1-cineworld-cinema-london-leicester-square'],['Enfield','x078z-cineworld-cinema-london-enfield']]) {
  const context=await browser.newContext();const page=await context.newPage();
  const urls=new Set<string>();
  page.on('response',response=>{
   const u=new URL(response.url());
   if(u.hostname==='www.cineworld.co.uk' && u.pathname.startsWith('/api/gatsby-source-boxofficeapi/')) {
    log('site-api-response',{cinema,path:u.pathname,status:response.status()});
    if(['/api/gatsby-source-boxofficeapi/schedule','/api/gatsby-source-boxofficeapi/scheduledMovies'].includes(u.pathname))urls.add(u.href);
   }
  });
  try {
   const r=await page.goto('https://www.cineworld.co.uk/cinemas/'+slug+'/',{waitUntil:'domcontentloaded',timeout:45000});
   log('navigation',{cinema,status:r?.status(),cfMitigated:r?.headers()['cf-mitigated']??null});
   await page.waitForFunction(()=>!!document.querySelector('a[href*="/order/showtimes/"]')||/sorry, you have been blocked/i.test(document.body.innerText),{},{timeout:30000}).catch(()=>{});
   const state=await page.evaluate(()=>({blocked:/just a moment|attention required|sorry, you have been blocked/i.test(document.title+' '+document.body.innerText.slice(0,800)),bookingLinks:document.querySelectorAll('a[href*="/order/showtimes/"]').length,imaxLabels:document.querySelectorAll('img[alt="IMAX"]').length}));
   log('page-result',{cinema,...state,observedScheduleApis:urls.size});
   if(state.blocked||!urls.size){failed=true;continue;}
   let scheduleValid=false;
   for(const url of [...urls].slice(0,4)) {
    const result=await page.evaluate(async url=>{
     const r=await fetch(url,{credentials:'same-origin',signal:AbortSignal.timeout(15000)});
     const text=await r.text();let json:unknown;try{json=JSON.parse(text);}catch{}
     const keys=json&&typeof json==='object'?Object.keys(json):[];
     let objects=0,showtimes=0,imax=0;const fields=new Set<string>();
     const walk=(v:unknown)=>{if(!v||typeof v!=='object')return;if(Array.isArray(v)){v.forEach(walk);return;}objects++;for(const [k,x]of Object.entries(v)){fields.add(k);if(/startAt|startTime|showtimeId/i.test(k))showtimes++;if(typeof x==='string'&&/imax/i.test(x))imax++;if(typeof x==='object')walk(x);}};walk(json);
     return {status:r.status,cfMitigated:r.headers.get('cf-mitigated'),json:json!==undefined,keys,objects,showtimeFieldCount:showtimes,imaxValueCount:imax,fields:[...fields].filter(k=>/time|date|tag|url|id/i.test(k)).slice(0,25)};
    },url);
    const path=new URL(url).pathname;log('browser-api-replay',{cinema,path,...result});
    if(path.endsWith('/schedule')&&result.status===200&&result.json&&result.objects>1)scheduleValid=true;
   }
   if(!scheduleValid||state.bookingLinks===0)failed=true;
  }catch(error){failed=true;log('probe-error',{cinema,type:error instanceof Error?error.name:'Unknown'});}
  finally{await context.close();}
 }
}finally{await browser.close();}
if(failed)process.exitCode=1;
