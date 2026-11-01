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
    el('cam-close').disabled = state === 'idle' || busy();
    for (const id of ['cam-delay', 'cam-position', 'cam-settings']) el(id).disabled = busy() || state === 'opening';
    el('cam-reset').hidden = busy() || snapshot.phase !== 'finished';
    el('cam-result').hidden = busy() || !recordingBlob;
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
    refresh();
  }
  function draw(text) {
    if (!video.videoWidth || video.readyState < 2) return;
    paint.drawImage(video, 0, 0, canvas.width, canvas.height);
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
  async function enableCamera() {
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
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } },
        audio: { echoCancellation: true, noiseSuppression: true }
      });
      if (ticket !== generation) { stream.getTracks().forEach(track => track.stop()); return; }
      input = stream;
      if (!stream.getVideoTracks().length || !stream.getAudioTracks().length) throw new Error('Camera and microphone are both required.');
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
  function stopRecording() {
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
    stopTimeout = setTimeout(() => {
      if (recorder?.state !== 'inactive') recorder.stop();
      else finishFile();
    }, 450);
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
  el('cam-close').addEventListener('click', () => { closeCamera(); status('Camera is off.'); });
  el('cam-settings').addEventListener('click', () => clock.settings());
  el('cam-reset').addEventListener('click', () => { clock.resetFinished(); refresh(); });
  el('cam-share').addEventListener('click', async () => {
    if (!recordingBlob) return;
    try { await navigator.share({ files: [new File([recordingBlob], recordingName, { type: recordingBlob.type })] }); }
    catch (failure) { if (failure.name !== 'AbortError') error('Sharing is unavailable. Use Save video instead.'); }
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    if (busy()) {
      error('Recording stopped because the page was hidden or the screen was locked. Keep it visible for the next take.');
      stopRecording();
    } else if (state === 'preview' || state === 'opening') closeCamera();
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
        el('cam-playback').pause();
        if (!busy() && (input || state === 'opening')) { closeCamera(); status('Camera is off.'); }
      } else refresh();
    }
  };
  refresh();
})();
