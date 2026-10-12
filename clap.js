/*
 * Jarvis Phone - double-clap detector.
 * Pure logic: feed it one level (0..1 peak amplitude) per frame with a
 * timestamp in milliseconds. No DOM or audio APIs, so it runs in node too.
 */
(function (root) {
  'use strict';

  var DEFAULTS = {
    sensitivity: 0.5,   // 0 = deaf, 1 = very sensitive
    minGap: 150,        // ms between claps for a double (inclusive)
    maxGap: 600,        // ms
    refractory: 90,     // ms after a clap onset during which new onsets are ignored
    maxClapLen: 120,    // ms a clap may stay loud before it counts as sustained noise
    maxRise: 40,        // ms from onset to the clap's peak
    cooldown: 1000,     // ms to ignore everything after a double clap fires
    floorInit: 0.01
  };

  function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // Threshold for a given noise floor and slider position.
  // Higher sensitivity -> lower multiplier and lower absolute minimum.
  function computeThreshold(floor, sensitivity) {
    var s = clamp(Number(sensitivity), 0, 1);
    var mult = lerp(10, 3, s);
    var minAbs = lerp(0.45, 0.04, s);
    return clamp(Math.max(minAbs, floor * mult), 0, 0.98);
  }

  function createDetector(options) {
    var o = {};
    var k;
    for (k in DEFAULTS) o[k] = DEFAULTS[k];
    if (options) for (k in options) if (options[k] !== undefined) o[k] = options[k];

    var floor = o.floorInit;
    var prev = 0;
    var cand = null;        // {start, peak, peakT}
    var busyUntilQuiet = false;
    var lastClap = -Infinity;   // onset time of the last confirmed single clap
    var pendingFirst = null;    // onset time of a clap waiting for its partner
    var cooldownUntil = -Infinity;
    var threshold = computeThreshold(floor, o.sensitivity);

    function updateFloor(level) {
      // Fast down, slow up: quiet moments pull the floor down quickly,
      // sustained noise lifts it gradually.
      if (level < floor) floor += (level - floor) * 0.2;
      else floor += (level - floor) * 0.02;
      floor = clamp(floor, 0.0005, 0.9);
    }

    function process(level, t) {
      level = clamp(Number(level) || 0, 0, 1);
      var ev = { clap: false, double: false, level: level, threshold: threshold, floor: floor, t: t };
      threshold = computeThreshold(floor, o.sensitivity);
      ev.threshold = threshold;
      var release = Math.max(threshold * 0.45, floor * 1.5);

      if (busyUntilQuiet) {
        // Long loud sound: wait for it to end, keep adapting the floor.
        updateFloor(level);
        if (level < release) busyUntilQuiet = false;
        prev = level;
        return ev;
      }

      if (cand) {
        if (level > cand.peak) { cand.peak = level; cand.peakT = t; }
        if (level < release) {
          // It decayed fast enough. Was it sharp?
          var sharp = (cand.peakT - cand.start) <= o.maxRise;
          var onset = cand.start;
          cand = null;
          if (sharp && t >= cooldownUntil) {
            ev.clap = true;
            lastClap = onset;
            if (pendingFirst !== null) {
              var gap = onset - pendingFirst;
              if (gap >= o.minGap && gap <= o.maxGap) {
                ev.double = true;
                ev.gap = gap;
                pendingFirst = null;
                cooldownUntil = t + o.cooldown;
              } else {
                pendingFirst = onset;
              }
            } else {
              pendingFirst = onset;
            }
          }
        } else if (t - cand.start > o.maxClapLen) {
          // Too long to be a clap: sustained noise or speech.
          cand = null;
          busyUntilQuiet = true;
          pendingFirst = null;
        }
        prev = level;
        return ev;
      }

      // Drop a stale first clap.
      if (pendingFirst !== null && t - pendingFirst > o.maxGap) pendingFirst = null;

      var rising = level >= threshold && prev < threshold;
      var jump = level >= prev * 2.5 || prev < release;
      if (rising && jump && t - lastClap >= o.refractory && t >= cooldownUntil) {
        cand = { start: t, peak: level, peakT: t };
      } else if (rising && t - lastClap < o.refractory) {
        // Inside the refractory window: treat as the tail of the last clap.
      } else {
        updateFloor(level);
      }
      prev = level;
      return ev;
    }

    return {
      process: process,
      setSensitivity: function (s) { o.sensitivity = clamp(Number(s), 0, 1); threshold = computeThreshold(floor, o.sensitivity); },
      getThreshold: function () { return threshold; },
      getFloor: function () { return floor; },
      options: o,
      reset: function () {
        floor = o.floorInit; prev = 0; cand = null; busyUntilQuiet = false;
        lastClap = -Infinity; pendingFirst = null; cooldownUntil = -Infinity;
        threshold = computeThreshold(floor, o.sensitivity);
      }
    };
  }

  // Convenience: run a whole sequence of {t, level} frames, return events.
  function detectSequence(frames, options) {
    var d = createDetector(options);
    var claps = [], doubles = [];
    for (var i = 0; i < frames.length; i++) {
      var ev = d.process(frames[i].level, frames[i].t);
      if (ev.clap) claps.push(ev.t);
      if (ev.double) doubles.push({ t: ev.t, gap: ev.gap });
    }
    return { claps: claps, doubles: doubles, detector: d };
  }

  var api = { createDetector: createDetector, computeThreshold: computeThreshold, detectSequence: detectSequence, DEFAULTS: DEFAULTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.JarvisClap = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
