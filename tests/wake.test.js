const test = require('node:test');
const assert = require('node:assert');
const { matchWake, findWake, editDistance, createDebouncer, backoff, isFatalError } = require('../wake.js');

// Fuzzy wake: iOS mishears of "jarvis".
for (const s of ['jarvas', 'jervis', 'travis', 'service', 'jarvi', 'harvest', "java's", 'nervous', 'hey jarvis',
  'hey travis what time is it', 'jarbis', 'jar vis', 'hey jarvez', 'Jarviss.']) {
  test('fuzzy wakes on: ' + s, () => assert.strictEqual(matchWake(s), true));
}
test('edit distance', () => {
  assert.strictEqual(editDistance('jarvis', 'jarvis'), 0);
  assert.strictEqual(editDistance('jarvis', 'jervis'), 1);
  assert.strictEqual(editDistance('kitten', 'sitting'), 3);
});
test('findWake gives the span including "hey"', () => {
  assert.deepStrictEqual(findWake('um hey jervis what is 2 plus 2'), { start: 3, end: 13 });
  assert.strictEqual(findWake('nothing here'), null);
});

for (const s of ['jarvis', 'Hey Jarvis', 'hey jarvis open spotify', 'JARVIS?', 'jervis', "jarvis's", 'ok jarvis', 'hi Jarvis.', 'um, jarvis']) {
  test('wakes on: ' + s, () => assert.strictEqual(matchWake(s), true));
}
for (const s of ['jar of jam', '', '   ', null, 'jarvisland', 'paris is nice', 'davis', 'is it raining', 'what is 25% of 200', 'jars']) {
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
