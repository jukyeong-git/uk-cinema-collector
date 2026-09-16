type SchedulerEnv = {[K in keyof Env]:string} & {GITHUB_TOKEN?:string};
export type DispatchFetch=(url:string,options:RequestInit)=>Promise<Response>;
export async function dispatch(env:SchedulerEnv, fetcher:DispatchFetch = fetch) {
  if (env.ENABLED !== 'true') return {event:'scheduler-disabled'};
  if (!env.GITHUB_TOKEN) throw new Error('MISSING_GITHUB_TOKEN');
  if (!/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY)) throw new Error('INVALID_REPOSITORY');
  const endpoint = `https://api.github.com/repos/${env.GITHUB_REPOSITORY}/actions/workflows/collect-nodriver.yml/dispatches`;
  let response;
  try {
    response = await fetcher(endpoint, {
      method:'POST',
      headers:{
        Authorization:`Bearer ${env.GITHUB_TOKEN}`,
        Accept:'application/vnd.github+json',
        'Content-Type':'application/json',
        'User-Agent':'uk-cinema-nodriver-scheduler',
        'X-GitHub-Api-Version':'2022-11-28',
      },
      body:JSON.stringify({ref:'main'}),
      signal:AbortSignal.timeout(15000),
    });
  } catch {
    // Never log request headers, raw errors, response bodies, or credentials.
    throw new Error('GITHUB_REQUEST_FAILED');
  }
  await response.body?.cancel();
  if (response.status !== 204 && response.status !== 200) throw new Error(`GITHUB_DISPATCH_STATUS_${response.status}`);
  return {event:'workflow-dispatched',status:response.status,workflow:'collect-nodriver.yml',deliveryEnabled:false};
}
export default {
  async scheduled(controller:ScheduledController,env:SchedulerEnv) {
    try {
      console.log(JSON.stringify({...await dispatch(env),scheduledTime:controller.scheduledTime}));
    } catch(error) {
      console.error(JSON.stringify({event:'dispatch-failed',code:error instanceof Error?error.message:'DISPATCH_FAILED'}));
      throw error;
    }
  },
  fetch() {
    return new Response('Not found',{status:404});
  },
};
