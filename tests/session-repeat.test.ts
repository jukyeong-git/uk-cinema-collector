import test from 'node:test';
import assert from 'node:assert/strict';
import {repeatSession} from '../scripts/session-repeat.ts';
test('reuses identical session ten times with nine one-minute waits',async()=>{
  const session={};const seen:number[]=[];const waits:number[]=[];
  await repeatSession(session,async(s,n)=>{assert.equal(s,session);seen.push(n);},async ms=>{waits.push(ms);});
  assert.deepEqual(seen,[1,2,3,4,5,6,7,8,9,10]);assert.deepEqual(waits,Array(9).fill(60000));
});
test('first failure stops before a wait or a second request',async()=>{
  let calls=0,waits=0;
  await assert.rejects(repeatSession({},async()=>{calls++;throw new Error('blocked');},async()=>{waits++;}));
  assert.equal(calls,1);assert.equal(waits,0);
});
test('failure after a successful baseline cancels all later checks',async()=>{
  const seen:number[]=[];let waits=0;
  await assert.rejects(repeatSession({},async(_,n)=>{seen.push(n);if(n===3)throw new Error('blocked');},async()=>{waits++;}));
  assert.deepEqual(seen,[1,2,3]);assert.equal(waits,2);
});
