import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {parseStoredState} from '../src/change.ts';
import {isRecord,requireCondition} from '../src/errors.ts';
try {
  const metadata=JSON.parse(execFileSync('aws',['lambda','invoke','--function-name','london-cinema-collector','--invocation-type','RequestResponse','--cli-binary-format','raw-in-base64-out','--cli-read-timeout','90','--payload','fileb://work/fallback-request.json','work/fallback-response.json','--no-cli-pager'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
  const response=JSON.parse(await readFile('work/fallback-response.json','utf8'));
  requireCondition(!metadata.FunctionError && isRecord(response) && response.ok === true,'FALLBACK_FAILED');
  const request=JSON.parse(await readFile('work/fallback-request.json','utf8'));
  parseStoredState({version:1,source:'bfi-imax',hash:response.hash});
  requireCondition(response.changed === (request.previous?.hash !== response.hash) && response.delivered === (request.deliver && response.changed),'INVALID_FALLBACK_RESPONSE');
  console.log(JSON.stringify({event:'fallback-complete',hash:response.hash,changed:response.changed,delivered:response.delivered}));
} catch {
  console.error('Fallback failed; inspect london-cinema-collector logs. Acknowledged hash was not updated.');
  process.exitCode=1;
}
