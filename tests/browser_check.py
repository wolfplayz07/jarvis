"""Headless Chromium check: real mic path fed by a synthetic double-clap WAV.
Run: python tests/browser_check.py  (needs `pip install playwright` + `playwright install chromium`)
"""
import os, sys, json, subprocess, time, socket
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WAV = os.path.join(ROOT, 'test', 'double-clap.wav')
PORT = int(os.environ.get('PORT', '8765'))

def wait_port(p):
    for _ in range(50):
        try:
            socket.create_connection(('127.0.0.1', p), 0.2).close(); return
        except OSError:
            time.sleep(0.1)
    raise RuntimeError('server did not start')

# Serve like GitHub Pages: /jarvis/ (this repo) and /Nova-AI/ (Nova's web/ folder) on one origin.
import tempfile
NOVA_WEB = os.environ.get('NOVA_WEB', '/workspace/nova-ai-work/Nova-AI/web')
SITE = tempfile.mkdtemp(prefix='jarvis-site-')
os.symlink(ROOT, os.path.join(SITE, 'jarvis')); os.symlink(NOVA_WEB, os.path.join(SITE, 'Nova-AI'))
BASE = f'http://127.0.0.1:{PORT}/jarvis/'
srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=SITE,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
results = {}
try:
    wait_port(PORT)
    with sync_playwright() as p:
        browser = p.chromium.launch(args=[
            '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
            '--use-file-for-fake-audio-capture=' + WAV, '--autoplay-policy=no-user-gesture-required'])
        ctx = browser.new_context(viewport={'width': 390, 'height': 844}, permissions=['microphone'])
        page = ctx.new_page()
        errors, manifest = [], {}
        page.on('console', lambda m: errors.append('console: ' + m.text) if m.type == 'error' else None)
        page.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
        page.on('response', lambda r: manifest.update(status=r.status, url=r.url) if r.url.endswith('manifest.webmanifest') else None)
        page.goto(BASE, wait_until='load')
        page.evaluate("localStorage.setItem('jarvis.settings.v1', JSON.stringify({clap:true, wake:false})); localStorage.setItem('jarvis.wake.default', '1')")
        page.reload(wait_until='load')
        sw = page.evaluate("""() => navigator.serviceWorker.ready.then(r => !!r.active)""")
        results['service_worker_active'] = sw
        man = page.evaluate("""() => fetch(document.querySelector('link[rel=manifest]').href).then(r => r.json())""")
        results['manifest_name'] = man.get('name'); results['manifest_display'] = man.get('display')
        results['manifest_link_status'] = manifest.get('status')
        page.click('#startBtn')
        page.wait_for_selector('#listenView:not([hidden])', timeout=8000)
        page.wait_for_timeout(600)
        page.wait_for_selector('#hud:not([hidden])', timeout=15000)
        results['greeting'] = page.inner_text('#greetText')
        results['trigger'] = page.evaluate('window.jarvisLastTrigger && window.jarvisLastTrigger.source')
        results['claps_counted'] = page.inner_text('#clapCount')
        page.wait_for_selector('#hudLaunchers.show', timeout=5000)
        results['hud_launchers'] = page.eval_on_selector_all('#hudLaunchers a', 'els => els.map(e => e.textContent + " -> " + e.getAttribute("href"))')
        # Phase 2: stubbed speech recognition that hears "hey jarvis".
        ctx2 = browser.new_context(viewport={'width': 390, 'height': 844}, permissions=['microphone'])
        ctx2.add_init_script('''
          (function(){
            function FakeRec(){ this.continuous=false; this.interimResults=false; this.lang=''; window.__fakeRecs=(window.__fakeRecs||0)+1; }
            FakeRec.prototype.start=function(){ var self=this; window.__fakeRec=self;
              setTimeout(function(){ self.onstart&&self.onstart(); }, 50);
              setTimeout(function(){ var alt={transcript:'hey jarvis', confidence:0.9}; var res=[alt]; res.isFinal=false;
                self.onresult&&self.onresult({resultIndex:0, results:[res]}); }, 400); };
            FakeRec.prototype.stop=function(){ var s=this; setTimeout(function(){ s.onend&&s.onend(); },10); };
            FakeRec.prototype.abort=FakeRec.prototype.stop;
            window.SpeechRecognition = undefined; window.webkitSpeechRecognition = FakeRec;
          })();''')
        page2 = ctx2.new_page()
        page2.on('console', lambda m: errors.append('console2: ' + m.text) if m.type == 'error' else None)
        page2.on('pageerror', lambda e: errors.append('pageerror2: ' + str(e)))
        page2.goto(BASE, wait_until='load')
        page2.evaluate("localStorage.clear()")
        page2.reload(wait_until='load')
        results['wake_toggle_default'] = page2.is_checked('#wakeToggle')
        page2.click('#startBtn')
        page2.wait_for_function("window.jarvisLastTrigger && window.jarvisLastTrigger.source.indexOf('voice') === 0", timeout=8000)
        results['wake_trigger'] = page2.evaluate('window.jarvisLastTrigger.source')
        results['wake_greeting'] = page2.inner_text('#greetText')
        page2.wait_for_selector('#hudLaunchers.show', timeout=5000)
        results['wake_buttons'] = page2.eval_on_selector_all('#hudLaunchers a', 'els => els.length')
        results['wake_heard'] = page2.inner_text('#wakeHeard')
        # no-support fallback
        ctx3 = browser.new_context()
        ctx3.add_init_script('window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined;')
        page3 = ctx3.new_page()
        page3.on('pageerror', lambda e: errors.append('pageerror3: ' + str(e)))
        page3.goto(BASE, wait_until='load')
        results['unsupported_note'] = page3.text_content('#wakeNote')
        # Phase 4: talk to Nova by voice (scripted final transcripts) + speechSynthesis spy.
        ctx4 = browser.new_context(viewport={'width': 390, 'height': 844}, permissions=['microphone'])
        ctx4.add_init_script('''
          (function(){
            window.__spoken=[];
            function FakeRec(){ this.n=0; }
            FakeRec.prototype.start=function(){ var self=this; window.__rec=self; self.live=true; self.list=[];
              setTimeout(function(){ self.onstart&&self.onstart(); }, 20); };
            FakeRec.prototype.stop=function(){ var s=this; if(!s.live) return; s.live=false; if(window.__rec===s) window.__rec=null; setTimeout(function(){ s.onend&&s.onend(); },10); };
            FakeRec.prototype.abort=FakeRec.prototype.stop;
            window.__say=function(t){ var r=window.__rec; if(!r) return false; var res=[{transcript:t,confidence:0.9}]; res.isFinal=true;
              r.list.push(res); r.onresult&&r.onresult({resultIndex:r.list.length-1, results:r.list}); return true; };
            window.SpeechRecognition = undefined; window.webkitSpeechRecognition = FakeRec;
            var ss = window.speechSynthesis;
            ss.speak=function(u){ window.__spoken.push(u.text); setTimeout(function(){ u.onend&&u.onend(); }, 30); };
            ss.cancel=function(){};
          })();''')
        page4 = ctx4.new_page()
        page4.on('console', lambda m: errors.append('console4: ' + m.text) if m.type == 'error' else None)
        page4.on('pageerror', lambda e: errors.append('pageerror4: ' + str(e)))
        page4.goto(BASE, wait_until='load')
        page4.evaluate("localStorage.clear()")
        page4.reload(wait_until='load')
        page4.click('#startBtn')
        page4.wait_for_function('window.jarvisNovaReady === true', timeout=20000)
        def say(t, wait_answer=True):
            page4.wait_for_function('!!window.__rec && window.__rec.live', timeout=8000)
            page4.wait_for_timeout(250)
            n = page4.evaluate('window.jarvisAnswerCount || 0')
            page4.evaluate('t => window.__say(t)', t)
            if wait_answer:
                page4.wait_for_function('n => (window.jarvisAnswerCount || 0) > n', arg=n, timeout=8000)
                return page4.evaluate('window.jarvisLastAnswer')
        results['talk_math'] = say('hey jarvis what is 25% of 200')
        results['talk_math_spoken'] = page4.evaluate('window.__spoken.indexOf("50.") !== -1')
        results['talk_math_bubble'] = page4.inner_text('#chat')
        page4.wait_for_timeout(int(8000 * 1.1))  # let the follow-up window close
        results['teach_q1'] = say('hey jarvis what is a zorp')
        results['teach_answer'] = say('a made up word')
        results['teach_q2'] = say('hey jarvis what is a zorp')
        results['skip_q'] = say('hey jarvis what is a blarf')
        results['skip_answer'] = say('never mind')
        results['open_spotify'] = say('hey jarvis open spotify')
        results['pulse'] = page4.evaluate('!!document.querySelector("#hudLaunchers a.pulse")')
        page4.wait_for_timeout(int(8000 * 1.1))
        before = page4.evaluate('window.__spoken.length')
        page4.evaluate('window.jarvisLastTrigger = null')
        say('jarvis', wait_answer=False)
        page4.wait_for_function('!!window.jarvisLastTrigger', timeout=8000)
        results['jarvis_alone_greets'] = page4.evaluate('window.jarvisLastTrigger.source') + ' | ' + page4.evaluate('window.__spoken[window.__spoken.length-1]')
        results['jarvis_alone_no_nova'] = page4.evaluate('window.jarvisAnswerCount') == 7
        # Phase 5: text box with no mic and no speech recognition at all.
        ctx5 = browser.new_context(viewport={'width': 390, 'height': 844})
        ctx5.add_init_script('''window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined;
          window.__spoken=[]; var ss=window.speechSynthesis; ss.speak=function(u){ window.__spoken.push(u.text); setTimeout(function(){ u.onend&&u.onend(); },30); }; ss.cancel=function(){};
          navigator.mediaDevices.getUserMedia=function(){ return Promise.reject(new DOMException('denied','NotAllowedError')); };''')
        page5 = ctx5.new_page()
        page5.on('pageerror', lambda e: errors.append('pageerror5: ' + str(e)))
        page5.goto(BASE, wait_until='load')
        page5.click('#startBtn')
        results['nomic_status'] = page5.inner_text('#status')
        results['nomic_wake_note'] = page5.inner_text('#wakeStatus')
        page5.fill('#askInput', 'what is 25% of 200'); page5.press('#askInput', 'Enter')
        page5.wait_for_function('(window.jarvisAnswerCount||0) > 0', timeout=20000)
        results['typed_math'] = page5.evaluate('window.jarvisLastAnswer')
        results['typed_math_spoken'] = page5.evaluate('window.__spoken.indexOf("50.") !== -1')
        # Phase 6: iOS kills recognition with not-allowed -> big "Tap to listen" button restarts it.
        ctx6 = browser.new_context(viewport={'width': 390, 'height': 844})
        ctx6.add_init_script('''(function(){ window.__starts=0;
          function R(){} R.prototype.start=function(){ var s=this; window.__starts++; window.__r=s; setTimeout(function(){ s.onstart&&s.onstart(); },20); };
          R.prototype.stop=function(){ var s=this; setTimeout(function(){ s.onend&&s.onend(); },10); }; R.prototype.abort=R.prototype.stop;
          window.SpeechRecognition=undefined; window.webkitSpeechRecognition=R; })();''')
        page6 = ctx6.new_page()
        page6.on('pageerror', lambda e: errors.append('pageerror6: ' + str(e)))
        page6.goto(BASE, wait_until='load')
        page6.click('#startBtn')
        page6.wait_for_function('window.__starts === 1', timeout=5000)
        page6.evaluate("window.__r.onerror({error:'not-allowed'}); window.__r.onend()")
        page6.wait_for_selector('#tapListenBtn:not([hidden])', timeout=3000)
        page6.wait_for_timeout(1500)
        results['fatal_no_auto_restart'] = page6.evaluate('window.__starts') == 1
        page6.click('#tapListenBtn')
        results['tap_listen_restarts'] = page6.evaluate('window.__starts') == 2 and page6.is_hidden('#tapListenBtn')
        results['console_errors'] = errors
        browser.close()
finally:
    srv.terminate()

print(json.dumps(results, indent=2))
ok = (results.get('service_worker_active') and results.get('manifest_name') == 'Jarvis'
      and results.get('trigger') == 'double clap' and 'Welcome home' in results.get('greeting', '')
      and results.get('wake_toggle_default') and str(results.get('wake_trigger','')).startswith('voice')
      and 'Welcome home' in results.get('wake_greeting', '') and results.get('wake_buttons', 0) > 0
      and 'not available' in results.get('unsupported_note', '')
      and results.get('talk_math') == '50.' and results.get('talk_math_spoken')
      and 'what do you mean by it' in str(results.get('teach_q1'))
      and str(results.get('teach_answer','')).startswith('got it') and 'a made up word' in str(results.get('teach_q2'))
      and str(results.get('skip_answer','')).startswith('ok. skipped')
      and results.get('open_spotify') == 'Tap to open Spotify, sir.' and results.get('pulse')
      and 'Welcome home' in results.get('jarvis_alone_greets', '') and results.get('jarvis_alone_no_nova')
      and results.get('typed_math') == '50.' and results.get('typed_math_spoken')
      and 'not available' in results.get('nomic_wake_note', '')
      and results.get('fatal_no_auto_restart') and results.get('tap_listen_restarts')
      and not results.get('console_errors'))
print('BROWSER CHECK:', 'PASS' if ok else 'FAIL')
sys.exit(0 if ok else 1)
