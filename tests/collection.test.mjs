import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCollection} from '../src/collection.mjs';
const fixture=()=>({schemaVersion:1,source:'bfi-imax',complete:true,expectedPages:1,pages:[{number:1,count:1}],performances:[{id:'00000000-0000-4000-8000-000000000001',articleId:'00000000-0000-4000-8000-000000000002',title:'Example',startsAtLocal:'2026-09-18T21:00:00',timeZone:'Europe/London'}]});
test('accepts a complete page',()=>assert.equal(validateCollection(fixture()).performances.length,1));
test('rejects a missing final page',()=>{const p=fixture();p.expectedPages=2;assert.throws(()=>validateCollection(p));});
test('rejects duplicate pages disguised as complete',()=>{const p=fixture();p.performances.push({...p.performances[0]});p.pages[0].count=2;assert.throws(()=>validateCollection(p));});
test('rejects empty collection',()=>{const p=fixture();p.performances=[];p.pages[0].count=0;assert.throws(()=>validateCollection(p));});
