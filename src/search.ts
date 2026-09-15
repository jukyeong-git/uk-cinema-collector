import {load} from 'cheerio';
import {checkedPageUrl} from './parse.ts';
import {requireCondition as check} from './errors.ts';
const prefix = 'BOset::WScontent::SearchCriteria::';
export const searchInputSelector = `input[name="${prefix}search_criteria"]`;
export function validateSearchForm(html: string, base: string) {
  const $ = load(html);
  const form = $('form').filter((_,el)=>$(el).find(searchInputSelector).length>0);
  check(form.length===1 && form.attr('method')?.toLowerCase()==='post', 'SEARCH_FORM_CHANGED');
  const target = checkedPageUrl(form.attr('action'),base);
  check(!target.search, 'FILTERED_SEARCH_URL');
  const inputs = form.find('input,select,textarea').toArray();
  for (const field of ['search_criteria','search_from','search_to','venue_filter','city_filter','month_filter','object_type_filter','category_filter']) {
    check(inputs.some(el=>$(el).attr('name')===prefix+field), 'SEARCH_FORM_CHANGED');
  }
  for (const el of inputs) {
    if (($(el).attr('name')||'').startsWith(prefix)) {
      check($(el).val()==='', 'FILTERED_SEARCH_FORM');
    }
  }
  check(form.find('input[name="doWork::WScontent::search"]').val()==='1', 'SEARCH_FORM_CHANGED');
  check((form.find('input[name="BOparam::WScontent::search::article_search_id"]').val()?.length ?? 0)>0, 'SEARCH_FORM_CHANGED');
  check(form.find('input[type="submit"]').length===1, 'SEARCH_FORM_CHANGED');
}
