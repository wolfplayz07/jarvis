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
        results['console_errors'] = errors
        browser.close()
finally:
    srv.terminate()

print(json.dumps(results, indent=2))
ok = (results.get('service_worker_active') and results.get('manifest_name') == 'Jarvis'
      and results.get('trigger') == 'double clap' and 'Welcome home' in results.get('greeting', '')
      and not results.get('console_errors'))
print('BROWSER CHECK:', 'PASS' if ok else 'FAIL')
sys.exit(0 if ok else 1)
