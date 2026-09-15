import test from 'node:test';
import assert from 'node:assert/strict';
import {responseDiagnostic,errorDiagnostic} from '../src/diagnostics.mjs';
test('reports challenge separately from HTTP failure without exporting headers or URLs',()=>{
 const diagnostic=responseDiagnostic({status:()=>403,headers:()=>({'cf-mitigated':'challenge','cf-ray':'0123456789abcdef-LHR','set-cookie':'SECRET',location:'https://secret/?token=SECRET','content-type':'text/html; charset=UTF-8',server:'cloudflare'}),request:()=>({redirectedFrom:()=>null})});
 assert.equal(diagnostic.httpStatus,403);assert.equal(diagnostic.cloudflareChallenge,true);assert.equal(diagnostic.cloudflareRay,'0123456789abcdef-LHR');assert.ok(!JSON.stringify(diagnostic).includes('SECRET'));
});
test('handles missing response and redacts untrusted header values',()=>{
 assert.deepEqual(responseDiagnostic(null),{responseReceived:false});
 const d=responseDiagnostic({status:()=>503,headers:()=>({'cf-ray':'SECRET','content-type':'SECRET'}),request:()=>({redirectedFrom:()=>({})})});
 assert.equal(d.cloudflareChallenge,false);assert.equal(d.redirected,true);assert.ok(!JSON.stringify(d).includes('SECRET'));
});
test('exports only controlled error categories',()=>{
 assert.deepEqual(errorDiagnostic({name:'TimeoutError',message:'https://site/?token=SECRET'}),{errorType:'TimeoutError'});
 assert.deepEqual(errorDiagnostic({name:'SECRET',message:'NS_ERROR_NET_RESET https://secret'}),{errorType:'OtherError',networkCode:'NS_ERROR_NET_RESET'});
});
