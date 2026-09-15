import {writeFile,readFile,mkdir,rm,rename,appendFile} from 'node:fs/promises';
import {launchOptions} from 'camoufox-js';
import {firefox} from 'playwright-core';
import {validateCollection} from './collection.mjs';
import {parsePage,checkedPageUrl} from './parse.mjs';
import {CollectionError,requireCondition} from './errors.mjs';
const config = JSON.parse(await readFile(new URL('../config/bfi.json', import.meta.url), 'utf8'));
const target = checkedPageUrl(config.articleUrl).href;
const started = Date.now();
let browser;
let phase = 'prepare';
const log = (event, values = {}) => console.log(JSON.stringify({event,...values}));
await mkdir('work', {recursive:true});
await rm('work/payload.json', {force:true});
await rm('work/payload.json.tmp', {force:true});
try {
  phase = 'launch';
  log(phase);
  browser = await firefox.launch({...await launchOptions({headless:true,geoip:true,locale:'en-GB'}),timeout:60000});
  const page = await browser.newPage({viewport:{width:1440,height:900}});
  phase = 'warmup';
  try { await page.goto('https://whatson.bfi.org.uk/imax/',{waitUntil:'domcontentloaded',timeout:15000}); }
  catch { log('warmup-incomplete'); }
  const payload = {schemaVersion:1,source:config.source,collectedAt:'',complete:false,pages:[],expectedPages:0,performances:[]};
  let next = target;
  for (let number=1; next && number<=config.maxPages; number++) {
    phase = 'navigate';
    const response = await page.goto(next,{waitUntil:'domcontentloaded',timeout:60000});
    requireCondition(response?.ok() && response.headers()['cf-mitigated'] !== 'challenge', 'BFI_BLOCKED');
    phase = 'wait-for-rows';
    await page.locator('div.result-box-item').first().waitFor({timeout:30000});
    phase = 'parse';
    const result = parsePage(await page.content(), next, number);
    if (number===1) payload.expectedPages=result.totalPages;
    requireCondition(result.totalPages === payload.expectedPages, 'PAGINATION_CHANGED');
    payload.pages.push({number,count:result.rows.length});
    payload.performances.push(...result.rows);
    next=result.next;
    log('page-collected',{page:number,rows:result.rows.length,hasNext:Boolean(next)});
  }
  requireCondition(!next, 'PAGE_LIMIT_EXCEEDED');
  phase = 'validate';
  payload.complete=true;
  payload.collectedAt=new Date().toISOString();
  validateCollection(payload);
  await writeFile('work/payload.json.tmp',JSON.stringify(payload));
  await rename('work/payload.json.tmp','work/payload.json');
  const summary={collected:payload.performances.length,pages:payload.pages.length,elapsedMs:Date.now()-started};
  log('collection-complete',summary);
  if(process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,`## Collection verified\n\n- Pages: ${summary.pages}\n- Performances: ${summary.collected}\n- Duration: ${(summary.elapsedMs/1000).toFixed(1)} seconds\n\nOnly validated schedule fields may be retained when JSON export is enabled. Cookies and raw HTML are never exported.\n`);
} catch(error) {
  await rm('work/payload.json',{force:true});
  // Browser/network errors can contain session URLs. Expose only controlled codes.
  log('collection-failed',{phase,code:error instanceof CollectionError ? error.code : 'EXECUTION_ERROR',errorType:error.name});
  process.exitCode=1;
} finally {
  await browser?.close();
}
