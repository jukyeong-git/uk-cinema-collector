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
