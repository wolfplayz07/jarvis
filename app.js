/* Jarvis Phone - app logic. Everything runs on the device; no network calls. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var TEST = /[?&]test=1\b/.test(location.search);
  var STORE = 'jarvis.settings.v1';
  var WAKE_DEFAULT_KEY = 'jarvis.wakeDefault.v2';

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
    wake: true,
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
  try { if (!localStorage.getItem(WAKE_DEFAULT_KEY)) { settings.wake = true; localStorage.setItem(WAKE_DEFAULT_KEY, '1'); } } catch (e) { /* ignore */ }
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
  function speak(text, onDone) {
    if (!hasTTS()) return false;
    try {
      var ss = window.speechSynthesis;
      ss.cancel();
      var u = new SpeechSynthesisUtterance(text);
      var v = bestVoice();
      if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = 'en-GB'; }
      u.rate = Number(settings.rate) || 1;
      u.pitch = Number(settings.pitch) || 1;
      pauseWake('speaking');
      var fired = false;
      var done = function () { if (fired) return; fired = true; if (onDone) { try { onDone(); } catch (e) { /* ignore */ } } setTimeout(function () { resumeWake('speaking'); }, 500); };
      u.onend = done; u.onerror = done;
      setTimeout(done, Math.min(30000, 4000 + String(text).length * 90)); // safety if onend never fires
      ss.speak(u);
      window.jarvisLastSpoken = text;
      return true;
    } catch (e) { if (onDone) onDone(); return false; }
  }
  function unlockSpeech() {
    // iOS only lets speech start after a tap; a silent utterance inside the tap unlocks it.
    if (!hasTTS()) return;
    try { var u = new SpeechSynthesisUtterance(' '); u.volume = 0; window.speechSynthesis.speak(u); } catch (e) { /* ignore */ }
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
    hud.hidden = false;
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
      if (!rec) showTapListen('ask');
    } else speak(text, function () { session.afterGreet(Date.now()); listenHint(); });
    if (navigator.vibrate) { try { navigator.vibrate([40, 60, 40]); } catch (e) { /* ignore */ } }
    setStatus('Greeting (' + source + ') · ' + new Date().toLocaleTimeString());
    document.dispatchEvent(new CustomEvent('jarvis:trigger', { detail: { source: source, text: text } }));
    window.jarvisLastTrigger = { source: source, text: text, at: Date.now() };
  }
  function closeHud() { $('hud').hidden = true; session.close(); listenHint(); }

  // ---------- Nova brain (talk) ----------
  var session = JarvisBrain.createSession();
  function showHud() {
    var hud = $('hud');
    if (hud.hidden) { hud.hidden = false; hud.style.animation = 'none'; void hud.offsetWidth; hud.style.animation = ''; }
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
    box.scrollTop = box.scrollHeight;
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
  var asking = false;
  function ask(text, via) {
    showHud();
    $('greetText').textContent = '';
    bubble('you', text);
    var target = via !== 'teach' ? JarvisBrain.launchTarget(text) : null;
    var appName = target ? launchByVoice(target) : null;
    if (appName) return say('Tap to open ' + appName + ', sir.', true);
    asking = true;
    setStatus('Asking Nova…');
    NovaBridge.ask(text).then(function (answer) {
      asking = false;
      answer = answer || 'i do not know.';
      say(answer, false);
    }).catch(function () {
      asking = false;
      say('My brain, Nova, did not load. Check the connection and try again.', true);
    });
  }
  function say(answer, skipTeach) {
    bubble('jarvis', answer);
    window.jarvisLastAnswer = answer; window.jarvisAnswerCount = (window.jarvisAnswerCount || 0) + 1;
    document.dispatchEvent(new CustomEvent('jarvis:answer', { detail: { text: answer } }));
    var after = function () { if (skipTeach) session.afterAnswer('', Date.now()); else session.afterAnswer(answer, Date.now()); listenHint(); };
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
    if (settings.wake) startWake(); else wakeMsg('Voice wake off. Type below, or turn on clap mode.');
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
  function pauseWake(why) {
    if (why === 'speaking' && rec) { muteUntil = Infinity; ignoreUpTo(); return; } // keep iOS session alive, just ignore our own voice
    pauses[why] = true; if (rec) stopRec();
  }
  function ignoreUpTo() { if (rec && rec.__len != null) doneIndex = rec.__len; pendingLine = null; clearTimeout(finalTimer); }
  function resumeWake(why) {
    if (why === 'speaking' && muteUntil === Infinity) { muteUntil = Date.now() + 400; ignoreUpTo(); if (!rec && wakeWanted && session.mode(Date.now())) showTapListen('ask'); return; }
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
    $('testVoiceBtn').addEventListener('click', function () { if (!speak(greetingText())) setStatus('Speech is not available on this browser.'); });

    var sn = $('shortcutName'); sn.value = settings.shortcutName;
    sn.addEventListener('change', function () { settings.shortcutName = sn.value.trim() || 'Jarvis'; sn.value = settings.shortcutName; save(); renderShortcut(); renderLaunchers(); });

    $('addLauncher').addEventListener('click', function () { settings.launchers.push({ name: 'New app', url: '' }); save(); renderLaunchers(); });
    $('resetLaunchers').addEventListener('click', function () { settings.launchers = DEFAULT_LAUNCHERS.map(function (l) { return { name: l.name, url: l.url }; }); save(); renderLaunchers(); });

    var wt = $('wakeToggle');
    if (!Rec) {
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

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { pauseWake('hidden'); if (running) setStatus('Paused while in the background'); }
      else { if (audio) { audio.ctx.resume().catch(function () {}); setStatus('Clap mode · clap twice (or type below)'); } else if (running) setStatus('Listening · say “Jarvis” (or type below)'); resumeWake('hidden'); }
    });

    renderShortcut();
    renderLaunchers();
  }

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
