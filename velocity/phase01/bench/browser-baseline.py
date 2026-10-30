"""Reproducible local Chromium cold-document parse/navigation smoke baseline.
No network calls permitted. Not a real-user performance metric."""
import json, hashlib, time, http.server, threading
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path('/mnt/data')
FILES={'fairycodex_v36_1': ROOT/'fairycodex_v36_1_market_fix.html','central_market_uploaded': ROOT/'bdo-market-intelligence.html'}
class Quiet(http.server.SimpleHTTPRequestHandler):
 def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(ROOT),**kwargs)
 def log_message(self,*args):pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Quiet)
threading.Thread(target=server.serve_forever,daemon=True).start()
PORT=server.server_port
result={'profile':'chromium headless, page.set_content (not HTTP navigation), external requests blocked, 1440x900 desktop; not production RUM','measurements':{}}
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True, executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 for name,path in FILES.items():
  if not path.exists():continue
  rows=[]
  for i in range(5):
   page=browser.new_page(viewport={'width':1440,'height':900},service_workers='block')
   page.route('http://**/*',lambda route:route.continue_() if route.request.url.startswith(f'http://127.0.0.1:{PORT}/') else route.abort())
   page.route('https://**/*',lambda route:route.abort())
   errors=[]
   page.on('pageerror',lambda e: errors.append(str(e)))
   t=time.perf_counter()
   page.set_content(path.read_text(encoding='utf-8'),wait_until='domcontentloaded',timeout=12000)
   t1=time.perf_counter()
   rows.append({'set_content_domcontentloaded_ms':round((t1-t)*1000,2),'js_heap_used_mb':round(page.evaluate('performance.memory.usedJSHeapSize')/1048576,2) if page.evaluate('!!performance.memory') else None,'page_errors':errors[:3]})
   page.close()
  result['measurements'][name]={'size_bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'runs':rows,'median_set_content_ms':sorted(x['set_content_domcontentloaded_ms'] for x in rows)[2]}
 browser.close()
out=ROOT/'fairycodex_velocity_phase01/bench/baseline_results.json';out.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))