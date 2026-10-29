import {logSummary} from './logging/contract';
type SchedulerEnv = {[K in keyof Env]:string} & {GITHUB_TOKEN?:string};
export type DispatchFetch=(url:string,options:RequestInit)=>Promise<Response>;
export async function dispatch(env:SchedulerEnv, fetcher:DispatchFetch = fetch) {
  if (env.ENABLED !== 'true') return {event:'scheduler-disabled'};
  if (!env.GITHUB_TOKEN) throw new Error('MISSING_GITHUB_TOKEN');
  if (!/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY)) throw new Error('INVALID_REPOSITORY');
  const endpoint = `https://api.github.com/repos/${env.GITHUB_REPOSITORY}/actions/workflows/collect.yml/dispatches`;
  let response;
  try {
    response = await fetcher(endpoint, {
      method:'POST',
      headers:{
        Authorization:`Bearer ${env.GITHUB_TOKEN}`,
        Accept:'application/vnd.github+json',
        'Content-Type':'application/json',
        'User-Agent':'uk-cinema-scheduler',
        'X-GitHub-Api-Version':'2022-11-28',
      },
      body:JSON.stringify({ref:'main',inputs:{deliver:env.DELIVER === 'true'}}),
      signal:AbortSignal.timeout(15000),
    });
  } catch {
    // Never log request headers, raw errors, response bodies, or credentials.
    throw new Error('GITHUB_REQUEST_FAILED');
  }
  await response.body?.cancel();
  if (response.status !== 204 && response.status !== 200) throw new Error(`GITHUB_DISPATCH_STATUS_${response.status}`);
  return {event:'workflow-dispatched',status:response.status,deliveryEnabled:env.DELIVER === 'true'};
}
export default {
  async scheduled(controller:ScheduledController,env:SchedulerEnv) {
    const started=Date.now(),runId=crypto.randomUUID();
    try {
      const result=await dispatch(env);
      logSummary({event:'run_summary',country:'GB',city:'London',component:'scheduler',operation:'workflow_dispatch',runId,status:result.event==='scheduler-disabled'?'skipped':'complete',durationMs:Date.now()-started,provider:'github',diagnostics:{originalEvent:result.event,scheduledTime:controller.scheduledTime,...('status' in result?{httpStatus:result.status,deliveryEnabled:result.deliveryEnabled}:{})}});
    } catch(error) {
      const code=error instanceof Error && /^[A-Z][A-Z0-9_]{0,80}$/.test(error.message)?error.message:'DISPATCH_FAILED';
      console.error(JSON.stringify({event:'dispatch-failed',code}));
      logSummary({event:'run_summary',country:'GB',city:'London',component:'scheduler',operation:'workflow_dispatch',runId,status:'failed',durationMs:Date.now()-started,provider:'github',error:{category:'dispatch',code}});
      throw error;
    }
  },
  fetch() {
    return new Response('Not found',{status:404});
  },
};
