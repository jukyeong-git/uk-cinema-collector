"""Read-only accessibility probe; never books or calls the alert receiver."""
import json
from curl_cffi import requests
from bs4 import BeautifulSoup
failed = False
with requests.Session(impersonate='chrome') as session:
    for name, slug in [('Leicester Square','x06v1-cineworld-cinema-london-leicester-square'),('Enfield','x078z-cineworld-cinema-london-enfield')]:
        try:
            r = session.get('https://www.cineworld.co.uk/cinemas/'+slug+'/',timeout=30,allow_redirects=False)
            soup = BeautifulSoup(r.text,'html.parser')
            title = soup.title.get_text().lower() if soup.title else ''
            blocked = r.status_code != 200 or any(s in title for s in ['attention required','just a moment'])
            print(json.dumps(dict(cinema=name,status=r.status_code,blocked=blocked,
                cfMitigated=r.headers.get('cf-mitigated'),cfRay=r.headers.get('cf-ray'),
                bytes=len(r.content),cookieCount=len(session.cookies),imaxMention='imax' in soup.get_text().lower(),
                jsonScriptTypes=[s.get('type') for s in soup.select('script[type]') if 'json' in s.get('type','')],
                bookingLinkCount=sum('booking' in a.get('href','').lower() for a in soup.select('a[href]')))),flush=True)
            failed = failed or blocked
        except Exception as error:
            print(json.dumps(dict(cinema=name,errorType=type(error).__name__)),flush=True)
            failed = True
raise SystemExit(1 if failed else 0)
