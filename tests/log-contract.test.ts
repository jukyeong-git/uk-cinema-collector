import test from 'node:test';
import assert from 'node:assert/strict';
import {sanitizeLogValue,logSummary} from '../src/logging/contract.ts';

test('summary contract and sensitive diagnostics',()=>{
 const output:string[]=[];const original=console.warn;console.warn=(s:unknown)=>{output.push(String(s));};
 try {logSummary({event:'run_summary',country:'GB',city:'London',component:'collector',operation:'test',runId:'123e4567-e89b-42d3-a456-426614174000',status:'partial',durationMs:3,diagnostics:{nested:{token:'my-secret',cookie:'sid=abc',bookingPayload:'private',email:'x@example.com',phone:'+44 123 456 7890'},message:'Bearer abc https://example.com/?token=private 192.168.1.1 <html>bad</html>',rawBody:'private',error:new Error('private')}});}finally{console.warn=original;}
 const row=JSON.parse(output[0]);assert.equal(row.schemaVersion,1);assert.equal(row.status,'partial');assert.equal(row.level,'WARN');assert.equal(row.runId,'123e4567-e89b-42d3-a456-426614174000');assert.match(row.timestamp,/^\d{4}-\d\d-\d\dT/);assert.equal(row.counts,undefined);
 for(const secret of ['my-secret','sid=abc','x@example.com','123 456 7890','192.168.1.1','private','<html>'])assert.ok(!output[0].includes(secret));
 assert.equal((sanitizeLogValue('x'.repeat(600)) as string).length,500);
});
