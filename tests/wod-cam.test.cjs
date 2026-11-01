const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Blob, File } = require('node:buffer');
const source = fs.readFileSync(path.join(__dirname, '..', 'wod-cam.js'), 'utf8');

function setup(savedFacing) {
  let now = 0, phase = 'ready', claimed = false, recorder, cueDestination;
  const elements = new Map(), frames = new Map(), timers = new Map(), draws = [], documentEvents = {}, recordedCues = [];
  let sequence = 0, permissionRequests = 0, starts = 0, cues = 0, finishes = 0;
  function track(kind) { return { kind, stopped: false, listeners: {}, stop() { this.stopped = true; }, addEventListener(n, f) { this.listeners[n] = f; } }; }
  class Stream {
    constructor(tracks) { this.tracks = tracks; }
    getTracks() { return this.tracks; }
    getVideoTracks() { return this.tracks.filter(t => t.kind === 'video'); }
    getAudioTracks() { return this.tracks.filter(t => t.kind === 'audio'); }
  }
  const camera = new Stream([track('video'), track('audio')]);
  const canvasStream = new Stream([track('video')]);
  const audioStream = new Stream([track('audio')]);
  const microphone = { connect(target) { this.target = target; }, disconnect() { this.disconnected = true; } };
  const mix = { stream: audioStream, disconnect() {} };
  const audio = { state: 'running', resume: async () => {}, createMediaStreamDestination: () => mix, createMediaStreamSource: () => microphone };
  const context = {
    fillRect() {},
    drawImage() {}, measureText() { return { width: 300, actualBoundingBoxLeft: 0, actualBoundingBoxRight: 300, actualBoundingBoxAscent: 42, actualBoundingBoxDescent: 3 }; },
    strokeText(text, x, y) { draws.push({ text, x, y, recording: recorder?.state === 'recording', outline: this.lineWidth, stroke: this.strokeStyle, fill: this.fillStyle }); }, fillText() {}
  };
  function get(id) {
    if (!elements.has(id)) elements.set(id, { events: {}, hidden: true, disabled: false, value: '', textContent: '',
      setAttribute(name, value) { this[name] = value; }, focus() { document.activeElement = this; }, addEventListener(name, callback) { this.events[name] = callback; }, pause() {}, play: async () => {},
      videoWidth: 1280, videoHeight: 720, readyState: 2, width: 720, height: 1280,
      getContext: () => context, captureStream: () => canvasStream });
    return elements.get(id);
  }
  get('cam-delay').value = '10'; get('cam-position').value = 'top-left';
  class Recorder {
    static isTypeSupported(type) { return type.startsWith('video/webm'); }
    constructor(stream, options) { this.stream = stream; this.mimeType = options.mimeType; this.state = 'inactive'; recorder = this; }
    start() { this.startCalls = (this.startCalls || 0) + 1; this.state = 'recording'; this.startTime = now; Promise.resolve().then(() => this.onstart?.()); }
    stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['test video'], { type: this.mimeType }) }); this.onstop?.(); }
  }
  const clock = {
    snapshot: () => ({ phase, text: phase === 'finished' ? '00:05:000' : '00:00:000', soundEnabled: true }),
    describe: () => 'For Time · No time cap',
    claim() { if (phase !== 'ready') throw new Error('Finish or reset the current workout'); claimed = true; },
    release() { claimed = false; }, audio: () => audio,
    routeCues(destination) { cueDestination = destination; }, cue() { cues++; recordedCues.push(recorder?.state === 'recording' && cueDestination === mix); },
    start() { phase = 'workout'; starts++; }, finish() { phase = 'finished'; finishes++; },
    settings() {}, closeCamera() { host.wodCam.onToolChange(null); }, resetFinished() { if (phase === 'finished') phase = 'ready'; }
  };
  const requests = [], storage = new Map(savedFacing ? [['wod-camera-facing', savedFacing]] : []);
  const navigator = { mediaDevices: { enumerateDevices: async () => [{kind: 'videoinput'}, {kind: 'videoinput'}], getUserMedia: async constraints => { permissionRequests++; requests.push(constraints); camera.getVideoTracks()[0].getSettings = () => ({ facingMode: constraints.video.facingMode.exact || constraints.video.facingMode.ideal }); return camera; } }, canShare: () => false };
  const host = { gymTimer: clock, MediaRecorder: Recorder, AudioContext: function () {}, addEventListener() {} };
  const classes = new Set();
  const document = { body: {classList: {add: x => classes.add(x), remove: x => classes.delete(x)}}, querySelectorAll: () => [], getElementById: get, documentElement: {}, hidden: false, fonts: { load: async () => {} }, addEventListener(n, f) { documentEvents[n] = f; } };
  vm.runInNewContext(source, {
    window: host, navigator, document, localStorage: {getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value)}, MediaRecorder: Recorder, MediaStream: Stream, Blob, File,
    performance: { now: () => now }, getComputedStyle: () => ({ getPropertyValue: () => '#ff9a3c' }),
    formatTime: ms => `00:${String(Math.floor(ms / 1000)).padStart(2, '0')}:000`,
    URL: { createObjectURL: () => 'blob:test-recording', revokeObjectURL() {} },
    requestAnimationFrame(fn) { const id = ++sequence; frames.set(id, fn); return id; }, cancelAnimationFrame(id) { frames.delete(id); },
    setTimeout(fn) { const id = ++sequence; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); }
  });
  return { get, host, navigator, document, documentEvents, requests, storage, classes, camera, canvasStream, audioStream, microphone, mix, draws, recordedCues,
    click: async id => { await get(id).events.click(); await Promise.resolve(); },
    async tick(ms) { now += ms; const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn()); await Promise.resolve(); },
    flush() { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(fn => fn()); },
    complete() { phase = 'finished'; },
    stats: () => ({ starts, finishes, cues, permissionRequests, claimed, cueDestination, recorder }) };
}

test('opening WOD Cam requests the rear camera and leaving releases it', async () => {
  const app = setup(); app.host.wodCam.onToolChange('cam');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.stats().permissionRequests, 1);
  assert.equal(app.requests[0].video.facingMode.ideal, 'environment');
  assert(app.classes.has('camera-open'));
  assert.equal(app.get('cam-record').disabled, false);
  app.host.wodCam.onToolChange('bar');
  assert(app.camera.getTracks().every(t => t.stopped));
  assert.equal(app.get('cam-canvas').hidden, true);
  assert(!app.classes.has('camera-open'));
});

test('zero-delay recording starts timer once and mixes microphone plus direct timer cues', async () => {
  const app = setup(); app.get('cam-delay').value = '0';
  await app.click('cam-enable'); await app.click('cam-record');
  assert.equal(app.stats().starts, 1);
  assert.equal(app.stats().recorder.state, 'recording');
  assert.equal(app.stats().cueDestination, app.mix);
  assert.equal(app.microphone.target, app.mix);
  assert.equal(app.stats().recorder.stream.getVideoTracks()[0], app.canvasStream.getVideoTracks()[0]);
  assert.equal(app.stats().recorder.stream.getAudioTracks()[0], app.audioStream.getAudioTracks()[0]);
  await app.click('cam-stop');
  assert.equal(app.stats().recorder.state, 'recording'); // Finish tone tail is retained.
  app.flush();
  assert.equal(app.get('cam-result').hidden, false);
  assert.match(app.get('cam-save').download, /\.webm$/);
  assert.equal(app.get('cam-playback').src, 'blob:test-recording');
  assert(app.camera.getTracks().every(t => t.stopped));
  assert.equal(app.stats().claimed, false);
});

test('10 and 20 second delays record every countdown cue and overlay before seamlessly starting the workout', async () => {
  for (const delay of [10, 20]) {
    const app = setup(); app.get('cam-delay').value = String(delay);
    await app.click('cam-enable'); await app.click('cam-record');
    const recorder = app.stats().recorder;
    assert.equal(recorder.state, 'recording');
    assert.equal(recorder.startTime, 0);
    assert.equal(app.get('cam-stop').textContent, 'Stop recording');
    assert.equal(app.draws.at(-1).text, `00:${delay}:000`);
    await app.tick(0); assert.equal(app.stats().starts, 0);
    for (let second = 1; second < delay; second++) await app.tick(1000);
    assert.equal(app.stats().starts, 0); assert.equal(app.stats().cues, delay);
    await app.tick(1000); assert.equal(app.stats().starts, 1);
    assert.equal(app.stats().recorder, recorder);
    assert.equal(recorder.startCalls, 1);
    assert.equal(recorder.state, 'recording');
    assert.equal(app.draws.at(-1).text, '00:00:000');
    assert(app.recordedCues.every(Boolean));
    for (let second = delay; second > 0; second--) {
      assert(app.draws.some(draw => draw.recording && draw.text === `00:${String(second).padStart(2, '0')}:000`));
    }
    await app.click('cam-stop'); app.flush();
    assert.equal(app.get('cam-result').hidden, false);
  }
});

test('stopping countdown saves the partial video without starting the workout', async () => {
  const app = setup(); await app.click('cam-enable'); await app.click('cam-record');
  await app.tick(3000); await app.click('cam-stop'); await app.tick(30000);
  assert.equal(app.draws.at(-1).text, '00:07:000');
  app.flush();
  assert.equal(app.stats().starts, 0);
  assert.equal(app.stats().finishes, 0);
  assert.equal(app.get('cam-result').hidden, false);
  assert.equal(app.stats().claimed, false);
  assert(app.camera.getTracks().every(t => t.stopped));
});

test('overlay draws numbers only in all four corners with theme color and two-pixel outer outline', async () => {
  const app = setup(); await app.click('cam-enable');
  const points = {};
  for (const corner of ['top-left', 'top-right', 'bottom-left', 'bottom-right']) {
    app.get('cam-position').value = corner; await app.tick(16);
    const draw = app.draws.at(-1); points[corner] = draw;
    assert.equal(draw.text, '00:00:000'); assert.equal(draw.outline, 4);
    assert.equal(draw.stroke, '#000000'); assert.equal(draw.fill, '#ff9a3c');
    assert(draw.x >= 20 && draw.x + 300 + 2 < 1280);
    assert(draw.y - 42 - 2 >= 20 && draw.y + 3 + 2 < 720);
  }
  assert(points['top-right'].x > points['top-left'].x);
  assert(points['bottom-left'].y > points['top-left'].y);
});

test('permission denial and unsupported recording show errors without starting timer', async () => {
  const app = setup();
  app.navigator.mediaDevices.getUserMedia = async () => { throw Object.assign(new Error('denied'), { name: 'NotAllowedError' }); };
  await app.click('cam-enable'); assert.match(app.get('cam-error').textContent, /permission was denied/);
  assert.equal(app.get('cam-enable').disabled, false);
  const unsupported = setup(); unsupported.host.MediaRecorder = null;
  await unsupported.click('cam-enable'); assert.match(unsupported.get('cam-error').textContent, /cannot record/);
  assert.equal(unsupported.stats().starts, 0);
});

test('leaving while permission is pending stops the late stream without showing a preview', async () => {
  const app = setup(); let resolve;
  app.navigator.mediaDevices.getUserMedia = () => new Promise(r => { resolve = r; });
  const pending = app.click('cam-enable'); await new Promise(resolve => setImmediate(resolve)); app.host.wodCam.onToolChange('bar');
  resolve(app.camera); await pending;
  assert(app.camera.getTracks().every(t => t.stopped));
  assert.equal(app.get('cam-canvas').hidden, true);
});

test('timer completion saves the file and a hidden page stops an active take', async () => {
  for (const hidden of [false, true]) {
    const app = setup(); app.get('cam-delay').value = '0';
    await app.click('cam-enable'); await app.click('cam-record');
    if (hidden) { app.document.hidden = true; app.documentEvents.visibilitychange(); }
    else { app.complete(); await app.tick(16); }
    app.flush();
    assert.equal(app.get('cam-result').hidden, false);
    assert.equal(app.stats().claimed, false);
    if (hidden) assert.match(app.get('cam-error').textContent, /page was hidden/);
  }
});


test('camera selection is remembered, flips before recording, and is locked during countdown', async () => {
  const app = setup('user'); await app.click('cam-enable');
  assert.equal(app.requests[0].video.facingMode.ideal, 'user');
  assert.equal(app.get('cam-flip').hidden, false);
  await app.click('cam-flip');
  assert.equal(app.requests[1].video.facingMode.exact, 'environment');
  assert.equal(app.storage.get('wod-camera-facing'), 'environment');
  await app.click('cam-record');
  assert.equal(app.get('cam-flip').disabled, true);
  await app.click('cam-flip');
  assert.equal(app.requests.length, 2);
});

test('one camera hides flip control', async () => {
  const app = setup(); app.navigator.mediaDevices.enumerateDevices = async () => [{kind: 'videoinput'}];
  await app.click('cam-enable');
  assert.equal(app.get('cam-flip').hidden, true);
});

test('close asks before stopping and Continue keeps the same recording running', async () => {
  const app = setup(); await app.click('cam-enable'); await app.click('cam-record');
  const recorder = app.stats().recorder;
  await app.tick(3000);
  assert.equal(app.get('cam-elapsed').textContent, '00:03');
  assert.equal(app.get('cam-recording').hidden, false);
  assert(!app.draws.some(draw => draw.text.includes('REC')));
  await app.click('cam-close');
  assert.equal(app.get('cam-close-confirm').hidden, false);
  assert.equal(recorder.state, 'recording');
  await app.click('cam-continue');
  assert.equal(app.get('cam-close-confirm').hidden, true);
  await app.tick(7000);
  assert.equal(app.get('cam-elapsed').textContent, '00:10');
  assert.equal(app.stats().starts, 1);
  await app.click('cam-close'); await app.click('cam-confirm-stop'); app.flush();
  assert.equal(app.get('cam-result').hidden, false);
  assert.equal(app.get('cam-recording').hidden, true);
});

test('settings panel collapses during recording and a preview can close without confirmation', async () => {
  const app = setup(); await app.click('cam-enable'); await app.click('cam-options-toggle');
  assert.equal(app.get('cam-options').hidden, false);
  await app.click('cam-record');
  assert.equal(app.get('cam-options').hidden, true);
  assert.equal(app.get('cam-options-toggle').disabled, true);
  await app.click('cam-stop'); app.flush(); await app.click('cam-close');
  assert.equal(app.get('cam-close-confirm').hidden, true);
  assert(!app.classes.has('camera-open'));
});

test('native fullscreen rejection retains the viewport camera and Close exits it', async () => {
  const app = setup();
  app.get('cam-tool').requestFullscreen = () => Promise.reject(new Error('Unavailable'));
  app.host.wodCam.onToolChange('cam');
  await new Promise(resolve => setImmediate(resolve));
  assert(app.classes.has('camera-open'));
  assert.equal(app.get('cam-record').disabled, false);
  await app.click('cam-close');
  assert(!app.classes.has('camera-open'));
});
