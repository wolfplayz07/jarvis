const test = require('node:test');
const assert = require('node:assert');
const { matchWake, createDebouncer, backoff, isFatalError } = require('../wake.js');

for (const s of ['jarvis', 'Hey Jarvis', 'hey jarvis open spotify', 'JARVIS?', 'jervis', "jarvis's", 'ok jarvis', 'hi Jarvis.', 'um, jarvis']) {
  test('wakes on: ' + s, () => assert.strictEqual(matchWake(s), true));
}
for (const s of ['jar of jam', 'service', '', '   ', null, 'jarvisland', 'hey travis']) {
  test('no wake on: ' + JSON.stringify(s), () => assert.strictEqual(matchWake(s), false));
}
test('debounce: one utterance triggers once within 3 s', () => {
  const d = createDebouncer(3000);
  assert.strictEqual(d.fire(1000), true);
  assert.strictEqual(d.fire(1200), false); // interim result
  assert.strictEqual(d.fire(3900), false); // final result
  assert.strictEqual(d.fire(4000), true);
  d.reset(); assert.strictEqual(d.fire(4001), true);
});
test('backoff grows and caps', () => {
  assert.deepStrictEqual([0, 1, 2, 10].map(backoff), [300, 600, 1200, 8000]);
});
test('fatal errors', () => {
  assert.ok(isFatalError('not-allowed')); assert.ok(isFatalError('service-not-allowed'));
  assert.ok(!isFatalError('no-speech')); assert.ok(!isFatalError('network')); assert.ok(!isFatalError('aborted'));
});
