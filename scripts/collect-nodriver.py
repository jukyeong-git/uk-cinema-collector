"""Experimental Nodriver collector; shares production TypeScript validators."""
import asyncio
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

import nodriver as uc

STARTED = time.monotonic()
PHASE = 'prepare'
SELECTOR = 'form:has(input[name="BOset::WScontent::SearchCriteria::search_criteria"])'


class CollectionError(Exception):
    pass


def log(event, **values):
    print(json.dumps(dict(event=event, timestamp=datetime.now(timezone.utc).isoformat(),
                         elapsedMs=round((time.monotonic()-STARTED)*1000), phase=PHASE, **values)), flush=True)


def checked_url(url):
    parsed = urlsplit(url)
    if (parsed.scheme != 'https' or parsed.netloc != 'whatson.bfi.org.uk'
            or parsed.path != '/imax/Online/default.asp'):
        raise CollectionError('UNEXPECTED_PAGE_URL')
    return url


async def bridge(command, **values):
    proc = await asyncio.create_subprocess_exec('node', '--import', 'tsx', 'scripts/nodriver-parse.ts',
        stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    try:
        out, _ = await asyncio.wait_for(proc.communicate(json.dumps(dict(command=command, **values)).encode()), 30)
    except BaseException:
        if proc.returncode is None:
            proc.kill()
            await proc.wait()
        raise
    result = json.loads(out)
    if proc.returncode or 'error' in result:
        raise CollectionError(result.get('error', 'BRIDGE_ERROR'))
    return result


async def collect():
    global PHASE
    config = json.loads(Path('config/bfi.json').read_text())
    target = checked_url(config['searchUrl'])
    if urlsplit(target).query or config['source'] != 'bfi-imax' or not 1 <= config['maxPages'] <= 100:
        raise CollectionError('INVALID_CONFIG')
    browser = None
    try:
        PHASE = 'launch'
        browser = await asyncio.wait_for(uc.start(headless=True, browser_executable_path=os.environ['NODRIVER_BROWSER_PATH']), 60)
        tab = await browser.get('about:blank')
        version = await tab.send(uc.cdp.browser.get_version())
        log('browser-started', engine='nodriver', version=version[1])
        frame_id = (await tab.send(uc.cdp.page.get_frame_tree())).frame.id_
        response_future = None

        async def received(event):
            if (event.type_ == uc.cdp.network.ResourceType.DOCUMENT and event.frame_id == frame_id
                    and response_future is not None and not response_future.done()):
                response_future.set_result(event.response)

        tab.add_handler(uc.cdp.network.ResponseReceived, received)
        await tab.send(uc.cdp.network.enable())

        async def navigate(action):
            nonlocal response_future
            response_future = asyncio.get_running_loop().create_future()
            await asyncio.wait_for(action(), 60)
            response = await asyncio.wait_for(response_future, 60)
            headers = {k.lower(): str(v) for k,v in response.headers.items()}
            ray = headers.get('cf-ray', '')
            log('http-response', httpStatus=int(response.status), responseReceived=True,
                cloudflareChallenge=headers.get('cf-mitigated') == 'challenge',
                cloudflareServer=headers.get('server') == 'cloudflare',
                **({'cloudflareRay':ray} if re.fullmatch(r'[a-fA-F0-9]{16,32}-[A-Z]{3}',ray) else {}))
            if not 200 <= response.status < 300 or headers.get('cf-mitigated') == 'challenge':
                raise CollectionError('BFI_BLOCKED')
            checked_url(response.url)
            return response.url

        PHASE = 'search-home'
        url = await navigate(lambda: tab.get(target))
        await tab.select(SELECTOR, timeout=30)
        await bridge('home', html=await tab.get_content(), url=url)
        PHASE = 'search-all'
        submit = await tab.select(SELECTOR+' input[type="submit"]', timeout=30)
        url = await navigate(submit.click)
        payload = dict(schemaVersion=1, source='bfi-imax', collectedAt='', complete=False,
                       pages=[], expectedPages=0, performances=[])
        for number in range(1, config['maxPages']+1):
            PHASE = 'wait-for-rows'
            await tab.select('div.result-box-item', timeout=30)
            result = await bridge('page', html=await tab.get_content(), url=url, number=number)
            if number == 1:
                payload['expectedPages'] = result['totalPages']
            if payload['expectedPages'] != result['totalPages']:
                raise CollectionError('PAGINATION_CHANGED')
            payload['pages'].append(dict(number=number, count=len(result['rows'])))
            payload['performances'].extend(result['rows'])
            log('page-collected', page=number, rows=len(result['rows']), hasNext=bool(result['next']))
            if not result['next']:
                break
            if number == config['maxPages']:
                raise CollectionError('PAGE_LIMIT_EXCEEDED')
            PHASE = 'navigate'
            next_url = checked_url(result['next'])
            url = await navigate(lambda: tab.get(next_url))
        PHASE = 'validate'
        payload.update(complete=True, collectedAt=datetime.now(timezone.utc).isoformat())
        await bridge('validate', payload=payload)
        log('collection-complete', collected=len(payload['performances']), pages=len(payload['pages']))
        # Comparison only: no payload file, production hash update, or AWS delivery.
    finally:
        if browser:
            browser.stop()


async def main():
    try:
        await asyncio.wait_for(collect(), 600)
    except Exception as error:
        log('collection-failed', code=str(error) if isinstance(error,CollectionError) else 'EXECUTION_ERROR',
            errorType=type(error).__name__)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(uc.loop().run_until_complete(main()))
