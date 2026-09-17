import type {Page,Response} from 'playwright-core';
import {setTimeout as delay} from 'node:timers/promises';
import {CollectionError,requireCondition} from './errors.ts';
import {checkedPageUrl} from './parse.ts';
import {validateSearchForm} from './search.ts';

export const challengeWaitMs = 15000;
const challenged = (response: Response | null) => response?.headers()['cf-mitigated'] === 'challenge';

// Only the initial GET can wait. Never reload, replay a POST, or replay a challenge submission.
export async function openSearchHome(page: Page, target: string, options: {
  recordResponse: (response: Response | null)=>void;
  log: (event: string, values: Record<string,unknown>)=>void;
  timeoutMs?: number;
  onTimeout?: ()=>Promise<void>;
  onChallenge?: ()=>Promise<void>;
}) {
  let latest: Response | null = null;
  const onResponse = (response: Response) => {
    if (!response.request().isNavigationRequest() || response.frame() !== page.mainFrame()) return;
    latest = response;
    options.recordResponse(response);
  };
  page.on('response',onResponse);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();
  try {
    const home = await page.goto(target,{waitUntil:'domcontentloaded',timeout:60000});
    if (!home) options.recordResponse(null);
    if (!challenged(home)) {
      requireCondition(home?.ok(),'BFI_BLOCKED');
      return;
    }
    const timeoutMs = options.timeoutMs ?? challengeWaitMs;
    const started = performance.now();
    options.log('challenge-wait-start',{phase:'search-home',timeoutMs});
    const observe = async () => {
      await options.onChallenge?.();
      while (!controller.signal.aborted) {
        const response = latest;
        if (response && !challenged(response)) {
          requireCondition(response.status()<400,'BFI_BLOCKED');
          if (response.ok()) {
            let valid = false;
            try {
              const html = await page.content();
              const url = checkedPageUrl(page.url());
              requireCondition(!url.search,'FILTERED_SEARCH_URL');
              validateSearchForm(html,url.href);
              valid = true;
            } catch { /* Navigation may still be replacing the challenge document. */ }
            if (valid && latest === response && !controller.signal.aborted) return;
          }
        }
        await delay(100,undefined,{signal:controller.signal});
      }
    };
    try {
      await Promise.race([
        observe(),
        new Promise<never>((_,reject)=>{
          timer=setTimeout(()=>reject(new CollectionError('BFI_CHALLENGE_TIMEOUT')),timeoutMs);
        }),
      ]);
      options.log('challenge-wait-complete',{phase:'search-home',outcome:'resolved',waitedMs:Math.round(performance.now()-started)});
    } catch(error) {
      options.log('challenge-wait-complete',{phase:'search-home',
        outcome:error instanceof CollectionError && error.code === 'BFI_CHALLENGE_TIMEOUT' ? 'timeout' : 'failed',
        waitedMs:Math.round(performance.now()-started)});
      controller.abort();
      if (error instanceof CollectionError && error.code === 'BFI_CHALLENGE_TIMEOUT' && challenged(latest)) {
        try { await options.onTimeout?.(); }
        catch { options.log('challenge-screenshot-failed',{phase:'search-home'}); }
      }
      throw error;
    }
  } finally {
    controller.abort();
    clearTimeout(timer);
    page.off('response',onResponse);
  }
}
