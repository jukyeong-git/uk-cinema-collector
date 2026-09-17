import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyFrame} from '../scripts/challenge-probe-discovery.ts';
const target='https://whatson.bfi.org.uk';
test('probe only accepts exact target and Cloudflare origins',()=>{
  assert.equal(classifyFrame(`${target}/imax/Online/default.asp?token=private`,target).classification,'target-site');
  assert.equal(classifyFrame('https://challenges.cloudflare.com/widget?token=private',target).classification,'cloudflare-challenge');
  for(const url of ['https://challenges.cloudflare.com.attacker.invalid/','http://challenges.cloudflare.com/','https://attacker.invalid/']) {
    const result=classifyFrame(url,target);
    assert.equal(result.classification,'other');
    assert.equal(result.origin,null);
    assert.ok(result.rejectionReason);
  }
});
test('probe metadata classifies blank frames without leaking opaque contents or URL tokens',()=>{
  for(const url of ['about:blank','about:srcdoc'])assert.equal(classifyFrame(url,target).classification,'blank');
  for(const url of [`${target}/path?secret=private#private`,'data:text/html,private','https://private.example/private','not-a-url-private']) {
    assert.ok(!JSON.stringify(classifyFrame(url,target)).includes('private'));
  }
});
