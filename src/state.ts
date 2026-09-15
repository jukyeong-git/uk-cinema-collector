import {readFile,writeFile,appendFile} from 'node:fs/promises';
import {planChange,parseStoredState,acknowledgedState} from './change.ts';
import {CollectionError,isRecord,requireCondition} from './errors.ts';

// Only the acknowledged hash is public. Full schedules are never committed.
const repo = process.env.GITHUB_REPOSITORY;
const token = process.env.GH_TOKEN;
async function request(method: 'GET' | 'PUT',body?: Record<string, unknown>): Promise<unknown> {
  requireCondition(/^[\w.-]+\/[\w.-]+$/.test(repo || '') && token, 'MISSING_STATE_ACCESS');
  const url = `https://api.github.com/repos/${repo}/contents/state.json${method === 'GET' ? '?ref=state' : ''}`;
  const response = await fetch(url,{
    method,
    headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${token}`,'X-GitHub-Api-Version':'2022-11-28',...(body?{'Content-Type':'application/json'}:{})},
    body:body?JSON.stringify(body):undefined,
    signal:AbortSignal.timeout(20000),
  });
  if(method === 'GET' && response.status === 404) return null;
  requireCondition(response.ok, method === 'GET' ? 'STATE_READ_FAILED' : 'STATE_WRITE_FAILED');
  return response.json();
}
try {
  const payload: unknown = JSON.parse(await readFile('work/payload.json','utf8'));
  if(process.argv[2] === 'compare') {
    const file = await request('GET');
    let previous: ReturnType<typeof parseStoredState> | null = null;
    if(file) {
      requireCondition(isRecord(file) && file.encoding === 'base64' && typeof file.sha === 'string' && typeof file.content === 'string', 'INVALID_STATE_FILE');
      previous = parseStoredState(JSON.parse(Buffer.from(file.content,'base64').toString('utf8')));
    }
    const pending = {...planChange(payload,previous),sha:isRecord(file) && typeof file.sha === 'string' ? file.sha : null};
    await writeFile('work/pending-state.json',JSON.stringify(pending));
    if(process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT,`changed=${pending.changed}\n`);
    console.log(JSON.stringify({event:'comparison-complete',changed:pending.changed,baselineExists:Boolean(previous)}));
  } else if(process.argv[2] === 'acknowledge') {
    const pending: unknown = JSON.parse(await readFile('work/pending-state.json','utf8'));
    const response: unknown = JSON.parse(await readFile('work/response.json','utf8'));
    requireCondition(isRecord(pending) && (pending.sha === null || typeof pending.sha === 'string'), 'INVALID_PENDING_STATE');
    const state = acknowledgedState(payload,pending,response);
    await request('PUT',{
      message:'Update acknowledged collection hash',
      branch:'state',
      content:Buffer.from(JSON.stringify(state)+'\n').toString('base64'),
      ...(pending.sha?{sha:pending.sha}:{}),
    });
    console.log(JSON.stringify({event:'acknowledged-hash-saved'}));
  } else {
    throw new CollectionError('UNKNOWN_STATE_OPERATION');
  }
} catch(error) {
  console.error(JSON.stringify({event:'state-operation-failed',code:error instanceof CollectionError?error.code:'STATE_EXECUTION_ERROR'}));
  process.exitCode=1;
}
