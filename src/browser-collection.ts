import type {Page,Response} from 'playwright-core';
import type {Collection} from './types.ts';
import {validateCollection} from './collection.ts';
import {parsePage,checkedPageUrl} from './parse.ts';
import {validateSearchForm,searchInputSelector} from './search.ts';
import {requireCondition} from './errors.ts';
import {responseDiagnostic} from './diagnostics.ts';
export interface CollectionTrace {phase:string;page:number;response?:ReturnType<typeof responseDiagnostic>;retryAfter?:string}
export async function collectPageSession(page:Page,target:string,maxPages:number,trace:CollectionTrace,log:(event:string,values:Record<string,unknown>)=>void):Promise<Collection> {
  let currentPage=0;
  trace.page=0;trace.response=undefined;trace.retryAfter=undefined;
  const setPhase=(phase:string)=>{trace.phase=phase;trace.page=currentPage;log('phase-start',{phase,page:currentPage});};
  const recordResponse=(response:Response|null)=>{
    trace.response=responseDiagnostic(response);trace.retryAfter=response?.headers()['retry-after'];
    log('http-response',{phase:trace.phase,page:currentPage,...trace.response});
  };
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
  const payload: Collection = {schemaVersion:1,source:'bfi-imax',collectedAt:'',complete:false,pages:[],expectedPages:0,performances:[]};
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
  return payload;
}
