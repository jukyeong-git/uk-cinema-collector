import {firefox,type Browser} from 'playwright-core';
import {launchOptions} from 'camoufox-js';
import {errorDiagnostic,responseDiagnostic} from './diagnostics.ts';
import {collect} from './science-collector.ts';
import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
import {mkdir,writeFile,readFile,rm} from 'node:fs/promises';import {setTimeout as sleep} from 'node:timers/promises';
const deadline=Number(process.env.COLLECTOR_END_AT);if(!Number.isFinite(deadline)||deadline<=Date.now())throw Error('INVALID_DEADLINE');
await mkdir('work',{recursive:true});let success=0,lastHash='',pending=false;let browser:Browser|undefined;
let context:import('playwright-core').BrowserContext|undefined;
let phase='launch',attempt=0,requestId=0;const started=Date.now();
const log=(event:string,values:Record<string,unknown>={})=>console.log(JSON.stringify({event,timestamp:new Date().toISOString(),elapsedMs:Date.now()-started,attempt,...values}));
async function stage<T>(name:string,operation:()=>Promise<T>):Promise<T>{const id=++requestId,start=Date.now();phase=name;log('science-phase-start',{phase:name,requestId:id});try{const value=await operation();log('science-phase-complete',{phase:name,requestId:id,phaseElapsedMs:Date.now()-start});return value;}catch(error){log('science-phase-failed',{phase:name,requestId:id,phaseElapsedMs:Date.now()-start,...errorDiagnostic(error)});throw error;}}
let apiPagePromise:Promise<import('playwright-core').Page>|undefined;
const timer=setTimeout(()=>{void browser?.close().catch(()=>{});},Math.max(0,deadline-Date.now()));
const browserFetch:typeof fetch=async(input,init)=>{
 const url=String(input);if(!context)throw Error('BROWSER_NOT_READY');
 if(new URL(url).hostname==='www.sciencemuseum.org.uk'){
  const name=new URL(url).pathname==='/imax-cinema'?'film-list':'film-details';const ctx=context;return stage(name,async()=>{const page=await ctx.newPage();try{const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:20000});const html=await page.content();log('science-http-response',{phase:name,...responseDiagnostic(response),bytes:Buffer.byteLength(html),impervaChallenge:html.includes('_Incapsula_Resource')});return new Response(html,{status:response?.status()??500});}finally{await page.close();}});
 }
 if(url!=='https://my.sciencemuseum.org.uk/api/products/productionseasons'||init?.method!=='POST'||typeof init.body!=='string')throw Error('UNEXPECTED_BROWSER_REQUEST');
 if(!apiPagePromise){phase='booking-page';const ctx=context;const request=JSON.parse(init.body);apiPagePromise=stage('booking-page',async()=>{const page=await ctx.newPage();const date=request.startDate.slice(0,10).split('-').reverse().join('-');const response=await page.goto('https://my.sciencemuseum.org.uk/events?'+new URLSearchParams({view:'calendar',kid:request.keywordIds[0],startdate:date}),{waitUntil:'domcontentloaded',timeout:20000});log('science-booking-session-ready',{...responseDiagnostic(response)});return page;});}
 const page=await apiPagePromise;
 phase='booking-api';const result=await stage('booking-api',()=>page.evaluate(async({url,body})=>{const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body,credentials:'same-origin',signal:AbortSignal.timeout(15000)});return {status:r.status,text:await r.text()};},{url,body:String(init.body)}));
 log('science-http-response',{phase:'booking-api',httpStatus:result.status,bytes:Buffer.byteLength(result.text),impervaChallenge:result.text.includes('_Incapsula_Resource')});
 return new Response(result.text,{status:result.status});
};
try{
 log('science-monitor-started',{deadline:new Date(deadline).toISOString(),intervalSeconds:60,deliveryEnabled:process.env.DELIVER==='true'});
 browser=await stage('launch',async()=>firefox.launch({...await launchOptions({headless:false,geoip:true,locale:'en-GB'}),timeout:60000}));context=await browser.newContext();log('science-browser-started',{version:browser.version(),headless:false});
 while(Date.now()<deadline-25000){const start=Date.now();attempt++;log('science-collection-start');try{
  const payload=await stage('collect',()=>collect(browserFetch));log('science-collection-complete',{films:payload.films.length,bookableFilms:payload.films.filter(f=>f.keywordIds.length).length,rows:payload.rows.length,through:payload.through,collectionElapsedMs:Date.now()-start});if(Date.now()>=deadline)break;const hash=createHash('sha256').update(JSON.stringify({films:payload.films,rows:payload.rows})).digest('hex');
  log('science-hash-compared',{changed:hash!==lastHash,pending,hash});
  let sent=0;
  if(process.env.DELIVER==='true'&&(hash!==lastHash||pending)){
   phase='deliver';log('science-delivery-start',{reason:hash!==lastHash?'changed':'pending'});
   if(!process.env.RECEIVER_FUNCTION)throw Error('MISSING_RECEIVER');
   await writeFile('work/science-payload.json',JSON.stringify(payload));
   const meta=JSON.parse(execFileSync('aws',['lambda','invoke','--function-name',process.env.RECEIVER_FUNCTION,'--invocation-type','RequestResponse','--payload','fileb://work/science-payload.json','work/science-response.json','--no-cli-pager'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:Math.max(1,Math.min(40000,deadline-Date.now()))}));
   const response=JSON.parse(await readFile('work/science-response.json','utf8'));if(meta.FunctionError||response.accepted!==true)throw Error('RECEIVER_REJECTED');pending=response.pending>0;sent=response.sent;lastHash=hash;log('science-delivery-complete',{accepted:true,sent,pending});
  }
  success++;log('science-cycle-complete',{films:payload.films.length,rows:payload.rows.length,sent,pending,cycleElapsedMs:Date.now()-start});
 }catch(e){if(Date.now()>=deadline)break;const message=e instanceof Error?e.message:'';log('science-cycle-failed',{phase,...errorDiagnostic(e),code:/^[A-Z][A-Z0-9_]{0,80}$/.test(message)?message:'EXECUTION_ERROR'});}
 const delay=Math.min(Math.max(0,60000-(Date.now()-start)),Math.max(0,deadline-Date.now()));if(delay){log('science-monitor-wait',{seconds:delay/1000});await sleep(delay);}
 }
 if(!success)process.exitCode=1;
 log('science-monitor-complete',{success,attempts:attempt,reason:'deadline'});
}catch(error){log('science-monitor-failed',{phase,...errorDiagnostic(error)});process.exitCode=1;}finally{clearTimeout(timer);await browser?.close().catch(()=>{});await rm('work/science-payload.json',{force:true});await rm('work/science-response.json',{force:true});}
