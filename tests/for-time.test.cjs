// Run with: node --test tests/for-time.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function setup() {
  const elements = new Map();
  const tones = [];
  let now = 0;
  let frame;
  function element() {
    return { children: [], style: { setProperty() {} }, events: {}, attrs: {},
      value: '', checked: false, hidden: true, textContent: '', disabled: false,
      setAttribute(key, value) { this.attrs[key] = value; },
      addEventListener(name, callback) { this.events[name] = callback; },
      append(child) { this.children.push(child); },
      replaceChildren() { this.children = []; }, focus() {} };
  }
  function get(id) {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  }
  get('bar-weight').value = '45';
  get('bar-weight').options = [45, 35, 15].map(value => ({ value: String(value) }));
  get('cap-minutes').value = '10';
  get('cap-seconds').value = '0';
  class AudioContext {
    state = 'running'; currentTime = 0; destination = {};
    createOscillator() {
      return { frequency: { value: 0 }, connect() {}, disconnect() {},
        start() { tones.push(this.frequency.value); }, stop() {} };
    }
    createGain() {
      return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {}, disconnect() {} };
    }
  }
  vm.runInNewContext(source, {
    document: { hidden: false, getElementById: get, createElement: element,
      querySelectorAll: () => get('plate-options').children },
    window: { AudioContext }, performance: { now: () => now },
    requestAnimationFrame(callback) { frame = callback; }
  });
  return { get, tones, tap(id) { get(id).events.click(); },
    advance(ms) { now += ms; frame(); },
    cap(minutes, seconds) {
      get('cap-enabled').checked = true;
      get('cap-enabled').events.change();
      get('cap-minutes').value = String(minutes);
      get('cap-seconds').value = String(seconds);
    }, display() { return get('timer-display').textContent; } };
}

test('uncapped For Time counts up, finishes, and holds its final milliseconds', () => {
  const app = setup();
  app.tap('start');
  assert.equal(app.display(), '00:10:000');
  assert.equal(app.get('finish').disabled, true);
  for (let i = 0; i < 10; i++) app.advance(1000);
  assert.deepEqual(app.tones, [...Array(10).fill(700), 1100]);
  app.advance(83450);
  app.tap('finish');
  assert.equal(app.display(), '01:23:450');
  assert.match(app.get('timer-status').textContent, /^Finished/);
  app.advance(90000);
  app.tap('start');
  assert.equal(app.display(), '01:23:450');
  assert.equal(app.get('start').disabled, true);
  assert.equal(app.get('finish').disabled, true);
  app.tap('reset');
  assert.equal(app.display(), '00:00:000');
  assert.equal(app.get('cap-enabled').disabled, false);
});

test('cap excludes preparation and clamps late frames to the exact cap once', () => {
  const app = setup();
  app.cap(0, 2);
  app.tap('start');
  app.advance(10000);
  assert.equal(app.display(), '00:00:000');
  app.advance(2500);
  assert.equal(app.display(), '00:02:000');
  assert.match(app.get('timer-status').textContent, /^Time cap reached/);
  const count = app.tones.length;
  app.advance(10000);
  app.tap('finish');
  assert.equal(app.tones.length, count);
  assert.equal(app.get('pause').disabled, true);
});

test('pause/resume excludes paused time in both preparation and workout', () => {
  const app = setup();
  app.cap(0, 5);
  app.tap('start'); app.advance(3000); app.tap('pause');
  app.advance(30000);
  assert.equal(app.display(), '00:07:000');
  app.tap('start'); app.advance(7000); app.advance(1234); app.tap('pause');
  app.advance(30000);
  assert.equal(app.display(), '00:01:234');
  app.tap('start'); app.advance(3766);
  assert.equal(app.display(), '00:05:000');
  assert.match(app.get('timer-status').textContent, /^Time cap reached/);
});

test('Finish also works while the workout is paused', () => {
  const app = setup();
  app.tap('start'); app.advance(10456); app.tap('pause'); app.advance(9000);
  app.tap('finish');
  assert.equal(app.display(), '00:00:456');
  assert.match(app.get('timer-status').textContent, /^Finished/);
});

test('active reset asks, cancel keeps the timer going, confirm clears it', () => {
  const app = setup();
  app.tap('start'); app.advance(2000); app.tap('reset');
  assert.equal(app.get('reset-confirmation').hidden, false);
  app.tap('cancel-reset'); app.advance(1000);
  assert.equal(app.display(), '00:07:000');
  app.tap('pause'); app.tap('reset');
  assert.equal(app.get('reset-confirmation').hidden, false);
  app.tap('confirm-reset');
  assert.equal(app.display(), '00:00:000');
  assert.equal(app.get('reset-confirmation').hidden, true);
  app.tap('start'); app.advance(10000); app.tap('reset');
  assert.equal(app.get('reset-confirmation').hidden, false);
});

test('invalid caps prevent starting, while disabled caps ignore saved input', () => {
  for (const [minutes, seconds] of [[0, 0], [-1, 5], [1, 60], [1.5, 0], ['', 5], [1, ''], [1000, 0], ['abc', 2]]) {
    const app = setup(); app.cap(minutes, seconds); app.tap('start');
    assert.equal(app.display(), '00:00:000');
    assert.equal(app.get('cap-error').hidden, false);
    assert.equal(app.get('start').disabled, false);
    assert.equal(app.tones.length, 0);
    app.get('cap-enabled').checked = false;
    app.get('cap-enabled').events.change(); app.tap('start');
    assert.equal(app.display(), '00:10:000');
  }
});

test('late preparation frame can finish at cap without a duplicate start tone', () => {
  const app = setup(); app.cap(0, 1); app.tap('start'); app.advance(20000);
  assert.equal(app.display(), '00:01:000');
  assert.deepEqual(app.tones, [700, 1100]);
});

test('muted timer still completes; barbell conversion still works', () => {
  const app = setup(); app.tap('sound-toggle'); app.cap(0, 1);
  app.tap('start'); app.advance(11000);
  assert.equal(app.tones.length, 0);
  assert.match(app.get('timer-status').textContent, /^Time cap reached/);
  app.get('plate-options').children[0].events.click();
  assert.equal(app.get('total').textContent, '135');
  app.tap('unit-toggle'); assert.equal(app.get('total').textContent, '61.23');
});
