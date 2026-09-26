import {collectPageSession,type CollectionTrace} from './browser-collection.ts';
import type {Browser} from 'playwright-core';
import {writeFile,readFile,mkdir,rm,rename,appendFile} from 'node:fs/promises';
import {launchOptions} from 'camoufox-js';
import {firefox,chromium} from 'playwright-core';
import {checkedPageUrl} from './parse.ts';
import {CollectionError,isRecord,requireCondition} from './errors.ts';
import {responseDiagnostic,errorDiagnostic} from './diagnostics.ts';
const config: unknown = JSON.parse(await readFile(new URL('../config/bfi.json', import.meta.url), 'utf8'));
requireCondition(isRecord(config) && config.source === 'bfi-imax' && typeof config.searchUrl === 'string' && typeof config.maxPages === 'number' && Number.isInteger(config.maxPages) && config.maxPages >= 1 && config.maxPages <= 100, 'INVALID_CONFIG');
const target = checkedPageUrl(config.searchUrl).href;
const started = Date.now();
let browser: Browser | undefined;
let phase = 'prepare';
let phaseStarted=started;
let currentPage=0;
let lastResponse: ReturnType<typeof responseDiagnostic> | undefined;
const setPhase=(value: string)=>{
  log('phase-complete',{phase,phaseElapsedMs:Date.now()-phaseStarted});
  phase=value;phaseStarted=Date.now();
  log('phase-start',{phase,page:currentPage});
};
const log = (event: string, values: Record<string, unknown> = {}) => console.log(JSON.stringify({event,timestamp:new Date().toISOString(),elapsedMs:Date.now()-started,...values}));
await mkdir('work', {recursive:true});
await rm('work/payload.json', {force:true});
await rm('work/payload.json.tmp', {force:true});
try {
  setPhase('launch');
  const engine = process.env.COLLECTOR_BROWSER ?? 'camoufox';
  requireCondition(engine === 'camoufox' || engine === 'chromium', 'INVALID_COLLECTOR_BROWSER');
  browser = engine === 'chromium'
    ? await chromium.launch({headless:true,timeout:60000})
    : await firefox.launch({...await launchOptions({headless:false,geoip:true,locale:'en-GB'}),timeout:60000});
  log('browser-started',{engine,version:browser.version(),headless:engine !== 'camoufox',displayAvailable:Boolean(process.env.DISPLAY)});
  const page = await browser.newPage({viewport:{width:1440,height:900},...(engine !== 'camoufox'?{locale:'en-GB'}:{})});
  const trace:CollectionTrace={phase:'search-home',page:0};
  const payload=await collectPageSession(page,target,config.maxPages,trace,(event,values)=>{phase=trace.phase;currentPage=trace.page;lastResponse=trace.response;log(event,values);});
  await writeFile('work/payload.json.tmp',JSON.stringify(payload));
  await rename('work/payload.json.tmp','work/payload.json');
  const summary={programmes:new Set(payload.performances.map(row=>row.articleId.toLowerCase())).size,collected:payload.performances.length,pages:payload.pages.length,elapsedMs:Date.now()-started};
  log('collection-complete',summary);
  if(process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,`## Collection verified\n\n- Scope: all published BFI IMAX schedules (no keyword/date filter)\n- Programmes: ${summary.programmes}\n- Pages: ${summary.pages}\n- Performances: ${summary.collected}\n- Duration: ${(summary.elapsedMs/1000).toFixed(1)} seconds\n\nSchedule JSON is not retained as an artifact. Cookies and raw HTML are never exported.\n`);
} catch(error) {
  await rm('work/payload.json',{force:true});
  // Browser/network errors can contain session URLs. Expose only controlled codes.
  log('collection-failed',{phase,code:error instanceof CollectionError ? error.code : 'EXECUTION_ERROR',page:currentPage,phaseElapsedMs:Date.now()-phaseStarted,lastResponse,...errorDiagnostic(error)});
  process.exitCode=1;
} finally {
  await browser?.close();
}
