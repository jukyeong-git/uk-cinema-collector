import {load} from 'cheerio';
import {requireCondition} from './errors.mjs';
const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
export function localTime(text) {
  const m = text.trim().replace(/\s+/g, ' ').match(/^\w+\s+(\d{1,2})\s+(\w+)\s+(\d{4})\s+(\d{2}):(\d{2})$/);
  requireCondition(m && months.includes(m[2]), 'DATE_FORMAT_CHANGED');
  const value = `${m[3]}-${String(months.indexOf(m[2])+1).padStart(2,'0')}-${m[1].padStart(2,'0')}T${m[4]}:${m[5]}:00`;
  requireCondition(validLocalTime(value), 'INVALID_DATE');
  return value;
}
export function validLocalTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00$/.test(value)) return false;
  const d = new Date(`${value}Z`);
  // This checks calendar validity only; the value remains London wall-clock time.
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0,19) === value;
}
export function checkedPageUrl(value, base) {
  let url;
  try { url = new URL(value, base); } catch { requireCondition(false, 'INVALID_PAGE_URL'); }
  requireCondition(url.origin === 'https://whatson.bfi.org.uk' && url.pathname === '/imax/Online/default.asp' && !url.username && !url.password, 'UNEXPECTED_PAGE_URL');
  return url;
}
function idFrom(href, suffix, base) {
  const url = checkedPageUrl(href, base);
  return [...url.searchParams].find(([key]) => key.endsWith(`::${suffix}`))?.[1] || '';
}
export function parsePage(html, url, number) {
  const $ = load(html);
  requireCondition(!/just a moment|performing security verification/i.test($('title').text()), 'BFI_CHALLENGE');
  const rows = $('div.result-box-item').toArray().map(el => {
    const row = $(el);
    const name = row.find('div.item-name a').first();
    const href = name.attr('href');
    requireCondition(href, 'MISSING_PERFORMANCE_LINK');
    const link = row.find('div.item-link');
    return {
      id: idFrom(href, 'context_id', url),
      articleId: idFrom(href, 'article_id', url),
      title: name.text().trim(),
      startsAtLocal: localTime(row.find('span.start-date').text()),
      timeZone: 'Europe/London',
      status: link.hasClass('soldout') ? 'soldout' : link.find('a.btn-primary').length ? 'available' : 'unavailable',
    };
  });
  requireCondition(rows.length > 0, 'NO_PERFORMANCES');
  const pageNumbers = $('.av-paging-links').toArray().map(el => Number($(el).text().trim())).filter(n => Number.isInteger(n) && n >= 1);
  const totalPages = Math.max(1, ...pageNumbers);
  const active = $('.av-paging-links.active').first().text().trim();
  if (active) requireCondition(Number(active) === number, 'WRONG_PAGE_RETURNED');
  const nextHref = $('#av-next-link a').attr('href');
  let next = null;
  if (nextHref) {
    const nextUrl = checkedPageUrl(nextHref, url);
    requireCondition(Number(nextUrl.searchParams.get('BOset::WScontent::SearchResultsInfo::current_page')) === number+1, 'INVALID_NEXT_PAGE');
    next = nextUrl.href; // May contain a token: kept in memory, never persisted/logged.
  }
  requireCondition(Boolean(next) === (number < totalPages), 'INCONSISTENT_PAGINATION');
  return {rows, totalPages, next};
}
