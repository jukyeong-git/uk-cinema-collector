"""Read-only BFI probe; no production payloads, cookies or HTML are persisted."""
import json
import sys
import time
from datetime import datetime, timezone
from urllib.parse import urljoin, urlsplit

import curl_cffi
from curl_cffi import requests
from bs4 import BeautifulSoup

URL = 'https://whatson.bfi.org.uk/imax/Online/default.asp'
PREFIX = 'BOset::WScontent::SearchCriteria::'


def log(event, **values):
    print(json.dumps(dict(event=event, timestamp=datetime.now(timezone.utc).isoformat(), **values)), flush=True)


def checked_url(url):
    parts = urlsplit(url)
    if parts.scheme != 'https' or parts.netloc != 'whatson.bfi.org.uk' or parts.path != '/imax/Online/default.asp':
        raise ValueError('UNEXPECTED_TARGET')
    return url


def fetch(session, attempt, phase, url, data=None):
    checked_url(url)
    started = time.monotonic()
    response = session.request('POST' if data is not None else 'GET', url, data=data,
                               timeout=30, allow_redirects=False)
    soup = BeautifulSoup(response.text, 'html.parser')
    title = soup.title.get_text().lower() if soup.title else ''
    challenge = response.headers.get('cf-mitigated') == 'challenge' or any(
        marker in title for marker in ['just a moment', 'security verification', 'attention required'])
    log('response', attempt=attempt, phase=phase, status=response.status_code,
        elapsedMs=round((time.monotonic()-started)*1000), challenge=challenge,
        cfMitigated=response.headers.get('cf-mitigated', '')[:40],
        cfRay=response.headers.get('cf-ray', '')[:80],
        contentType=response.headers.get('content-type', '')[:80], bytes=len(response.content),
        cookieCount=len(session.cookies), performanceRows=len(soup.select('div.result-box-item')))
    if response.status_code != 200 or challenge:
        raise ValueError('HTTP_OR_CHALLENGE_FAILURE')
    return soup


def main():
    log('probe-start', libraryVersion=curl_cffi.__version__, impersonate='chrome', attempts=10,
        intervalSeconds=30, cookies='fresh-in-memory-session', redirects=False)
    attempt, phase = 0, 'start'
    try:
        with requests.Session(impersonate='chrome') as session:
            for attempt in range(1, 11):
                phase = 'search-home'
                soup = fetch(session, attempt, phase, URL)
                field = soup.find('input', attrs={'name': PREFIX+'search_criteria'})
                form = field.find_parent('form') if field else None
                if form is None or form.get('method', '').lower() != 'post':
                    raise ValueError('SEARCH_FORM_MISSING')
                action = checked_url(urljoin(URL, form.get('action', '')))
                if urlsplit(action).query:
                    raise ValueError('FILTERED_SEARCH_FORM')
                data = {}
                for el in form.select('input[name], select[name], textarea[name]'):
                    if el.has_attr('disabled') or el.get('type') in ['button', 'reset', 'file']:
                        continue
                    if el.get('type') in ['checkbox', 'radio'] and not el.has_attr('checked'):
                        continue
                    name = el['name']
                    if el.name == 'select':
                        option = el.find('option', selected=True) or el.find('option')
                        value = option.get('value', option.get_text()) if option else ''
                    else:
                        value = el.get('value', '') if el.name == 'input' else el.get_text()
                    data[name] = '' if name.startswith(PREFIX) else value
                phase = 'search-results'
                results = fetch(session, attempt, phase, action, data)
                if not results.select('div.result-box-item'):
                    raise ValueError('NO_PERFORMANCE_ROWS')
                log('attempt-passed', attempt=attempt)
                if attempt < 10:
                    time.sleep(30)
        log('probe-complete', passed=10)
        return 0
    except Exception as error:
        # Never print exception messages: they may contain URLs, tokens or cookies.
        log('probe-stopped', attempt=attempt, phase=phase, errorType=type(error).__name__,
            passed=max(0, attempt-1), remainingAttemptsCancelled=10-attempt)
        return 1


if __name__ == '__main__':
    sys.exit(main())
