"""WebKit (Safari engine) check for v7. Serves Jarvis + Nova like GitHub Pages, then:
 1) mic denied -> the type box still answers "50." and speaks it
 2) Hold to talk with the on-device Whisper engine, a spoken WAV fed in as the microphone -> "50."
Run: python tests/webkit_check.py   (BASE=https://... to run against a live site)
"""
import os, sys, json, subprocess, time, socket, tempfile
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(os.environ.get('PORT', '8766'))
NOVA_WEB = os.environ.get('NOVA_WEB', '/workspace/nova-ai-work/Nova-AI/web')
BASE = os.environ.get('BASE')
srv = None
if not BASE:
    SITE = tempfile.mkdtemp(prefix='jarvis-wk-')
    os.symlink(ROOT, os.path.join(SITE, 'jarvis')); os.symlink(NOVA_WEB, os.path.join(SITE, 'Nova-AI'))
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=SITE,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(50):
        try: socket.create_connection(('127.0.0.1', PORT), 0.2).close(); break
        except OSError: time.sleep(0.1)
    BASE = f'http://127.0.0.1:{PORT}/jarvis/'
WAV = BASE + 'test/question.wav'
SPY = "window.__spoken=[];var ss=window.speechSynthesis;if(ss){ss.speak=function(u){window.__spoken.push(u.text);setTimeout(function(){u.onend&&u.onend();},30);};ss.cancel=function(){};}"
DENY = "navigator.mediaDevices.getUserMedia=function(){return Promise.reject(new DOMException('denied','NotAllowedError'));};"
FAKEMIC = """navigator.mediaDevices.getUserMedia=function(){ var ac=new (window.AudioContext||window.webkitAudioContext)();
  return fetch('%s').then(function(r){return r.arrayBuffer();}).then(function(b){return ac.decodeAudioData(b);}).then(function(buf){
    var s=ac.createBufferSource(); s.buffer=buf; s.loop=true; var d=ac.createMediaStreamDestination(); s.connect(d); s.start(); ac.resume(); return d.stream; }); };""" % WAV
UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
R, errors = {}, []
try:
    with sync_playwright() as p:
        b = p.webkit.launch()
        def page(init):
            c = b.new_context(viewport={'width': 393, 'height': 852}, is_mobile=True, has_touch=True, user_agent=UA)
            c.add_init_script(SPY); c.add_init_script(init)
            pg = c.new_page()
            pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
            pg.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
            pg.goto(BASE, wait_until='load'); return pg
        p1 = page(DENY)
        p1.dispatch_event('#holdBtn', 'pointerdown', {'button': 0, 'pointerId': 1}); p1.wait_for_timeout(800)
        p1.dispatch_event('#holdBtn', 'pointerup', {'button': 0, 'pointerId': 1})
        p1.wait_for_function("window.jarvisTalkState === 'idle'", timeout=15000)
        R['denied_error'] = p1.evaluate('window.jarvisTalkError || ""')
        p1.fill('#askInput', 'what is 25% of 200'); p1.press('#askInput', 'Enter')
        p1.wait_for_function('(window.jarvisAnswerCount||0) > 0', timeout=30000)
        R['denied_typed_answer'] = p1.evaluate('window.jarvisLastAnswer')
        R['denied_typed_spoken'] = p1.evaluate("window.__spoken.indexOf('50.') !== -1")
        p2 = page(FAKEMIC)
        R['engine'] = p2.evaluate('JarvisTalk.engine()')
        p2.dispatch_event('#holdBtn', 'pointerdown', {'button': 0, 'pointerId': 1}); p2.wait_for_timeout(4500)
        p2.dispatch_event('#holdBtn', 'pointerup', {'button': 0, 'pointerId': 1})
        p2.wait_for_function("(window.jarvisAnswerCount||0) > 0 || (window.jarvisTalkState === 'idle' && !!window.jarvisTalkError)", timeout=180000)
        R['local_heard'] = p2.evaluate('window.jarvisHeard'); R['local_answer'] = p2.evaluate('window.jarvisLastAnswer')
        R['local_spoken'] = p2.evaluate("window.__spoken.indexOf('50.') !== -1")
        R['local_mic_released'] = p2.evaluate("!!window.jarvisLastStream && window.jarvisLastStream.getTracks().every(function(t){return t.readyState==='ended';})")
        R['console_errors'] = errors
        b.close()
finally:
    if srv: srv.terminate()
print(json.dumps(R, indent=2))
ok = ('microphone' in R.get('denied_error', '') and R.get('denied_typed_answer') == '50.' and R.get('denied_typed_spoken')
      and R.get('engine') == 'local' and R.get('local_answer') == '50.' and R.get('local_spoken') and R.get('local_mic_released')
      and not R.get('console_errors'))
print('WEBKIT CHECK:', 'PASS' if ok else 'FAIL')
sys.exit(0 if ok else 1)
