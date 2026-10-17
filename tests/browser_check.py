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
WAKEON = "try{ if(!localStorage.getItem('jarvis.settings.v1')) localStorage.setItem('jarvis.settings.v1', JSON.stringify({wake:true})); localStorage.setItem('jarvis.wakeDefault.v3','1'); }catch(e){}"
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
        ctx2.add_init_script(WAKEON)
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
        results['wake_toggle_on_when_chosen'] = page2.is_checked('#wakeToggle')
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
        ctx4.add_init_script(WAKEON)
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
            page4.wait_for_timeout(1300)
            n = page4.evaluate('window.jarvisAnswerCount || 0')
            page4.evaluate('t => window.__say(t)', t)
            if wait_answer:
                page4.wait_for_function('n => (window.jarvisAnswerCount || 0) > n', arg=n, timeout=8000)
                return page4.evaluate('window.jarvisLastAnswer')
        results['talk_math'] = say('hey jarvis what is 25% of 200')
        results['talk_math_spoken'] = page4.evaluate('window.__spoken.indexOf("50.") !== -1')
        results['talk_math_bubble'] = page4.inner_text('#chat')
        page4.wait_for_timeout(int(12000 * 1.1))  # let the follow-up window close
        results['teach_q1'] = say('hey jarvis what is a zorp')
        results['teach_answer'] = say('a made up word')
        results['teach_q2'] = say('hey jarvis what is a zorp')
        results['skip_q'] = say('hey jarvis what is a blarf')
        results['skip_answer'] = say('never mind')
        results['open_spotify'] = say('hey jarvis open spotify')
        results['pulse'] = page4.evaluate('!!document.querySelector("#hudLaunchers a.pulse")')
        page4.wait_for_timeout(int(12000 * 1.1))
        before = page4.evaluate('window.__spoken.length')
        page4.evaluate('window.jarvisLastTrigger = null')
        say('jarvis', wait_answer=False)
        page4.wait_for_function('!!window.jarvisLastTrigger', timeout=8000)
        results['jarvis_alone_greets'] = page4.evaluate('window.jarvisLastTrigger.source') + ' | ' + page4.inner_text('#greetText')
        results['jarvis_alone_silent'] = page4.evaluate('window.__spoken.length') == before
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
        ctx6.add_init_script(WAKEON)
        ctx6.add_init_script('''(function(){ window.__starts=0;
          function R(){} R.prototype.start=function(){ var s=this; window.__starts++; window.__r=s; setTimeout(function(){ s.onstart&&s.onstart(); },20); };
          R.prototype.stop=function(){ var s=this; setTimeout(function(){ s.onend&&s.onend(); },10); }; R.prototype.abort=R.prototype.stop;
          window.SpeechRecognition=undefined; window.webkitSpeechRecognition=R; })();''')
        page6 = ctx6.new_page()
        page6.on('pageerror', lambda e: errors.append('pageerror6: ' + str(e)))
        page6.goto(BASE, wait_until='load')
        page6.click('#startBtn')
        page6.wait_for_function('window.__starts === 1', timeout=5000)
        page6.wait_for_timeout(200)
        page6.evaluate("window.__r.onerror({error:'not-allowed'}); window.__r.onend()")
        page6.wait_for_selector('#tapListenBtn:not([hidden])', timeout=3000)
        page6.wait_for_timeout(1500)
        results['fatal_no_auto_restart'] = page6.evaluate('window.__starts') == 1
        page6.click('#tapListenBtn')
        results['tap_listen_restarts'] = page6.evaluate('window.__starts') == 2 and page6.is_hidden('#tapListenBtn')
        # Phase 7: mishear only in alternative #2 still wakes; Tap to talk skips the wake word; live transcript.
        ctx7 = browser.new_context(viewport={'width': 390, 'height': 844})
        ctx7.add_init_script(WAKEON)
        ctx7.add_init_script('''(function(){ window.__spoken=[]; window.__starts=0;
          function R(){} R.prototype.start=function(){ var s=this; window.__starts++; window.__r=s; s.live=true; s.list=[]; setTimeout(function(){ s.onstart&&s.onstart(); },20); };
          R.prototype.stop=function(){ var s=this; if(!s.live) return; s.live=false; setTimeout(function(){ s.onend&&s.onend(); },10); }; R.prototype.abort=R.prototype.stop;
          window.__sayAlts=function(alts){ var r=window.__r; var res=alts.map(function(t){return {transcript:t,confidence:0.5};}); res.isFinal=true; r.list.push(res); r.onresult({resultIndex:r.list.length-1,results:r.list}); };
          window.SpeechRecognition=undefined; window.webkitSpeechRecognition=R;
          var ss=window.speechSynthesis; ss.speak=function(u){ window.__spoken.push(u.text); setTimeout(function(){ u.onend&&u.onend(); },30); }; ss.cancel=function(){}; })();''')
        page7 = ctx7.new_page()
        page7.on('pageerror', lambda e: errors.append('pageerror7: ' + str(e)))
        page7.goto(BASE, wait_until='load')
        page7.click('#startBtn')
        page7.wait_for_function('window.jarvisNovaReady === true', timeout=20000)
        page7.wait_for_function('window.__r && window.__r.live', timeout=5000); page7.wait_for_timeout(250)
        page7.evaluate("window.__sayAlts(['hey garbage what is 25% of 200', 'hey jarvis what is 25% of 200'])")
        page7.wait_for_function('(window.jarvisAnswerCount||0) >= 1', timeout=8000)
        results['alt_wake_answer'] = page7.evaluate('window.jarvisLastAnswer')
        results['live_heard'] = page7.inner_text('#liveHeard')
        page7.wait_for_timeout(9500)
        page7.evaluate("document.getElementById('hudTalkBtn').click()")  # legacy button, hidden since v7 (Hold to talk replaces it)
        results['ptt_restarted'] = page7.evaluate('window.__starts') >= 2
        page7.wait_for_function('window.__r && window.__r.live', timeout=5000); page7.wait_for_timeout(100)
        page7.evaluate("window.__sayAlts(['what is 3 + 4'])")
        page7.wait_for_function('(window.jarvisAnswerCount||0) >= 2', timeout=8000)
        results['ptt_answer'] = page7.evaluate('window.jarvisLastAnswer')
        results['ptt_spoken'] = page7.evaluate('window.__spoken.indexOf(window.jarvisLastAnswer) !== -1')
        # Phase 8: "hey jarvis" alone, recognition ends (onend) in between, then a separate question.
        page8 = ctx7.new_page()
        page8.on('pageerror', lambda e: errors.append('pageerror8: ' + str(e)))
        page8.goto(BASE, wait_until='load')
        page8.click('#startBtn')
        page8.wait_for_function('window.jarvisNovaReady === true', timeout=20000)
        page8.wait_for_function('window.__r && window.__r.live', timeout=5000); page8.wait_for_timeout(250)
        n0 = page8.evaluate('window.__spoken.length')
        page8.evaluate("window.__sayAlts(['hey jarvis'])")
        page8.wait_for_function("window.jarvisLastTrigger && window.jarvisLastTrigger.source.indexOf('voice') === 0", timeout=5000)
        results['split_wake_silent'] = page8.evaluate('window.__spoken.length') == n0
        page8.evaluate("window.__r.stop()")  # iOS ends the session between phrases
        page8.wait_for_function("window.jarvisTapShown === 'ask'", timeout=3000)
        results['split_tap_to_ask_shown'] = True
        page8.wait_for_function('window.__r && window.__r.live', timeout=8000); page8.wait_for_timeout(100)
        page8.evaluate("window.__sayAlts(['what is 25% of 200'])")
        page8.wait_for_function('(window.jarvisAnswerCount||0) >= 1', timeout=8000)
        results['split_answer'] = page8.evaluate('window.jarvisLastAnswer')
        results['split_spoken'] = page8.evaluate("window.__spoken.indexOf('50.') !== -1")
        # Same session, interim only: sent after ~1.2 s of silence.
        page8.wait_for_timeout(13000)
        page8.evaluate('''(function(){ var r=window.__r; var a=[{transcript:'hey jarvis what is 3 + 4',confidence:0.5}]; a.isFinal=false; r.list.push(a); r.onresult({resultIndex:r.list.length-1,results:r.list}); })()''')
        page8.wait_for_function('(window.jarvisAnswerCount||0) >= 2', timeout=5000)
        results['interim_answer'] = page8.evaluate('window.jarvisLastAnswer')
        # Phase 9 (v7): Hold to talk with Safari speech (stubbed). Hands-free wake is off by default.
        ctx9 = browser.new_context(viewport={'width': 390, 'height': 844})
        ctx9.add_init_script('''(function(){ window.__spoken=[]; window.__recs=0; window.__mode=window.__mode||'ok';
          function R(){ window.__recs++; } R.prototype.start=function(){ var s=this; window.__r=s;
            if (window.__mode==='fail'){ setTimeout(function(){ s.onerror&&s.onerror({error:'service-not-allowed'}); s.onend&&s.onend(); },30); return; }
            setTimeout(function(){ s.onstart&&s.onstart(); },20);
            setTimeout(function(){ var a=[{transcript:'what is 25% of 200',confidence:0.9}]; a.isFinal=true; s.onresult&&s.onresult({resultIndex:0,results:[a]}); },200); };
          R.prototype.stop=function(){ var s=this; setTimeout(function(){ s.onend&&s.onend(); },20); }; R.prototype.abort=R.prototype.stop;
          window.SpeechRecognition=undefined; window.webkitSpeechRecognition=R;
          var ss=window.speechSynthesis; ss.speak=function(u){ window.__spoken.push(u.text); setTimeout(function(){ u.onend&&u.onend(); },30); }; ss.cancel=function(){}; })();''')
        page9 = ctx9.new_page()
        page9.on('console', lambda m: errors.append('console9: ' + m.text) if m.type == 'error' else None)
        page9.on('pageerror', lambda e: errors.append('pageerror9: ' + str(e)))
        page9.goto(BASE, wait_until='load')
        results['v7_wake_default_off'] = not page9.is_checked('#wakeToggle')
        results['v7_engine_tab'] = page9.evaluate('JarvisTalk.engine()')
        states = []
        page9.expose_function('__st', lambda s: states.append(s))
        page9.evaluate("JarvisTalk.machine.on(function(s){ window.__st(s); })")
        page9.dispatch_event('#holdBtn', 'pointerdown', {'button': 0, 'pointerId': 1})
        page9.wait_for_timeout(900)
        page9.dispatch_event('#holdBtn', 'pointerup', {'button': 0, 'pointerId': 1})
        page9.wait_for_function("(window.jarvisAnswerCount||0) >= 1 && window.jarvisTalkState === 'idle'", timeout=25000)
        results['v7_safari_answer'] = page9.evaluate('window.jarvisLastAnswer')
        results['v7_safari_spoken'] = page9.evaluate("window.__spoken.indexOf('50.') !== -1")
        results['v7_safari_heard'] = page9.inner_text('#heardLine')
        results['v7_states'] = list(states)
        # Safari speech refuses (as in a Home Screen app) -> switches to on-device for next time.
        page9.evaluate("window.__mode='fail'")
        page9.dispatch_event('#holdBtn', 'pointerdown', {'button': 0, 'pointerId': 1})
        page9.wait_for_timeout(700)
        page9.dispatch_event('#holdBtn', 'pointerup', {'button': 0, 'pointerId': 1})
        page9.wait_for_function("window.jarvisTalkState === 'idle'", timeout=8000)
        page9.wait_for_timeout(200)
        results['v7_fallback_engine'] = page9.evaluate('JarvisTalk.engine()')
        results['v7_fallback_msg'] = page9.inner_text('#talkState')
        # Home Screen app: on-device engine, hands-free wake disabled with an explanation.
        ctx10 = browser.new_context(viewport={'width': 390, 'height': 844})
        ctx10.add_init_script("Object.defineProperty(navigator, 'standalone', {value: true}); window.webkitSpeechRecognition = function(){};")
        page10 = ctx10.new_page()
        page10.on('pageerror', lambda e: errors.append('pageerror10: ' + str(e)))
        page10.goto(BASE, wait_until='load')
        results['v7_standalone_engine'] = page10.evaluate('JarvisTalk.engine()')
        results['v7_standalone_wake_disabled'] = page10.is_disabled('#wakeToggle')
        results['v7_standalone_note'] = page10.text_content('#wakeNote')
        browser.close()
        # Phase 11 (v7): on-device Whisper with a spoken WAV as the fake microphone.
        QWAV = os.path.join(ROOT, 'test', 'question.wav')
        b2 = p.chromium.launch(args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
                                     '--use-file-for-fake-audio-capture=' + QWAV, '--autoplay-policy=no-user-gesture-required'])
        ctx11 = b2.new_context(viewport={'width': 390, 'height': 844}, permissions=['microphone'])
        ctx11.add_init_script("window.__spoken=[]; var ss=window.speechSynthesis; ss.speak=function(u){ window.__spoken.push(u.text); setTimeout(function(){ u.onend&&u.onend(); },30); }; ss.cancel=function(){}; localStorage.setItem('jarvis.engine.v1','local');")
        page11 = ctx11.new_page()
        page11.on('console', lambda m: errors.append('console11: ' + m.text) if m.type == 'error' else None)
        page11.on('pageerror', lambda e: errors.append('pageerror11: ' + str(e)))
        page11.goto(BASE, wait_until='load')
        page11.dispatch_event('#holdBtn', 'pointerdown', {'button': 0, 'pointerId': 1})
        page11.wait_for_timeout(4500)
        results['v7_local_mic_open_while_held'] = page11.evaluate('window.jarvisMicOpen === true')
        page11.dispatch_event('#holdBtn', 'pointerup', {'button': 0, 'pointerId': 1})
        page11.wait_for_function("(window.jarvisAnswerCount||0) >= 1 || (window.jarvisTalkState === 'idle' && !!window.jarvisTalkError)", timeout=180000)
        results['v7_local_heard'] = page11.evaluate('window.jarvisHeard')
        results['v7_local_answer'] = page11.evaluate('window.jarvisLastAnswer')
        results['v7_local_spoken'] = page11.evaluate("window.__spoken.indexOf('50.') !== -1")
        results['v7_local_mic_released'] = page11.evaluate("!!window.jarvisLastStream && window.jarvisLastStream.getTracks().every(function(t){ return t.readyState === 'ended'; })")
        results['v7_local_error'] = page11.evaluate('window.jarvisTalkError || ""')
        b2.close()
        results['console_errors'] = errors
finally:
    srv.terminate()

print(json.dumps(results, indent=2))
ok = (results.get('service_worker_active') and results.get('manifest_name') == 'Jarvis'
      and results.get('trigger') == 'double clap' and 'Welcome home' in results.get('greeting', '')
      and results.get('wake_toggle_on_when_chosen') and str(results.get('wake_trigger','')).startswith('voice')
      and 'Yes, sir?' in results.get('wake_greeting', '') and results.get('wake_buttons', 0) > 0
      and 'not available' in results.get('unsupported_note', '')
      and results.get('talk_math') == '50.' and results.get('talk_math_spoken')
      and 'what do you mean by it' in str(results.get('teach_q1'))
      and str(results.get('teach_answer','')).startswith('got it') and 'a made up word' in str(results.get('teach_q2'))
      and str(results.get('skip_answer','')).startswith('ok. skipped')
      and results.get('open_spotify') == 'Tap to open Spotify, sir.' and results.get('pulse')
      and 'Yes, sir?' in results.get('jarvis_alone_greets', '') and results.get('jarvis_alone_silent') and results.get('jarvis_alone_no_nova')
      and results.get('typed_math') == '50.' and results.get('typed_math_spoken')
      and 'not available' in results.get('nomic_wake_note', '')
      and results.get('fatal_no_auto_restart') and results.get('tap_listen_restarts')
      and results.get('alt_wake_answer') == '50.' and 'Heard' in results.get('live_heard', '')
      and results.get('ptt_restarted') and results.get('ptt_answer') == '7.' and results.get('ptt_spoken')
      and results.get('split_wake_silent') and results.get('split_tap_to_ask_shown')
      and results.get('split_answer') == '50.' and results.get('split_spoken') and results.get('interim_answer') == '7.'
      and results.get('v7_wake_default_off') and results.get('v7_engine_tab') == 'safari'
      and results.get('v7_safari_answer') == '50.' and results.get('v7_safari_spoken') and 'what is 25% of 200' in results.get('v7_safari_heard', '')
      and results.get('v7_states') == ['listening', 'thinking', 'speaking', 'idle']
      and results.get('v7_fallback_engine') == 'local' and 'on-device' in results.get('v7_fallback_msg', '')
      and results.get('v7_standalone_engine') == 'local' and results.get('v7_standalone_wake_disabled')
      and results.get('v7_local_mic_open_while_held') and results.get('v7_local_answer') == '50.' and results.get('v7_local_spoken')
      and results.get('v7_local_mic_released')
      and not results.get('console_errors'))
print('BROWSER CHECK:', 'PASS' if ok else 'FAIL')
sys.exit(0 if ok else 1)
