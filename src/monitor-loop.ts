import {errorHttpStatus} from './errors.ts';
import {acquireSession,retryDelay} from './initial-retry.ts';
export interface MonitorHooks {
  collect:()=>Promise<void>;
  process:()=>Promise<void>;
  response:()=>{status?:number;retryAfter?:string};
  failed:(attempt:number,error:unknown)=>Promise<void>;
  retryFailed?:(attempt:number,error:unknown)=>Promise<void>;
  wait:(ms:number)=>Promise<void>;
  now:()=>number;
  signal:AbortSignal;
}
export async function monitorLoop(h:MonitorHooks) {
  const check=()=>h.signal.throwIfAborted();
  let started=h.now();
  const collectWithRetry=()=>acquireSession(async()=>{check();started=h.now();await h.collect();},()=>h.response().status===403,
    ()=>retryDelay(h.response().retryAfter,h.now()),async ms=>{check();await h.wait(ms);},h.failed);
  let retryAttempt=0;
  while(!h.signal.aborted) {
    let collecting=true;
    try {
      await collectWithRetry();check();collecting=false;await h.process();
      retryAttempt=0;
    } catch(error) {
      check();
      // Processing errors must not inherit the last BFI response status.
      const status=errorHttpStatus(error) ?? (collecting?h.response().status:undefined);
      if(status===403 || status===429)throw error;
      await (h.retryFailed ?? h.failed)(++retryAttempt,error);
      await h.wait(60000);check();
      continue; // Discard the failed cycle and collect fresh BFI data.
    }
    if(h.signal.aborted)return;
    // Start-to-start cadence; never overlap or issue catch-up bursts.
    const next=started+60000;
    await h.wait(next>h.now()?next-h.now():60000);check();
  }
}
export async function processChange(changed:boolean,deliver:boolean,send:()=>Promise<void>,acknowledge:()=>Promise<void>) {
  if(!changed || !deliver)return;
  await send();
  await acknowledge();
}
