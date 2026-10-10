import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {runInNewContext} from 'node:vm';
const workflow=readFileSync(new URL('../.github/workflows/collect.yml',import.meta.url),'utf8');
const scripts=[...workflow.matchAll(/node -e '(const n=Number\(process.env.DURATION_MINUTES\).*?)'/g)].map(m=>m[1]);
test('both collectors cap late starts at next full hour',()=>{
 assert.equal(scripts.length,2);
 for(const script of scripts)for(const [start,minutes,end] of [['2026-10-10T10:17:00Z','60','2026-10-10T11:00:00Z'],['2026-10-10T10:59:30Z','60','2026-10-10T11:00:00Z'],['2026-10-10T10:00:00Z','60','2026-10-10T11:00:00Z'],['2026-10-10T10:10:00Z','3','2026-10-10T10:13:00Z']]){
  let output='';runInNewContext(script,{Date:{now:()=>Date.parse(start)},Math,Number,process:{env:{DURATION_MINUTES:minutes,GITHUB_ENV:'test'},exit:()=>{throw Error('INVALID')}},require:()=>({appendFileSync:(_:string,text:string)=>{output=text;}})});assert.equal(Number(output.split('=')[1]),Date.parse(end));
 }
});
