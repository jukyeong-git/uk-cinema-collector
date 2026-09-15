import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const script = fileURLToPath(new URL('../src/deliver.ts', import.meta.url));
const loader = import.meta.resolve('tsx');
const cases = [
  {name:'acknowledged', metadata:'{}', response:'{"accepted":true}', success:true},
  {name:'rejected', metadata:'{}', response:'{"accepted":false}'},
  {name:'function error', metadata:'{"FunctionError":"Unhandled"}', response:'{"accepted":true}'},
  {name:'invalid metadata', metadata:'invalid', response:'{"accepted":true}'},
  {name:'invalid response', metadata:'{}', response:'invalid'},
  {name:'non-boolean acknowledgement', metadata:'{}', response:'{"accepted":"true"}'},
  {name:'CLI failure', metadata:'{}', response:'{"accepted":true}', cliFailure:true},
  {name:'missing receiver', metadata:'{}', response:'{"accepted":true}', missingReceiver:true},
];

for (const scenario of cases) {
  test(`delivery: ${scenario.name}`, {skip:process.platform === 'win32'}, async () => {
    const directory = await mkdtemp(join(tmpdir(),'cinema-delivery-'));
    try {
      await mkdir(join(directory,'work'));
      await writeFile(join(directory,'work/response.json'),scenario.response);
      // PATH points only to this fake CLI. No AWS credentials or network are used.
      await writeFile(join(directory,'aws'),`#!/bin/sh
if [ "$MOCK_FAIL" = "1" ]; then echo private-detail >&2; exit 1; fi
printf '%s' "$MOCK_METADATA"
`,{mode:0o755});
      const result = spawnSync(process.execPath,['--import',loader,script],{
        cwd:directory,
        encoding:'utf8',
        timeout:10000,
        env:{PATH:directory,RECEIVER_FUNCTION:scenario.missingReceiver?'':'mock-receiver',MOCK_METADATA:scenario.metadata,MOCK_FAIL:scenario.cliFailure?'1':'0'},
      });
      assert.ifError(result.error);
      assert.equal(result.status,scenario.success?0:1);
      assert.equal(result.stdout,scenario.success?'Receiver accepted collection\n':'');
      assert.equal(result.stderr,scenario.success?'':'Delivery failed; inspect receiver privately.\n');
    } finally {
      await rm(directory,{recursive:true,force:true});
    }
  });
}
