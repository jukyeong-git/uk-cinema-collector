import {httpHandoff} from './http-handoff.ts';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {setTimeout as sleep} from 'node:timers/promises';
import {launchOptions} from 'camoufox-js';
import {firefox,type Browser,type Page,type Response} from 'playwright-core';
import type {Collection} from '../src/types.ts';
import {parsePage,checkedPageUrl} from '../src/parse.ts';
import {validateSearchForm,searchInputSelector} from '../src/search.ts';
import {validateCollection} from '../src/collection.ts';
import {collectionHash} from '../src/change.ts';
import {CollectionError,isRecord,requireCondition} from '../src/errors.ts';
import {responseDiagnostic,errorDiagnostic} from '../src/diagnostics.ts';
import {repeatSession} from './session-repeat.ts';

const config:unknown=JSON.parse(await readFile(new URL('../config/bfi.json',import.meta.url),'utf8'));
requireCondition(isRecord(config) && config.source==='bfi-imax' && typeof config.searchUrl==='string' && typeof config.maxPages==='number' && Number.isInteger(config.maxPages) && config.maxPages>=1 && config.maxPages<=100,'INVALID_CONFIG');
const source='bfi-imax' as const;
const maxPages=config.maxPages;
const target=checkedPageUrl(config.searchUrl).href;
const handoff=process.env.HTTP_HANDOFF==='true';
const maximumAttempts=handoff?1:10;
const directory=handoff?'work/http-handoff-probe':'work/session-reuse-probe';
const started=Date.now();
let browser:Browser|undefined;
let phase='launch';
let attempt=0;
let passed=0;
let currentPage=0;
let previousHash:string|undefined;
let lastResponse:ReturnType<typeof responseDiagnostic>|undefined;
const events:Record<string,unknown>[]=[];
const log=(event:string,values:Record<string,unknown>={})=>{
  const entry={event,timestamp:new Date().toISOString(),elapsedMs:Date.now()-started,attempt,...values};
  events.push(entry);console.log(JSON.stringify(entry));
};
const setPhase=(value:string)=>{phase=value;log('phase-start',{phase,page:currentPage});};
const recordResponse=(response:Response|null)=>{lastResponse=responseDiagnostic(response);log('http-response',{phase,page:currentPage,...lastResponse});};
const save=()=>writeFile(`${directory}/report.json`,JSON.stringify({startedAt:new Date(started).toISOString(),maximumAttempts,intervalSeconds:60,intervalBasis:'after-completion',passed,attempt,events},null,2)+'\n');
await mkdir(directory,{recursive:true});
try {
  browser=await firefox.launch({...await launchOptions({headless:false,geoip:true,locale:'en-GB'}),timeout:60000});
  const context=await browser.newContext({viewport:{width:1440,height:900}});
  const page=await context.newPage();
  page.setDefaultTimeout(30000);
  log('browser-started',{version:browser.version(),headless:false,displayAvailable:Boolean(process.env.DISPLAY),sessionReuse:true});
  await repeatSession(page,async (page:Page,number:number)=>{
    attempt=number;currentPage=0;lastResponse=undefined;
    const cookies=await context.cookies(target);
    log('attempt-start',{cookiesBefore:cookies.length,hasClearance:cookies.some(c=>c.name==='cf_clearance'),baselineEstablished:passed>0});
    setPhase('search-home');
    requireCondition(!new URL(target).search, 'FILTERED_SEARCH_URL');
    const home = await page.goto(target,{waitUntil:'domcontentloaded',timeout:60000});
    recordResponse(home);
    requireCondition(home?.ok() && home.headers()['cf-mitigated'] !== 'challenge', 'BFI_BLOCKED');
    const form = page.locator('form').filter({has:page.locator(searchInputSelector)});
    await form.waitFor({timeout:30000});
    validateSearchForm(await page.content(),page.url());
    setPhase('search-all');
    // Submit the live IMAX search form with empty keyword/date/category filters.
    // Its session token stays inside the browser and is never exported.
    const [searchResponse] = await Promise.all([
      page.waitForNavigation({waitUntil:'domcontentloaded',timeout:60000}),
      form.locator('input[type="submit"]').click(),
    ]);
    recordResponse(searchResponse);
    requireCondition(searchResponse?.ok() && searchResponse.headers()['cf-mitigated'] !== 'challenge', 'BFI_BLOCKED');
    checkedPageUrl(page.url());
    const payload: Collection = {schemaVersion:1,source,collectedAt:'',complete:false,pages:[],expectedPages:0,performances:[]};
    let next: string | null = page.url();
    for (let number=1; next && number<=maxPages; number++) {
      currentPage=number;
      if (number>1) {
        setPhase('navigate');
        const response = await page.goto(next,{waitUntil:'domcontentloaded',timeout:60000});
        recordResponse(response);
        requireCondition(response?.ok() && response.headers()['cf-mitigated'] !== 'challenge', 'BFI_BLOCKED');
      }
      setPhase('wait-for-rows');
      await page.locator('div.result-box-item').first().waitFor({timeout:30000});
      setPhase('parse');
      const result = parsePage(await page.content(), next, number);
      if (number===1) payload.expectedPages=result.totalPages;
      requireCondition(result.totalPages === payload.expectedPages, 'PAGINATION_CHANGED');
      payload.pages.push({number,count:result.rows.length});
      payload.performances.push(...result.rows);
      next=result.next;
      log('page-collected',{page:number,rows:result.rows.length,hasNext:Boolean(next)});
    }
    requireCondition(!next, 'PAGE_LIMIT_EXCEEDED');
    setPhase('validate');
    payload.complete=true;
    payload.collectedAt=new Date().toISOString();
    validateCollection(payload);
    const hash=collectionHash(payload);
    const cookiesAfter=await context.cookies(target);
    passed++;
    log('attempt-passed',{pages:payload.pages.length,performances:payload.performances.length,hash,changedFromPrevious:previousHash===undefined?null:previousHash!==hash,cookiesAfter:cookiesAfter.length,hasClearance:cookiesAfter.some(c=>c.name==='cf_clearance')});
    previousHash=hash;
    await save();
  },async ms=>{log('waiting',{seconds:ms/1000});await sleep(ms);},maximumAttempts);
  if(handoff) {
    phase='http-handoff';
    await httpHandoff(context,target,maxPages,await page.evaluate(()=>navigator.userAgent),previousHash!,log);
  }
  log('probe-complete',{passed});
} catch(error) {
  log('probe-failed',{phase,page:currentPage,passed,baselineEstablished:passed>0,remainingAttemptsCancelled:Math.max(0,maximumAttempts-attempt),code:error instanceof CollectionError?error.code:'EXECUTION_ERROR',lastResponse,...errorDiagnostic(error)});
  process.exitCode=1;
} finally {
  try {await browser?.close();} catch(error) {log('browser-close-failed',errorDiagnostic(error));process.exitCode=1;}
  await save();
}
