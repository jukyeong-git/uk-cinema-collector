import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

for (const failed of [false, true]) test(`authentication keeps identifiers private (failure=${failed})`, () => {
  const dir = mkdtempSync(join(tmpdir(), 'receiver-auth-'));
  try {
    writeFileSync(join(dir, 'fetch.mjs'), `globalThis.fetch = async () => ({ok:true,json:async()=>({value:'oidc-test-token'})});`);
    writeFileSync(join(dir, 'aws'), '#!/usr/bin/env node\n' + (failed
      ? `console.error('private-aws-error');process.exit(1);`
      : `console.log(JSON.stringify({Credentials:{AccessKeyId:'test-access',SecretAccessKey:'test-secret',SessionToken:'test-session'},AssumedRoleUser:{Arn:'test-role-arn',AssumedRoleId:'test-role-id'}}));`), {mode:0o700});
    const envFile = join(dir, 'env');
    const result = spawnSync(process.execPath, ['--import',join(dir,'fetch.mjs'),'--import','tsx','scripts/authenticate-receiver.ts'], {
      encoding:'utf8', env:{...process.env,PATH:dir+':'+process.env.PATH,RECEIVER_ROLE:'arn:aws:iam::123456789012:role/test',RECEIVER_REGION:'eu-west-2',ACTIONS_ID_TOKEN_REQUEST_URL:'https://example.invalid/token',ACTIONS_ID_TOKEN_REQUEST_TOKEN:'request-token',GITHUB_ENV:envFile},
    });
    assert.equal(result.status, failed ? 1 : 0);
    const publicLog = result.stdout.split('\n').filter(line=>!line.startsWith('::add-mask::')).join('\n')+result.stderr;
    for(const value of ['123456789012','test-role-id','test-role-arn','test-access','test-secret','test-session','oidc-test-token','private-aws-error']) assert.ok(!publicLog.includes(value),value);
    if(!failed) {
      assert.match(readFileSync(envFile,'utf8'), /AWS_SESSION_TOKEN=test-session/);
      assert.match(result.stdout,/::add-mask::test-role-id/);
    }
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
