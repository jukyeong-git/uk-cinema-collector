import {mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {Camoufox} from 'camoufox-js';
import type {Browser, Frame, Locator, Page, Response} from 'playwright-core';
import {checkedPageUrl} from '../src/parse.ts';
import {searchInputSelector, validateSearchForm} from '../src/search.ts';
import {errorDiagnostic, responseDiagnostic} from '../src/diagnostics.ts';
import {isRecord, requireCondition} from '../src/errors.ts';
import {classifyFrame, resolveFrameEvidence, inspectionFailure} from './challenge-probe-discovery.ts';

const directory = 'work/challenge-probe';
const started = Date.now();
const elapsed = () => Date.now()-started;
type Outcome = 'no-challenge' | 'resolved' | 'click-timeout' | 'not-found' | 'unresolved' | 'error';
type FrameRecord = ReturnType<typeof classifyFrame> & {
  id:number; parentId:number|null; firstSeenMs:number; lastSeenMs:number;
  attached:boolean; checkboxCount:number; namedHumanControlCount:number;
  namedHumanLabelCount:number;
  documentInspection?:string; ownerInspection?:string;
  visibleEligibleCount:number; scans:number; rejectionReason:string|null;
};
const frameIds = new Map<Frame,number>();
const frames: FrameRecord[] = [];
const events: ({event:string; frameId:number; elapsedMs:number; documentInspection?:string; ownerInspection?:string} & ReturnType<typeof classifyFrame>)[] = [];
const responses: (ReturnType<typeof responseDiagnostic> & {elapsedMs:number})[] = [];
const screenshots: {stage:string; captured:boolean}[] = [];
let browser: Browser | undefined;
let browserVersion: string | undefined;
let page: Page | undefined;
let targetOrigin = '';
let latestResponse: Response | undefined;
let outcome: Outcome = 'error';
let failure: ReturnType<typeof errorDiagnostic> | undefined;
let challengeObserved = false;
let clickAttempted = false;
let clicked = false;
let clickedFrameId: number | undefined;
let initialChallengeMs: number | undefined;
let challengeStartedAt: number | undefined;
let searchEndedMs: number | undefined;
let truncated = false;
const humanName = /(?:verify|confirm|prove)(?:\s+that)?\s+(?:you(?:'re| are)?|i(?:'m| am)?)\s+(?:a\s+)?human|(?:i(?:'m| am)?)\s+not\s+a\s+robot/i;

async function bounded<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation,new Promise<never>((_,reject)=>{
      timer=setTimeout(()=>reject(new Error('INSPECTION_TIMEOUT')),Math.max(1,timeoutMs));
    })]);
  } finally { clearTimeout(timer); }
}

function observe(frame: Frame, event: string): FrameRecord | undefined {
  let id = frameIds.get(frame);
  if (id === undefined) {
    if (frames.length >= 100) { truncated=true; return; }
    const parent = frame.parentFrame();
    const parentId = parent ? observe(parent,'parent-observed')?.id ?? null : null;
    id=frames.length+1;
    frameIds.set(frame,id);
    frames.push({...resolveFrameEvidence(frame.url(),targetOrigin),id,parentId,firstSeenMs:elapsed(),lastSeenMs:elapsed(),attached:true,
      checkboxCount:0,namedHumanControlCount:0,namedHumanLabelCount:0,visibleEligibleCount:0,scans:0});
  }
  const record=frames[id-1];
  const classification=resolveFrameEvidence(frame.url(),targetOrigin);
  if (classification.classification==='blank') {
    let ancestor=frame.parentFrame();
    while (ancestor && classifyFrame(ancestor.url(),targetOrigin).classification==='blank') ancestor=ancestor.parentFrame();
    const ancestorClass=ancestor ? classifyFrame(ancestor.url(),targetOrigin).classification : null;
    if (ancestorClass!=='target-site' && ancestorClass!=='cloudflare-challenge') classification.rejectionReason='blank-without-trusted-ancestor';
  }
  Object.assign(record,classification,{lastSeenMs:elapsed(),attached:event!=='detached'});
  if (events.length<500) events.push({event,frameId:id,elapsedMs:elapsed(),...classification}); else truncated=true;
  return record;
}
const attached = (frame: Frame) => { observe(frame,'attached'); };
const navigated = (frame: Frame) => { observe(frame,'navigated'); };
const detached = (frame: Frame) => { observe(frame,'detached'); };
const responseReceived = (response: Response) => {
  if (!page || !response.request().isNavigationRequest() || response.frame() !== page.mainFrame()) return;
  latestResponse=response;
  const diagnostic=responseDiagnostic(response);
  if (responses.length<50) responses.push({...diagnostic,elapsedMs:elapsed()}); else truncated=true;
  if (diagnostic.responseReceived && diagnostic.cloudflareChallenge) {
    challengeObserved=true;
    challengeStartedAt ??= Date.now();
    initialChallengeMs ??= elapsed();
  }
};
async function capture(stage: string) {
  try {
    requireCondition(page,'NO_PAGE');
    await page.screenshot({path:`${directory}/${stage}.png`,fullPage:false,timeout:2000});
    screenshots.push({stage,captured:true});
  } catch { screenshots.push({stage,captured:false}); }
}
async function normalSearchForm(deadline: number): Promise<boolean> {
  if (!page || !latestResponse?.ok() || latestResponse.headers()['cf-mitigated']==='challenge') return false;
  const response=latestResponse;
  try {
    requireCondition(!checkedPageUrl(page.url()).search,'FILTERED_SEARCH_URL');
    if (!await bounded(page.locator(searchInputSelector).isVisible(),Math.min(500,deadline-Date.now()))) return false;
    validateSearchForm(await bounded(page.content(),Math.min(500,deadline-Date.now())),page.url());
    return response===latestResponse && latestResponse.ok() && latestResponse.headers()['cf-mitigated']!=='challenge';
  } catch { return false; }
}
async function candidate(deadline: number): Promise<{locator:Locator; id:number}|undefined> {
  if (!page) return;
  let selected: {locator:Locator; id:number}|undefined;
  for (const frame of page.frames()) {
    if (Date.now()>=deadline) return selected;
    const record=observe(frame,'scan');
    if (!record) continue;
    const primary=frame.url();
    if (record.classification==='invalid' || record.classification==='blank') {
      // The protocol may attach a frame before supplying its document URL.
      // Read corroborating URLs only in memory; serialize classifications only.
      let documentUrl: string | undefined;
      let frameElementSrc: string | undefined;
      try {
        documentUrl=await bounded(frame.evaluate(()=>location.href),Math.min(400,deadline-Date.now()));
        record.documentInspection=typeof documentUrl==='string' ? 'ok' : 'non-string';
      } catch(error) { record.documentInspection=inspectionFailure(error); }
      if (Date.now()<deadline) {
        try {
          const element=await bounded(frame.frameElement(),Math.min(400,deadline-Date.now()));
          try { frameElementSrc=await bounded(element.evaluate(el=>(el as HTMLIFrameElement).src),Math.min(400,deadline-Date.now())); record.ownerInspection=typeof frameElementSrc==='string' ? 'ok' : 'non-string'; }
          finally { await bounded(element.dispose(),Math.min(100,deadline-Date.now())); }
        } catch(error) { record.ownerInspection=inspectionFailure(error); }
      }
      const evidence=resolveFrameEvidence(primary,targetOrigin,{documentUrl,frameElementSrc});
      const oldRejection=record.rejectionReason;
      Object.assign(record,evidence);
      if (evidence.classification==='blank') record.rejectionReason=oldRejection;
      if (events.length<500) events.push({event:'frame-url-evidence',frameId:record.id,elapsedMs:elapsed(),documentInspection:record.documentInspection,ownerInspection:record.ownerInspection,...evidence});
      else truncated=true;
    }
    if (record.rejectionReason) continue;
    try {
      const checkboxes=frame.getByRole('checkbox');
      const named=frame.getByRole('checkbox',{name:humanName}).or(frame.getByRole('button',{name:humanName}));
      const labels=frame.locator('label').filter({hasText:humanName}).filter({has:frame.locator('input[type="checkbox"], [role="checkbox"]')});
      const inspect=<T>(operation: Promise<T>)=>bounded(operation,Math.min(300,deadline-Date.now()));
      record.checkboxCount=await inspect(checkboxes.count());
      record.namedHumanControlCount=await inspect(named.count());
      record.namedHumanLabelCount=await inspect(labels.count());
      record.scans++;
      // Generic site checkboxes may be filters/consent. Only a named human control
      // qualifies there; a strict observed Cloudflare frame may use an unnamed checkbox.
      const eligible=record.classification==='cloudflare-challenge' ? checkboxes.or(named).or(labels) : named.or(labels);
      const count=await inspect(eligible.count());
      record.visibleEligibleCount=0;
      let first: Locator | undefined;
      for (let index=0;index<Math.min(count,30) && Date.now()<deadline;index++) {
        const locator=eligible.nth(index);
        if (await inspect(locator.isVisible()) && await inspect(locator.isEnabled())) { record.visibleEligibleCount++; first ??= locator; }
      }
      record.rejectionReason=first ? null : count ? 'no-visible-enabled-human-control' : 'no-human-control';
      if (first) selected ??= {locator:first,id:record.id};
    } catch { record.rejectionReason='frame-detached-or-inaccessible'; }
  }
  return selected;
}

await mkdir(directory,{recursive:true});
await Promise.all(['initial.png','end.png','report.json'].map(name=>rm(`${directory}/${name}`,{force:true})));
try {
  const config: unknown=JSON.parse(await readFile(new URL('../config/bfi.json',import.meta.url),'utf8'));
  requireCondition(isRecord(config) && typeof config.searchUrl==='string','INVALID_CONFIG');
  const target=checkedPageUrl(config.searchUrl);
  requireCondition(!target.search && !target.hash,'FILTERED_SEARCH_URL');
  targetOrigin=target.origin;
  browser=await Camoufox<undefined,Browser>({headless:'virtual',geoip:true,locale:'en-GB',timeout:30000});
  browserVersion=browser.version();
  page=await browser.newPage({viewport:{width:1440,height:900}});
  page.on('frameattached',attached);
  page.on('framenavigated',navigated);
  page.on('framedetached',detached);
  page.on('response',responseReceived);
  observe(page.mainFrame(),'initial');
  try { await page.goto(target.href,{waitUntil:'commit',timeout:30000}); }
  catch (error) { failure=errorDiagnostic(error); }
  const deadline=(challengeStartedAt ?? Date.now())+30000;
  const searchDeadline=Math.min(Date.now()+15000,deadline);
  await capture('initial');
  if (await normalSearchForm(deadline)) outcome=challengeObserved ? 'resolved' : 'no-challenge';
  else {
    let selected: Awaited<ReturnType<typeof candidate>>;
    while (Date.now()<searchDeadline) {
      if (await normalSearchForm(searchDeadline)) { outcome=challengeObserved ? 'resolved' : 'no-challenge'; break; }
      selected=await candidate(searchDeadline);
      if (selected && challengeObserved) break;
      await new Promise(resolve=>setTimeout(resolve,Math.min(250,Math.max(0,searchDeadline-Date.now()))));
    }
    searchEndedMs=elapsed();
    if (selected && outcome!=='resolved' && outcome!=='no-challenge' && challengeObserved && latestResponse?.headers()['cf-mitigated']==='challenge' && Date.now()<deadline) {
      clickAttempted=true;
      clickedFrameId=selected.id;
      try {
        await selected.locator.click({timeout:Math.min(3000,deadline-Date.now()),noWaitAfter:true});
        clicked=true;
        outcome='unresolved';
      } catch (error) { failure=errorDiagnostic(error); outcome='click-timeout'; }
    } else if (outcome!=='resolved' && outcome!=='no-challenge') outcome='not-found';
    while (outcome!=='resolved' && outcome!=='no-challenge' && Date.now()<deadline) {
      if (await normalSearchForm(deadline)) { outcome=challengeObserved ? 'resolved' : 'no-challenge'; break; }
      await new Promise(resolve=>setTimeout(resolve,Math.min(250,Math.max(0,deadline-Date.now()))));
    }
  }
} catch (error) { outcome='error'; failure=errorDiagnostic(error); }
finally {
  await capture('end');
  if (page) {
    page.off('frameattached',attached);page.off('framenavigated',navigated);page.off('framedetached',detached);page.off('response',responseReceived);
  }
  try { await browser?.close(); } catch (error) { failure ??= errorDiagnostic(error); }
  const report={schemaVersion:1,startedAt:new Date(started).toISOString(),elapsedMs:elapsed(),outcome,
    runtime:{engine:'camoufox',browserVersion,headless:'virtual',geoip:true,locale:'en-GB',viewport:{width:1440,height:900}},
    challengeObserved,initialChallengeMs,searchEndedMs,clickAttempted,clicked,clickedFrameId,
    limits:{challengeWaitMs:30000,discoveryMs:15000,maximumClicks:1},frames,events,responses,screenshots,truncated,...(failure?{failure}:{})};
  await writeFile(`${directory}/report.json`,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({event:'challenge-probe-complete',outcome,clickAttempted,report:`${directory}/report.json`}));
  if (outcome!=='resolved' && outcome!=='no-challenge') process.exitCode=1;
}
