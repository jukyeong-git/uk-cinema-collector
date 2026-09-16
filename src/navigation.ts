import type {Locator, Page, Response, Request, Frame} from 'playwright-core';
import {CollectionError, requireCondition} from './errors.ts';
import {checkedPageUrl} from './parse.ts';

// Observe before navigation so an automatic Challenge redirect cannot be missed.
// Never reload, resubmit forms, or interact with verification controls here.
export async function checkedNavigation(
  page: Page,
  navigate: () => Promise<Response | null>,
  ready: Locator,
  recordResponse: (response: Response | null) => void,
  log: (event: string, values: Record<string, unknown>) => void,
  timeoutMs = 15000,
) {
  const state: {latest: Response | null; committed: Response | null} = {latest:null,committed:null};
  let latestRequest: Request | undefined;
  const isMain = (request: Request) => request.isNavigationRequest() && request.frame() === page.mainFrame();
  const onRequest = (request: Request) => {
    if (isMain(request)) {latestRequest = request; state.latest = null; state.committed = null;}
  };
  const onResponse = (response: Response) => {
    if (isMain(response.request()) && (!latestRequest || latestRequest === response.request())) state.latest = response;
  };
  const onFrame = (frame: Frame) => {
    if (frame === page.mainFrame()) state.committed = state.latest;
  };
  page.on('framenavigated', onFrame);
  page.on('request', onRequest);
  page.on('response', onResponse);
  try {
    const initial = await navigate();
    recordResponse(initial);
    if (initial?.headers()['cf-mitigated'] !== 'challenge') {
      requireCondition(initial?.ok(), 'BFI_BLOCKED');
      return;
    }
    const started = Date.now();
    log('challenge-wait-start', {timeoutMs});
    while (Date.now() - started < timeoutMs) {
      if (page.isClosed()) throw new CollectionError('CHALLENGE_PAGE_CLOSED');
      const candidate: Response | null = state.latest;
      if (candidate && state.committed === candidate && candidate.headers()['cf-mitigated'] !== 'challenge') {
        if (!candidate.ok()) {
          recordResponse(candidate);
          throw new CollectionError('BFI_BLOCKED');
        }
        checkedPageUrl(page.url());
        if (candidate.url() === page.url() && await ready.isVisible() && state.latest === candidate) {
          recordResponse(candidate);
          log('challenge-resolved', {elapsedMs:Date.now() - started});
          return;
        }
      }
      await new Promise(resolve => setTimeout(resolve, Math.min(100, Math.max(1, timeoutMs - (Date.now() - started)))));
    }
    if (state.latest) recordResponse(state.latest);
    log('challenge-wait-timeout', {elapsedMs:Date.now() - started});
    throw new CollectionError('CHALLENGE_TIMEOUT');
  } finally {
    page.off('framenavigated', onFrame);
    page.off('request', onRequest);
    page.off('response', onResponse);
  }
}
