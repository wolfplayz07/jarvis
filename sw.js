/* Jarvis Phone service worker: precache the app shell so it works offline. */
var CACHE = 'jarvis-v7-2';
// The on-device voice model and runtime (~70 MB) live in their own cache, kept across app updates.
var MODEL_CACHE = 'jmodel-whisper-tiny-en-v1';
var SHELL = [
  './',
  './index.html',
  './styles.css?v=7.2',
  './clap.js?v=7.2',
  './wake.js?v=7.2',
  './brain.js?v=7.2',
  './nova-bridge.js?v=7.2',
  './app.js?v=7.2',
  './ptt.js?v=7.2',
  './talk.js?v=7.2',
  './stt-worker.js?v=7.2',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png'
];
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('jarvis-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/';
  if (req.url.indexOf(CDN) === 0) {
    e.respondWith(caches.open(MODEL_CACHE).then(function (c) {
      return c.match(req).then(function (hit) {
        return hit || fetch(req).then(function (res) { if (res && res.ok) c.put(req, res.clone()); return res; });
      });
    }));
    return;
  }
  if (new URL(req.url).origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    // Network first for the page so updates arrive; cached copy when offline.
    e.respondWith(fetch(req).then(function (res) {
      var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put('./index.html', copy); });
      return res;
    }).catch(function () { return caches.match('./index.html').then(function (r) { return r || caches.match('./'); }); }));
    return;
  }
  if (/\/(models|vendor)\//.test(new URL(req.url).pathname)) {
    e.respondWith(caches.open(MODEL_CACHE).then(function (c) {
      return c.match(req).then(function (hit) {
        return hit || fetch(req).then(function (res) { if (res && res.ok) c.put(req, res.clone()); return res; });
      });
    }));
    return;
  }
  e.respondWith(caches.match(req).then(function (hit) {
    return hit || fetch(req).then(function (res) {
      if (res && res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
      return res;
    });
  }));
});
