import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';

// AWS credentials stay in the user's normal credential provider chain.
const region = 'eu-west-2';
const profile = process.env.AWS_PROFILE ?? 'cinema-alert';
const name = 'london-cinema-collector';
const root = fileURLToPath(new URL('../', import.meta.url));
const template = fileURLToPath(new URL('../lambda/stack.json', import.meta.url));
function run(command: string, args: string[], input?: string) {
  return execFileSync(command, args, {cwd: root, input, encoding:'utf8',
    maxBuffer: 10 * 1024 * 1024, stdio: ['pipe','pipe','pipe']}).trim();
}
function aws(args: string[]) {
  return run('aws', [...args,'--profile',profile,'--region',region,'--no-cli-pager']);
}
const mode = process.argv[2] ?? 'deploy';
if (!['deploy'].includes(mode)) throw new Error('Use deploy');
let image = '';
if (mode === 'deploy') {
  const account = JSON.parse(aws(['sts','get-caller-identity'])).Account;
  if (!/^\d{12}$/.test(account)) throw new Error('INVALID_AWS_ACCOUNT');
  let repository: string;
  try {
    repository = JSON.parse(aws(['ecr','describe-repositories','--repository-names',name])).repositories[0].repositoryUri;
  } catch (error) {
    if (!String((error as {stderr?: unknown}).stderr).includes('RepositoryNotFoundException')) throw error;
    repository = JSON.parse(aws(['ecr','create-repository','--repository-name',name,
      '--image-scanning-configuration','scanOnPush=true'])).repository.repositoryUri;
  }
  const tag = new Date().toISOString().replace(/[^0-9]/g,'');
  const tagged = `${repository}:${tag}`;
  console.log('Building the pinned collection fallback image');
  execFileSync('docker',['buildx','build','--platform','linux/arm64','--provenance=false','--load',
    '-f','lambda/Dockerfile','-t',tagged,'.'],{cwd:root,stdio:'inherit'});
  const password = aws(['ecr','get-login-password']);
  const registry = `${account}.dkr.ecr.${region}.amazonaws.com`;
  // The password is passed only through stdin and is never logged.
  run('docker',['login','--username','AWS','--password-stdin',registry],password);
  try {
    execFileSync('docker',['push',tagged],{cwd:root,stdio:'inherit'});
  } finally { run('docker',['logout',registry]); }
  const digest = JSON.parse(aws(['ecr','describe-images','--repository-name',name,
    '--image-ids',`imageTag=${tag}`])).imageDetails[0].imageDigest;
  image = `${repository}@${digest}`;
}
// Fallback is invoked only by GitHub; no independent schedule.
JSON.parse(readFileSync(template,'utf8'));
execFileSync('aws',['cloudformation','deploy','--stack-name',name,'--template-file',template,
  '--capabilities','CAPABILITY_IAM','--parameter-overrides',`ImageUri=${image}`,
  '--no-fail-on-empty-changeset','--profile',profile,'--region',region,'--no-cli-pager'],{cwd:root,stdio:'inherit'});
console.log(JSON.stringify({functionName:name,region,memoryMB:2048,timeoutSeconds:60,schedule:false,image}));
