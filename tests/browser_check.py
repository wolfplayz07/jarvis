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

srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=ROOT,
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
        page.goto(f'http://127.0.0.1:{PORT}/', wait_until='load')
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
        page2.goto(f'http://127.0.0.1:{PORT}/', wait_until='load')
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
        page3.goto(f'http://127.0.0.1:{PORT}/', wait_until='load')
        results['unsupported_note'] = page3.text_content('#wakeNote')
        results['console_errors'] = errors
        browser.close()
finally:
    srv.terminate()

print(json.dumps(results, indent=2))
ok = (results.get('service_worker_active') and results.get('manifest_name') == 'Jarvis'
      and results.get('trigger') == 'double clap' and 'Welcome home' in results.get('greeting', '')
      and results.get('wake_toggle_default') and str(results.get('wake_trigger','')).startswith('voice')
      and 'Welcome home' in results.get('wake_greeting', '') and results.get('wake_buttons', 0) > 0
      and 'not supported' in results.get('unsupported_note', '')
      and not results.get('console_errors'))
print('BROWSER CHECK:', 'PASS' if ok else 'FAIL')
sys.exit(0 if ok else 1)
