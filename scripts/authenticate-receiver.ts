import {execFileSync} from 'node:child_process';
import {appendFileSync} from 'node:fs';

// Keep OIDC credentials and AWS identities out of public Actions logs.
try {
  const required = (name: string): string => {
    const value = process.env[name];
    if (!value || /[\r\n]/.test(value)) throw new Error('Invalid configuration');
    return value;
  };
  const mask = (value: string): void => {
    console.log(`::add-mask::${value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')}`);
  };
  const role = required('RECEIVER_ROLE');
  const region = required('RECEIVER_REGION');
  mask(role);
  const account = role.split(':')[4];
  if (account) mask(account);
  const url = new URL(required('ACTIONS_ID_TOKEN_REQUEST_URL'));
  url.searchParams.set('audience', 'sts.amazonaws.com');
  const response = await fetch(url, {
    headers: {Authorization: `Bearer ${required('ACTIONS_ID_TOKEN_REQUEST_TOKEN')}`},
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('OIDC failed');
  const token = await response.json() as {value?: string};
  if (!token.value) throw new Error('Missing token');
  mask(token.value);
  const result = JSON.parse(execFileSync('aws', [
    'sts', 'assume-role-with-web-identity', '--role-arn', role,
    '--role-session-name', 'cinema-collection', '--web-identity-token', token.value,
    '--region', region, '--output', 'json', '--no-cli-pager',
  ], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000})) as {
    Credentials: {AccessKeyId: string; SecretAccessKey: string; SessionToken: string};
    AssumedRoleUser?: {Arn?: string; AssumedRoleId?: string};
  };
  for (const value of Object.values(result.AssumedRoleUser ?? {})) if (value) mask(value);
  const env = {
    AWS_ACCESS_KEY_ID: result.Credentials.AccessKeyId,
    AWS_SECRET_ACCESS_KEY: result.Credentials.SecretAccessKey,
    AWS_SESSION_TOKEN: result.Credentials.SessionToken,
    AWS_REGION: region, AWS_DEFAULT_REGION: region,
  };
  for (const value of Object.values(env)) {
    if (!value || /[\r\n]/.test(value)) throw new Error('Invalid credentials');
    mask(value);
  }
  appendFileSync(required('GITHUB_ENV'), Object.entries(env).map(([k,v]) => `${k}=${v}\n`).join(''));
  console.log('Receiver authentication succeeded');
} catch {
  console.error('Receiver authentication failed; inspect configuration privately.');
  process.exitCode = 1;
}
