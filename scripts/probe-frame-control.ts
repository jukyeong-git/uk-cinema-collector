import type {Browser} from 'playwright-core';
import {inspectionErrorDetail} from './challenge-probe-discovery.ts';

// Fully intercepted synthetic origins: no external requests or site state.
export async function inspectControlFrames(browser: Browser) {
  const context=await browser.newContext();
  const page=await context.newPage();
  const results: object[]=[];
  try {
    await page.route('**/*',route=> {
      const url=new URL(route.request().url());
      if(url.hostname==='probe-parent.invalid') return route.fulfill({contentType:'text/html',body:`<!doctype html><body><iframe src="https://probe-child.invalid/plain"></iframe><div id="open"></div><div id="closed"></div><script>for(const mode of ['open','closed']) { const root=document.getElementById(mode).attachShadow({mode}); const frame=document.createElement('iframe');frame.src='https://probe-child.invalid/'+mode;root.appendChild(frame); }</script>`});
      if(url.hostname==='probe-child.invalid') return route.fulfill({contentType:'text/html',body:'<!doctype html><body><input type="checkbox" aria-label="Fixture control">'});
      return route.abort();
    });
    await page.goto('https://probe-parent.invalid/',{waitUntil:'load',timeout:10000});
    for(const frame of page.frames().filter(frame=>frame!==page.mainFrame())) {
      const result: Record<string,unknown>={url:frame.url(),detached:frame.isDetached()};
      for(const [stage,operation] of Object.entries({
        document:()=>frame.evaluate(()=>location.href),
        checkbox:()=>frame.getByRole('checkbox').count(),
        owner:async()=>{const element=await frame.frameElement();try{return await element.evaluate(el=>(el as HTMLIFrameElement).src);}finally{await element.dispose();}},
      })) {
        let timer:ReturnType<typeof setTimeout>|undefined;
        try { result[stage]=await Promise.race([operation(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('INSPECTION_TIMEOUT')),1500);})]); }
        catch(error) {result[stage]=inspectionErrorDetail(error);}
        finally {clearTimeout(timer);}
      }
      results.push(result);
    }
  } catch(error) {results.push({failure:inspectionErrorDetail(error)});}
  finally {await context.close();}
  return results;
}
