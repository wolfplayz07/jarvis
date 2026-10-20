/*
 * Jarvis Phone - Hold to talk. The main way to talk to Jarvis on iPhone.
 * Engines: Safari speech (webkitSpeechRecognition) in a Safari tab, or the on-device Whisper model
 * (Home Screen app, or whenever Safari speech is missing or fails). The mic is only open while the
 * button is held and is fully released afterwards, so it never fights with Jarvis's voice.
 */
(function (root) {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var P = root.JarvisPTT;
  var App = function () { return root.JarvisApp; };
  var Rec = root.SpeechRecognition || root.webkitSpeechRecognition;
  var standalone = !!(navigator.standalone || (root.matchMedia && root.matchMedia('(display-mode: standalone)').matches));
  var PREF_KEY = 'jarvis.engine.v1', FAIL_KEY = 'jarvis.webSpeechFailed.v1';
  var dbg = { engine: '', perm: 'unknown', error: '', level: 0, model: 'not loaded', lastMs: 0 };
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* private mode */ } }

  var machine = P.createMachine();
  function env() {
    return { webSpeech: !!Rec, standalone: standalone, webSpeechFailed: lsGet(FAIL_KEY) === '1',
      mediaDevices: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia), wasm: typeof WebAssembly === 'object' && typeof Worker === 'function',
      pref: lsGet(PREF_KEY) || 'auto' };
  }
  function engine() { return P.chooseEngine(env()); }

  // ---------- UI ----------
  var LABEL = { idle: 'Idle · hold to talk', listening: 'Listening… let go to send', thinking: 'Thinking…', speaking: 'Speaking… (hold to interrupt)' };
  function render() {
    var s = machine.state, btn = $('holdBtn');
    document.body.setAttribute('data-talk', s);
    if ($('talkState')) $('talkState').textContent = (s === 'listening' && machine.mode === 'toggle') ? 'Listening… tap again to send' : LABEL[s];
    if (btn) { btn.className = 'hold-btn ' + s; btn.setAttribute('aria-pressed', s === 'listening' ? 'true' : 'false'); }
    root.jarvisTalkState = s;
    renderDebug();
  }
  function renderDebug() {
    dbg.engine = engine();
    var el = $('dbgText'); if (!el) return;
    var name = { safari: 'Safari speech', local: 'On-device (Whisper tiny.en)', none: 'none available' }[dbg.engine];
    el.textContent = 'Engine: ' + name + (standalone ? ' · Home Screen app' : ' · browser tab') +
      '\nMic permission: ' + dbg.perm + '\nModel: ' + dbg.model + (dbg.lastMs ? ' · last transcribe ' + dbg.lastMs + ' ms' : '') +
      '\nLevel: ' + (dbg.engine === 'safari' ? 'n/a (Safari speech owns the mic)' : Math.round(dbg.level * 100) + '%') +
      '\nLast error: ' + (dbg.error || 'none');
    var sel = $('engineSel'); if (sel && sel.value !== (lsGet(PREF_KEY) || 'auto')) sel.value = lsGet(PREF_KEY) || 'auto';
  }
  function heardLine(t, final) { var h = $('heardLine'); if (h) h.textContent = t ? 'Heard' + (final ? '' : ' (so far)') + ': “' + t + '”' : ''; root.jarvisHeard = t || ''; }
  function setError(e) { dbg.error = e || ''; root.jarvisTalkError = dbg.error; renderDebug(); }
  function meter(level) {
    dbg.level = level;
    var c = $('pttMeter'); if (!c) return;
    var g = c.getContext('2d'); g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = level > 0.6 ? '#ff5a5a' : '#39c6ff'; g.fillRect(0, 0, Math.min(1, level) * c.width, c.height);
  }
  function checkPermission() {
    try {
      if (navigator.permissions && navigator.permissions.query) {
        navigator.permissions.query({ name: 'microphone' }).then(function (p) {
          dbg.perm = p.state; renderDebug(); p.onchange = function () { dbg.perm = p.state; renderDebug(); };
        }).catch(function () { /* Safari may not support the name */ });
      }
    } catch (e) { /* ignore */ }
  }

  // ---------- on-device engine ----------
  var worker = null, workerReady = false, progress = {}, pending = {}, nextId = 1;
  function ensureWorker() {
    if (worker) return worker;
    worker = new Worker('stt-worker.js?v=7.2', { type: 'module' });
    dbg.model = 'loading…'; showProgress(0, true);
    worker.onmessage = function (e) {
      var m = e.data || {};
      if (m.type === 'progress') {
        var p = m.p || {};
        if (p.file && p.total) progress[p.file] = { loaded: p.loaded || 0, total: p.total };
        if (p.status === 'done' && p.file && progress[p.file]) progress[p.file].loaded = progress[p.file].total;
        var L = 0, T = 0; for (var k in progress) { L += progress[k].loaded; T += progress[k].total; }
        T = Math.max(T, 68e6); // model + runtime is about 68 MB in total; files report sizes one by one
        showProgress(Math.min(1, L / T), true, L, T);
      } else if (m.type === 'ready') {
        workerReady = true; lsSet('jarvis.modelSeen.v1', '1'); dbg.model = 'ready (on this phone)'; showProgress(1, false); renderDebug();
      } else if (m.type === 'text' || m.type === 'error') {
        var cb = pending[m.id]; delete pending[m.id];
        if (m.type === 'error') { setError('on-device: ' + m.error); if (!workerReady) { dbg.model = 'failed to load'; showProgress(0, false); } }
        if (m.ms) dbg.lastMs = m.ms;
        if (cb) cb(m.type === 'text' ? m.text : null);
      }
    };
    worker.onerror = function (e) { setError('on-device worker: ' + (e.message || 'failed')); dbg.model = 'failed to load'; showProgress(0, false); var ids = Object.keys(pending); ids.forEach(function (id) { var cb = pending[id]; delete pending[id]; cb(null); }); };
    worker.postMessage({ type: 'load' });
    return worker;
  }
  function showProgress(f, on, loaded, total) {
    var box = $('modelProgress'); if (!box) return;
    box.hidden = !on;
    var mb = total ? ' (' + Math.round(loaded / 1048576) + ' of about ' + Math.round(total / 1048576) + ' MB)' : '';
    box.textContent = on ? 'Downloading the on-device voice model, one time only: ' + Math.round(f * 100) + '%' + mb : '';
    root.jarvisModelProgress = f;
  }
  function transcribe(pcm16k) {
    return new Promise(function (resolve) {
      var id = nextId++; pending[id] = resolve;
      ensureWorker().postMessage({ type: 'transcribe', id: id, audio: pcm16k }, [pcm16k.buffer]);
    });
  }
  var cap = null; // {ctx, stream, src, proc, chunks, rate, raf}
  var actx = null;
  function startCapture() {
    ensureWorker();
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!actx || actx.state === 'closed') actx = new AC();
    var ctx = actx;
    // A refused resume() is not a mic failure: once the mic is live iOS lets the context run, so retry then.
    var resumed = (ctx.resume ? ctx.resume() : Promise.resolve()).catch(function () { return ctx.resume ? ctx.resume().catch(function () {}) : null; });
    var c = { ctx: ctx, chunks: [], rate: ctx.sampleRate, stopped: false };
    try { if (navigator.audioSession) navigator.audioSession.type = 'play-and-record'; } catch (e) { /* older iOS */ }
    cap = c;
    return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } })
      .then(function (stream) {
        dbg.perm = 'granted'; c.stream = stream; root.jarvisLastStream = stream;
        if (c.stopped) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
        return resumed.then(function () {
          c.src = ctx.createMediaStreamSource(stream);
          c.proc = ctx.createScriptProcessor(4096, 1, 1);
          c.proc.onaudioprocess = function (ev) {
            var d = ev.inputBuffer.getChannelData(0), copy = new Float32Array(d.length), peak = 0;
            for (var i = 0; i < d.length; i++) { copy[i] = d[i]; var a = d[i] < 0 ? -d[i] : d[i]; if (a > peak) peak = a; }
            c.chunks.push(copy); meter(Math.min(1, peak * 1.5));
          };
          var mute = ctx.createGain(); mute.gain.value = 0;
          c.src.connect(c.proc); c.proc.connect(mute); mute.connect(ctx.destination); c.mute = mute;
        });
      }).catch(function (err) {
        dbg.perm = (err && err.name === 'NotAllowedError') ? 'denied' : dbg.perm;
        setError('microphone: ' + (err && err.name ? err.name : 'error'));
        c.failed = true;
      });
  }
  function releaseCapture(c) {
    if (!c) return;
    c.stopped = true;
    try { if (c.proc) { c.proc.onaudioprocess = null; c.proc.disconnect(); } if (c.src) c.src.disconnect(); if (c.mute) c.mute.disconnect(); } catch (e) { /* ignore */ }
    if (c.stream) c.stream.getTracks().forEach(function (t) { t.stop(); });
    // Close (not just suspend) the AudioContext and hand the iOS audio session back to playback,
    // otherwise iOS keeps record mode and Jarvis's voice goes to the earpiece or is muted.
    // Suspend (not close): a new AudioContext made outside a real tap is refused by WebKit, so the
    // same one is reused. The mic tracks are stopped above, which is what ends iOS record mode.
    try { if (c.ctx && c.ctx.suspend && c.ctx.state !== 'closed') c.ctx.suspend(); } catch (e) { /* ignore */ }
    var a = App(); if (a && a.setPlayback) a.setPlayback();
    meter(0);
    root.jarvisMicOpen = false;
  }
  function resample(chunks, rate) {
    var n = 0; chunks.forEach(function (c) { n += c.length; });
    var all = new Float32Array(n), o = 0; chunks.forEach(function (c) { all.set(c, o); o += c.length; });
    if (rate === 16000) return all;
    var ratio = rate / 16000, len = Math.floor(n / ratio), out = new Float32Array(len);
    for (var i = 0; i < len; i++) {
      // average the source samples in each output slot (simple low-pass) then pick
      var s = i * ratio, e = Math.min(n, (i + 1) * ratio), a = Math.floor(s), b = Math.max(a + 1, Math.floor(e)), sum = 0;
      for (var j = a; j < b && j < n; j++) sum += all[j];
      out[i] = sum / Math.max(1, Math.min(b, n) - a);
    }
    return out;
  }
  function finishCapture() {
    var c = cap; cap = null;
    var wait = c && c.stream ? Promise.resolve() : new Promise(function (r) { setTimeout(r, 400); });
    return wait.then(function () {
      releaseCapture(c);
      if (!c || c.failed) return null;
      var pcm = resample(c.chunks, c.rate);
      if (pcm.length < 16000 * 0.3) { setError('too short, hold the button while you speak'); return ''; }
      if (!workerReady) $('talkState').textContent = 'Thinking… (finishing the one-time model download)';
      return transcribe(pcm);
    });
  }

  // ---------- Safari engine ----------
  var srec = null;
  function startSafari() {
    var r = new Rec(), s = { text: '', interim: '', ended: false, error: '', started: false };
    srec = { r: r, s: s };
    try { r.continuous = true; } catch (e) { /* ignore */ }
    r.interimResults = true; r.lang = 'en-US'; try { r.maxAlternatives = 1; } catch (e) { /* ignore */ }
    r.onstart = function () { s.started = true; };
    r.onresult = function (e) {
      var fin = '', intr = '';
      for (var i = 0; i < e.results.length; i++) { var t = (e.results[i][0] && e.results[i][0].transcript) || ''; if (e.results[i].isFinal) fin += t + ' '; else intr += t + ' '; }
      s.text = fin.trim(); s.interim = intr.trim();
      heardLine((s.text + ' ' + s.interim).trim(), false);
    };
    r.onerror = function (e) { s.error = (e && e.error) || 'error'; };
    r.onend = function () { s.ended = true; var a = App(); if (a && a.setPlayback) a.setPlayback(); if (s.done) s.done(); };
    try { r.start(); } catch (e) { s.error = 'start: ' + (e && e.message); s.ended = true; }
  }
  function finishSafari() {
    var x = srec; srec = null;
    if (!x) return Promise.resolve(null);
    return new Promise(function (resolve) {
      var t = null;
      function done() {
        clearTimeout(t);
        var s = x.s, text = (s.text + ' ' + s.interim).trim();
        if (s.error && s.error !== 'no-speech' && s.error !== 'aborted') setError('Safari speech: ' + s.error);
        // Safari speech that never starts, errors, or hangs (WebKit bug 321436) -> use on-device from now on.
        if (!text && (s.error === 'not-allowed' || s.error === 'service-not-allowed' || s.error === 'audio-capture' || !s.started || s.hung)) {
          lsSet(FAIL_KEY, '1'); renderDebug();
          resolve({ fallback: true }); return;
        }
        resolve(text);
      }
      x.s.done = done;
      if (x.s.ended) return done();
      try { x.r.stop(); } catch (e) { /* ignore */ }
      t = setTimeout(function () { x.s.hung = !x.s.text && !x.s.interim; try { x.r.abort(); } catch (e) { /* ignore */ } done(); }, 2500);
    });
  }

  // ---------- flow ----------
  var current = null, idleTimer = null;
  function begin() {
    var a = App(); if (a) { a.unlockSpeech(); a.loadNova(); a.pauseOthers(); a.stopSpeaking(); }
    heardLine(''); setError('');
    current = engine();
    if (current === 'none') { machine.fail('no engine'); setError('No speech engine here. Type below instead.'); return; }
    if (current === 'safari') startSafari(); else startCapture();
    root.jarvisMicOpen = current === 'local';
  }
  function end() {
    var eng = current; current = null;
    var p = eng === 'safari' ? finishSafari() : finishCapture();
    p.then(function (res) {
      if (res && res.fallback) {
        machine.fail('safari failed');
        setError((dbg.error || 'Safari speech did not answer') + ' · switched to on-device. Hold again.');
        ensureWorker(); resumeOthersSoon();
        $('talkState').textContent = 'Safari speech is not available here. Switched to on-device: hold and speak again.';
        return;
      }
      var t = P.cleanTranscript(res || '');
      heardLine(t || (res === null ? '' : '(nothing)'), true);
      if (!machine.heard(t)) { if (res !== null && !dbg.error) setError('did not catch that, try again'); resumeOthersSoon(); return; }
      var a = App(); if (!a) { machine.fail('no app'); return; }
      a.sendLine(t);
      clearTimeout(idleTimer);
      idleTimer = setTimeout(function () { if (machine.state === 'thinking') machine.fail('no answer'); }, 25000);
    });
  }
  function resumeOthersSoon() { var a = App(); if (a) setTimeout(function () { if (machine.state === 'idle') a.resumeOthers(); }, 300); }
  machine.on(function (s, prev) {
    render();
    if (s === 'listening' && prev !== 'listening') begin();
    if (prev === 'listening' && s === 'thinking') end();
    if (s === 'idle') resumeOthersSoon();
  });
  document.addEventListener('jarvis:answer', function () { if (machine.state === 'thinking') machine.answered(); });
  document.addEventListener('jarvis:spoken', function () { if (machine.state === 'speaking' || machine.state === 'thinking') machine.spoken(); });

  function bind() {
    var btn = $('holdBtn'); if (!btn) return;
    var down = false;
    function onDown(e) { if (e.button != null && e.button > 0) return; e.preventDefault(); down = true; try { btn.setPointerCapture && e.pointerId != null && btn.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ } machine.press(Date.now()); }
    function onUp(e) { if (!down) return; down = false; e.preventDefault(); var a = App(); if (a && a.primeSpeech) a.primeSpeech(); machine.release(Date.now()); }
    if (root.PointerEvent) {
      btn.addEventListener('pointerdown', onDown); btn.addEventListener('pointerup', onUp); btn.addEventListener('pointercancel', onUp);
    } else {
      btn.addEventListener('touchstart', onDown, { passive: false }); btn.addEventListener('touchend', onUp); btn.addEventListener('mousedown', onDown); btn.addEventListener('mouseup', onUp);
    }
    btn.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    // Keyboard: space/enter acts as a tap toggle.
    btn.addEventListener('keydown', function (e) { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); if (machine.press(Date.now())) machine.release(Date.now()); } });
    var sel = $('engineSel');
    if (sel) sel.addEventListener('change', function () { lsSet(PREF_KEY, sel.value === 'auto' ? null : sel.value); if (sel.value === 'safari') lsSet(FAIL_KEY, null); if (engine() === 'local') ensureWorker(); renderDebug(); });
    var rs = $('resetEngine');
    if (rs) rs.addEventListener('click', function () { lsSet(FAIL_KEY, null); lsSet(PREF_KEY, null); renderDebug(); });
    checkPermission(); render();
    // Start the one-time model download early when on-device is the engine (Home Screen app).
    if (engine() === 'local' && lsGet('jarvis.modelSeen.v1') === '1') ensureWorker();
  }
  // Page hidden / back from the background: drop the mic and recognizer and go back to Idle.
  function abort(why) {
    clearTimeout(idleTimer);
    var c = cap; cap = null; if (c) releaseCapture(c);
    var x = srec; srec = null; if (x) { try { x.r.onend = null; x.r.abort(); } catch (e) { /* ignore */ } }
    current = null;
    // iOS can leave the context "interrupted" after the background; a fresh one is made on the next hold.
    if (actx && actx.state !== 'running' && actx.state !== 'suspended') { try { actx.close(); } catch (e) { /* ignore */ } actx = null; }
    if (machine.state !== 'idle') machine.reset();
    root.jarvisMicOpen = false;
    meter(0);
  }
  function reset(why) {
    abort(why);
    // A Safari speech failure right after coming back is usually iOS, not a real lack of support:
    // try Safari speech again instead of switching to the 70 MB on-device model for good.
    if (!standalone) lsSet(FAIL_KEY, null);
    heardLine(''); setError(''); checkPermission(); render();
  }
  root.JarvisTalk = { abort: abort, reset: reset, machine: machine, engine: engine, env: env, ensureWorker: ensureWorker, resample: resample, standalone: standalone, bind: bind };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind); else bind();
})(typeof globalThis !== 'undefined' ? globalThis : this);
