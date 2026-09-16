import type {Collection} from './types.ts';
import type {Browser, Response} from 'playwright-core';
import {writeFile,readFile,mkdir,rm,rename,appendFile} from 'node:fs/promises';
import {launchOptions} from 'camoufox-js';
import {firefox} from 'playwright-core';
import {validateCollection} from './collection.ts';
import {parsePage,checkedPageUrl} from './parse.ts';
import {validateSearchForm,searchInputSelector} from './search.ts';
import {CollectionError,isRecord,requireCondition} from './errors.ts';
import {responseDiagnostic,errorDiagnostic} from './diagnostics.ts';
import {checkedNavigation} from './navigation.ts';
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
const recordResponse=(response: Response | null)=>{lastResponse=responseDiagnostic(response);log('http-response',{phase,page:currentPage,phaseElapsedMs:Date.now()-phaseStarted,...lastResponse});};
const log = (event: string, values: Record<string, unknown> = {}) => console.log(JSON.stringify({event,timestamp:new Date().toISOString(),elapsedMs:Date.now()-started,...values}));
await mkdir('work', {recursive:true});
await rm('work/payload.json', {force:true});
await rm('work/payload.json.tmp', {force:true});
try {
  setPhase('launch');
  browser = await firefox.launch({...await launchOptions({headless:true,geoip:true,locale:'en-GB'}),timeout:60000});
  const page = await browser.newPage({viewport:{width:1440,height:900}});
  setPhase('search-home');
  requireCondition(!new URL(target).search, 'FILTERED_SEARCH_URL');
  const form = page.locator('form').filter({has:page.locator(searchInputSelector)});
  await checkedNavigation(page,()=>page.goto(target,{waitUntil:'domcontentloaded',timeout:60000}),form,recordResponse,log);
  await form.waitFor({timeout:30000});
  validateSearchForm(await form.evaluate(el=>el.outerHTML),page.url());
  setPhase('search-all');
  // Submit the live IMAX search form with empty keyword/date/category filters.
  // Its session token stays inside the browser and is never exported.
  const rows = page.locator('div.result-box-item').first();
  await checkedNavigation(page,async()=>{
    const [response] = await Promise.all([
      page.waitForNavigation({waitUntil:'domcontentloaded',timeout:60000}),
      form.locator('input[type="submit"]').click(),
    ]);
    return response;
  },rows,recordResponse,log);
  checkedPageUrl(page.url());
  const payload: Collection = {schemaVersion:1,source:config.source,collectedAt:'',complete:false,pages:[],expectedPages:0,performances:[]};
  let next: string | null = page.url();
  for (let number=1; next && number<=config.maxPages; number++) {
    currentPage=number;
    if (number>1) {
      setPhase('navigate');
      const destination = next;
      await checkedNavigation(page,()=>page.goto(destination,{waitUntil:'domcontentloaded',timeout:60000}),rows,recordResponse,log);
    }
    setPhase('wait-for-rows');
    await page.locator('div.result-box-item').first().waitFor({timeout:30000});
    setPhase('parse');
    const result = parsePage(await page.content(), checkedPageUrl(page.url()).href, number);
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
