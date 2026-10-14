/*
 * Jarvis Phone - wake-word matching and debounce. Pure logic, runs in node too.
 */
(function (root) {
  'use strict';
  // jarvis plus common mishearings; optional possessive; word boundaries on both sides.
  var NAME = '(?:jarvis|jarvi|jervis|jarvas|jarves|jarviss|travis jarvis)';
  var RE = new RegExp('(?:^|[^a-z])(?:(?:hey|hi|ok|okay|yo|hay)\\s+)?' + NAME + "(?:'s|s)?(?=$|[^a-z])", 'i');

  function normalize(text) {
    return String(text == null ? '' : text).toLowerCase().replace(/[\u2018\u2019]/g, "'");
  }
  function matchWake(text) {
    var t = normalize(text);
    if (!t.trim()) return false;
    return RE.test(t);
  }
  function createDebouncer(cooldownMs) {
    var cd = cooldownMs == null ? 3000 : cooldownMs, last = -Infinity;
    return {
      fire: function (now) { if (now - last < cd) return false; last = now; return true; },
      reset: function () { last = -Infinity; }
    };
  }
  // Restart backoff for speech recognition: 300ms doubling up to 8s.
  function backoff(attempt) { return Math.min(8000, 300 * Math.pow(2, Math.max(0, attempt))); }
  var FATAL = { 'not-allowed': 1, 'service-not-allowed': 1, 'language-not-supported': 1 };
  function isFatalError(err) { return !!FATAL[err]; }

  var api = { matchWake: matchWake, createDebouncer: createDebouncer, backoff: backoff, isFatalError: isFatalError };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.JarvisWake = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
