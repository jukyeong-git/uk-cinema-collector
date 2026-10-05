import test from 'node:test';
import assert from 'node:assert/strict';
import {patchCamoufox} from '../scripts/patch-camoufox.ts';
import {readFile} from 'node:fs/promises';

test('compatibility patch is idempotent and preserves validation of explicit settings',async()=>{
 const source=await readFile(new URL('../node_modules/camoufox-js/dist/utils.js',import.meta.url),'utf8');
 const patched=patchCamoufox(source);
 assert.equal(patchCamoufox(patched),patched);
 assert.ok(patched.includes('validateConfig(config, knownProperties);'));
 // Exercise the generated-property filter, preserving explicit caller entries.
 const start=patched.indexOf('    const generatedConfig =');
 const end=patched.indexOf('    // Add seeds',start);
 const apply=new Function('config','knownProperties','fromBrowserforge','fingerprint','ff_version_str','mergeInto',patched.slice(start,end));
 const config:Record<string,unknown>={'navigator.product':'explicit value'};
 apply(config,{'navigator.userAgent':'str'},()=>({'navigator.product':'generated','navigator.userAgent':'Firefox'}),{},'156',(a:Record<string,unknown>,b:Record<string,unknown>)=>{for(const [k,v] of Object.entries(b))if(!(k in a))a[k]=v;});
 assert.deepEqual(config,{'navigator.product':'explicit value','navigator.userAgent':'Firefox'});
});
test('patch rejects unexpected dependency source instead of silently skipping fixes',()=>{
 assert.throws(()=>patchCamoufox('different library version'),/CAMOUFOX_PATCH_SOURCE_CHANGED/);
});
