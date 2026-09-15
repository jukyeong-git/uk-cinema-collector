// Transport checks only; alert eligibility and notification state belong to the receiver.
export function validateCollection(p){
 if(p.schemaVersion!==1||p.source!=='bfi-imax'||p.complete!==true)throw Error('Incomplete collection');
 if(!Number.isInteger(p.expectedPages)||p.expectedPages<1||p.pages.length!==p.expectedPages)throw Error('Missing pages');
 if(!p.performances.length||p.pages.reduce((n,x)=>n+x.count,0)!==p.performances.length)throw Error('Missing rows');
 const ids=new Set();
 for(const [i,page] of p.pages.entries())if(page.number!==i+1||!Number.isInteger(page.count)||page.count<1)throw Error('Invalid page order');
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 for(const r of p.performances){
  if(!uuid.test(r.id)||!uuid.test(r.articleId)||ids.has(r.id.toLowerCase()))throw Error('Invalid/duplicate ID');
  ids.add(r.id.toLowerCase());
  if(!r.title||r.timeZone!=='Europe/London'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00$/.test(r.startsAtLocal))throw Error('Invalid row');
 }
 return p;
}
