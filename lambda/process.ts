import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';

// Each invocation owns a process group, including Firefox. Kill the entire
// group before the Lambda deadline so warm invocations cannot inherit it.
export async function runCollector(options: {
  command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv;
  timeoutMs: number; onEvent: (event: Record<string, unknown>) => void;
}): Promise<{exitCode: number | null; timedOut: boolean}> {
  return await new Promise((resolve, reject) => {
    const child = spawn(options.command, options.args, {
      cwd: options.cwd, env: options.env, detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let timedOut = false;
    const stop = () => {
      if (!child.pid) return;
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already exited. */ }
    };
    const timer = setTimeout(() => { timedOut = true; stop(); }, options.timeoutMs);
    const lines = createInterface({input: child.stdout});
    lines.on('line', line => {
      // The shared collector already allowlists diagnostic data. Drop all
      // third-party output: it may contain browser URLs or session information.
      if (line.length > 16384) return;
      try {
        const value: unknown = JSON.parse(line);
        if (value && typeof value === 'object' && 'event' in value &&
          typeof value.event === 'string' &&
          ['phase-start','phase-complete','http-response','page-collected',
            'browser-options-ready','browser-started','collection-complete','collection-failed'].includes(value.event)) {
          options.onEvent(value as Record<string, unknown>);
        }
      } catch { /* Not a collector diagnostic. */ }
    });
    child.stderr.resume();
    child.once('error', () => {
      clearTimeout(timer); lines.close(); stop(); reject(new Error('COLLECTOR_PROCESS_START_FAILED'));
    });
    child.once('close', code => {
      clearTimeout(timer); lines.close(); stop(); resolve({exitCode: code, timedOut});
    });
  });
}
