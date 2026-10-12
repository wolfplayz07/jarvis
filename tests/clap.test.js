'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { detectSequence, computeThreshold, createDetector } = require('../clap.js');

// Deterministic pseudo-random noise so tests never flake.
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// Build frames: background noise plus extra shapes. frameMs ~ analyser poll rate.
function frames(totalMs, shapes, { frameMs = 10, noise = 0.01, seed = 1 } = {}) {
  const r = rng(seed); const out = [];
  for (let t = 0; t <= totalMs; t += frameMs) {
    let lvl = noise * (0.6 + 0.8 * r());
    for (const f of shapes) lvl = Math.max(lvl, f(t, r));
    out.push({ t, level: Math.min(1, lvl) });
  }
  return out;
}
const clap = (at, peak = 0.8, tau = 15) => (t) => (t < at ? 0 : peak * Math.exp(-(t - at) / tau));
const sustained = (from, to, lvl = 0.5) => (t, r) => (t >= from && t < to ? lvl * (0.85 + 0.3 * r()) : 0);
// Speech-like syllables: ~60 ms rise, ~200 ms body, gentle fall, every 320 ms.
const speech = (from, to, peak = 0.45) => (t, r) => {
  if (t < from || t >= to) return 0;
  const p = (t - from) % 320;
  let env = 0;
  if (p < 60) env = 0.5 - 0.5 * Math.cos(Math.PI * p / 60);
  else if (p < 220) env = 1;
  else if (p < 280) env = 0.5 + 0.5 * Math.cos(Math.PI * (p - 220) / 60);
  return peak * env * (0.8 + 0.4 * r());
};

for (const frameMs of [10, 21]) {
  test(`double clap 300 ms apart triggers (frame ${frameMs} ms)`, () => {
    const res = detectSequence(frames(3000, [clap(1000), clap(1300)], { frameMs }));
    assert.equal(res.doubles.length, 1, JSON.stringify(res));
    assert.ok(res.doubles[0].gap >= 280 && res.doubles[0].gap <= 320);
  });
}

test('a single clap does not trigger', () => {
  const res = detectSequence(frames(3000, [clap(1000)]));
  assert.equal(res.claps.length, 1);
  assert.equal(res.doubles.length, 0);
});

test('two claps 900 ms apart do not trigger', () => {
  const res = detectSequence(frames(3000, [clap(1000), clap(1900)]));
  assert.equal(res.claps.length, 2);
  assert.equal(res.doubles.length, 0);
});

test('claps 80 ms apart fall inside the refractory window and are not a double', () => {
  const res = detectSequence(frames(3000, [clap(1000), clap(1080)]));
  assert.equal(res.doubles.length, 0);
  assert.equal(res.claps.length, 1);
});

test('sustained loud noise does not trigger', () => {
  const res = detectSequence(frames(5000, [sustained(1000, 4000)], { seed: 7 }));
  assert.equal(res.doubles.length, 0);
  assert.equal(res.claps.length, 0);
});

test('speech-like envelopes do not trigger', () => {
  for (const seed of [2, 3, 4, 5]) {
    const res = detectSequence(frames(6000, [speech(800, 5500)], { seed }));
    assert.equal(res.doubles.length, 0, `seed ${seed}: ${JSON.stringify(res.claps)}`);
  }
});

test('rapid choppy noise bursts (long) do not trigger', () => {
  const res = detectSequence(frames(4000, [sustained(1000, 1400, 0.6), sustained(1600, 2100, 0.6)]));
  assert.equal(res.doubles.length, 0);
});

test('sensitivity slider changes the threshold', () => {
  const lo = computeThreshold(0.01, 0.1), mid = computeThreshold(0.01, 0.5), hi = computeThreshold(0.01, 0.9);
  assert.ok(lo > mid && mid > hi, `${lo} ${mid} ${hi}`);
  const d = createDetector({ sensitivity: 0.2 });
  const before = d.getThreshold();
  d.setSensitivity(0.9);
  assert.ok(d.getThreshold() < before);
});

test('sensitivity decides whether a soft double clap counts', () => {
  const soft = frames(3000, [clap(1000, 0.18), clap(1300, 0.18)]);
  assert.equal(detectSequence(soft, { sensitivity: 0.9 }).doubles.length, 1);
  assert.equal(detectSequence(soft, { sensitivity: 0.1 }).doubles.length, 0);
});

test('threshold adapts upward with a louder noise floor', () => {
  assert.ok(computeThreshold(0.1, 0.5) > computeThreshold(0.005, 0.5));
});

test('a double clap after background noise settles still triggers', () => {
  const res = detectSequence(frames(6000, [sustained(500, 2500, 0.3), clap(4000), clap(4250)], { seed: 9 }));
  assert.equal(res.doubles.length, 1);
});
