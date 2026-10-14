const test = require('node:test');
const assert = require('node:assert');
const B = require('../brain.js');

test('extract question after wake word', () => {
  assert.strictEqual(B.extractQuery('hey jarvis what is 25% of 200'), 'what is 25% of 200');
  assert.strictEqual(B.extractQuery('Hey Jarvis, what is a photo?'), 'what is a photo?');
  assert.strictEqual(B.extractQuery('ok Jarvis open spotify'), 'open spotify');
  assert.strictEqual(B.extractQuery('um jarvis how are you'), 'how are you');
  assert.strictEqual(B.extractQuery('jarvis'), '');
  assert.strictEqual(B.extractQuery('Hey Jarvis.'), '');
  assert.strictEqual(B.extractQuery('what is a photo'), null);
  assert.strictEqual(B.extractQuery('jarvisland is big'), null);
});
test('wake alone greets, then next line is a question', () => {
  const s = B.createSession();
  assert.deepStrictEqual(s.handle('hey jarvis', 0), { type: 'greet' });
  s.afterGreet(1000);
  assert.deepStrictEqual(s.handle('what is a photo', 3000), { type: 'ask', text: 'what is a photo', via: 'await' });
});
test('lines without wake word are ignored when no window is open', () => {
  const s = B.createSession();
  assert.strictEqual(s.handle('what is a photo', 0), null);
  s.afterGreet(0);
  assert.strictEqual(s.handle('what is a photo', B.AWAIT_MS + 1), null);
});
test('unknown answer routes the next line into the teach flow', () => {
  const s = B.createSession();
  assert.strictEqual(s.handle('hey jarvis what is a zorp', 0).text, 'what is a zorp');
  assert.strictEqual(s.afterAnswer('i do not know zorp. what do you mean by it?', 100), 'teach');
  assert.deepStrictEqual(s.handle('a made up word', 10000), { type: 'ask', text: 'a made up word', via: 'teach' });
  assert.strictEqual(s.mode(10001), null);
});
test('teach window expires after ~15 s', () => {
  const s = B.createSession();
  s.afterAnswer('i do not know.', 0);
  assert.strictEqual(s.handle('a thing', B.TEACH_MS + 1), null);
});
test('skip / never mind cancels the teach', () => {
  for (const t of ['skip', 'Never mind', 'nevermind.', 'cancel', 'forget it']) {
    const s = B.createSession();
    s.afterAnswer('yes or no?', 0);
    assert.deepStrictEqual(s.handle(t, 1000), { type: 'ask', text: 'skip', via: 'teach' });
  }
});
test('normal answer opens short follow-up window', () => {
  const s = B.createSession();
  assert.strictEqual(s.afterAnswer('50.', 0), 'follow');
  assert.strictEqual(s.handle('what is 2 plus 2', 5000).via, 'follow');
  s.afterAnswer('4.', 6000);
  assert.strictEqual(s.handle('hello', 6000 + B.FOLLOW_MS + 1), null);
});
test('wantsTeach detects Nova prompts only', () => {
  assert.ok(B.wantsTeach('i do not know.'));
  assert.ok(B.wantsTeach('i do not know zorp. what do you mean by it?'));
  assert.ok(B.wantsTeach('yes or no?'));
  assert.ok(!B.wantsTeach('50.'));
  assert.ok(!B.wantsTeach("got it. next time i'll say: a made up word"));
});
test('voice launch commands', () => {
  assert.strictEqual(B.launchTarget('open spotify'), 'spotify');
  assert.strictEqual(B.launchTarget('Open YouTube.'), 'youtube');
  assert.strictEqual(B.launchTarget('launch the chrome app'), 'chrome');
  assert.strictEqual(B.launchTarget('what is open source'), null);
});
test('speakable flattens lists', () => {
  assert.strictEqual(B.speakable('- name: Tony\n- city: Malibu'), 'name: Tony. city: Malibu');
});
