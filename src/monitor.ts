import {readFile,writeFile,mkdir,rename,rm,appendFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {setTimeout as sleep} from 'node:timers/promises';
import {launchOptions} from 'camoufox-js';
import {firefox,type Browser} from 'playwright-core';
import {collectPageSession,type CollectionTrace} from './browser-collection.ts';
import {checkedPageUrl} from './parse.ts';
import {CollectionError,isRecord,requireCondition} from './errors.ts';
import {errorDiagnostic} from './diagnostics.ts';
import {collectionHash} from './change.ts';
import {monitorLoop,processChange} from './monitor-loop.ts';
const started=Date.now();
const deadline=Number(process.env.COLLECTOR_END_AT);
requireCondition(Number.isFinite(deadline) && deadline>started && deadline-started<=58*60000,'INVALID_MONITOR_DEADLINE');
const controller=new AbortController();
let browser:Browser|undefined;
let attempts=0,collections=0;
const trace:CollectionTrace={phase:'launch',page:0};
const log=(event:string,values:Record<string,unknown>={})=>console.log(JSON.stringify({event,timestamp:new Date().toISOString(),attempt:attempts,...values}));
const timer=setTimeout(()=>{controller.abort();void browser?.close().catch(()=>{});},deadline-Date.now());
const run=(script:string,args:string[]=[])=>new Promise<void>((resolve,reject)=>{
  const child=execFile(process.execPath,['--import','tsx',script,...args],{timeout:150000,signal:controller.signal,env:process.env},error=>error?reject(new CollectionError('MONITOR_SUBPROCESS_FAILED')):resolve());
  // Child CLIs expose only sanitized status messages, never payloads or raw errors.
  child.stdout?.pipe(process.stdout);child.stderr?.pipe(process.stderr);
});
await mkdir('work',{recursive:true});
try {
  const config:unknown=JSON.parse(await readFile(new URL('../config/bfi.json',import.meta.url),'utf8'));
  requireCondition(isRecord(config) && config.source==='bfi-imax' && typeof config.searchUrl==='string' && typeof config.maxPages==='number' && Number.isInteger(config.maxPages) && config.maxPages>=1 && config.maxPages<=100,'INVALID_CONFIG');
  const target=checkedPageUrl(config.searchUrl).href;
  const maxPages=config.maxPages;
  browser=await firefox.launch({...await launchOptions({headless:false,geoip:true,locale:'en-GB'}),timeout:60000});
  const context=await browser.newContext({viewport:{width:1440,height:900}});
  const page=await context.newPage();page.setDefaultTimeout(30000);
  log('monitor-started',{version:browser.version(),intervalSeconds:60,deadline:new Date(deadline).toISOString(),deliveryEnabled:process.env.DELIVER==='true'});
  await monitorLoop({
    signal:controller.signal,now:Date.now,
    wait:async ms=>{log('monitor-wait',{seconds:ms/1000});await sleep(ms,undefined,{signal:controller.signal});},
    response:()=>({status:trace.response?.responseReceived?trace.response.httpStatus:undefined,retryAfter:trace.retryAfter}),
    failed:async(initialAttempt,error)=>{log('initial-attempt-failed',{initialAttempt,phase:trace.phase,page:trace.page,lastResponse:trace.response,...errorDiagnostic(error)});},
    collect:async()=>{
      attempts++;
      for(const file of ['payload.json','payload.json.tmp','pending-state.json','response.json'])await rm(`work/${file}`,{force:true});
      const cookies=await context.cookies(target);
      log('collection-start',{hasClearance:cookies.some(c=>c.name==='cf_clearance'),baselineEstablished:collections>0});
      const payload=await collectPageSession(page,target,maxPages,trace,log);
      controller.signal.throwIfAborted();
      await writeFile('work/payload.json.tmp',JSON.stringify(payload));await rename('work/payload.json.tmp','work/payload.json');
      collections++;
      log('collection-complete',{collections,pages:payload.pages.length,performances:payload.performances.length,hash:collectionHash(payload)});
    },
    process:async()=>{
      trace.phase='compare';await run('src/state.ts',['compare']);
      const pending:unknown=JSON.parse(await readFile('work/pending-state.json','utf8'));
      requireCondition(isRecord(pending) && typeof pending.changed==='boolean','INVALID_PENDING_STATE');
      await processChange(pending.changed,process.env.DELIVER==='true',async()=>{trace.phase='deliver';await run('src/deliver.ts');},async()=>{trace.phase='acknowledge';await run('src/state.ts',['acknowledge']);});
      log('cycle-complete',{collections,changed:pending.changed,deliveryEnabled:process.env.DELIVER==='true'});
    },
  });
} catch(error) {
  if(controller.signal.aborted)log('monitor-complete',{reason:'deadline',collections,attempts});
  else {log('monitor-failed',{phase:trace.phase,page:trace.page,collections,lastResponse:trace.response,code:error instanceof CollectionError?error.code:'EXECUTION_ERROR',...errorDiagnostic(error)});process.exitCode=1;}
} finally {
  clearTimeout(timer);await browser?.close().catch(()=>{});
  for(const file of ['payload.json','payload.json.tmp','pending-state.json','response.json'])await rm(`work/${file}`,{force:true});
  if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,`## Session monitor\n\n- Completed collections: ${collections}\n- Attempts: ${attempts}\n- Duration: ${Math.round((Date.now()-started)/1000)} seconds\n- Result: ${process.exitCode===1?'failed':'completed'}\n`);
}
