import {acquireSession,retryDelay} from './initial-retry.ts';
export interface MonitorHooks {
  collect:()=>Promise<void>;
  process:()=>Promise<void>;
  response:()=>{status?:number;retryAfter?:string};
  failed:(attempt:number,error:unknown)=>Promise<void>;
  wait:(ms:number)=>Promise<void>;
  now:()=>number;
  signal:AbortSignal;
}
export async function monitorLoop(h:MonitorHooks) {
  const check=()=>h.signal.throwIfAborted();
  let started=h.now();
  const collectWithRetry=()=>acquireSession(async()=>{check();started=h.now();await h.collect();},()=>h.response().status===403,
    ()=>retryDelay(h.response().retryAfter,h.now()),async ms=>{check();await h.wait(ms);},h.failed);
  await collectWithRetry();check();await h.process();
  while(!h.signal.aborted) {
    // Start-to-start cadence; never overlap or issue catch-up bursts.
    const next=started+60000;
    await h.wait(next>h.now()?next-h.now():60000);
    check();await collectWithRetry();check();await h.process();
  }
}
export async function processChange(changed:boolean,deliver:boolean,send:()=>Promise<void>,acknowledge:()=>Promise<void>) {
  if(!changed || !deliver)return;
  await send();
  await acknowledge();
}
