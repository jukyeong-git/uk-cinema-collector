import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyFrame, describeFrameUrl, resolveFrameEvidence} from '../scripts/challenge-probe-discovery.ts';
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
test('probe resolves an empty frame URL only with exact trusted fallback evidence',()=>{
  const missing=resolveFrameEvidence('',target);
  assert.equal(missing.classification,'invalid');
  assert.equal(missing.evidenceSource,'none');
  assert.equal(missing.urlShape.empty,true);
  assert.ok(missing.rejectionReason);
  const document=resolveFrameEvidence('',target,{documentUrl:'https://challenges.cloudflare.com/widget?token=private'});
  assert.equal(document.classification,'cloudflare-challenge');
  assert.equal(document.evidenceSource,'document-url');
  const declared=resolveFrameEvidence('',target,{documentUrl:'about:blank',frameElementSrc:'https://challenges.cloudflare.com/widget?token=private'});
  assert.equal(declared.classification,'cloudflare-challenge');
  assert.equal(declared.evidenceSource,'frame-element-src');
  assert.equal(declared.documentUrlShape?.opaque,true);
  assert.equal(declared.frameElementSrcShape?.protocolCategory,'https');
});
test('known foreign or opaque documents cannot be upgraded by a declared trusted src',()=>{
  const frameElementSrc='https://challenges.cloudflare.com/widget';
  for (const url of ['https://foreign.invalid/private','data:text/html,private','https://challenges.cloudflare.com.attacker.invalid/']) {
    const primary=resolveFrameEvidence(url,target,{documentUrl:frameElementSrc,frameElementSrc});
    assert.notEqual(primary.classification,'cloudflare-challenge');
    assert.ok(primary.rejectionReason);
    const document=resolveFrameEvidence('',target,{documentUrl:url,frameElementSrc});
    assert.notEqual(document.classification,'cloudflare-challenge');
    assert.ok(document.rejectionReason);
  }
});
test('shape and evidence metadata contain no raw URL contents',()=>{
  assert.equal(describeFrameUrl('/private?token=private').relative,true);
  assert.equal(describeFrameUrl('data:text/html,private').opaque,true);
  assert.equal(describeFrameUrl('https://private.invalid/private').parseable,true);
  for (const primary of ['', 'about:blank','/private','data:text/html,private','https://private.invalid/private']) {
    for (const fallback of ['https://challenges.cloudflare.com/widget?token=private#private','https://private.invalid/private','data:text/html,private']) {
      const result=resolveFrameEvidence(primary,target,{documentUrl:fallback,frameElementSrc:fallback});
      assert.ok(!JSON.stringify(result).includes('private'));
    }
  }
});
test('probe metadata classifies blank frames without leaking opaque contents or URL tokens',()=>{
  for(const url of ['about:blank','about:srcdoc'])assert.equal(classifyFrame(url,target).classification,'blank');
  for(const url of [`${target}/path?secret=private#private`,'data:text/html,private','https://private.example/private','not-a-url-private']) {
    assert.ok(!JSON.stringify(classifyFrame(url,target)).includes('private'));
  }
});


test('inspection failures expose fixed categories only',async()=>{
  const {inspectionFailure}=await import('../scripts/challenge-probe-discovery.ts');
  for(const [message,category] of [
    ['INSPECTION_TIMEOUT private','timeout'],
    ['Frame was detached https://private.example','detached'],
    ['Execution context was destroyed private','execution-context'],
    ['Target closed private','closed'],
    ['Unable to adopt element handle from a different document private','adoption-failed'],
    ['Protocol error (Page.adoptNode): private','protocol-error'],
    ['Unexpected private','other'],
  ])assert.equal(inspectionFailure(new Error(message)),category);
});

test('error detail removes URLs, quoted values and credentials',async()=>{
 const {inspectionErrorDetail}=await import('../scripts/challenge-probe-discovery.ts');
 const result=inspectionErrorDetail(new Error('Protocol error (Page.adoptNode): missing frame "private" https://secret.invalid/?token=private token=private\nsecret stack'));
 assert.equal(result.category,'protocol-error');
 assert.match(result.detail,/Page.adoptNode/);
 assert.ok(!result.detail.includes('private'));
 assert.ok(!result.detail.includes('secret'));
});
