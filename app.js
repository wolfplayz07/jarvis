/* Jarvis Phone - app logic. Everything runs on the device; no network calls. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var TEST = /[?&]test=1\b/.test(location.search);
  var STORE = 'jarvis.settings.v1';
  var WAKE_DEFAULT_KEY = 'jarvis.wakeDefault.v3';
  var STANDALONE = !!(navigator.standalone || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches));

  var DEFAULT_LAUNCHERS = [
    { name: 'Spotify', url: 'spotify://' },
    { name: 'YouTube', url: 'youtube://' },
    { name: 'Chrome', url: 'googlechrome://' },
    { name: 'Safari', url: 'https://www.apple.com/' }
  ];
  var DEFAULTS = {
    sensitivity: 50,
    greeting: '{greeting}, sir. Welcome home.',
    voiceURI: '',
    rate: 0.95,
    pitch: 0.9,
    shortcutName: 'Jarvis',
    wake: false,
    clap: false,
    launchers: DEFAULT_LAUNCHERS
  };

  function load() {
    var s = {};
    try { s = JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch (e) { s = {}; }
    var out = {};
    for (var k in DEFAULTS) out[k] = (s[k] !== undefined) ? s[k] : DEFAULTS[k];
    if (!Array.isArray(out.launchers)) out.launchers = DEFAULT_LAUNCHERS.slice();
    out.launchers = out.launchers.map(function (l) { return { name: String(l.name || ''), url: String(l.url || '') }; });
    return out;
  }
  var settings = load();
  try { if (!localStorage.getItem(WAKE_DEFAULT_KEY)) { settings.wake = false; localStorage.setItem(WAKE_DEFAULT_KEY, '1'); } } catch (e) { /* ignore */ }
  function save() { try { localStorage.setItem(STORE, JSON.stringify(settings)); } catch (e) { /* private mode */ } }

  function setStatus(t) { $('status').textContent = t; }

  // ---------- greeting ----------
  function partOfDay(d) {
    var h = (d || new Date()).getHours();
    if (h >= 5 && h < 12) return 'Good morning';
    if (h >= 12 && h < 17) return 'Good afternoon';
    return 'Good evening';
  }
  function greetingText(d) {
    var tpl = settings.greeting || DEFAULTS.greeting;
    return tpl.replace(/\{greeting\}/gi, partOfDay(d));
  }

  // ---------- voices ----------
  var voices = [];
  var PREFERRED = ['daniel', 'arthur', 'oliver', 'google uk english male', 'malcolm', 'george', 'fred'];
  function hasTTS() { return typeof window.speechSynthesis !== 'undefined' && typeof window.SpeechSynthesisUtterance !== 'undefined'; }
  function rankVoice(v) {
    var name = (v.name || '').toLowerCase();
    var lang = (v.lang || '').toLowerCase().replace('_', '-');
    for (var i = 0; i < PREFERRED.length; i++) {
      if (name.indexOf(PREFERRED[i]) !== -1 && (lang === 'en-gb' || PREFERRED[i].indexOf('uk') !== -1)) return i;
    }
    if (lang === 'en-gb') return 20 + (/male|man/.test(name) && !/female/.test(name) ? 0 : 1);
    if (lang.indexOf('en') === 0) return 40;
    return 80;
  }
  function bestVoice() {
    if (!voices.length) return null;
    if (settings.voiceURI) {
      for (var i = 0; i < voices.length; i++) if (voices[i].voiceURI === settings.voiceURI) return voices[i];
    }
    var sorted = voices.slice().sort(function (a, b) { return rankVoice(a) - rankVoice(b); });
    return sorted[0];
  }
  function refreshVoices() {
    if (!hasTTS()) { $('voiceSel').innerHTML = '<option>Speech not available</option>'; return; }
    try { voices = window.speechSynthesis.getVoices() || []; } catch (e) { voices = []; }
    var sel = $('voiceSel');
    var chosen = bestVoice();
    var sorted = voices.slice().sort(function (a, b) { return rankVoice(a) - rankVoice(b) || a.name.localeCompare(b.name); });
    sel.innerHTML = '';
    var auto = document.createElement('option');
    auto.value = '';
    auto.textContent = 'Auto (best British male)' + (chosen && !settings.voiceURI ? ' → ' + chosen.name : '');
    sel.appendChild(auto);
    sorted.forEach(function (v) {
      var o = document.createElement('option');
      o.value = v.voiceURI; o.textContent = v.name + ' (' + v.lang + ')';
      sel.appendChild(o);
    });
    sel.value = settings.voiceURI || '';
  }
  // ---------- speech out (iOS-safe) ----------
  // iOS rules this code works around:
  //  1. speechSynthesis must be used once inside a real tap (click / touchend / pointerup), or later
  //     speak() calls from async callbacks are silently dropped. primeSpeech() runs on every tap.
  //  2. After the mic was open, iOS keeps the audio session in record mode and routes speech to the
  //     earpiece (very quiet) or mutes it. setPlayback() switches the session back (iOS 17+).
  //  3. speak() right after cancel() is often dropped; Safari can also get stuck "paused".
  //  4. Utterances can be garbage-collected before they play, so keep a reference.
  // If speech still does not start, Jarvis says so ON SCREEN and offers a tap-to-hear button.
  var primed = false, curUtter = null, lastSpeechText = '';
  function speechMsg(t) {
    var el = $('speechMsg'); if (el) { el.textContent = t || ''; el.hidden = !t; }
    var rb = $('replayBtn'); if (rb) rb.hidden = !t;
    window.jarvisSpeechMsg = t || '';
  }
  function setPlayback() {
    try { if (navigator.audioSession && navigator.audioSession.type !== 'playback') navigator.audioSession.type = 'playback'; } catch (e) { /* older iOS */ }
  }
  function primeSpeech() {
    // Call ONLY from a tap handler. Speaks a silent real utterance so iOS unlocks speech for this page.
    if (!hasTTS()) return;
    try {
      var ss = window.speechSynthesis;
      if (ss.paused) ss.resume();
      if (primed || ss.speaking || ss.pending) return;
      setPlayback();
      var u = new SpeechSynthesisUtterance('.'); u.volume = 0; u.rate = 2;
      u.onstart = function () { primed = true; window.jarvisSpeechPrimed = true; };
      curUtter = u; ss.speak(u);
    } catch (e) { window.jarvisSpeechError = 'prime: ' + (e && e.message); }
  }
  function speak(text, onDone, opts) {
    opts = opts || {};
    if (!hasTTS()) { speechMsg('This browser cannot speak. The reply is shown above.'); if (onDone) onDone(); return false; }
    var ss = window.speechSynthesis, fired = false, started = false, watchdog = null, safety = null;
    lastSpeechText = text;
    var done = function (err) {
      if (fired) return; fired = true; clearTimeout(watchdog); clearTimeout(safety);
      if (err) {
        speechMsg('🔇 Jarvis could not speak (' + err + '). Check the volume and the silent switch, then tap 🔊 to hear it.');
        window.jarvisSpeechError = err;
      }
      if (onDone) { try { onDone(); } catch (e) { /* keep going */ } }
      setTimeout(function () { resumeWake('speaking'); }, 500);
    };
    var go = function () {
      try {
        setPlayback();
        if (ss.paused) ss.resume();
        var u = new SpeechSynthesisUtterance(text);
        var v = bestVoice();
        if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = 'en-GB'; }
        u.rate = Number(settings.rate) || 1;
        u.pitch = Number(settings.pitch) || 1;
        u.volume = 1;
        u.onstart = function () { started = true; primed = true; speechMsg(''); window.jarvisSpeechStarted = (window.jarvisSpeechStarted || 0) + 1; };
        u.onend = function () { done(started ? null : 'no sound started'); };
        u.onerror = function (e) {
          var er = (e && e.error) || 'error';
          done(er === 'interrupted' || er === 'canceled' ? null : er);
        };
        curUtter = u; window.jarvisCurUtter = u; // keep alive (GC bug)
        ss.speak(u);
        window.jarvisLastSpoken = text;
        // iOS drops blocked speech without any event: if it has not started in 2.5 s, say so on screen.
        watchdog = setTimeout(function () {
          if (started || fired) return;
          try { if (ss.paused) ss.resume(); } catch (e) { /* ignore */ }
          setTimeout(function () { if (!started && !fired) { try { ss.cancel(); } catch (e) { /* ignore */ } done('blocked by iPhone'); } }, 700);
        }, 2500);
        safety = setTimeout(function () { done(null); }, Math.min(45000, 6000 + String(text).length * 110));
      } catch (e) { done('error: ' + (e && e.message)); }
    };
    pauseWake('speaking');
    var busy = false;
    try { busy = ss.speaking || ss.pending; } catch (e) { busy = false; }
    if (busy) { try { ss.cancel(); } catch (e) { /* ignore */ } if (opts.sync) go(); else setTimeout(go, 120); } // sync keeps the tap gesture
    else {
      // Voices load late on iOS. If the list is still empty, refresh it once; with no voice object,
      // lang en-GB still makes iOS use its British voice, so speak now rather than wait.
      if (!voices.length) refreshVoices();
      go();
    }
    return true;
  }
  function unlockSpeech() { primeSpeech(); }
  function testVoice() {
    // Runs inside a tap, so it is allowed even if speech was blocked before.
    speechMsg('');
    var t = lastSpeechText && window.jarvisReplayLast ? lastSpeechText : 'Voice check. Can you hear me, sir?';
    window.jarvisReplayLast = false;
    if (!speak(t, null, { noWait: true, sync: true })) setStatus('Speech is not available on this browser.');
  }

  // ---------- launchers ----------
  function safeUrl(u) {
    u = String(u || '').trim();
    if (/^\s*(javascript|data|vbscript):/i.test(u)) return '#';
    return u || '#';
  }
  function renderLaunchers() {
    ['launchers', 'hudLaunchers'].forEach(function (id) {
      var box = $(id); box.innerHTML = '';
      settings.launchers.forEach(function (l) {
        if (!l.url) return;
        var a = document.createElement('a');
        a.className = 'launch'; a.href = safeUrl(l.url); a.textContent = l.name || l.url;
        if (/^https?:/i.test(l.url)) { a.target = '_blank'; a.rel = 'noopener'; }
        box.appendChild(a);
      });
      if (id === 'hudLaunchers') {
        var s = document.createElement('a');
        s.className = 'launch shortcut'; s.href = shortcutUrl(); s.textContent = '⚡ Shortcut “' + settings.shortcutName + '”';
        box.appendChild(s);
      }
    });
    renderEditor();
  }
  function renderEditor() {
    var box = $('editList'); box.innerHTML = '';
    settings.launchers.forEach(function (l, i) {
      var row = document.createElement('div'); row.className = 'item';
      var n = document.createElement('input'); n.value = l.name; n.placeholder = 'Name'; n.setAttribute('aria-label', 'App name');
      var u = document.createElement('input'); u.value = l.url; u.placeholder = 'app:// or https://'; u.setAttribute('aria-label', 'App link');
      u.autocapitalize = 'off'; u.spellcheck = false;
      var del = document.createElement('button'); del.type = 'button'; del.className = 'ghost'; del.textContent = '✕'; del.setAttribute('aria-label', 'Remove');
      n.addEventListener('change', function () { settings.launchers[i].name = n.value.trim(); save(); renderLaunchers(); });
      u.addEventListener('change', function () { settings.launchers[i].url = u.value.trim(); save(); renderLaunchers(); });
      del.addEventListener('click', function () { settings.launchers.splice(i, 1); save(); renderLaunchers(); });
      row.appendChild(n); row.appendChild(u); row.appendChild(del); box.appendChild(row);
    });
  }
  function shortcutUrl() { return 'shortcuts://run-shortcut?name=' + encodeURIComponent(settings.shortcutName || 'Jarvis'); }
  function renderShortcut() {
    $('shortcutBtn').href = shortcutUrl();
    $('shortcutNameLbl').textContent = '⚡ Run iOS Shortcut “' + settings.shortcutName + '”';
    $('helpName').textContent = settings.shortcutName;
  }

  // ---------- HUD ----------
  var hudTimer = null;
  function trigger(source) {
    var byVoice = /^voice/.test(String(source));
    var text = greetingText();
    var hud = $('hud');
    hud.hidden = false; hudOpen(true);
    hud.style.animation = 'none'; void hud.offsetWidth; hud.style.animation = '';
    $('greetText').textContent = text;
    $('hudClock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    var hl = $('hudLaunchers'); hl.classList.remove('show');
    clearTimeout(hudTimer);
    hudTimer = setTimeout(function () { hl.classList.add('show'); }, 1400);
    if (byVoice) {
      // Woken by voice: stay silent and keep the SAME recognition session running, so the very next
      // phrase is the question. (iOS will not restart recognition after speech without a tap.)
      $('greetText').textContent = 'Yes, sir?';
      session.afterGreet(Date.now()); listenHint();
      document.dispatchEvent(new CustomEvent('jarvis:spoken'));
      if (!rec) showTapListen('ask');
    } else speak(text, function () { session.afterGreet(Date.now()); listenHint(); document.dispatchEvent(new CustomEvent('jarvis:spoken')); });
    if (navigator.vibrate) { try { navigator.vibrate([40, 60, 40]); } catch (e) { /* ignore */ } }
    setStatus('Greeting (' + source + ') · ' + new Date().toLocaleTimeString());
    document.dispatchEvent(new CustomEvent('jarvis:trigger', { detail: { source: source, text: text } }));
    window.jarvisLastTrigger = { source: source, text: text, at: Date.now() };
  }
  function closeHud() { $('hud').hidden = true; hudOpen(false); session.close(); listenHint(); }
  // While the HUD is open the main page is hidden, so no old text shows through behind the reply.
  function hudOpen(on) { document.body.classList.toggle('hud-open', !!on); }

  // ---------- Nova brain (talk) ----------
  var session = JarvisBrain.createSession();
  function showHud() {
    var hud = $('hud');
    if (hud.hidden) { hud.hidden = false; hudOpen(true); hud.style.animation = 'none'; void hud.offsetWidth; hud.style.animation = ''; }
    $('hudClock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    $('hudLaunchers').classList.add('show');
  }
  function bubble(who, text) {
    var box = $('chat'); if (!box) return;
    var d = document.createElement('div');
    d.className = 'bubble ' + (who === 'you' ? 'you' : 'jarvis');
    var b = document.createElement('b'); b.textContent = who === 'you' ? 'You' : 'Jarvis';
    var sp = document.createElement('span'); sp.textContent = text;
    d.appendChild(b); d.appendChild(sp); box.appendChild(d);
    while (box.children.length > 12) box.removeChild(box.firstChild);
    $('hud').classList.add('talking');
    box.scrollTop = box.scrollHeight;
    try { d.scrollIntoView({ block: 'nearest' }); } catch (e) { /* old browsers */ }
  }
  function listenHint() {
    var m = session.mode(Date.now()), el = $('chatHint'); if (!el) return;
    el.textContent = m === 'teach' ? 'Teach me: just say the answer (or “skip”)…'
      : m ? 'Listening… no need to say “Jarvis”' : 'Say “Jarvis” to talk';
  }
  function launchByVoice(target) {
    var links = $('hudLaunchers').querySelectorAll('a.launch');
    for (var i = 0; i < links.length; i++) {
      var n = links[i].textContent.toLowerCase();
      if (n.indexOf(target) !== -1 || target.indexOf(n) !== -1) {
        links[i].classList.add('pulse');
        (function (a) { setTimeout(function () { a.classList.remove('pulse'); }, 6000); })(links[i]);
        return links[i].textContent;
      }
    }
    return null;
  }
  var asking = false, askToken = 0;
  function ask(text, via) {
    showHud();
    $('greetText').textContent = '';
    bubble('you', text);
    var target = via !== 'teach' ? JarvisBrain.launchTarget(text) : null;
    var appName = target ? launchByVoice(target) : null;
    if (appName) return say('Tap to open ' + appName + ', sir.', true);
    asking = true;
    var token = ++askToken;
    setStatus('Asking Nova…');
    // Never leave Jarvis stuck "asking": after 25 s give up, say so on screen, and reload Nova.
    var guard = setTimeout(function () {
      if (token !== askToken || !asking) return;
      asking = false; NovaBridge.reset();
      say('Nova took too long to answer. I am reloading my brain, sir. Please ask again.', true);
    }, 25000);
    NovaBridge.ask(text).then(function (answer) {
      clearTimeout(guard); if (token !== askToken || !asking) return;
      asking = false;
      answer = answer || 'i do not know.';
      say(answer, false);
    }).catch(function () {
      clearTimeout(guard); if (token !== askToken || !asking) return;
      asking = false;
      say('My brain, Nova, did not load. Check the connection and try again.', true);
    });
  }
  function say(answer, skipTeach) {
    bubble('jarvis', answer);
    window.jarvisLastAnswer = answer; window.jarvisAnswerCount = (window.jarvisAnswerCount || 0) + 1;
    document.dispatchEvent(new CustomEvent('jarvis:answer', { detail: { text: answer } }));
    var after = function () { document.dispatchEvent(new CustomEvent('jarvis:spoken')); if (skipTeach) session.afterAnswer('', Date.now()); else session.afterAnswer(answer, Date.now()); listenHint(); };
    setStatus('Jarvis answered · ' + new Date().toLocaleTimeString());
    if (!speak(JarvisBrain.speakable(answer), after)) after();
  }
  function heardLine(text, source) {
    if (asking) return;
    var r = session.handle(text, Date.now());
    if (!r) return;
    if (r.type === 'greet') { if (wakeDebounce.fire(Date.now())) trigger(source || ('voice: ' + String(text).trim())); return; }
    wakeDebounce.fire(Date.now());
    ask(r.text, r.via);
  }

  // ---------- microphone + clap ----------
  var audio = null; // {ctx, stream, analyser, buf, timer, raf}
  var detector = JarvisClap.createDetector({ sensitivity: settings.sensitivity / 100 });
  var clapCount = 0;
  var lastLevel = 0, levelHist = [];

  var running = false;
  // Start tap: everything that iOS needs a gesture for happens right here, synchronously,
  // before any mic request. Voice wake and the clap mic never run at the same time.
  function startListening() {
    unlockSpeech();
    loadNova();
    running = true;
    $('startView').hidden = true; $('listenView').hidden = false;
    hideTapListen();
    if (settings.clap) { stopWake(true); setStatus('Clap mode · asking for the microphone…'); return startMic(); }
    setStatus(Rec ? 'Listening · say “Jarvis” (or type below)' : 'Voice not supported in this browser · type below');
    if (!Rec) wakeMsg('Speech recognition is not available in this browser. Hold to talk uses the on-device engine, or type below.');
    else if (settings.wake && !STANDALONE) startWake(); else if (!STANDALONE) wakeMsg('Hands-free wake is off. Hold the 🎙 button to talk, or type below.');
    return Promise.resolve();
  }
  function loadNova() {
    return NovaBridge.load().then(function () { window.jarvisNovaReady = true; }).catch(function () { window.jarvisNovaReady = false; });
  }
  function startMic() {
    if (audio) return Promise.resolve();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus('Microphone not available here. Open in Safari over https.');
      return Promise.resolve();
    }
    setStatus('Asking for the microphone…');
    var AC = window.AudioContext || window.webkitAudioContext;
    var ctx = new AC();
    var resumed = ctx.resume ? ctx.resume() : Promise.resolve();
    return navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    }).catch(function () {
      return navigator.mediaDevices.getUserMedia({ audio: true });
    }).then(function (stream) {
      return resumed.then(function () {
        var src = ctx.createMediaStreamSource(stream);
        var an = ctx.createAnalyser();
        an.fftSize = 1024; an.smoothingTimeConstant = 0;
        src.connect(an);
        audio = { ctx: ctx, stream: stream, analyser: an, buf: new Float32Array(an.fftSize) };
        detector.reset();
        audio.timer = setInterval(tick, 12);
        audio.raf = requestAnimationFrame(draw);
        setStatus('Clap mode · clap twice (or type below)');
      });
    }).catch(function (err) {
      try { ctx.close(); } catch (e) { /* ignore */ }
      setStatus('Mic blocked: ' + (err && err.name ? err.name : 'error') + '. Clap mode needs the microphone. You can still type below.');
    });
  }
  function closeMic() {
    if (!audio) return;
    clearInterval(audio.timer); cancelAnimationFrame(audio.raf);
    audio.stream.getTracks().forEach(function (t) { t.stop(); });
    try { audio.ctx.close(); } catch (e) { /* ignore */ }
    audio = null;
  }
  function stopMic() {
    running = false;
    closeMic();
    stopWake();
    hideTapListen();
    $('startView').hidden = false; $('listenView').hidden = true;
    setStatus('Stopped · tap Start');
  }
  function tick() {
    if (!audio) return;
    if (audio.ctx.state === 'suspended') { audio.ctx.resume().catch(function () {}); }
    var b = audio.buf;
    if (audio.analyser.getFloatTimeDomainData) audio.analyser.getFloatTimeDomainData(b);
    var peak = 0;
    for (var i = 0; i < b.length; i++) { var a = b[i] < 0 ? -b[i] : b[i]; if (a > peak) peak = a; }
    lastLevel = peak;
    var ev = detector.process(peak, performance.now());
    levelHist.push({ l: peak, th: ev.threshold });
    if (levelHist.length > 150) levelHist.shift();
    if (ev.clap) { clapCount++; $('clapCount').textContent = 'claps: ' + clapCount; }
    if (ev.double) trigger('double clap');
  }
  function draw() {
    if (!audio) return;
    var c = $('meter'), g = c.getContext('2d');
    var w = c.width, h = c.height;
    g.clearRect(0, 0, w, h);
    var n = levelHist.length, bw = w / 150;
    for (var i = 0; i < n; i++) {
      var lv = Math.sqrt(levelHist[i].l); // sqrt so quiet sounds are visible
      g.fillStyle = 'rgba(47,224,255,' + (0.35 + 0.65 * (i / n)) + ')';
      g.fillRect(i * bw, h - lv * h, Math.max(1, bw - 1), lv * h);
    }
    var th = Math.sqrt(detector.getThreshold());
    g.strokeStyle = '#ffb347'; g.lineWidth = 2; g.setLineDash([6, 4]);
    g.beginPath(); g.moveTo(0, h - th * h); g.lineTo(w, h - th * h); g.stroke(); g.setLineDash([]);
    audio.raf = requestAnimationFrame(draw);
  }

  // ---------- "Jarvis" / "Hey Jarvis" voice wake ----------
  var Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  var rec = null, wakeWanted = false, wakeFatal = false, restartTry = 0, restartTimer = null;
  var pauses = {};
  var wakeDebounce = JarvisWake.createDebouncer(3000);
  function wakeMsg(t) { var n = $('wakeNote'); if (n) n.textContent = t; var w = $('wakeStatus'); if (w) w.textContent = t; }
  function heard(t, alts, final) {
    var h = $('wakeHeard'); if (h) h.textContent = t ? '“' + t + '”' : '';
    var lv = $('liveHeard');
    if (lv) {
      var more = (alts || []).filter(function (x) { return x && x !== t; }).slice(0, 3);
      lv.textContent = t ? 'Heard' + (final ? '' : ' (still listening)') + ': “' + t + '”' + (more.length ? '  ·  or: ' + more.map(function (x) { return '“' + x + '”'; }).join(', ') : '') : '';
    }
    window.jarvisHeard = t || '';
  }
  // Push-to-talk: the next phrase goes straight to Nova, no wake word needed.
  var ptt = false, pttTimer = null;
  function setPtt(on) {
    ptt = on; clearTimeout(pttTimer);
    ['talkBtn', 'hudTalkBtn'].forEach(function (id) { var b = $(id); if (b) { b.classList.toggle('on', on); b.textContent = on ? '🎙 Listening… speak now' : '🎙 Tap to talk'; } });
    if (on) pttTimer = setTimeout(function () { setPtt(false); }, 10000);
  }
  function talkTap() {
    unlockSpeech(); loadNova();
    if (!Rec) { setStatus('Voice is not available here. Type below.'); var i = $('askInput'); if (i) i.focus(); return; }
    if (!running) { settings.clap = false; $('clapToggle').checked = false; startListening(); }
    if (settings.clap) { settings.clap = false; save(); $('clapToggle').checked = false; closeMic(); }
    try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) { /* ignore */ }
    pauses = {};
    hideTapListen();
    setPtt(true);
    // Restart recognition inside this tap so iOS allows it.
    stopRec(); wakeWanted = true; wakeFatal = false; restartTry = 0; startRec();
  }
  function paused() { for (var k in pauses) if (pauses[k]) return true; return false; }
  function scheduleRestart() {
    clearTimeout(restartTimer);
    if (!wakeWanted || wakeFatal || paused() || !running) return;
    var d = JarvisWake.backoff(restartTry++);
    restartTimer = setTimeout(startRec, d);
  }
  var pendingLine = null, finalTimer = null, doneIndex = 0;
  function finalize() {
    clearTimeout(finalTimer);
    var p = pendingLine; pendingLine = null;
    if (!p) return;
    doneIndex = p.index + 1;
    if (ptt && String(p.text).trim()) {
      setPtt(false);
      if (session.mode(Date.now()) || JarvisWake.matchWake(p.text)) heardLine(p.text, 'talk');
      else heardLine('jarvis ' + p.text, 'talk');
      return;
    }
    heardLine(p.text);
  }
  function showHudPending() { var g = $('greetText'); showHud(); if (g && !g.textContent) g.textContent = '…'; }
  function startRec() {
    if (!Rec || rec || !wakeWanted || wakeFatal || paused()) return;
    try {
      var r = new Rec();
      try { r.continuous = true; } catch (e) { /* not supported */ }
      r.interimResults = true; r.lang = 'en-US';
      try { r.maxAlternatives = 5; } catch (e) { /* ignore */ }
      r.onstart = function () { hideTapListen(); wakeMsg('Listening for “Jarvis”… (clapping works too)'); };
      r.onresult = function (e) {
        restartTry = 0;
        r.__len = e.results.length;
        if (Date.now() < muteUntil) { doneIndex = e.results.length; return; }
        for (var i = e.resultIndex; i < e.results.length; i++) {
          if (i < doneIndex) continue;
          var res = e.results[i], t = (res[0] && res[0].transcript) || '', alts = [];
          for (var a = 0; a < res.length; a++) if (res[a] && res[a].transcript) alts.push(res[a].transcript);
          // Any alternative that contains the wake word wins, so a mishear in #1 still wakes.
          if (!JarvisWake.matchWake(t)) for (var a2 = 1; a2 < alts.length; a2++) if (JarvisWake.matchWake(alts[a2])) { t = alts[a2]; break; }
          heard(t, alts, res.isFinal);
          if (!ptt && JarvisWake.matchWake(t) && !session.mode(Date.now())) showHudPending();
          pendingLine = { text: t, index: i };
          clearTimeout(finalTimer);
          if (e.results[i].isFinal) finalize(); else finalTimer = setTimeout(finalize, 1200);
        }
      };
      r.onerror = function (e) {
        var err = e && e.error;
        if (JarvisWake.isFatalError(err) || err === 'audio-capture') {
          wakeFatal = true;
          wakeMsg('iPhone stopped the listening (' + err + '). Tap “Tap to listen” to start again, or type below.');
          showTapListen();
        }
      };
      r.onend = function () {
        if (rec === r) { rec = null; finalize(); doneIndex = 0; }
        // A question window is open but iOS ended listening: ask for a tap instead of waiting silently.
        if (wakeWanted && !ptt && session.mode(Date.now())) showTapListen('ask');
        scheduleRestart();
      };
      rec = r; doneIndex = 0; pendingLine = null;
      r.start();
    } catch (e) {
      rec = null;
      wakeMsg('Voice wake could not start here. Tap “Tap to listen”, or type below.');
      showTapListen();
    }
  }
  function startWake() {
    if (!Rec) { wakeMsg('Speech recognition is not available in this browser, so voice wake can’t work here. Type below instead.'); return; }
    wakeWanted = true; wakeFatal = false; restartTry = 0;
    startRec();
  }
  function stopRec() { var r = rec; rec = null; clearTimeout(finalTimer); pendingLine = null; clearTimeout(restartTimer); if (r) { try { r.abort ? r.abort() : r.stop(); } catch (e) { /* ignore */ } } }
  function stopWake(quiet) { wakeWanted = false; stopRec(); heard(''); if (!quiet) wakeMsg(Rec ? 'Voice wake off. Type below, or turn on clap mode.' : 'Speech recognition is not available in this browser. Type below instead.'); }
  function showTapListen(kind) {
    ['tapListenBtn', 'hudTapBtn'].forEach(function (id) { var b = $(id); if (!b) return; b.hidden = (id === 'hudTapBtn' && kind !== 'ask'); b.textContent = kind === 'ask' ? '🎙 Tap to ask' : '🎙 Tap to listen'; });
    window.jarvisTapShown = kind || 'listen';
  }
  function hideTapListen() { ['tapListenBtn', 'hudTapBtn'].forEach(function (id) { var b = $(id); if (b) b.hidden = true; }); window.jarvisTapShown = ''; }
  function tapListen() {
    // Called from a tap, so iOS allows recognition to start again.
    unlockSpeech(); hideTapListen();
    if (!running) return startListening();
    if (settings.clap) return;
    settings.wake = true; save(); $('wakeToggle').checked = true;
    stopRec(); wakeWanted = true; wakeFatal = false; restartTry = 0; startRec();
  }
  function typed(e) {
    if (e) e.preventDefault();
    var box = $('askInput'), t = String(box.value || '').trim();
    if (!t) return;
    box.value = '';
    unlockSpeech(); loadNova();
    if (session.mode(Date.now())) heardLine(t, 'typed'); else heardLine('jarvis ' + t, 'typed');
  }
  var muteUntil = 0;
  // Abort before Jarvis speaks and start a NEW recognizer after: on iOS a recognizer kept alive
  // across speechSynthesis stops delivering results (WebKit bug 321436).
  function pauseWake(why) { pauses[why] = true; if (rec) stopRec(); }
  function ignoreUpTo() { if (rec && rec.__len != null) doneIndex = rec.__len; pendingLine = null; clearTimeout(finalTimer); }
  function resumeWake(why) {
    if (!pauses[why]) return; pauses[why] = false; restartTry = 0; if (wakeWanted && !paused()) { clearTimeout(restartTimer); restartTimer = setTimeout(startRec, 150); } }

  // ---------- wire up ----------
  function bind() {
    $('startBtn').addEventListener('click', startListening);
    $('tapListenBtn').addEventListener('click', function () { if (window.jarvisTapShown === 'ask') talkTap(); else tapListen(); });
    $('talkBtn').addEventListener('click', talkTap);
    $('hudTalkBtn').addEventListener('click', talkTap);
    $('hudTapBtn').addEventListener('click', talkTap);
    $('askForm').addEventListener('submit', typed);
    var ct = $('clapToggle'); ct.checked = !!settings.clap;
    ct.addEventListener('change', function () {
      settings.clap = ct.checked; save();
      if (!running) return;
      if (ct.checked) { stopWake(true); startMic(); }
      else { closeMic(); setStatus('Listening · say “Jarvis” (or type below)'); if (settings.wake) startWake(); }
    });
    $('stopBtn').addEventListener('click', stopMic);
    $('testClapBtn').addEventListener('click', function () { trigger('button'); });
    $('hudClose').addEventListener('click', closeHud);

    var sens = $('sens'); sens.value = settings.sensitivity; $('sensOut').textContent = settings.sensitivity;
    sens.addEventListener('input', function () {
      settings.sensitivity = Number(sens.value); $('sensOut').textContent = sens.value;
      detector.setSensitivity(settings.sensitivity / 100); save();
    });

    var tpl = $('greetTpl'); tpl.value = settings.greeting;
    tpl.addEventListener('change', function () { settings.greeting = tpl.value.trim() || DEFAULTS.greeting; tpl.value = settings.greeting; save(); });

    $('voiceSel').addEventListener('change', function () { settings.voiceURI = $('voiceSel').value; save(); refreshVoices(); });
    [['rate', 'rateOut'], ['pitch', 'pitchOut']].forEach(function (p) {
      var el = $(p[0]); el.value = settings[p[0]]; $(p[1]).textContent = Number(settings[p[0]]).toFixed(2);
      el.addEventListener('input', function () { settings[p[0]] = Number(el.value); $(p[1]).textContent = Number(el.value).toFixed(2); save(); });
    });
    $('testVoiceBtn').addEventListener('click', testVoice);
    $('voiceTestBtn').addEventListener('click', testVoice);
    $('replayBtn').addEventListener('click', function () { window.jarvisReplayLast = true; testVoice(); });
    // Every real tap anywhere primes speech (touchend/click are the taps iOS accepts).
    ['touchend', 'click'].forEach(function (ev) { document.addEventListener(ev, primeSpeech, true); });

    var sn = $('shortcutName'); sn.value = settings.shortcutName;
    sn.addEventListener('change', function () { settings.shortcutName = sn.value.trim() || 'Jarvis'; sn.value = settings.shortcutName; save(); renderShortcut(); renderLaunchers(); });

    $('addLauncher').addEventListener('click', function () { settings.launchers.push({ name: 'New app', url: '' }); save(); renderLaunchers(); });
    $('resetLaunchers').addEventListener('click', function () { settings.launchers = DEFAULT_LAUNCHERS.map(function (l) { return { name: l.name, url: l.url }; }); save(); renderLaunchers(); });

    var wt = $('wakeToggle');
    if (Rec && STANDALONE) {
      wt.disabled = true; wt.checked = false; settings.wake = false;
      wakeMsg('Hands-free “Jarvis” is not available in the Home Screen app on iPhone (Apple limitation). Use Hold to talk, or open the link in Safari to try it.');
    } else if (!Rec) {
      wt.disabled = true; wt.checked = false;
      wakeMsg('Speech recognition is not available in this browser, so voice wake can’t work here. Type below, or turn on clap mode.');
    } else {
      wt.checked = !!settings.wake;
      wakeMsg(settings.wake ? 'Tap Start, then say “Jarvis” or “Hey Jarvis”.' : 'Voice wake off. Clap twice to wake Jarvis.');
      wt.addEventListener('change', function () {
        settings.wake = wt.checked; save();
        if (wt.checked) { if (running && !settings.clap) startWake(); else if (!running) wakeMsg('Tap Start to begin listening.'); }
        else stopWake();
      });
    }

    if (hasTTS()) {
      refreshVoices();
      if ('onvoiceschanged' in window.speechSynthesis) window.speechSynthesis.onvoiceschanged = refreshVoices;
      else if (window.speechSynthesis.addEventListener) window.speechSynthesis.addEventListener('voiceschanged', refreshVoices);
      setTimeout(refreshVoices, 700);
    } else refreshVoices();

    document.addEventListener('visibilitychange', function () { if (document.hidden) onHide('hidden'); else onResume('visible'); });
    window.addEventListener('pagehide', function () { onHide('pagehide'); });
    // Back/forward cache: the page is restored frozen, without a reload.
    window.addEventListener('pageshow', function (e) { if (e.persisted) onResume('pageshow'); });
    window.addEventListener('focus', function () { if (wasHidden) onResume('focus'); });

    renderShortcut();
    renderLaunchers();
  }

  // ---------- leaving / coming back ----------
  // iOS freezes or kills the mic, recognizer, AudioContext and speech while Safari is in the background
  // and does not tell the page. On return, rebuild them all instead of waiting for a refresh.
  var wasHidden = false, resumeTimer = null;
  function onHide(why) {
    wasHidden = true;
    pauseWake('hidden');
    stopRec();
    if (audio) { closeMic(); talkPaused.clapHidden = true; }
    try { if (hasTTS()) window.speechSynthesis.cancel(); } catch (e) { /* ignore */ }
    if (window.JarvisTalk && window.JarvisTalk.abort) window.JarvisTalk.abort('hidden');
    if (running) setStatus('Paused while in the background');
    window.jarvisLastHide = why;
  }
  function onResume(why) {
    if (!wasHidden) return;
    clearTimeout(resumeTimer);
    resumeTimer = setTimeout(function () {
      wasHidden = false;
      window.jarvisResumes = (window.jarvisResumes || 0) + 1; window.jarvisLastResume = why;
      // Speech: iOS can come back stuck "paused" and needs a new tap to unlock.
      primed = false;
      try { if (hasTTS()) { var ss = window.speechSynthesis; ss.cancel(); if (ss.paused) ss.resume(); refreshVoices(); } } catch (e) { /* ignore */ }
      speechMsg('');
      setPlayback();
      if (window.JarvisTalk && window.JarvisTalk.reset) window.JarvisTalk.reset('resume');
      asking = false; askToken++;
      NovaBridge.check().then(function (ok) { window.jarvisNovaAlive = ok; });
      pauses.hidden = false;
      if (running && settings.clap && talkPaused.clapHidden) { talkPaused.clapHidden = false; startMic(); }
      else if (running && wakeWanted && !STANDALONE) {
        // iOS usually refuses to restart recognition without a tap: try, and offer the button.
        restartTry = 0; wakeFatal = false; startRec();
        setTimeout(function () { if (!rec) showTapListen(); }, 1500);
      }
      setStatus(running ? 'Back · hold 🎙 to talk' : 'Ready · hold 🎙 to talk');
    }, 250);
  }

  var talkPaused = { clap: false };
  window.JarvisApp = {
    unlockSpeech: unlockSpeech,
    primeSpeech: primeSpeech,
    setPlayback: setPlayback,
    speechMsg: speechMsg,
    loadNova: loadNova,
    stopSpeaking: function () { try { if (hasTTS() && (window.speechSynthesis.speaking || window.speechSynthesis.pending)) window.speechSynthesis.cancel(); } catch (e) { /* ignore */ } },
    // Hold to talk owns the mic: stop voice wake and the clap mic while it runs.
    pauseOthers: function () { pauseWake('talk'); if (audio) { closeMic(); talkPaused.clap = true; } },
    resumeOthers: function () { resumeWake('talk'); if (talkPaused.clap && running && settings.clap) { talkPaused.clap = false; startMic(); } },
    sendLine: function (t) { if (session.mode(Date.now()) || JarvisWake.matchWake(t)) heardLine(t, 'talk'); else heardLine('jarvis ' + t, 'talk'); }
  };
  bind();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).then(function () {
      window.jarvisSW = 'registered';
    }).catch(function (e) { window.jarvisSW = 'failed: ' + (e && e.message); });
  }

  if (TEST) {
    window.jarvisSimulateClap = function () { trigger('simulated'); };
    window.jarvisHear = function (t) { heardLine(t); };
    window.jarvisDebug = {
      level: function () { return lastLevel; },
      threshold: function () { return detector.getThreshold(); },
      claps: function () { return clapCount; },
      voice: function () { var v = bestVoice(); return v ? v.name + ' ' + v.lang : null; }
    };
  }
})();
