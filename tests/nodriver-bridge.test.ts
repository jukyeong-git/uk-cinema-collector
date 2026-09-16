import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
function bridge(input:unknown) {
  const result=spawnSync(process.execPath,['--import','tsx','scripts/nodriver-parse.ts'],{input:JSON.stringify(input),encoding:'utf8'});
  return {status:result.status,output:JSON.parse(result.stdout),stderr:result.stderr};
}
test('Nodriver bridge rejects incomplete collection',()=>{
  const r=bridge({command:'validate',payload:{schemaVersion:1,source:'bfi-imax',complete:false}});
  assert.equal(r.status,1);
  assert.equal(r.output.error,'INCOMPLETE_COLLECTION');
});
test('Nodriver bridge sanitizes challenge errors',()=>{
  const r=bridge({command:'page',html:'<title>Just a moment</title>private-session',url:'https://whatson.bfi.org.uk/imax/Online/default.asp?sToken=private-session',number:1});
  assert.equal(r.status,1);
  assert.equal(r.output.error,'BFI_CHALLENGE');
  assert.ok(!JSON.stringify(r).includes('private-session'));
});
test('Nodriver bridge accepts complete validated collections',()=>{
  const r=bridge({command:'validate',payload:{schemaVersion:1,source:'bfi-imax',complete:true,collectedAt:new Date().toISOString(),expectedPages:1,pages:[{number:1,count:1}],performances:[{id:'00000000-0000-4000-8000-000000000001',articleId:'00000000-0000-4000-8000-000000000002',title:'Example',startsAtLocal:'2026-09-18T21:00:00',timeZone:'Europe/London',status:'available'}]}});
  assert.equal(r.status,0);
  assert.deepEqual(r.output,{ok:true});
});
