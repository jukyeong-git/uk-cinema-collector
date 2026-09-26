import test from 'node:test';
import assert from 'node:assert/strict';
import {acquireSession,retryDelay} from '../src/initial-retry.ts';
test('initial 403 retries stop at ten attempts with nine waits',async()=>{
 let calls=0;const waits:number[]=[];
 await assert.rejects(acquireSession(async()=>{calls++;throw Error();},()=>true,()=>5000,async ms=>{waits.push(ms);},async()=>{}));
 assert.equal(calls,10);assert.deepEqual(waits,Array(9).fill(5000));
});
test('successful acquisition stops retries',async()=>{
 let calls=0,waits=0;
 await acquireSession(async()=>{if(++calls<3)throw Error();},()=>true,()=>5000,async()=>{waits++;},async()=>{});
 assert.equal(calls,3);assert.equal(waits,2);
});
test('non retryable responses such as 429 stop immediately',async()=>{
 let calls=0,waits=0;
 await assert.rejects(acquireSession(async()=>{calls++;throw Error();},()=>false,()=>5000,async()=>{waits++;},async()=>{}));
 assert.equal(calls,1);assert.equal(waits,0);
});
test('Retry-After seconds and dates respect five second minimum',()=>{
 assert.equal(retryDelay('30'),30000);assert.equal(retryDelay('1'),5000);
 assert.equal(retryDelay('Thu, 01 Jan 1970 00:01:00 GMT',0),60000);
 assert.equal(retryDelay('invalid'),5000);
});
