import test from 'node:test';
import assert from 'node:assert/strict';
import {monitorLoop,processChange} from '../src/monitor-loop.ts';
test('initial 403 retries then processes every successful collection at one minute cadence',async()=>{
 const controller=new AbortController();let now=0,calls=0,processed=0,status=403;const waits:number[]=[];
 await monitorLoop({signal:controller.signal,now:()=>now,
  collect:async()=>{calls++;now+=2000;if(calls===1)throw Error('403');status=200;},
  process:async()=>{processed++;now+=1000;if(processed===3)controller.abort();},
  response:()=>({status}),failed:async()=>{},wait:async ms=>{waits.push(ms);now+=ms;},
 });
 assert.equal(calls,4);assert.equal(processed,3);assert.deepEqual(waits,[5000,57000,57000]);
});
test('post-baseline 403 restarts full collection and resumes minute cadence after recovery',async()=>{
 const controller=new AbortController();let now=0,calls=0,processed=0,status=200;const waits:number[]=[];
 await monitorLoop({signal:controller.signal,now:()=>now,
  collect:async()=>{calls++;now+=1000;status=calls===2?403:200;if(status===403)throw Error('page 2 blocked');},
  process:async()=>{if(++processed===3)controller.abort();},response:()=>({status}),failed:async()=>{},
  wait:async ms=>{waits.push(ms);now+=ms;},
 });
 assert.equal(calls,4);assert.equal(processed,3);assert.deepEqual(waits,[59000,5000,59000]);
});
test('each failed follow-up cycle stops after ten attempts without processing partial data',async()=>{
 let calls=0,processed=0;const waits:number[]=[];
 await assert.rejects(monitorLoop({signal:new AbortController().signal,now:()=>0,
  collect:async()=>{if(++calls>1)throw Error('403');},process:async()=>{processed++;},
  response:()=>({status:403}),failed:async()=>{},wait:async ms=>{waits.push(ms);},
 }));
 assert.equal(calls,11);assert.equal(processed,1);assert.deepEqual(waits,[60000,...Array(9).fill(5000)]);
});
test('deadline during recovery prevents another collection and does not extend session',async()=>{
 const controller=new AbortController();let calls=0,processed=0;
 await assert.rejects(monitorLoop({signal:controller.signal,now:()=>0,
  collect:async()=>{if(++calls>1)throw Error('403');},process:async()=>{processed++;},
  response:()=>({status:403}),failed:async()=>{},wait:async ms=>{if(ms===5000)controller.abort();},
 }));assert.equal(calls,2);assert.equal(processed,1);
});
test('429 after baseline stops immediately',async()=>{
 let calls=0,processed=0;
 await assert.rejects(monitorLoop({signal:new AbortController().signal,now:()=>0,
  collect:async()=>{if(++calls>1)throw Error('429');},process:async()=>{processed++;},
  response:()=>({status:429}),failed:async()=>{},wait:async()=>{},
 }));assert.equal(calls,2);assert.equal(processed,1);
});
test('deadline during initial retry wait prevents another request',async()=>{
 const controller=new AbortController();let calls=0;
 await assert.rejects(monitorLoop({signal:controller.signal,now:()=>0,
  collect:async()=>{calls++;throw Error('403');},process:async()=>assert.fail('no delivery'),
  response:()=>({status:403}),failed:async()=>{},wait:async()=>{controller.abort();},
 }));assert.equal(calls,1);
});
test('unchanged or disabled delivery does not invoke or acknowledge',async()=>{
 for(const [changed,enabled] of [[false,true],[true,false]])await processChange(changed,enabled,async()=>assert.fail(),async()=>assert.fail());
});
test('acknowledgement happens only after successful delivery',async()=>{
 const events:string[]=[];
 await processChange(true,true,async()=>{events.push('send');},async()=>{events.push('ack');});
 assert.deepEqual(events,['send','ack']);
 await assert.rejects(processChange(true,true,async()=>{throw Error('rejected');},async()=>assert.fail('must not acknowledge')));
});
test('non-403 collection error retries after one minute and resumes collection',async()=>{
 const controller=new AbortController();let calls=0,processed=0;const waits:number[]=[];
 await monitorLoop({signal:controller.signal,now:()=>0,
  collect:async()=>{if(++calls===1)throw Error('network reset');},
  process:async()=>{processed++;controller.abort();},
  response:()=>({}),failed:async()=>{},wait:async ms=>{waits.push(ms);},
 });
 assert.equal(calls,2);assert.equal(processed,1);assert.deepEqual(waits,[60000]);
});
test('processing errors restart full collection after one minute with fresh data',async()=>{
 for(const phase of ['compare','deliver','acknowledge']) {
  const controller=new AbortController();const events:string[]=[];let calls=0;
  await monitorLoop({signal:controller.signal,now:()=>0,
   collect:async()=>{events.push(`collect-${++calls}`);},
   process:async()=>{events.push(`${phase}-${calls}`);if(calls===1)throw Error(phase);controller.abort();},
   response:()=>({status:200}),failed:async()=>{},wait:async ms=>{events.push(`wait-${ms}`);},
  });
  assert.deepEqual(events,['collect-1',`${phase}-1`,'wait-60000','collect-2',`${phase}-2`]);
 }
});
test('deadline during processing recovery prevents another BFI request',async()=>{
 const controller=new AbortController();let calls=0;
 await assert.rejects(monitorLoop({signal:controller.signal,now:()=>0,
  collect:async()=>{calls++;},process:async()=>{throw Error('state');},
  response:()=>({status:200}),failed:async()=>{},wait:async ms=>{assert.equal(ms,60000);controller.abort();},
 }));
 assert.equal(calls,1);
});
test('processing HTTP 403 and 429 do not trigger full-cycle retries',async()=>{
 for(const httpStatus of [403,429]) {
  let calls=0;
  await assert.rejects(monitorLoop({signal:new AbortController().signal,now:()=>0,
   collect:async()=>{calls++;},process:async()=>{throw Object.assign(Error('state'),{httpStatus});},
   response:()=>({status:200}),failed:async()=>{},wait:async()=>assert.fail('must not retry'),
  }));
  assert.equal(calls,1);
 }
});
