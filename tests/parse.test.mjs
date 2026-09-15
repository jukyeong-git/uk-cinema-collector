import test from 'node:test';
import assert from 'node:assert/strict';
import {localTime,parsePage,checkedPageUrl} from '../src/parse.mjs';
const base='https://whatson.bfi.org.uk/imax/Online/default.asp';
const id='00000000-0000-4000-8000-000000000001';
const article='00000000-0000-4000-8000-000000000002';
function page({number=1,total=1,next=null,status='available',date='Friday 18 September 2026 21:00'}={}) {
 return `<title>Buy cinema tickets</title><div class="result-box-item"><div class="item-name"><a href="default.asp?BOparam::WScontent::loadArticle::article_id=${article}&BOparam::WScontent::loadArticle::context_id=${id}&sToken=example">Example Film</a></div><span class="start-date">${date}</span><div class="item-link ${status}">${status==='available'?'<a class="btn-primary">Buy</a>':''}</div></div><li class="av-paging-links active">${number}</li><li class="av-paging-links">${total}</li>${next?`<li id="av-next-link"><a href="${next}">Next</a></li>`:''}`;
}
test('extracts rows without retaining token-bearing links',()=>{const result=parsePage(page(),base,1);assert.equal(result.rows[0].id,id);assert.equal(result.rows[0].startsAtLocal,'2026-09-18T21:00:00');assert.equal(result.rows[0].status,'available');assert.ok(!JSON.stringify(result).includes('example'));});
test('keeps winter London time without applying a fixed UTC offset',()=>assert.equal(localTime('Friday 18 December 2026 21:00'),'2026-12-18T21:00:00'));
test('rejects impossible dates',()=>assert.throws(()=>localTime('Monday 30 February 2026 21:00')));
test('follows only the expected next page',()=>{const next='default.asp?BOset::WScontent::SearchResultsInfo::current_page=2';const r=parsePage(page({total:2,next}),base,1);assert.equal(r.totalPages,2);assert.ok(r.next.includes('current_page=2'));});
test('rejects missing next link instead of accepting partial data',()=>assert.throws(()=>parsePage(page({total:2}),base,1)));
test('rejects a server returning the first page again',()=>assert.throws(()=>parsePage(page(),base,2)));
test('rejects cross-origin pagination',()=>assert.throws(()=>checkedPageUrl('https://example.com/imax/Online/default.asp',base)));
test('rejects login/seat selection pagination paths',()=>assert.throws(()=>checkedPageUrl('mapSelect.asp',base)));
test('preserves sold-out state',()=>assert.equal(parsePage(page({status:'soldout'}),base,1).rows[0].status,'soldout'));
test('rejects challenge HTML',()=>assert.throws(()=>parsePage('<title>Just a moment...</title>',base,1)));
