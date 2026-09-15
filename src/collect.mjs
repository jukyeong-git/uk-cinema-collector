import {writeFile,mkdir} from 'node:fs/promises';
import {launchOptions} from 'camoufox-js';
import {firefox} from 'playwright-core';
import {validateCollection} from './collection.mjs';
const target='https://whatson.bfi.org.uk/imax/Online/default.asp?BOparam::WScontent::loadArticle::permalink=resident-evil';
const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
function localTime(s){const m=s.match(/^\w+\s+(\d{1,2})\s+(\w+)\s+(\d{4})\s+(\d{2}):(\d{2})$/);if(!m||!months.includes(m[2]))throw Error('Unknown BFI date format');return `${m[3]}-${String(months.indexOf(m[2])+1).padStart(2,'0')}-${m[1].padStart(2,'0')}T${m[4]}:${m[5]}:00`;}
let browser;
try{
 browser=await firefox.launch({...await launchOptions({headless:true,geoip:true,locale:'en-GB'}),timeout:60000});
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 await page.goto('https://whatson.bfi.org.uk/imax/',{waitUntil:'domcontentloaded',timeout:60000});
 const payload={schemaVersion:1,source:'bfi-imax',collectedAt:'',complete:false,pages:[],expectedPages:0,performances:[]};
 let next=target;const seen=new Set();
 for(let number=1;next&&number<=100;number++){
  if(seen.has(next))throw Error('Pagination loop');seen.add(next);
  const response=await page.goto(next,{waitUntil:'domcontentloaded',timeout:60000});
  if(!response?.ok()||response.headers()['cf-mitigated']==='challenge')throw Error('BFI navigation blocked');
  await page.locator('div.result-box-item').first().waitFor({timeout:30000});
  const result=await page.evaluate(()=>{
   const getId=(href,suffix)=>{const u=new URL(href,location.href);return [...u.searchParams].find(([k])=>k.endsWith('::'+suffix))?.[1]||'';};
   const rows=[...document.querySelectorAll('div.result-box-item')].map(row=>{
    const a=row.querySelector('div.item-name a');const link=row.querySelector('div.item-link');
    return{id:getId(a?.href||'','context_id'),articleId:getId(a?.href||'','article_id'),title:a?.textContent.trim()||'',date:row.querySelector('span.start-date')?.textContent.trim()||'',status:link?.classList.contains('soldout')?'soldout':link?.querySelector('a.btn-primary')?'available':'unavailable'};
   });
   const nums=[...document.querySelectorAll('.av-paging-links')].map(e=>Number(e.textContent.trim())).filter(Number.isFinite);
   return{rows,totalPages:Math.max(1,...nums),next:document.querySelector('#av-next-link a')?.href||null};
  });
  if(number===1)payload.expectedPages=result.totalPages;
  if(!result.rows.length)throw Error('Empty page');
  payload.pages.push({number,count:result.rows.length});
  payload.performances.push(...result.rows.map(({date,...r})=>({...r,startsAtLocal:localTime(date),timeZone:'Europe/London'})));
  next=result.next;
  console.log(JSON.stringify({page:number,rows:result.rows.length,hasNext:Boolean(next)}));
 }
 if(next)throw Error('Page limit exceeded');
 payload.complete=true;payload.collectedAt=new Date().toISOString();
 validateCollection(payload);
 await mkdir('work',{recursive:true});
 await writeFile('work/payload.json',JSON.stringify(payload));
 console.log(JSON.stringify({collected:payload.performances.length,pages:payload.pages.length}));
}catch(error){console.error(JSON.stringify({failed:true,errorType:error.name}));process.exitCode=1;}
finally{await browser?.close();}
