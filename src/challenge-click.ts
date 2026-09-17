import type {Page} from 'playwright-core';
import {setTimeout as delay} from 'node:timers/promises';

// Diagnostic only: interact with a visible checkbox once; never force a click.
export async function tryChallengeClick(page: Page, log: (event:string, values:Record<string,unknown>)=>void) {
  const deadline=performance.now()+5000;
  while (performance.now()<deadline) {
    for (const frame of page.frames()) {
      if (!frame.url().startsWith('https://challenges.cloudflare.com/')) continue;
      const checkbox=frame.getByRole('checkbox').first();
      try {
        if (!await checkbox.isVisible()) continue;
        log('challenge-click-attempt',{phase:'search-home'});
        await checkbox.click({timeout:Math.max(1,Math.min(2000,deadline-performance.now()))});
        log('challenge-click-complete',{phase:'search-home',outcome:'clicked'});
      } catch {
        log('challenge-click-complete',{phase:'search-home',outcome:'failed'});
      }
      return;
    }
    await delay(100);
  }
  log('challenge-click-complete',{phase:'search-home',outcome:'checkbox-not-found'});
}
