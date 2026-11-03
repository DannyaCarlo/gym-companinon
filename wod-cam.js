/* Compose the camera and timer into the same frames used for preview and recording. */
(() => {
  const el = id => document.getElementById(id);
  const clock = window.gymTimer;
  const video = el('cam-source');
  const canvas = el('cam-canvas');
  const paint = canvas.getContext('2d');
  let state = 'idle';
  let input, canvasStream, mixedStream, recorder, microphone, audioMix;
  let chunks = [], recordingBlob, recordingUrl, recordingName;
  let frameId, stopTimeout, generation = 0, claimed = false;
  let countdownEnd = 0, lastSecond = null, themeColor = '#ff9a3c';
  let stoppedText = '';
  let facing = 'environment', cameraCount = 0, recordingStarted = 0, cameraOpen = false;
  let wakeLock = null, wakeRequest = null, wakeEpoch = 0;
  const needsWakeLock = () => cameraOpen && !!input && !document.hidden && state !== 'idle';
  function wakeStatus(text = '') {
    el('cam-awake').textContent = text;
    el('cam-awake').hidden = !text;
  }
  function releaseWakeLock() {
    wakeEpoch++;
    const lock = wakeLock;
    wakeLock = null;
    if (lock) Promise.resolve(lock.release()).catch(() => {});
    wakeStatus();
  }
  async function requestWakeLock() {
    if (!needsWakeLock() || wakeLock || wakeRequest) return;
    if (!navigator.wakeLock?.request) {
      wakeStatus('Keep screen awake manually · automatic wake lock unavailable.');
      return;
    }
    const epoch = wakeEpoch;
    const request = Promise.resolve().then(() => navigator.wakeLock.request('screen'));
    wakeRequest = request;
    try {
      const lock = await request;
      if (epoch !== wakeEpoch || !needsWakeLock()) {
        await lock.release();
        return;
      }
      wakeLock = lock;
      wakeStatus('Screen stay-awake active');
      lock.addEventListener('release', () => {
        if (wakeLock !== lock) return;
        wakeLock = null;
        wakeStatus(needsWakeLock() ? 'Stay-awake released · keep screen awake manually.' : '');
      });
    } catch (_) {
      if (epoch === wakeEpoch && needsWakeLock()) wakeStatus('Stay-awake unavailable · keep screen awake manually.');
    } finally {
      if (wakeRequest === request) wakeRequest = null;
      // A pending request may finish after a close/reopen or visibility change.
      if (epoch !== wakeEpoch && needsWakeLock()) requestWakeLock();
    }
  }
  try { if (localStorage.getItem('wod-camera-facing') === 'user') facing = 'user'; } catch (_) {}

  function enterCamera() {
    cameraOpen = true;
    document.body.classList.add('camera-open');
    for (const node of document.querySelectorAll('main > :not(#cam-tool)')) node.inert = true;
    el('cam-close').focus();
    if (state === 'idle' && !recordingBlob) enableCamera();
  }
  function requestNativeFullscreen() {
    if (cameraOpen && !document.fullscreenElement) {
      try { el('cam-tool').requestFullscreen?.().catch(() => {}); } catch (_) {}
    }
  }
  function exitCamera() {
    cameraOpen = false;
    releaseWakeLock();
    document.body.classList.remove('camera-open');
    for (const node of document.querySelectorAll('main > :not(#cam-tool)')) node.inert = false;
    if (document.fullscreenElement === el('cam-tool')) return document.exitFullscreen?.().catch(() => {});
  }
  async function requestClose() {
    if (busy()) {
      el('cam-close-confirm').hidden = false;
      el('cam-continue').focus();
    } else {
      closeCamera(); await exitCamera(); clock.closeCamera(); el('choose-cam').focus();
    }
  }
  function elapsedRecording() {
    const seconds = Math.floor(Math.max(0, performance.now() - recordingStarted) / 1000);
    el('cam-elapsed').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }

  const busy = () => ['preparing', 'countdown', 'starting', 'recording', 'stopping'].includes(state);
  function status(text) { el('cam-status').textContent = text; }
  function error(text) {
    el('cam-error').textContent = text;
    el('cam-error').hidden = !text;
  }
  function refresh() {
    const snapshot = clock.snapshot();
    el('cam-workout').textContent = `${clock.describe()} · Sound ${snapshot.soundEnabled ? 'on' : 'off'}`;
    el('cam-enable').disabled = state !== 'idle';
    el('cam-record').disabled = state !== 'preview';
    el('cam-stop').disabled = !busy() || state === 'stopping';
    el('cam-stop').textContent = ['preparing', 'starting'].includes(state) ? 'Cancel start' : 'Stop recording';
    el('cam-close').disabled = state === 'stopping';
    el('cam-enable').hidden = state !== 'idle';
    el('cam-record').hidden = state === 'idle' || busy();
    el('cam-stop').hidden = !busy();
    el('cam-flip').hidden = cameraCount < 2;
    el('cam-flip').disabled = state !== 'preview';
    el('cam-flip').setAttribute('aria-label', `Switch to ${facing === 'environment' ? 'front' : 'rear'} camera`);
    el('cam-options-toggle').disabled = busy() || state === 'opening';
    el('cam-recording').hidden = !['countdown', 'recording', 'stopping'].includes(state);
    if (busy()) { el('cam-options').hidden = true; el('cam-options-toggle').setAttribute('aria-expanded', 'false'); }
    for (const id of ['cam-delay', 'cam-position', 'cam-settings']) el(id).disabled = busy() || state === 'opening';
    el('cam-reset').hidden = busy() || snapshot.phase !== 'finished';
    el('cam-result').hidden = state !== 'idle' || !recordingBlob;
  }
  function supported() {
    return !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder && canvas.captureStream && paint
      && (window.AudioContext || window.webkitAudioContext));
  }
  function mimeType() {
    return ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp8,opus', 'video/webm']
      .find(type => MediaRecorder.isTypeSupported(type));
  }
  function releaseMedia() {
    releaseWakeLock();
    cancelAnimationFrame(frameId);
    clearTimeout(stopTimeout);
    for (const stream of [input, canvasStream, mixedStream]) stream?.getTracks().forEach(track => track.stop());
    microphone?.disconnect();
    audioMix?.disconnect();
    input = canvasStream = mixedStream = microphone = audioMix = recorder = null;
    video.srcObject = null;
    canvas.hidden = true;
    clock.routeCues(null);
    if (claimed) { clock.release(); claimed = false; }
  }
  function closeCamera() {
    generation++;
    if (recorder && recorder.state !== 'inactive') {
      recorder.onstart = recorder.onstop = recorder.ondataavailable = null;
      recorder.stop();
    }
    releaseMedia();
    state = 'idle';
    el('cam-close-confirm').hidden = true;
    refresh();
  }
  function draw(text) {
    if (!video.videoWidth || video.readyState < 2) return;
    // Letterbox any orientation change during a take; never stretch or crop the saved image.
    const scale = Math.min(canvas.width / video.videoWidth, canvas.height / video.videoHeight);
    const width = video.videoWidth * scale, height = video.videoHeight * scale;
    paint.fillStyle = '#000';
    paint.fillRect(0, 0, canvas.width, canvas.height);
    paint.drawImage(video, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
    const padding = Math.max(20, Math.round(Math.min(canvas.width, canvas.height) * .04));
    let size = Math.max(20, Math.round(canvas.width * .065));
    paint.font = `700 ${size}px "Gym Digital", monospace`;
    while (paint.measureText(text).width > canvas.width - 2 * padding - 4 && size > 10) {
      paint.font = `700 ${--size}px "Gym Digital", monospace`;
    }
    paint.textAlign = 'left';
    paint.textBaseline = 'alphabetic';
    const metrics = paint.measureText(text);
    const left = metrics.actualBoundingBoxLeft || 0;
    const right = metrics.actualBoundingBoxRight ?? metrics.width;
    const ascent = metrics.actualBoundingBoxAscent ?? size;
    const descent = metrics.actualBoundingBoxDescent ?? size * .2;
    const corner = el('cam-position').value;
    const x = corner.endsWith('right') ? canvas.width - padding - 2 - right : padding + 2 + left;
    const y = corner.startsWith('bottom') ? canvas.height - padding - 2 - descent : padding + 2 + ascent;
    paint.lineJoin = 'round';
    // Stroke is centered on the glyph edge: a 4px stroke leaves a 2px black outline after fill.
    paint.lineWidth = 4;
    paint.strokeStyle = '#000000';
    paint.fillStyle = themeColor;
    paint.strokeText(text, x, y);
    paint.fillText(text, x, y);
  }
  function renderCamera() {
    if (!input) return;
    if (state === 'preview') {
      const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
      const width = Math.round(video.videoWidth * scale / 2) * 2;
      const height = Math.round(video.videoHeight * scale / 2) * 2;
      if (width && height && (canvas.width !== width || canvas.height !== height)) { canvas.width = width; canvas.height = height; }
    }
    if (['countdown', 'recording'].includes(state)) elapsedRecording();
    let text = clock.snapshot().text;
    if (state === 'countdown') {
      const remaining = Math.max(0, countdownEnd - performance.now());
      const second = Math.ceil(remaining / 1000);
      if (remaining <= 0) {
        startWorkout();
        text = clock.snapshot().text;
      }
      else {
        if (second !== lastSecond) {
          lastSecond = second;
          clock.cue();
          status(`Recording · Workout starts in ${second} seconds…`);
        }
        text = formatTime(remaining);
      }
    }
    draw(state === 'stopping' ? stoppedText : text);
    if (state === 'recording' && clock.snapshot().phase === 'finished') stopRecording();
    frameId = requestAnimationFrame(renderCamera);
  }
  async function enableCamera(requiredFacing) {
    if (state !== 'idle') return;
    error('');
    if (!supported()) {
      error('This browser cannot record a video with the timer overlay. Try a current Safari or Chrome browser over HTTPS.');
      return;
    }
    state = 'opening';
    const ticket = ++generation;
    refresh(); status('Allow camera and microphone access to open the preview.');
    try {
      // Browsers may suppress a fresh camera permission prompt in native fullscreen.
      if (document.fullscreenElement === el('cam-tool')) await document.exitFullscreen();
      if (ticket !== generation) return;
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: typeof requiredFacing === 'string' ? { exact: requiredFacing } : { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } },
        audio: { echoCancellation: true, noiseSuppression: true }
      });
      if (ticket !== generation) { stream.getTracks().forEach(track => track.stop()); return; }
      input = stream;
      if (!stream.getVideoTracks().length || !stream.getAudioTracks().length) throw new Error('Camera and microphone are both required.');
      const actualFacing = stream.getVideoTracks()[0].getSettings?.().facingMode;
      if (['user', 'environment'].includes(actualFacing)) facing = actualFacing;
      else if (typeof requiredFacing === 'string') facing = requiredFacing;
      try { localStorage.setItem('wod-camera-facing', facing); } catch (_) {}
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        cameraCount = devices.filter(device => device.kind === 'videoinput').length;
      } catch (_) { cameraCount = 0; }
      if (ticket !== generation) return;
      video.srcObject = stream;
      await video.play();
      if (ticket !== generation) return;
      if (!video.videoWidth || !video.videoHeight) throw new Error('The camera did not provide a video image. Close the camera and try again.');
      const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.round(video.videoWidth * scale / 2) * 2;
      canvas.height = Math.round(video.videoHeight * scale / 2) * 2;
      themeColor = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#ff9a3c';
      for (const track of input.getTracks()) track.addEventListener('ended', () => {
        error('Camera or microphone access was interrupted.');
        if (state === 'recording' || state === 'countdown') stopRecording();
        else if (state !== 'stopping') closeCamera();
      });
      canvas.hidden = false;
      state = 'preview'; refresh();
      requestWakeLock();
      requestNativeFullscreen();
      status('Camera ready. Choose a delay and corner, then tap Record.');
      renderCamera();
    } catch (failure) {
      if (ticket !== generation) return;
      closeCamera();
      const messages = {
        NotAllowedError: 'Camera or microphone permission was denied. Allow both in your browser’s site settings and try again.',
        NotFoundError: 'No camera or microphone was found on this device.',
        NotReadableError: 'The camera or microphone is busy. Close other apps using it and try again.'
      };
      error(messages[failure.name] || failure.message || 'Unable to open the camera.');
      status('Camera is off.');
    }
  }
  async function record() {
    if (state !== 'preview') return;
    requestWakeLock();
    error('');
    try { clock.claim(); claimed = true; }
    catch (failure) { error(failure.message); return; }
    const ticket = ++generation;
    state = 'preparing'; refresh(); status('Preparing recording…');
    try {
      // Audio initialization starts within the Record gesture, before asynchronous work.
      const audio = clock.audio();
      if (!audio) throw new Error('Audio recording is unavailable in this browser.');
      await audio.resume();
      if (ticket !== generation) return;
      if (audio.state !== 'running') throw new Error('Audio could not start. Tap Record again after enabling sound in your browser.');
      requestNativeFullscreen();
      await document.fonts.load('700 48px "Gym Digital"');
      if (ticket !== generation) return;
      audioMix = audio.createMediaStreamDestination();
      microphone = audio.createMediaStreamSource(input);
      microphone.connect(audioMix); // Microphone goes to the file, never to the speakers.
      clock.routeCues(audioMix); // Timer tones go to both speakers and the recording.
      canvasStream = canvas.captureStream(30);
      mixedStream = new MediaStream([...canvasStream.getVideoTracks(), ...audioMix.stream.getAudioTracks()]);
      const mime = mimeType();
      recorder = new MediaRecorder(mixedStream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 3000000 });
      const seconds = Number(el('cam-delay').value);
      if (![0, 10, 20].includes(seconds)) throw new Error('Choose a start delay of 0, 10, or 20 seconds.');
      chunks = [];
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onstart = () => {
        if (state !== 'starting') return;
        recordingStarted = performance.now(); elapsedRecording();
        countdownEnd = performance.now() + seconds * 1000;
        state = 'countdown';
        if (seconds === 0) startWorkout();
        else {
          lastSecond = seconds;
          clock.cue();
          draw(formatTime(seconds * 1000));
          refresh(); status(`Recording · Workout starts in ${seconds} seconds…`);
        }
      };
      recorder.onerror = () => {
        error('Recording was interrupted. Preview any recovered video before saving.');
        stopRecording();
      };
      recorder.onstop = finishFile;
      // Keep the previous take available until the next recording actually begins.
      lastSecond = null;
      startRecorder(seconds);
    } catch (failure) {
      if (ticket !== generation) return;
      closeCamera(); error(failure.message || 'Unable to start recording.'); status('Recording did not start.');
    }
  }
  function startRecorder(seconds) {
    if (state !== 'preparing') return;
    state = 'starting'; refresh();
    el('cam-playback').pause();
    draw(seconds > 0 ? formatTime(seconds * 1000) : clock.snapshot().text);
    try { recorder.start(1000); }
    catch (failure) { closeCamera(); error(failure.message); }
  }
  function startWorkout() {
    if (state !== 'countdown') return;
    try { clock.start(); }
    catch (failure) { error(failure.message); stopRecording(); return; }
    state = 'recording';
    draw(clock.snapshot().text);
    refresh(); status('Recording · Timer and microphone audio are included.');
  }
  function stopRecording(immediate = false) {
    if (['opening', 'preparing', 'starting'].includes(state)) {
      closeCamera(); status('Start cancelled. No video was recorded.'); return;
    }
    if (state !== 'recording' && state !== 'countdown') return;
    if (state === 'recording') {
      clock.finish();
      stoppedText = clock.snapshot().text;
    } else stoppedText = formatTime(Math.max(0, countdownEnd - performance.now()));
    state = 'stopping'; refresh(); status('Finishing your video…');
    draw(stoppedText);
    // Keep the final frame and completion tone in the file before closing the recorder.
    const finish = () => {
      if (recorder?.state !== 'inactive') recorder.stop();
      else finishFile();
    };
    if (immediate === true) finish();
    else stopTimeout = setTimeout(finish, 450);
  }
  function finishFile() {
    const type = recorder?.mimeType || chunks[0]?.type || 'video/webm';
    const file = new Blob(chunks, { type });
    chunks = [];
    closeCamera();
    if (!file.size) { error('No video data was captured. Please try a short recording again.'); return; }
    recordingBlob = file;
    if (recordingUrl) URL.revokeObjectURL(recordingUrl);
    recordingUrl = URL.createObjectURL(file);
    recordingName = `gym-companion-${new Date().toISOString().replace(/[:.]/g, '-')}.${type.includes('mp4') ? 'mp4' : 'webm'}`;
    el('cam-playback').src = recordingUrl;
    el('cam-save').href = recordingUrl;
    el('cam-save').download = recordingName;
    el('cam-result').hidden = false;
    const shareFile = new File([file], recordingName, { type });
    el('cam-share').hidden = !(navigator.canShare?.({ files: [shareFile] }) && navigator.share);
    status('Recording ready. Preview it below, then save your video.');
  }
  el('cam-enable').addEventListener('click', enableCamera);
  el('cam-record').addEventListener('click', record);
  el('cam-stop').addEventListener('click', stopRecording);
  el('cam-close').addEventListener('click', requestClose);
  el('cam-continue').addEventListener('click', () => { el('cam-close-confirm').hidden = true; el('cam-close').focus(); });
  el('cam-confirm-stop').addEventListener('click', () => { el('cam-close-confirm').hidden = true; stopRecording(); });
  el('cam-options-toggle').addEventListener('click', () => {
    if (busy()) return;
    el('cam-options').hidden = !el('cam-options').hidden;
    el('cam-options-toggle').setAttribute('aria-expanded', String(!el('cam-options').hidden));
  });
  el('cam-flip').addEventListener('click', async () => {
    if (state !== 'preview' || cameraCount < 2) return;
    const previous = facing;
    const next = facing === 'environment' ? 'user' : 'environment';
    closeCamera();
    await enableCamera(next);
    if (state === 'idle' && cameraOpen) {
      facing = previous;
      await enableCamera();
      error('The other camera is unavailable. Your previous camera has been restored.');
    }
  });
  el('cam-settings').addEventListener('click', () => clock.settings());
  el('cam-reset').addEventListener('click', () => { clock.resetFinished(); refresh(); });
  el('cam-share').addEventListener('click', async () => {
    if (!recordingBlob) return;
    try { await navigator.share({ files: [new File([recordingBlob], recordingName, { type: recordingBlob.type })] }); }
    catch (failure) { if (failure.name !== 'AbortError') error('Sharing is unavailable. Use Save video instead.'); }
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      requestWakeLock();
      if (state === 'preview') status('Camera ready. Recording is not running.');
      return;
    }
    releaseWakeLock();
    if (busy()) {
      error('Recording stopped because the page was hidden or the screen was locked. Keep it visible for the next take.');
      // Do not depend on a delayed timer after the OS suspends the page.
      if (state === 'stopping') { clearTimeout(stopTimeout); if (recorder?.state !== 'inactive') recorder.stop(); }
      else stopRecording(true);
    } else if (state === 'opening') { closeCamera(); status('Camera opening interrupted. Tap Enable camera to retry.'); }
    else if (state === 'preview') status('Preview suspended while the app is hidden. Recording is not running.');
  });
  document.addEventListener('keydown', event => {
    if (!cameraOpen) return;
    if (event.key === 'Escape') { event.preventDefault(); requestClose(); }
    if (event.key === 'Tab' && !el('cam-close-confirm').hidden) {
      event.preventDefault();
      (document.activeElement === el('cam-continue') ? el('cam-confirm-stop') : el('cam-continue')).focus();
    }
  });
  window.addEventListener('beforeunload', event => {
    if (busy() || recordingBlob) { event.preventDefault(); event.returnValue = ''; }
  });
  window.addEventListener('pagehide', () => {
    generation++;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    releaseMedia();
  });
  window.wodCam = {
    onToolChange(selected) {
      if (selected !== 'cam') {
        exitCamera();
        el('cam-playback').pause();
        if (!busy() && (input || state === 'opening')) { closeCamera(); status('Camera is off.'); }
      } else { refresh(); enterCamera(); }
    }
  };
  refresh();
})();
