import {load} from 'cheerio';
import {request,type BrowserContext,type APIResponse} from 'playwright-core';
import {checkedPageUrl,parsePage} from '../src/parse.ts';
import {validateSearchForm,searchInputSelector} from '../src/search.ts';
import {validateCollection} from '../src/collection.ts';
import {collectionHash} from '../src/change.ts';
import {requireCondition} from '../src/errors.ts';
import {responseDiagnostic} from '../src/diagnostics.ts';
import type {Collection} from '../src/types.ts';

// Independent Node HTTP client; cookies stay in memory and never enter artifacts.
export async function httpHandoff(context:BrowserContext,target:string,maxPages:number,userAgent:string,baselineHash:string,log:(event:string,values:Record<string,unknown>)=>void) {
  const cookies=await context.cookies(target);
  const clearance=cookies.find(c=>c.name==='cf_clearance');
  log('handoff-start',{client:'Playwright APIRequestContext (Node HTTP)',cookieCount:cookies.length,hasClearance:Boolean(clearance),expiresAt:clearance && clearance.expires>0?new Date(clearance.expires*1000).toISOString():null});
  const client=await request.newContext({storageState:{cookies,origins:[]},userAgent,timeout:30000,extraHTTPHeaders:{'Accept':'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8','Accept-Language':'en-GB,en;q=0.5'}});
  let phase='http-search-home';
  const read=async(response:APIResponse)=>{
    const diagnostic=responseDiagnostic({headers:()=>response.headers(),status:()=>response.status(),request:()=>({redirectedFrom:()=>null})});
    log('http-handoff-response',{phase,...diagnostic});
    requireCondition(response.ok() && response.headers()['cf-mitigated']!=='challenge','HTTP_HANDOFF_BLOCKED');
    checkedPageUrl(response.url());
    return response.text();
  };
  try {
    await context.close();
    // Browser pages are closed: no JavaScript execution after this point.
    let html=await read(await client.get(target,{maxRedirects:0}));
    validateSearchForm(html,target);
    const $=load(html);
    const form=$('form').filter((_,el)=>$(el).find(searchInputSelector).length>0);
    const fields=new URLSearchParams();
    for(const field of form.serializeArray()) fields.append(field.name,field.value);
    const submit=form.find('input[type="submit"]');
    if(submit.attr('name')) fields.append(submit.attr('name')!,String(submit.val()??''));
    const action=checkedPageUrl(form.attr('action'),target).href;
    phase='http-search-all';
    const response=await client.post(action,{data:fields.toString(),headers:{'Content-Type':'application/x-www-form-urlencoded','Origin':new URL(target).origin,'Referer':target},maxRedirects:0});
    html=await read(response);
    const payload:Collection={schemaVersion:1,source:'bfi-imax',collectedAt:'',complete:false,pages:[],expectedPages:0,performances:[]};
    let next:string|null=response.url();
    for(let number=1;next && number<=maxPages;number++) {
      if(number>1){phase='http-pagination';html=await read(await client.get(checkedPageUrl(next).href,{maxRedirects:0}));}
      const result=parsePage(html,next,number);
      if(number===1)payload.expectedPages=result.totalPages;
      requireCondition(result.totalPages===payload.expectedPages,'PAGINATION_CHANGED');
      payload.pages.push({number,count:result.rows.length});payload.performances.push(...result.rows);next=result.next;
    }
    requireCondition(!next,'PAGE_LIMIT_EXCEEDED');
    payload.complete=true;payload.collectedAt=new Date().toISOString();validateCollection(payload);
    const hash=collectionHash(payload);
    log('http-handoff-passed',{pages:payload.pages.length,performances:payload.performances.length,hash,matchesBrowser:hash===baselineHash});
  } finally {await client.dispose();}
}
