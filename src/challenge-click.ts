import type {Frame, Locator, Page} from 'playwright-core';
import {setTimeout as delay} from 'node:timers/promises';

const verificationName = /verify\s+(?:that\s+)?you\s+are\s+human|confirm\s+(?:that\s+)?you\s+are\s+human|i\s+am\s+human/i;

function isChallengeFrame(frame: Frame): boolean {
  let current: Frame | null = frame;
  while (current) {
    const url = current.url();
    try {
      if (new URL(url).origin === 'https://challenges.cloudflare.com') return true;
    } catch { /* A frame can be unattached while it is loading. */ }
    if (url !== 'about:blank' && url !== 'about:srcdoc' && url !== '') return false;
    current = current.parentFrame();
  }
  return false;
}

// Diagnostic only: use ordinary visible controls, and attempt at most one click.
export async function tryChallengeClick(
  page: Page,
  log: (event: string, values: Record<string, unknown>) => void,
  options: {signal?: AbortSignal; timeoutMs?: number} = {},
) {
  const started = performance.now();
  const timeoutMs = Math.max(0, options.timeoutMs ?? 15000);
  const deadline = started + timeoutMs;
  const active = () => !options.signal?.aborted && performance.now() < deadline;
  const counts = {polls: 0, framesSeen: 0, trustedFramesSeen: 0, candidatesSeen: 0, visibleCandidatesSeen: 0, discoveryErrors: 0};
  log('challenge-click-search-start', {phase: 'search-home', timeoutMs});

  // Bound inspection calls as well as the click; a detached/loading frame must
  // not keep diagnostics alive beyond the caller's deadline.
  async function inspect<T>(operation: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          onAbort = () => reject(new Error('Discovery stopped'));
          timer = setTimeout(onAbort, Math.max(0, deadline - performance.now()));
          options.signal?.addEventListener('abort', onAbort, {once: true});
          if (options.signal?.aborted) onAbort();
        }),
      ]);
    } finally {
      clearTimeout(timer);
      if (onAbort) options.signal?.removeEventListener('abort', onAbort);
    }
  }

  function complete(outcome: string) {
    log('challenge-click-complete', {
      phase: 'search-home', outcome,
      searchedMs: Math.round(performance.now() - started), ...counts,
    });
  }

  while (active()) {
    counts.polls++;
    const frames = page.frames();
    counts.framesSeen += frames.length;
    for (const frame of frames) {
      if (!active()) break;
      const trusted = isChallengeFrame(frame);
      if (!trusted && frame !== page.mainFrame()) continue;
      if (trusted) counts.trustedFramesSeen++;
      const candidates: Array<{locator: Locator; label?: boolean}> = trusted
        ? [
          {locator: frame.getByRole('checkbox')},
          {locator: frame.locator('input[type="checkbox"]')},
          {locator: frame.getByRole('button', {name: verificationName})},
          {locator: frame.locator('label'), label: true},
        ]
        : [
          {locator: frame.getByRole('checkbox', {name: verificationName})},
          {locator: frame.getByRole('button', {name: verificationName})},
          {locator: frame.locator('label').filter({hasText: verificationName}), label: true},
        ];
      for (const candidate of candidates) {
        if (!active()) break;
        try {
          const count = await inspect(candidate.locator.count());
          counts.candidatesSeen += count;
          for (let index = 0; index < count && active(); index++) {
            const target = candidate.locator.nth(index);
            if (!await inspect(target.isVisible())) continue;
            if (candidate.label && !await inspect(target.evaluate(element => {
              const control = (element as HTMLLabelElement).control;
              return control instanceof HTMLInputElement && control.type === 'checkbox';
            }))) continue;
            counts.visibleCandidatesSeen++;
            if (!active()) break;
            log('challenge-click-attempt', {phase: 'search-home', target: candidate.label ? 'label' : 'control', ...counts});
            try {
              await target.click({timeout: Math.max(1, Math.min(2000, deadline - performance.now()))});
              complete('clicked');
            } catch {
              complete(options.signal?.aborted ? 'cancelled' : 'failed');
            }
            return;
          }
        } catch {
          counts.discoveryErrors++;
        }
      }
    }
    if (active()) {
      try {
        await delay(Math.min(100, Math.max(0, deadline - performance.now())), undefined, {signal: options.signal});
      } catch { /* Cancellation ends discovery without attempting a click. */ }
    }
  }
  complete(options.signal?.aborted ? 'cancelled' : 'checkbox-not-found');
}
