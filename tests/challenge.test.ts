import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import type {Page,Response} from 'playwright-core';
import {openSearchHome} from '../src/challenge.ts';
const target='https://whatson.bfi.org.uk/imax/Online/default.asp';
const fields=['search_criteria','search_from','search_to','venue_filter','city_filter','month_filter','object_type_filter','category_filter'];
const validForm=`<form method="post" action="default.asp">${fields.map(f=>`<input name="BOset::WScontent::SearchCriteria::${f}" value="">`).join('')}<input name="doWork::WScontent::search" value="1"><input name="BOparam::WScontent::search::article_search_id" value="private-token"><input type="submit"></form>`;
class FakePage extends EventEmitter {
  frame={}; currentUrl=target; html='<title>Just a moment</title>'; calls=0;
  afterGoto=()=>{};
  constructor(readonly initialStatus=403,readonly initialChallenge=true){super();}
  mainFrame(){return this.frame;}
  url(){return this.currentUrl;}
  async content(){return this.html;}
  response(status:number,challenge=false,frame=this.frame,navigation=true){
    const response={status:()=>status,ok:()=>status>=200&&status<300,headers:()=>challenge?{'cf-mitigated':'challenge'}:{},frame:()=>frame,request:()=>({isNavigationRequest:()=>navigation})} as unknown as Response;
    this.emit('response',response);return response;
  }
  async goto(){this.calls++;const home=this.response(this.initialStatus,this.initialChallenge);this.afterGoto();return home;}
}
function run(page:FakePage,timeoutMs=250){
  const events:Record<string,unknown>[]=[];const statuses:number[]=[];
  const promise=openSearchHome(page as unknown as Page,target,{timeoutMs,recordResponse:r=>statuses.push(r?.status()??0),log:(event,values)=>events.push({event,...values})});
  return {promise,events,statuses};
}
test('ordinary success does not wait; ordinary 403 fails immediately',async()=>{
  const page=new FakePage(200,false);const success=run(page);await success.promise;
  assert.deepEqual(success.events,[]);assert.equal(page.listenerCount('response'),0);
  const blocked=new FakePage(403,false);const failed=run(blocked);await assert.rejects(failed.promise,/BFI_BLOCKED/);
  assert.deepEqual(failed.events,[]);assert.equal(blocked.calls,1);assert.equal(blocked.listenerCount('response'),0);
});
test('challenge resolves only after main document success and valid BFI form, without another request',async()=>{
  const page=new FakePage();page.afterGoto=()=>{setTimeout(()=>{page.html=validForm;page.response(200);},5);};
  const r=run(page);await r.promise;
  assert.deepEqual(r.statuses,[403,200]);assert.equal(r.events.at(-1)?.outcome,'resolved');
  assert.equal(page.calls,1);assert.equal(page.listenerCount('response'),0);
  assert.ok(!JSON.stringify(r.events).includes('private-token'));
});
test('handles a main document recovery racing with initial goto completion',async()=>{
  const page=new FakePage();page.afterGoto=()=>{page.html=validForm;page.response(200);};
  const r=run(page);await r.promise;assert.equal(r.events.at(-1)?.outcome,'resolved');
});
test('challenge that persists times out and removes the response observer',async()=>{
  const page=new FakePage();const r=run(page,30);await assert.rejects(r.promise,/BFI_CHALLENGE_TIMEOUT/);
  assert.equal(r.events.at(-1)?.outcome,'timeout');assert.equal(page.calls,1);assert.equal(page.listenerCount('response'),0);
});
for(const kind of ['iframe','subresource','invalid-form','foreign-url','still-challenged']) test(`does not mistake ${kind} for challenge clearance`,async()=>{
  const page=new FakePage();page.afterGoto=()=>{
    page.html=kind==='invalid-form'?'<form></form>':validForm;
    if(kind==='foreign-url')page.currentUrl='https://example.org/';
    page.response(200,kind==='still-challenged',kind==='iframe'?{}:page.frame,kind!=='subresource');
  };
  const r=run(page,25);await assert.rejects(r.promise,/BFI_CHALLENGE_TIMEOUT/);
  assert.equal(page.calls,1);assert.equal(page.listenerCount('response'),0);
});
test('a stalled document read cannot extend the challenge deadline',async()=>{
  const page=new FakePage();page.content=()=>new Promise<string>(()=>{});
  page.afterGoto=()=>{page.response(200);};
  const start=performance.now();const r=run(page,30);
  await assert.rejects(r.promise,/BFI_CHALLENGE_TIMEOUT/);assert.ok(performance.now()-start<500);
  assert.equal(page.listenerCount('response'),0);
});
test('ordinary denial after a challenge fails instead of being treated as clearance',async()=>{
  const page=new FakePage();page.afterGoto=()=>{page.response(403,false);};
  const r=run(page);await assert.rejects(r.promise,/BFI_BLOCKED/);assert.equal(r.events.at(-1)?.outcome,'failed');
});

test('optional timeout diagnostic runs only for a persistent challenge and cannot replace its error',async()=>{
  for(const challenge of [false,true]) {
    const page=new FakePage(403,challenge);let captures=0;
    await assert.rejects(openSearchHome(page as unknown as Page,target,{
      timeoutMs:20,recordResponse:()=>{},log:()=>{},
      onTimeout:async()=>{captures++;throw Error('capture failed');},
    }),challenge?/BFI_CHALLENGE_TIMEOUT/:/BFI_BLOCKED/);
    assert.equal(captures,challenge?1:0);assert.equal(page.listenerCount('response'),0);
  }
});

test('normal recovery does not wait for a stalled interaction and cancels it',async()=>{
  const page=new FakePage();let interactionSignal:AbortSignal|undefined;
  const events:Record<string,unknown>[]=[];
  await openSearchHome(page as unknown as Page,target,{
    timeoutMs:500,recordResponse:()=>{},log:(event,values)=>events.push({event,...values}),
    onChallenge:async signal=>{
      interactionSignal=signal;
      page.html=validForm;page.response(200);
      await new Promise<void>(()=>{});
    },
  });
  assert.equal(interactionSignal?.aborted,true);
  assert.equal(events.at(-1)?.outcome,'resolved');
  assert.equal(page.listenerCount('response'),0);
});

test('deadline aborts a pending interaction before timeout diagnostics',async()=>{
  const page=new FakePage();let interactionSignal:AbortSignal|undefined;let aborts=0;
  await assert.rejects(openSearchHome(page as unknown as Page,target,{
    timeoutMs:20,recordResponse:()=>{},log:()=>{},
    onChallenge:signal=>{
      interactionSignal=signal;
      return new Promise<void>(resolve=>signal.addEventListener('abort',()=>{aborts++;resolve();},{once:true}));
    },
    onTimeout:async()=>{assert.equal(interactionSignal?.aborted,true);},
  }),/BFI_CHALLENGE_TIMEOUT/);
  assert.equal(aborts,1);assert.equal(page.listenerCount('response'),0);
});

test('interaction rejection is sanitized and does not replace recovery or timeout',async()=>{
  for (const recover of [false,true]) {
    const page=new FakePage();const events:Record<string,unknown>[]=[];
    const promise=openSearchHome(page as unknown as Page,target,{
      timeoutMs:recover?500:20,recordResponse:()=>{},log:(event,values)=>events.push({event,...values}),
      onChallenge:async()=>{
        if(recover)setTimeout(()=>{page.html=validForm;page.response(200);},5);
        throw new Error('private-interaction-details');
      },
    });
    if(recover)await promise;else await assert.rejects(promise,/BFI_CHALLENGE_TIMEOUT/);
    assert.equal(events.filter(e=>e.event==='challenge-interaction-failed').length,1);
    assert.equal(events.at(-1)?.outcome,recover?'resolved':'timeout');
    assert.ok(!JSON.stringify(events).includes('private-interaction-details'));
    assert.equal(page.listenerCount('response'),0);
  }
});

test('recovery before goto completes skips interaction entirely',async()=>{
  const page=new FakePage();let interactions=0;
  page.afterGoto=()=>{page.html=validForm;page.response(200);};
  await openSearchHome(page as unknown as Page,target,{
    timeoutMs:100,recordResponse:()=>{},log:()=>{},onChallenge:async()=>{interactions++;},
  });
  assert.equal(interactions,0);assert.equal(page.listenerCount('response'),0);
});
