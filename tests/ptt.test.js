const test = require('node:test');
const assert = require('node:assert');
const { createMachine, chooseEngine, cleanTranscript } = require('../ptt.js');

test('hold to talk: press -> listening, release -> thinking -> answer -> speaking -> idle', () => {
  const m = createMachine(); const seen = [];
  m.on((s) => seen.push(s));
  assert.strictEqual(m.press(0), true); assert.strictEqual(m.state, 'listening'); assert.strictEqual(m.mode, 'hold');
  assert.strictEqual(m.release(2000), 'stop'); assert.strictEqual(m.state, 'thinking');
  assert.strictEqual(m.heard('what is 25% of 200'), true);
  m.answered(); assert.strictEqual(m.state, 'speaking');
  m.spoken(); assert.strictEqual(m.state, 'idle');
  assert.deepStrictEqual(seen, ['listening', 'thinking', 'speaking', 'idle']);
});
test('a quick tap toggles: keeps listening until the next tap', () => {
  const m = createMachine();
  m.press(0); assert.strictEqual(m.release(100), 'toggle'); assert.strictEqual(m.state, 'listening'); assert.strictEqual(m.mode, 'toggle');
  assert.strictEqual(m.press(3000), false); assert.strictEqual(m.state, 'thinking');
  assert.strictEqual(m.release(3100), null);
});
test('nothing heard goes back to idle; errors reset', () => {
  const m = createMachine();
  m.press(0); m.release(1000); assert.strictEqual(m.heard('  '), false); assert.strictEqual(m.state, 'idle');
  m.press(0); m.fail('mic'); assert.strictEqual(m.state, 'idle'); assert.strictEqual(m.mode, null);
});
test('pressing while speaking interrupts and listens; presses while thinking are ignored', () => {
  const m = createMachine();
  m.press(0); m.release(900); m.heard('hi'); assert.strictEqual(m.press(1000), false); assert.strictEqual(m.state, 'thinking');
  m.answered(); assert.strictEqual(m.press(2000), true); assert.strictEqual(m.state, 'listening');
});
test('spoken/answered out of order are harmless', () => {
  const m = createMachine();
  m.spoken(); m.answered(); assert.strictEqual(m.state, 'idle');
  assert.strictEqual(m.release(5), null);
});

const base = { webSpeech: true, standalone: false, webSpeechFailed: false, mediaDevices: true, wasm: true, pref: 'auto' };
test('fallback: Safari tab with speech -> safari', () => assert.strictEqual(chooseEngine(base), 'safari'));
test('fallback: Home Screen app -> on-device even though webkitSpeechRecognition exists', () =>
  assert.strictEqual(chooseEngine({ ...base, standalone: true }), 'local'));
test('fallback: no webkitSpeechRecognition -> on-device', () => assert.strictEqual(chooseEngine({ ...base, webSpeech: false }), 'local'));
test('fallback: Safari speech failed before -> on-device', () => assert.strictEqual(chooseEngine({ ...base, webSpeechFailed: true }), 'local'));
test('fallback: user can force either engine; forced but unavailable falls back', () => {
  assert.strictEqual(chooseEngine({ ...base, pref: 'local' }), 'local');
  assert.strictEqual(chooseEngine({ ...base, standalone: true, pref: 'safari' }), 'local');
  assert.strictEqual(chooseEngine({ ...base, mediaDevices: false, pref: 'local' }), 'safari');
});
test('fallback: nothing available -> none', () =>
  assert.strictEqual(chooseEngine({ webSpeech: false, mediaDevices: false, wasm: true }), 'none'));
test('cleanTranscript', () => {
  assert.strictEqual(cleanTranscript(' What is 25 percent of 200?'), 'What is 25% of 200?');
  assert.strictEqual(cleanTranscript('[BLANK_AUDIO]'), '');
  assert.strictEqual(cleanTranscript(' (music) open Spotify.'), 'open Spotify');
  assert.strictEqual(cleanTranscript('Thank you.'), '');
  assert.strictEqual(cleanTranscript(null), '');
});
