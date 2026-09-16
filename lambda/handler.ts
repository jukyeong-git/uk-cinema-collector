import {access,mkdtemp,readFile,rm} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isIP} from 'node:net';
import {LambdaClient,InvokeCommand} from '@aws-sdk/client-lambda';
import {completeCollection,parseRequest} from './delivery.ts';
import {CollectionError,requireCondition} from '../src/errors.ts';
import {validateCollection} from '../src/collection.ts';
import {runCollector} from './process.ts';

interface Context {awsRequestId: string; getRemainingTimeInMillis(): number}
let invocationCount = 0;
const cache = process.env.CAMOUFOX_INSTALL_DIR ?? '/opt/camoufox';

export async function assertBrowserCache(directory: string) {
  await access(join(directory, 'camoufox'), constants.X_OK);
  for (const name of ['version.json','GeoLite2-City.mmdb','addons/UBO/manifest.json']) {
    await access(join(directory, name), constants.R_OK);
  }
  const version = JSON.parse(await readFile(join(directory, 'version.json'), 'utf8'));
  const addon = JSON.parse(await readFile(join(directory, 'addons/UBO/manifest.json'), 'utf8'));
  return {browserVersion: String(version.version), browserRelease: String(version.release),
    ublockVersion: String(addon.version)};
}

async function publicIPv4(): Promise<string | null> {
  try {
    const response = await fetch('https://api.ipify.org', {signal: AbortSignal.timeout(3000)});
    const address = (await response.text()).trim();
    return response.ok && isIP(address) === 4 ? address : null;
  } catch { return null; }
}

export async function handler(event: unknown, context: Context) {
  const started = Date.now();
  const coldStart = invocationCount++ === 0;
  const log = (event: string, values: Record<string, unknown> = {}) => console.log(JSON.stringify({
    ...values, event, timestamp: new Date().toISOString(), requestId: context.awsRequestId,
    region: process.env.AWS_REGION, elapsedMs: Date.now() - started,
  }));
  let directory: string | undefined;
  let failure: Record<string, unknown> | undefined;
  try {
    // Check before importing/launching Camoufox: a broken image must fail rather
    // than triggering its automatic browser/addon/GeoIP download fallback.
    parseRequest(event);
    const versions = await assertBrowserCache(cache);
    log('lambda-start', {coldStart, memoryMB: process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE,
      browserCache: 'image', browserDownload: false, ...versions});
    directory = await mkdtemp('/tmp/bfi-collector-');
    const ipTask = publicIPv4().then(ip => log('runner-ip', {ipv4: ip}));
    const env: NodeJS.ProcessEnv = {...process.env, COLLECTOR_BROWSER: 'camoufox', TMPDIR: directory};
    delete env.GITHUB_STEP_SUMMARY;
    delete env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD; // This flag also disables the cached uBlock addon.
    const result = await runCollector({
      command: process.execPath,
      args: [fileURLToPath(new URL('../src/collect.js', import.meta.url))],
      cwd: directory, env, timeoutMs: Math.max(1, context.getRemainingTimeInMillis() - 15000),
      onEvent(value) {
        if (value.event === 'collection-failed') failure = value;
        const {event, ...fields} = value;
        log(String(event), fields);
      },
    });
    await ipTask;
    if (result.timedOut || result.exitCode !== 0) {
      const code = result.timedOut ? 'COLLECTION_DEADLINE' : String(failure?.code ?? 'COLLECTOR_PROCESS_FAILED');
      log('lambda-result', {ok: false, code, blocked: code === 'BFI_BLOCKED', coldStart});
      return {ok: false, code, blocked: code === 'BFI_BLOCKED', requestId: context.awsRequestId};
    }
    const payload = validateCollection(JSON.parse(await readFile(join(directory,'work/payload.json'),'utf8')));
    const delivery = await completeCollection(payload,event,async value=>{
      const client=new LambdaClient({maxAttempts:1});
      try {
        const response=await client.send(new InvokeCommand({FunctionName:process.env.RECEIVER_FUNCTION,InvocationType:'RequestResponse',Payload:Buffer.from(JSON.stringify(value))}),{abortSignal:AbortSignal.timeout(Math.max(1,context.getRemainingTimeInMillis()-2000))});
        requireCondition(!response.FunctionError && response.Payload,'RECEIVER_INVOCATION_FAILED');
        return JSON.parse(Buffer.from(response.Payload).toString());
      } finally {client.destroy();}
    },plan=>log('comparison-complete',plan));
    log('delivery-complete',delivery);
    const summary = {ok: true, pages: payload.pages.length, collected: payload.performances.length,
      ...delivery, requestId: context.awsRequestId};
    log('lambda-result', {...summary, coldStart});
    // GitHub persists this hash only after the receiver acknowledged delivery.
    return summary;
  } catch(error) {
    const code=error instanceof CollectionError ? error.code : 'LAMBDA_COLLECTOR_ERROR';
    log('lambda-result', {ok: false, code, coldStart});
    return {ok:false,code,requestId:context.awsRequestId};
  } finally {
    if (directory) await rm(directory, {recursive: true, force: true});
  }
}
