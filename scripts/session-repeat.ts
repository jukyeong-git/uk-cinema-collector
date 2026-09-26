// A failed collection aborts the sequence; never replace the supplied session.
export async function repeatSession<T>(session:T, collect:(session:T,attempt:number)=>Promise<void>, wait:(ms:number)=>Promise<void>, attempts=10, intervalMs=300000) {
  for(let attempt=1;attempt<=attempts;attempt++) {
    await collect(session,attempt);
    if(attempt<attempts) await wait(intervalMs);
  }
}
