/*
 * Jarvis Phone - conversation logic around Nova (pure, runs in node too).
 * Jarvis adds no knowledge of its own: it only decides WHEN a spoken line goes to Nova.
 */
(function (root) {
  'use strict';
  var Wake = root.JarvisWake || (typeof require === 'function' ? require('./wake.js') : null);
  var TEACH_MS = 15000, FOLLOW_MS = 8000, AWAIT_MS = 8000;

  function clean(t) {
    return String(t == null ? '' : t).replace(/[\u2018\u2019]/g, "'").replace(/^[\s,.:;!?-]+|[\s,;:-]+$/g, '').replace(/\s+/g, ' ').trim();
  }
  // Text after the wake phrase ("hey jarvis, what is a photo?" -> "what is a photo?"). '' when nothing follows.
  function extractQuery(text) {
    var t = String(text == null ? '' : text).replace(/[\u2018\u2019]/g, "'");
    var w = Wake.findWake(t);
    if (!w) return null;
    var rest = clean(t.slice(w.end));
    return /^[.!?]*$/.test(rest) ? '' : rest;
  }
  // Nova asked something back: next line (no wake word) is the teaching answer.
  function wantsTeach(answer) {
    var a = String(answer || '').toLowerCase().trim();
    return /^i do not know\b/.test(a) || /what do you mean by it\?\s*$/.test(a) || /^yes or no\?\s*$/.test(a);
  }
  function isCancel(text) { return /^(skip|never ?mind|cancel|forget it)[.!]?$/i.test(clean(text)); }
  // "open spotify" -> "spotify" (matched against launcher names by the app).
  function launchTarget(text) {
    var m = /^(?:please\s+)?(?:open|launch|start|play)\s+(?:up\s+)?(?:the\s+)?([a-z][a-z0-9 ]{1,30}?)(?:\s+app)?[.!]?$/i.exec(clean(text));
    return m ? m[1].toLowerCase() : null;
  }
  // Nova reads text; spoken punctuation-free answers are fine, but strip markdown bullets for speech.
  function speakable(answer) {
    return String(answer || '').replace(/^\s*-\s+/gm, '').replace(/\n+/g, '. ').replace(/\s+/g, ' ').trim();
  }

  function createSession() {
    var mode = null, until = 0;
    var s = {
      open: function (m, ms, now) { mode = m; until = now + ms; },
      close: function () { mode = null; until = 0; },
      mode: function (now) { return mode && now <= until ? mode : null; },
      // Final utterance -> {type:'greet'} | {type:'ask', text, via} | null (ignored).
      handle: function (text, now) {
        var q = extractQuery(text);
        if (q === '') { s.close(); return { type: 'greet' }; }
        if (q) { s.close(); return { type: 'ask', text: q, via: 'wake' }; }
        var m = s.mode(now), t = clean(text);
        if (!m || !t) return null;
        s.close();
        return { type: 'ask', text: (m === 'teach' && isCancel(t)) ? 'skip' : t, via: m };
      },
      // After Nova answers: teach window if it asked back, else a short follow-up window.
      afterAnswer: function (answer, now) {
        if (wantsTeach(answer)) s.open('teach', TEACH_MS, now); else s.open('follow', FOLLOW_MS, now);
        return mode;
      },
      afterGreet: function (now) { s.open('await', AWAIT_MS, now); }
    };
    return s;
  }

  var api = { extractQuery: extractQuery, wantsTeach: wantsTeach, isCancel: isCancel, launchTarget: launchTarget,
    speakable: speakable, createSession: createSession, TEACH_MS: TEACH_MS, FOLLOW_MS: FOLLOW_MS, AWAIT_MS: AWAIT_MS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.JarvisBrain = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
