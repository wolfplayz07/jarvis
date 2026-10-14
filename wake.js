/*
 * Jarvis Phone - wake-word matching and debounce. Pure logic, runs in node too.
 */
(function (root) {
  'use strict';
  // Fuzzy wake: "jarvis" plus what iOS often hears instead. Any token within edit distance 2 of
  // "jarvis" that still has the "rv"/"rb" sound also counts (so "paris" or "davis" do not).
  var MISHEARS = { jarvis: 1, jarvas: 1, jervis: 1, travis: 1, service: 1, jarvi: 1, harvest: 1, javas: 1, nervous: 1,
    jarves: 1, jarviss: 1, jarvish: 1, gervais: 1, jarbis: 1 };
  var LEADS = { hey: 1, hi: 1, ok: 1, okay: 1, yo: 1, hay: 1, a: 1 };
  function normalize(text) {
    return String(text == null ? '' : text).toLowerCase().replace(/[\u2018\u2019]/g, "'");
  }
  function editDistance(a, b) {
    var m = a.length, n = b.length, prev = [], cur, i, j;
    for (j = 0; j <= n; j++) prev[j] = j;
    for (i = 1; i <= m; i++) {
      cur = [i];
      for (j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[n];
  }
  function isName(tok) {
    var w = tok.replace(/'s$/, '').replace(/'/g, '');
    if (MISHEARS[w] || MISHEARS[tok.replace(/'/g, '')]) return true;
    return w.length >= 5 && /r[vb]/.test(w) && editDistance(w, 'jarvis') <= 2;
  }
  // Finds the wake phrase. Returns {start, end} character offsets in the text (end is just after
  // the name), or null. "jar vis" split in two is joined.
  function findWake(text) {
    var t = normalize(text), re = /[a-z']+/g, toks = [], m;
    while ((m = re.exec(t))) toks.push({ w: m[0], s: m.index, e: m.index + m[0].length });
    for (var i = 0; i < toks.length; i++) {
      var hit = isName(toks[i].w) ? toks[i].e : (i + 1 < toks.length && isName(toks[i].w + toks[i + 1].w) ? toks[++i].e : -1);
      if (hit < 0) continue;
          var start = toks[i].s;
      if (i > 0 && LEADS[toks[i - 1].w]) start = toks[i - 1].s;
      return { start: start, end: hit };
    }
    return null;
  }
  function matchWake(text) { return !!findWake(text); }
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

  var api = { matchWake: matchWake, findWake: findWake, editDistance: editDistance, createDebouncer: createDebouncer, backoff: backoff, isFatalError: isFatalError };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.JarvisWake = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
