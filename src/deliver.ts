import {execFileSync} from 'node:child_process';
import {isRecord} from './errors.ts';
import {readFile} from 'node:fs/promises';

// Invoke the configured receiver without printing its identity or payload.
try {
  const receiver = process.env.RECEIVER_FUNCTION;
  if(!receiver) throw new Error('Missing receiver configuration');
  const output = execFileSync('aws',[
    'lambda','invoke','--function-name',receiver,
    '--invocation-type','RequestResponse','--cli-binary-format','raw-in-base64-out',
    '--payload','fileb://work/payload.json','work/response.json','--no-cli-pager',
  ],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
  const metadata: unknown = JSON.parse(output);
  const response: unknown = JSON.parse(await readFile('work/response.json','utf8'));
  if(!isRecord(metadata) || metadata.FunctionError || !isRecord(response) || response.accepted !== true) {
    throw new Error('Receiver rejected collection');
  }
  console.log('Receiver accepted collection');
} catch {
  console.error('Delivery failed; inspect receiver privately.');
  process.exitCode = 1;
}
