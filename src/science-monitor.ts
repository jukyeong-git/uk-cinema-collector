import {firefox,type Browser} from 'playwright-core';
import {launchOptions} from 'camoufox-js';
import {collect} from './science-collector.ts';
import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
import {mkdir,writeFile,readFile,rm} from 'node:fs/promises';import {setTimeout as sleep} from 'node:timers/promises';
const deadline=Number(process.env.COLLECTOR_END_AT);if(!Number.isFinite(deadline)||deadline<=Date.now())throw Error('INVALID_DEADLINE');
await mkdir('work',{recursive:true});let success=0,lastHash='',pending=false;let browser:Browser|undefined;
let context:import('playwright-core').BrowserContext|undefined;
let phase='launch';
let apiPagePromise:Promise<import('playwright-core').Page>|undefined;
const browserFetch:typeof fetch=async(input,init)=>{
 const url=String(input);if(!context)throw Error('BROWSER_NOT_READY');
 if(new URL(url).hostname==='www.sciencemuseum.org.uk'){
  phase=new URL(url).pathname==='/imax-cinema'?'film-list':'film-details';const page=await context.newPage();try{const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:20000});return new Response(await page.content(),{status:response?.status()??500});}finally{await page.close();}
 }
 if(url!=='https://my.sciencemuseum.org.uk/api/products/productionseasons'||init?.method!=='POST'||typeof init.body!=='string')throw Error('UNEXPECTED_BROWSER_REQUEST');
 if(!apiPagePromise){phase='booking-page';const ctx=context;const request=JSON.parse(init.body);apiPagePromise=(async()=>{const page=await ctx.newPage();const date=request.startDate.slice(0,10).split('-').reverse().join('-');await page.goto('https://my.sciencemuseum.org.uk/events?'+new URLSearchParams({view:'calendar',kid:request.keywordIds[0],startdate:date}),{waitUntil:'domcontentloaded',timeout:20000});return page;})();}
 const page=await apiPagePromise;
 phase='booking-api';const result=await page.evaluate(async({url,body})=>{const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body,credentials:'same-origin',signal:AbortSignal.timeout(15000)});return {status:r.status,text:await r.text()};},{url,body:init.body});
 return new Response(result.text,{status:result.status});
};
try{
 browser=await firefox.launch({...await launchOptions({headless:false,geoip:true,locale:'en-GB'}),timeout:60000});context=await browser.newContext();
 while(Date.now()<deadline-25000){const start=Date.now();try{
  const payload=await collect(browserFetch);const hash=createHash('sha256').update(JSON.stringify({films:payload.films,rows:payload.rows})).digest('hex');
  let sent=0;
  if(process.env.DELIVER==='true'&&(hash!==lastHash||pending)){
   if(!process.env.RECEIVER_FUNCTION)throw Error('MISSING_RECEIVER');
   await writeFile('work/science-payload.json',JSON.stringify(payload));
   const meta=JSON.parse(execFileSync('aws',['lambda','invoke','--function-name',process.env.RECEIVER_FUNCTION,'--invocation-type','RequestResponse','--payload','fileb://work/science-payload.json','work/science-response.json','--no-cli-pager'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:40000}));
   const response=JSON.parse(await readFile('work/science-response.json','utf8'));if(meta.FunctionError||response.accepted!==true)throw Error('RECEIVER_REJECTED');pending=response.pending>0;sent=response.sent;lastHash=hash;
  }
  success++;console.log(JSON.stringify({event:'science-cycle-complete',films:payload.films.length,rows:payload.rows.length,sent,pending}));
 }catch(e){const message=e instanceof Error?e.message:'';console.log(JSON.stringify({event:'science-cycle-failed',phase,errorType:e instanceof Error?e.name:'unknown',code:/^[A-Z][A-Z0-9_]{0,80}$/.test(message)?message:'EXECUTION_ERROR'}));}
 const delay=Math.min(Math.max(0,60000-(Date.now()-start)),Math.max(0,deadline-Date.now()));if(delay)await sleep(delay);
 }
 if(!success)process.exitCode=1;
 console.log(JSON.stringify({event:'science-monitor-complete',success}));
}finally{await browser?.close();await rm('work/science-payload.json',{force:true});await rm('work/science-response.json',{force:true});}
