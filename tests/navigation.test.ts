import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import type {Page, Response, Request, Locator} from 'playwright-core';
import {checkedNavigation} from '../src/navigation.ts';

const url = 'https://whatson.bfi.org.uk/imax/Online/default.asp';
function fixture() {
  const events = new EventEmitter();
  const frame = {};
  let visible = true;
  const page = Object.assign(events,{mainFrame:()=>frame,url:()=>url,isClosed:()=>false}) as unknown as Page;
  const ready = {isVisible:async()=>visible} as Locator;
  const logs:string[]=[];
  const recorded:Response[]=[];
  function response(status:number,challenge=false,main=true) {
    const request = {isNavigationRequest:()=>true,frame:()=>main?frame:{}} as Request;
    const result = {request:()=>request,headers:()=>challenge?{'cf-mitigated':'challenge'}:{},ok:()=>status===200,url:()=>url} as Response;
    return {request,result,emit:()=>{events.emit('request',request);events.emit('response',result);events.emit('framenavigated',main?frame:{});}};
  }
  const run=(navigate:()=>Promise<Response|null>)=>checkedNavigation(page,navigate,ready,r=>{if(r)recorded.push(r);},e=>logs.push(e),30);
  return {events,response,run,logs,recorded,hide:()=>{visible=false;}};
}
test('normal response proceeds without challenge wait and removes observers',async()=>{
  const f=fixture();await f.run(async()=>f.response(200).result);
  assert.deepEqual(f.logs,[]);assert.equal(f.events.listenerCount('response'),0);
});
test('ordinary 403 fails without waiting',async()=>{
  const f=fixture();await assert.rejects(f.run(async()=>f.response(403).result),/BFI_BLOCKED/);
  assert.deepEqual(f.logs,[]);
});
test('captures automatic main-page transition before initial navigation returns',async()=>{
  const f=fixture();const initial=f.response(403,true);const success=f.response(200);
  await f.run(async()=>{initial.emit();success.emit();return initial.result;});
  assert.deepEqual(f.logs,['challenge-wait-start','challenge-resolved']);
  assert.equal(f.recorded.at(-1),success.result);
});
test('iframe success cannot clear a main-page challenge',async()=>{
  const f=fixture();const initial=f.response(403,true);
  await assert.rejects(f.run(async()=>{initial.emit();f.response(200,false,false).emit();return initial.result;}),/CHALLENGE_TIMEOUT/);
  assert.equal(f.logs.at(-1),'challenge-wait-timeout');
  assert.equal(f.events.listenerCount('request'),0);
});
test('successful response without expected page content times out',async()=>{
  const f=fixture();f.hide();const initial=f.response(403,true);
  await assert.rejects(f.run(async()=>{initial.emit();f.response(200).emit();return initial.result;}),/CHALLENGE_TIMEOUT/);
});
test('new navigation invalidates a previously successful response',async()=>{
  const f=fixture();const initial=f.response(403,true);
  await assert.rejects(f.run(async()=>{
    initial.emit();f.response(200).emit();f.events.emit('request',f.response(403,true).request);return initial.result;
  }),/CHALLENGE_TIMEOUT/);
});
test('ordinary denial after a challenge fails immediately',async()=>{
  const f=fixture();const initial=f.response(403,true);
  await assert.rejects(f.run(async()=>{initial.emit();f.response(403).emit();return initial.result;}),/BFI_BLOCKED/);
  assert.equal(f.logs.includes('challenge-resolved'),false);
});
