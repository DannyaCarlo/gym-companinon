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
  get('workout-mode').value = 'for-time';
  get('duration-minutes').value = '10';
  get('duration-seconds').value = '0';
  get('emom-interval').value = '60000';
  get('interval-minutes').value = '1';
  get('interval-seconds').value = '0';
  get('emom-rounds').value = '10';
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
    mode(value) { get('workout-mode').value = value; get('workout-mode').events.change(); },
    duration(minutes, seconds) {
      get('duration-minutes').value = String(minutes);
      get('duration-seconds').value = String(seconds);
      get('duration-seconds').events.input();
    },
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

test('AMRAP defaults to ten minutes and completes exactly at zero after preparation', () => {
  const app = setup(); app.mode('amrap');
  assert.equal(app.display(), '10:00:000');
  assert.equal(app.get('duration-settings').hidden, false);
  assert.equal(app.get('cap-toggle-label').hidden, true);
  assert.equal(app.get('timer-direction').textContent, 'COUNT DOWN');
  app.tap('start');
  assert.equal(app.display(), '00:10:000');
  assert.equal(app.get('workout-mode').disabled, true);
  assert.equal(app.get('duration-minutes').disabled, true);
  for (let i = 0; i < 10; i++) app.advance(1000);
  assert.equal(app.display(), '10:00:000');
  assert.deepEqual(app.tones, [...Array(10).fill(700), 1100]);
  app.advance(1234); assert.equal(app.display(), '09:58:766');
  app.advance(598765); assert.equal(app.display(), '00:00:001');
  app.advance(1); assert.equal(app.display(), '00:00:000');
  assert.match(app.get('timer-status').textContent, /^AMRAP complete/);
  assert.equal(app.tones.length, 12);
  app.advance(9000); assert.equal(app.display(), '00:00:000');
  assert.equal(app.tones.length, 12);
  assert.equal(app.get('start').disabled, true);
});

test('AMRAP early Finish holds elapsed and remaining time, including when paused', () => {
  for (const paused of [false, true]) {
    const app = setup(); app.mode('amrap'); app.duration(1, 30);
    app.tap('start'); app.advance(22345);
    if (paused) { app.tap('pause'); app.advance(60000); }
    app.tap('finish');
    assert.equal(app.display(), '01:17:655');
    assert.equal(app.get('timer-status').textContent, 'AMRAP ended early · Elapsed 00:12:345 · Remaining 01:17:655');
    app.advance(200000); assert.equal(app.display(), '01:17:655');
  }
});

test('AMRAP pause/resume works in preparation and workout and reset retains duration', () => {
  const app = setup(); app.mode('amrap'); app.duration(0, 5);
  app.tap('start'); app.advance(2000); app.tap('pause'); app.advance(30000);
  assert.equal(app.display(), '00:08:000');
  app.tap('start'); app.advance(8000); app.advance(1000); app.tap('pause');
  app.advance(30000); assert.equal(app.display(), '00:04:000');
  app.tap('reset'); assert.equal(app.get('reset-confirmation').hidden, false);
  app.tap('cancel-reset'); app.tap('start'); app.advance(500);
  assert.equal(app.display(), '00:03:500');
  app.tap('reset'); app.tap('confirm-reset');
  assert.equal(app.display(), '00:05:000');
  assert.equal(app.get('workout-mode').disabled, false);
  app.tap('start'); assert.equal(app.display(), '00:10:000');
});

test('AMRAP validates required length even when optional For Time cap is disabled', () => {
  for (const [minutes, seconds] of [[0, 0], [-1, 5], [1, 60], [0, 0.5], ['', 5], [1000, 0]]) {
    const app = setup(); app.mode('amrap'); app.duration(minutes, seconds); app.tap('start');
    assert.equal(app.get('duration-error').hidden, false);
    assert.equal(app.get('start').disabled, false);
    assert.equal(app.tones.length, 0);
  }
});

test('switching modes keeps separate duration settings and restores For Time behavior', () => {
  const app = setup(); app.cap(0, 7); app.mode('amrap'); app.duration(0, 2);
  app.tap('start'); app.advance(15000);
  assert.equal(app.display(), '00:00:000');
  assert.match(app.get('timer-status').textContent, /^AMRAP complete/);
  app.tap('reset'); app.mode('for-time');
  assert.equal(app.get('duration-settings').hidden, true);
  assert.equal(app.get('cap-fields').hidden, false);
  assert.equal(app.display(), '00:00:000');
  app.tap('start'); app.advance(17000);
  assert.equal(app.display(), '00:07:000');
  assert.match(app.get('timer-status').textContent, /^Time cap reached/);
  app.tap('reset'); app.mode('amrap'); assert.equal(app.display(), '00:02:000');
});

test('muted AMRAP handles a late frame without negative time or extra tones', () => {
  const app = setup(); app.mode('amrap'); app.duration(0, 1);
  app.tap('sound-toggle'); app.tap('start'); app.advance(100000);
  assert.equal(app.display(), '00:00:000');
  assert.equal(app.get('timer-status').textContent, 'AMRAP complete · Elapsed 00:01:000 · Remaining 00:00:000');
  assert.equal(app.tones.length, 0);
});

function emom(app, seconds, rounds) {
  app.mode('emom');
  app.get('emom-interval').value = 'custom';
  app.get('interval-minutes').value = '0';
  app.get('interval-seconds').value = String(seconds);
  app.get('emom-rounds').value = String(rounds);
  app.get('emom-interval').events.change();
}

test('EMOM defaults to one minute, ten rounds and supports two-minute preset', () => {
  const app = setup(); app.mode('emom');
  assert.equal(app.display(), '01:00:000');
  assert.equal(app.get('emom-settings').hidden, false);
  assert.equal(app.get('cap-toggle-label').hidden, true);
  assert.equal(app.get('round-status').textContent, '10 rounds · Total workout 10:00:000');
  app.get('emom-interval').value = '120000'; app.get('emom-interval').events.change();
  assert.equal(app.display(), '02:00:000');
  assert.equal(app.get('round-status').textContent, '10 rounds · Total workout 20:00:000');
  app.tap('start'); app.advance(10000); app.advance(120000);
  assert.equal(app.display(), '02:00:000');
  assert.equal(app.get('round-status').textContent, 'Round 2 of 10');
  assert.equal(app.get('emom-rounds').disabled, true);
});

test('EMOM signals each round exactly once and completes after final full interval', () => {
  const app = setup(); emom(app, 3, 3); app.tap('start');
  for (let i = 0; i < 10; i++) app.advance(1000);
  assert.equal(app.display(), '00:03:000');
  assert.equal(app.get('round-status').textContent, 'Round 1 of 3');
  assert.equal(app.tones.length, 11);
  app.advance(2999); assert.equal(app.display(), '00:00:001');
  app.advance(1); assert.equal(app.display(), '00:03:000');
  assert.equal(app.get('round-status').textContent, 'Round 2 of 3');
  assert.equal(app.tones.length, 12);
  app.advance(1); assert.equal(app.tones.length, 12);
  app.advance(2999); assert.equal(app.get('round-status').textContent, 'Round 3 of 3');
  assert.equal(app.tones.length, 13);
  app.advance(3000); assert.equal(app.display(), '00:00:000');
  assert.equal(app.get('round-status').textContent, '3 of 3 rounds completed');
  assert.equal(app.get('timer-status').textContent, 'EMOM complete · Elapsed 00:09:000');
  assert.equal(app.tones.length, 14);
  app.advance(10000); assert.equal(app.tones.length, 14);
  assert.equal(app.get('start').disabled, true);
});

test('EMOM pause/resume preserves preparation and interval time without duplicate signals', () => {
  const app = setup(); emom(app, 5, 2);
  app.tap('start'); app.advance(1000); app.tap('pause'); app.advance(20000);
  assert.equal(app.display(), '00:09:000');
  app.tap('start'); app.advance(9000); app.advance(1500); app.tap('pause');
  const count = app.tones.length;
  app.advance(90000); assert.equal(app.display(), '00:03:500');
  app.tap('start'); assert.equal(app.tones.length, count);
  app.advance(3500); assert.equal(app.get('round-status').textContent, 'Round 2 of 2');
  assert.equal(app.tones.length, count + 1);
});

test('EMOM Finish counts only fully completed rounds and holds the summary', () => {
  for (const paused of [false, true]) {
    const app = setup(); emom(app, 5, 3);
    app.tap('start'); app.advance(16750);
    if (paused) { app.tap('pause'); app.advance(10000); }
    app.tap('finish');
    assert.equal(app.get('round-status').textContent, '1 of 3 rounds completed');
    assert.equal(app.get('timer-status').textContent, 'EMOM ended early · Elapsed 00:06:750');
    assert.equal(app.display(), '00:03:250');
    app.advance(100000); assert.equal(app.display(), '00:03:250');
  }
});

test('EMOM validates custom interval and round count', () => {
  for (const [seconds, rounds] of [[0, 2], [60, 2], [-1, 2], [1.5, 2], ['', 2], [5, 0], [5, 1.5], [5, ''], [5, 1000]]) {
    const app = setup(); emom(app, seconds, rounds); app.tap('start');
    assert.equal(app.get('start').disabled, false);
    assert.equal(app.tones.length, 0);
    assert.equal(app.get('interval-error').hidden && app.get('emom-error').hidden, false);
  }
});

test('EMOM late frames catch up without replaying missed beeps, including one-round completion', () => {
  const app = setup(); emom(app, 2, 5); app.tap('start'); app.advance(10000);
  const before = app.tones.length;
  app.advance(6500);
  assert.equal(app.get('round-status').textContent, 'Round 4 of 5');
  assert.equal(app.display(), '00:01:500');
  assert.equal(app.tones.length, before + 1);
  app.advance(20000);
  assert.equal(app.get('timer-status').textContent, 'EMOM complete · Elapsed 00:10:000');
  assert.equal(app.tones.length, before + 2);
  const single = setup(); emom(single, 1, 1); single.tap('start'); single.advance(20000);
  assert.equal(single.display(), '00:00:000');
  assert.equal(single.get('round-status').textContent, '1 of 1 rounds completed');
  assert.deepEqual(single.tones, [700, 1100]);
});

test('EMOM reset confirmation, mute and mode switching preserve settings', () => {
  const app = setup(); emom(app, 4, 2); app.tap('sound-toggle');
  app.tap('start'); app.advance(11000); app.tap('reset');
  assert.equal(app.get('reset-confirmation').hidden, false);
  app.tap('cancel-reset'); app.advance(1000); assert.equal(app.display(), '00:02:000');
  app.tap('reset'); app.tap('confirm-reset'); assert.equal(app.display(), '00:04:000');
  app.mode('amrap'); assert.equal(app.get('emom-settings').hidden, true);
  assert.equal(app.get('round-status').hidden, true); assert.equal(app.display(), '10:00:000');
  app.mode('for-time'); assert.equal(app.display(), '00:00:000');
  app.mode('emom'); assert.equal(app.display(), '00:04:000');
  app.tap('start'); app.advance(18000);
  assert.equal(app.get('round-status').textContent, '2 of 2 rounds completed');
  assert.equal(app.tones.length, 0);
});

test('digital round counter shows R0 during preparation, advances, holds and resets', () => {
  const app = setup();
  assert.equal(app.get('clock-round').hidden, true);
  emom(app, 2, 3);
  assert.equal(app.get('clock-round').hidden, false);
  assert.equal(app.get('clock-round').textContent, 'R0');
  app.tap('start'); app.advance(9999);
  assert.equal(app.get('clock-round').textContent, 'R0');
  app.advance(1); assert.equal(app.get('clock-round').textContent, 'R1');
  app.advance(2000); assert.equal(app.get('clock-round').textContent, 'R2');
  app.tap('pause'); app.advance(10000);
  assert.equal(app.get('clock-round').textContent, 'R2');
  app.tap('start'); app.advance(2000);
  assert.equal(app.get('clock-round').textContent, 'R3');
  app.advance(2000); assert.equal(app.get('clock-round').textContent, 'R3');
  assert.equal(app.display(), '00:00:000');
  app.tap('reset'); assert.equal(app.get('clock-round').textContent, 'R0');
  app.mode('amrap'); assert.equal(app.get('clock-round').hidden, true);
  app.mode('for-time'); assert.equal(app.get('clock-round').hidden, true);
});
