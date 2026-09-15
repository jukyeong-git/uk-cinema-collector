import {requireCondition as check} from './errors.mjs';
import {validLocalTime} from './parse.mjs';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function keys(value, allowed) {
  check(value && typeof value === 'object' && !Array.isArray(value), 'INVALID_OBJECT');
  check(Object.keys(value).every(key => allowed.includes(key)), 'UNEXPECTED_FIELD');
}
export function validateCollection(p, now = Date.now()) {
  keys(p, ['schemaVersion','source','collectedAt','complete','pages','expectedPages','performances']);
  check(p.schemaVersion === 1 && p.source === 'bfi-imax' && p.complete === true, 'INCOMPLETE_COLLECTION');
  const age = now-Date.parse(p.collectedAt);
  check(Number.isFinite(age) && age >= -60000 && age <= 15*60000, 'INVALID_COLLECTION_TIME');
  check(Number.isInteger(p.expectedPages) && p.expectedPages >= 1 && p.expectedPages <= 100, 'INVALID_PAGE_COUNT');
  check(Array.isArray(p.pages) && p.pages.length === p.expectedPages, 'MISSING_PAGES');
  check(Array.isArray(p.performances) && p.performances.length > 0 && p.performances.length <= 1000, 'INVALID_ROW_COUNT');
  for (const [i,page] of p.pages.entries()) {
    keys(page, ['number','count']);
    check(page.number === i+1 && Number.isInteger(page.count) && page.count >= 1, 'INVALID_PAGE_ORDER');
  }
  check(p.pages.reduce((n,x) => n+x.count,0) === p.performances.length, 'MISSING_ROWS');
  const ids = new Set();
  for (const r of p.performances) {
    keys(r, ['id','articleId','title','startsAtLocal','timeZone','status']);
    check(uuid.test(r.id) && uuid.test(r.articleId), 'INVALID_ID');
    check(!ids.has(r.id.toLowerCase()), 'DUPLICATE_ID');
    ids.add(r.id.toLowerCase());
    check(typeof r.title === 'string' && r.title.trim().length > 0 && r.title.length <= 300, 'INVALID_TITLE');
    check(r.timeZone === 'Europe/London' && validLocalTime(r.startsAtLocal), 'INVALID_DATE');
    check(['available','soldout','unavailable'].includes(r.status), 'INVALID_STATUS');
  }
  return p;
}
