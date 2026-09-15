import type {Collection} from './types.ts';
import {isRecord,requireCondition as check} from './errors.ts';
import {validLocalTime} from './parse.ts';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function keys(value: unknown, allowed: string[]): asserts value is Record<string, unknown> {
  check(isRecord(value), 'INVALID_OBJECT');
  check(Object.keys(value).every(key => allowed.includes(key)), 'UNEXPECTED_FIELD');
}
export function validateCollection(p: unknown, now = Date.now()): Collection {
  keys(p, ['schemaVersion','source','collectedAt','complete','pages','expectedPages','performances']);
  check(p.schemaVersion === 1 && p.source === 'bfi-imax' && p.complete === true, 'INCOMPLETE_COLLECTION');
  const age = now-Date.parse(typeof p.collectedAt === 'string' ? p.collectedAt : '');
  check(Number.isFinite(age) && age >= -60000 && age <= 15*60000, 'INVALID_COLLECTION_TIME');
  check(typeof p.expectedPages === 'number' && Number.isInteger(p.expectedPages) && p.expectedPages >= 1 && p.expectedPages <= 100, 'INVALID_PAGE_COUNT');
  check(Array.isArray(p.pages) && p.pages.length === p.expectedPages, 'MISSING_PAGES');
  check(Array.isArray(p.performances) && p.performances.length > 0 && p.performances.length <= 1000, 'INVALID_ROW_COUNT');
  let rowCount = 0;
  for (const [i,page] of p.pages.entries()) {
    keys(page, ['number','count']);
    check(page.number === i+1 && typeof page.count === 'number' && Number.isInteger(page.count) && page.count >= 1, 'INVALID_PAGE_ORDER');
    rowCount += page.count;
  }
  check(rowCount === p.performances.length, 'MISSING_ROWS');
  const ids = new Set<string>();
  for (const r of p.performances) {
    keys(r, ['id','articleId','title','startsAtLocal','timeZone','status']);
    check(typeof r.id === 'string' && typeof r.articleId === 'string' && uuid.test(r.id) && uuid.test(r.articleId), 'INVALID_ID');
    check(!ids.has(r.id.toLowerCase()), 'DUPLICATE_ID');
    ids.add(r.id.toLowerCase());
    check(typeof r.title === 'string' && r.title.trim().length > 0 && r.title.length <= 300, 'INVALID_TITLE');
    check(r.timeZone === 'Europe/London' && validLocalTime(r.startsAtLocal), 'INVALID_DATE');
    check(typeof r.status === 'string' && ['available','soldout','unavailable'].includes(r.status), 'INVALID_STATUS');
  }
  // Every field has been checked above; preserve the original payload object.
  return p as unknown as Collection;
}
