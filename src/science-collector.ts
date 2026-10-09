import {load} from 'cheerio';
export interface Screening {id:string;productionId:string;title:string;startsAt:string;status:'available'|'soldout'|'unavailable';url:string}
export interface Film {title:string;url:string;keywordIds:string[]}
export interface Collection {collectedAt:string;films:Film[];rows:Screening[];through:string}
const root='https://www.sciencemuseum.org.uk';
export function filmLinks(html:string):Film[]{
 const $=load(html),section=$('section[aria-labelledby="a-blockbuster-films"]');
 if(section.length!==1)throw Error('BLOCKBUSTER_SECTION_MISSING');
 const films=section.find('a.c-card__link').toArray().map(e=>{const url=new URL($(e).attr('href')!,root);if(url.origin!==root||!url.pathname.startsWith('/see-and-do/'))throw Error('INVALID_FILM_LINK');return {title:$(e).find('h3').text().trim(),url:url.href,keywordIds:[]};});
 if(!films.length||films.length>20)throw Error('INVALID_FILM_COUNT');return films;
}
export function bookingFilters(html:string):string[]{
 const $=load(html),ids=new Set<string>();
 $('a[href]').each((_,e)=>{const u=new URL($(e).attr('href')!,root);if(u.hostname==='my.sciencemuseum.org.uk'&&u.pathname==='/events'){const id=u.searchParams.get('kid');if(!id||!/^\d+$/.test(id))throw Error('UNKNOWN_BOOKING_FILTER');ids.add(id);}});
 if(!ids.size&&!$('a[href*="sciencemuseum.wufoo.com"]').toArray().some(e=>/register|interest|alert/i.test($(e).text())))throw Error('BOOKING_LINK_MISSING');
 return [...ids];
}
export function parseResponse(value:unknown):Screening[]{
 const data=value as {productions?:{productionSeasonId:unknown;productionTitle:unknown;performances:Record<string,unknown>[]}[]};
 if(!data||!Array.isArray(data.productions))throw Error('INVALID_API_RESPONSE');
 const rows:Screening[]=[];
 for(const p of data.productions){if(!/^\d+$/.test(String(p.productionSeasonId))||typeof p.productionTitle!=='string'||!Array.isArray(p.performances))throw Error('INVALID_PRODUCTION');
  for(const r of p.performances){
   if(r.isPerformanceVisible===false)continue;
   if(typeof r.isPerformanceVisible!=='boolean'||typeof r.isOnSale!=='boolean'||!/^\d+$/.test(String(r.id))||typeof r.iso8601DateString!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?[+-]\d{2}:\d{2}$/.test(r.iso8601DateString)||!Number.isFinite(Date.parse(r.iso8601DateString)))throw Error('INVALID_SCREENING');
   const url=new URL(String(r.actionUrl));if(url.origin!=='https://my.sciencemuseum.org.uk'||url.pathname!==`/${p.productionSeasonId}/${r.id}`||url.search)throw Error('INVALID_BOOKING_URL');
   rows.push({id:String(r.id),productionId:String(p.productionSeasonId),title:p.productionTitle,startsAt:r.iso8601DateString,status:r.isOnSale?'available':/sold\s*out/i.test(String(r.performanceStatusMessage))?'soldout':'unavailable',url:url.href});
  }
 }return rows;
}
export const screeningKey=(r:Screening)=>`science-museum|${r.id}|${r.startsAt.slice(0,19)}`;
export async function collect(fetcher:typeof fetch=fetch,now=new Date()):Promise<Collection>{
 const deadline=AbortSignal.timeout(21000);
 const request=async(url:string,init:RequestInit={})=>{const r=await fetcher(url,{...init,signal:deadline});if(!r.ok)throw Error(`SOURCE_HTTP_${r.status}`);const text=await r.text();if(text.length>5000000)throw Error('SOURCE_TOO_LARGE');return text;};
 const films=filmLinks(await request(root+'/imax-cinema'));
 // Query a complete rolling 13-month window; no old month from a published link is reused.
 const start=now.toLocaleDateString('en-CA',{timeZone:'Europe/London'}).slice(0,7)+'-01T00:00';
 const end=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+13,0)).toISOString().slice(0,10)+'T23:59';
 const all:Screening[]=[];
 for(let i=0;i<films.length;i+=3)await Promise.all(films.slice(i,i+3).map(async film=>{
  film.keywordIds=bookingFilters(await request(film.url));
  for(const kid of film.keywordIds){const text=await request('https://my.sciencemuseum.org.uk/api/products/productionseasons',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({productionSeasonIdFilter:[],keywordIds:[kid],startDate:start,endDate:end,keywords:[]})});let data;try{data=JSON.parse(text);}catch{throw Error('API_NOT_JSON');}all.push(...parseResponse(data));}
 }));
 const unique=new Map<string,Screening>();for(const row of all){const key=screeningKey(row),previous=unique.get(key);if(previous&&JSON.stringify(previous)!==JSON.stringify(row))throw Error('CONFLICTING_SCREENING');unique.set(key,row);}
 if(unique.size>3000)throw Error('TOO_MANY_SCREENINGS');
 return {collectedAt:new Date().toISOString(),films,rows:[...unique.values()].sort((a,b)=>screeningKey(a).localeCompare(screeningKey(b))),through:end};
}
