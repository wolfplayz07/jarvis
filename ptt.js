/*
 * Jarvis Phone - push-to-talk logic (pure, runs in node too).
 * - createMachine(): Idle -> Listening -> Thinking -> Speaking -> Idle, driven by button and engine events.
 * - chooseEngine(): Safari speech when it can work, otherwise the on-device Whisper model.
 * - cleanTranscript(): tidy what an engine heard before it goes to Nova.
 */
(function (root) {
  'use strict';
  var TAP_MS = 350; // a press shorter than this is a tap: it toggles listening instead of hold-to-talk

  function createMachine(opts) {
    opts = opts || {};
    var tapMs = opts.tapMs == null ? TAP_MS : opts.tapMs;
    var state = 'idle', mode = null, pressedAt = 0, listeners = [];
    function set(s, why) { var prev = state; state = s; if (s === 'idle') mode = null; listeners.forEach(function (fn) { fn(s, prev, why); }); return s; }
    var m = {
      get state() { return state; },
      get mode() { return mode; },
      on: function (fn) { listeners.push(fn); },
      // Button pressed. From Speaking it interrupts and listens. Returns true when listening should start.
      press: function (now) {
        if (state === 'listening' && mode === 'toggle') { m.stopListening('tap'); return false; }
        if (state === 'idle' || state === 'speaking') { pressedAt = now; mode = 'hold'; set('listening', 'press'); return true; }
        return false;
      },
      // Button released. A short press switches to tap mode (keep listening until the next tap).
      release: function (now) {
        if (state !== 'listening' || mode !== 'hold') return null;
        if (now - pressedAt < tapMs) { mode = 'toggle'; return 'toggle'; }
        m.stopListening('release'); return 'stop';
      },
      stopListening: function (why) { if (state === 'listening') set('thinking', why || 'stop'); },
      heard: function (text) {   // engine finished; empty text -> back to idle
        if (state !== 'thinking' && state !== 'listening') return false;
        if (!String(text || '').trim()) { set('idle', 'nothing heard'); return false; }
        if (state === 'listening') set('thinking', 'heard');
        return true;
      },
      answered: function () { if (state === 'thinking') set('speaking', 'answer'); },
      spoken: function () { if (state === 'speaking' || state === 'thinking') set('idle', 'spoken'); },
      fail: function (why) { set('idle', why || 'error'); },
      reset: function () { set('idle', 'reset'); }
    };
    return m;
  }

  // env: { webSpeech, standalone, webSpeechFailed, mediaDevices, wasm, pref }
  function chooseEngine(env) {
    env = env || {};
    var canLocal = !!(env.mediaDevices && env.wasm);
    var canSafari = !!env.webSpeech && !env.standalone && !env.webSpeechFailed;
    if (env.pref === 'local') return canLocal ? 'local' : (canSafari ? 'safari' : 'none');
    if (env.pref === 'safari') return canSafari ? 'safari' : (canLocal ? 'local' : 'none');
    if (canSafari) return 'safari';
    return canLocal ? 'local' : 'none';
  }

  // Whisper sometimes writes sounds or silence as tags; Nova wants plain words.
  function cleanTranscript(t) {
    t = String(t == null ? '' : t)
      .replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g, ' ')
      .replace(/(\d)\s*(?:percent|per cent)\b/gi, '$1%')
      .replace(/\s+/g, ' ').trim();
    if (/^(thank you|thanks for watching|you)[.!]*$/i.test(t)) return '';
    t = t.replace(/^[\s.,!-]+/, '').replace(/[\s.!,]+$/, '');
    return t;
  }

  var api = { createMachine: createMachine, chooseEngine: chooseEngine, cleanTranscript: cleanTranscript, TAP_MS: TAP_MS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.JarvisPTT = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
