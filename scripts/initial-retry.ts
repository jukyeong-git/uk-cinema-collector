export function retryDelay(header:string|undefined,now=Date.now()) {
  if(!header)return 5000;
  const ms=/^\d+$/.test(header.trim())?Number(header)*1000:Date.parse(header)-now;
  return Number.isFinite(ms)?Math.max(5000,ms):5000;
}
export async function acquireSession(collect:()=>Promise<void>,retryable:()=>boolean,delay:()=>number,wait:(ms:number)=>Promise<void>,failed:(attempt:number,error:unknown)=>Promise<void>) {
  for(let attempt=1;attempt<=10;attempt++) {
    try {await collect();return;} catch(error) {
      await failed(attempt,error);
      if(attempt===10 || !retryable())throw error;
      await wait(delay());
    }
  }
}
