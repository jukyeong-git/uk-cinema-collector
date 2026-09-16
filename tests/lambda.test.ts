import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runCollector} from '../lambda/process.ts';
import {assertBrowserCache} from '../lambda/handler.ts';

test('collector forwards controlled collector events but never raw browser output', async () => {
  const events: Record<string,unknown>[] = [];
  const result = await runCollector({command:process.execPath,args:['-e',
    'console.log("private-session-url"); console.error("private-cookie"); console.log(JSON.stringify({event:"http-response",httpStatus:403,cloudflareChallenge:true})); process.exitCode=1;'],
    cwd:tmpdir(),env:process.env,timeoutMs:3000,onEvent:value=>events.push(value)});
  assert.equal(result.exitCode,1); assert.equal(result.timedOut,false);
  assert.deepEqual(events,[{event:'http-response',httpStatus:403,cloudflareChallenge:true}]);
});
test('collector terminates a stuck collector before the Lambda deadline', async () => {
  const start=Date.now();
  const result = await runCollector({command:process.execPath,args:['-e','setInterval(()=>{},1000)'],
    cwd:tmpdir(),env:process.env,timeoutMs:100,onEvent:()=>{}});
  assert.equal(result.timedOut,true); assert.ok(Date.now()-start<3000);
});
test('missing baked browser resources fail locally without attempting download', async () => {
  const dir=await mkdtemp(join(tmpdir(),'bfi-cache-test-'));
  try {
    await assert.rejects(assertBrowserCache(dir));
    await mkdir(join(dir,'addons/UBO'),{recursive:true});
    await writeFile(join(dir,'camoufox'),'browser',{mode:0o755});
    await writeFile(join(dir,'version.json'),JSON.stringify({version:'152',release:'test'}));
    await writeFile(join(dir,'GeoLite2-City.mmdb'),'database');
    await assert.rejects(assertBrowserCache(dir));
    await writeFile(join(dir,'addons/UBO/manifest.json'),JSON.stringify({version:'1.0'}));
    assert.deepEqual(await assertBrowserCache(dir),{browserVersion:'152',browserRelease:'test',ublockVersion:'1.0'});
  } finally {await rm(dir,{recursive:true,force:true});}
});
test('collector infrastructure has the requested limits and isolated permissions',async()=>{
  const stack=JSON.parse(await readFile(new URL('../lambda/stack.json',import.meta.url),'utf8'));
  const r=stack.Resources;
  assert.equal(r.Collector.Properties.MemorySize,2048);
  assert.deepEqual(r.Collector.Properties.Architectures,['arm64']);
  assert.equal(r.Collector.Properties.Timeout,60);
  // This account has a regional concurrency quota of 10; Lambda requires
  // retaining 100 unreserved executions to configure a nonzero reservation.
  assert.equal(r.Collector.Properties.ReservedConcurrentExecutions,undefined);
  assert.equal(r.EveryMinute,undefined);
  assert.equal(r.SchedulerRole,undefined);
  assert.equal(r.AsyncPolicy.Properties.MaximumRetryAttempts,0);
  assert.equal(r.Collector.Properties.VpcConfig,undefined);
  const actions=r.ExecutionRole.Properties.Policies.flatMap((p:any)=>p.PolicyDocument.Statement.flatMap((s:any)=>s.Action));
  assert.deepEqual(actions,['logs:CreateLogStream','logs:PutLogEvents','lambda:InvokeFunction']);
});

import {completeCollection,parseRequest} from '../lambda/delivery.ts';
import {collectionHash} from '../src/change.ts';
const payload={schemaVersion:1,source:'bfi-imax',collectedAt:new Date().toISOString(),complete:true,pages:[{number:1,count:1}],expectedPages:1,performances:[{id:'11111111-1111-4111-8111-111111111111',articleId:'22222222-2222-4222-8222-222222222222',title:'Test',startsAtLocal:'2026-10-01T12:00:00',timeZone:'Europe/London',status:'available'}]};
test('fallback invokes receiver only for a changed hash and acknowledges only accepted true',async()=>{
  let calls=0;const invoke=async(value:unknown)=>{calls++;assert.deepEqual(value,payload);return {accepted:true};};
  const event={source:'github-403-fallback',previous:null,deliver:true};
  const first=await completeCollection(payload,event,invoke);
  assert.equal(first.delivered,true);assert.equal(calls,1);
  const unchanged=await completeCollection(payload,{...event,previous:{version:1,source:'bfi-imax',hash:collectionHash(payload)}},invoke);
  assert.equal(unchanged.changed,false);assert.equal(unchanged.delivered,false);assert.equal(calls,1);
  const dry=await completeCollection(payload,{...event,deliver:false},invoke);
  assert.equal(dry.delivered,false);assert.equal(calls,1);
  await assert.rejects(completeCollection(payload,event,async()=>({accepted:false})));
  await assert.rejects(completeCollection(payload,event,async()=>{throw Error('network');}));
});
test('fallback rejects independent schedule and invalid shared baseline',()=>{
  assert.throws(()=>parseRequest({source:'bfi-collector-probe-schedule'}));
  assert.throws(()=>parseRequest({source:'github-403-fallback',deliver:true,previous:{hash:'bad'}}));
});
