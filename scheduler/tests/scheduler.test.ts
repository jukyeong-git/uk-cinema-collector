import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{dispatch} from '../src/index.ts';
const env={ENABLED:'true',GITHUB_TOKEN:'test-token',GITHUB_REPOSITORY:'example/collector',DELIVER:'false'};
test('dispatches only the configured workflow with delivery disabled',async()=>{
 const requests: {url:string;options:RequestInit}[]=[];
 const r=await dispatch(env,async(url,options)=>{requests.push({url,options});return new Response(null,{status:204});});
 const request=requests[0];
 assert.ok(request);
 assert.match(request.url,/example\/collector\/actions\/workflows\/collect.yml\/dispatches$/);
 assert.deepEqual(JSON.parse(String(request.options.body)),{ref:'main',inputs:{deliver:false}});
 assert.equal(r.event,'workflow-dispatched');assert.ok(!JSON.stringify(r).includes('test-token'));
});
test('disabled scheduler never makes a request',async()=>{let called=false;await dispatch({...env,ENABLED:'false'},async()=>{called=true;return new Response(null,{status:204})});assert.equal(called,false);});
test('missing token prevents requests',async()=>assert.rejects(()=>dispatch({...env,GITHUB_TOKEN:''}),/MISSING_GITHUB_TOKEN/));
test('authentication rejection is not reported as success',async()=>assert.rejects(()=>dispatch(env,async()=>new Response('private response',{status:401})),/^Error: GITHUB_DISPATCH_STATUS_401$/));
test('raw network errors do not leak',async()=>assert.rejects(()=>dispatch(env,async()=>{throw Error('Authorization test-token')}),/^Error: GITHUB_REQUEST_FAILED$/));
test('public HTTP requests cannot trigger workflow',async()=>assert.equal(worker.fetch().status,404));
