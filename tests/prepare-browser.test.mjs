import test from 'node:test';
import assert from 'node:assert/strict';
import {ensureBrowser} from '../scripts/prepare-browser.mjs';
test('uses preinstalled runner libraries without installing packages',async()=>{
 let installs=0;await ensureBrowser(async()=>{},()=>installs++,()=>{});assert.equal(installs,0);
});
test('installs missing libraries once and verifies browser again',async()=>{
 let probes=0,installs=0;await ensureBrowser(async()=>{if(++probes===1)throw new Error('libX.so: cannot open shared object file');},()=>installs++,()=>{});assert.equal(probes,2);assert.equal(installs,1);
});
test('does not install packages for an unrelated browser failure or expose raw error',async()=>{
 let installs=0;await assert.rejects(ensureBrowser(async()=>{throw new Error('private-browser-detail');},()=>installs++,()=>{}),/^Error: BROWSER_PREFLIGHT_FAILED$/);assert.equal(installs,0);
});
test('fails if installation did not repair the browser',async()=>{
 let installs=0;await assert.rejects(ensureBrowser(async()=>{throw new Error('error while loading shared libraries');},()=>installs++,()=>{}),/BROWSER_PREFLIGHT_FAILED_AFTER_INSTALL/);assert.equal(installs,1);
});
