// STATE: the information the app remembers while the page is open.
const timer = { mode: 'for-time', phase: 'ready', running: false, elapsed: 0, startedAt: 0, cap: null, result: null, interval: null, rounds: 0, lastRound: 0 };
let plates = []; // Store one side only; every plate represents a matching pair.
let unit = 'lb';
// Keep original pound values internally, so switching units never loses precision.
function displayWeight(pounds) {
  return String(Number((unit === 'kg' ? pounds * 0.45359237 : pounds).toFixed(2)));
}
const plateTypes = [
  { weight: 45, color: '#3971b8', height: 120 },
  { weight: 35, color: '#c5a42e', height: 108 },
  { weight: 25, color: '#38916b', height: 94 },
  { weight: 15, color: '#b54d70', height: 85 },
  { weight: 10, color: '#d16b43', height: 76 },
  { weight: 5, color: '#7f76b8', height: 60 },
  { weight: 2.5, color: '#6d7c83', height: 46 },
  { weight: 1, color: '#397f8b', height: 38 },
  { weight: 0.5, color: '#92713e', height: 32 }
];
const $ = (id) => document.getElementById(id);
let soundEnabled = true;
let audioContext;
let lastCountdownSecond = null;
const activeBeeps = new Set();

// A tap unlocks browser audio; the tones are generated locally, with no audio download.
function unlockAudio() {
  if (!soundEnabled) return;
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    audioContext ??= new AudioContextClass();
    if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
  } catch { /* The timer still works if audio is unavailable. */ }
}
function stopBeeps() {
  for (const oscillator of activeBeeps) {
    try { oscillator.stop(); } catch { /* Already finished. */ }
  }
  activeBeeps.clear();
}
function beep(isStart = false) {
  if (!soundEnabled || document.hidden) return true;
  if (!audioContext || audioContext.state !== 'running') return false;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  const now = audioContext.currentTime;
  const duration = isStart ? 0.35 : 0.1;
  oscillator.type = 'sine';
  oscillator.frequency.value = isStart ? 1100 : 700;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.15, now + 0.008);
  gain.gain.linearRampToValueAtTime(0, now + duration);
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  activeBeeps.add(oscillator);
  oscillator.onended = () => {
    activeBeeps.delete(oscillator);
    oscillator.disconnect();
    gain.disconnect();
  };
  oscillator.start(now);
  oscillator.stop(now + duration);
  return true;
}
$('sound-toggle').addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  $('sound-toggle').textContent = soundEnabled ? 'Sound: On' : 'Sound: Off';
  $('sound-toggle').setAttribute('aria-pressed', String(soundEnabled));
  if (soundEnabled) unlockAudio();
  else stopBeeps();
});

// Use actual elapsed time, rather than counting interval callbacks.
function elapsedTime() {
  return timer.elapsed + (timer.running ? performance.now() - timer.startedAt : 0);
}
function formatTime(milliseconds) {
  const total = Math.max(0, Math.floor(milliseconds));
  const minutes = String(Math.floor(total / 60000)).padStart(2, '0');
  const seconds = String(Math.floor(total / 1000) % 60).padStart(2, '0');
  const fraction = String(total % 1000).padStart(3, '0');
  return `${minutes}:${seconds}:${fraction}`;
}
function completeWorkout(reason, elapsed) {
  stopBeeps();
  Object.assign(timer, { phase: 'finished', running: false, elapsed, result: reason });
  $('reset-confirmation').hidden = true;
  beep(true);
}
function readDuration(prefix, showError = true) {
  const minutesText = $(`${prefix}-minutes`).value.trim();
  const secondsText = $(`${prefix}-seconds`).value.trim();
  const minutes = Number(minutesText);
  const seconds = Number(secondsText);
  if (!/^\d+$/.test(minutesText) || !/^\d+$/.test(secondsText) || minutes > 999 || seconds > 59 || minutes * 60 + seconds === 0) {
    if (showError) {
      $(`${prefix}-error`).textContent = 'Enter 0–999 whole minutes and 0–59 whole seconds, with a duration of at least 1 second.';
      $(`${prefix}-error`).hidden = false;
    }
    return false;
  }
  return (minutes * 60 + seconds) * 1000;
}
function readTimeCap() {
  if (timer.mode === 'amrap') return readDuration('duration');
  return $('cap-enabled').checked ? readDuration('cap') : null;
}
function readEmom(showError = true) {
  const preset = $('emom-interval').value;
  const interval = preset === 'custom' ? readDuration('interval', showError) : Number(preset);
  const roundsText = $('emom-rounds').value.trim();
  const rounds = Number(roundsText);
  if (!/^\d+$/.test(roundsText) || rounds < 1 || rounds > 999) {
    if (showError) {
      $('emom-error').textContent = 'Enter a whole number of rounds from 1 to 999.';
      $('emom-error').hidden = false;
    }
    return false;
  }
  if (!interval || (preset !== 'custom' && interval !== 60000 && interval !== 120000)) return false;
  return { interval, rounds };
}
function updateEmomFields() {
  $('interval-fields').hidden = $('emom-interval').value !== 'custom';
  $('interval-error').hidden = true;
  $('emom-error').hidden = true;
  if (timer.phase === 'ready') renderTimer();
}
$('emom-interval').addEventListener('change', updateEmomFields);
for (const id of ['interval-minutes', 'interval-seconds', 'emom-rounds']) {
  $(id).addEventListener('input', updateEmomFields);
}
function updateCapFields() {
  $('cap-fields').hidden = timer.mode !== 'for-time' || !$('cap-enabled').checked;
  $('cap-error').hidden = true;
}
$('workout-mode').addEventListener('change', () => {
  if (timer.phase !== 'ready') return;
  timer.mode = $('workout-mode').value;
  $('duration-settings').hidden = timer.mode !== 'amrap';
  $('cap-toggle-label').hidden = timer.mode !== 'for-time';
  $('emom-settings').hidden = timer.mode !== 'emom';
  $('interval-error').hidden = true;
  $('emom-error').hidden = true;
  $('duration-error').hidden = true;
  $('timer-direction').textContent = timer.mode === 'for-time' ? 'COUNT UP' : 'COUNT DOWN';
  $('mode-help').textContent = timer.mode === 'amrap'
    ? 'Complete as many rounds or reps as possible before time runs out.'
    : 'Count up until you finish, or set a time cap.';
  if (timer.mode === 'emom') $('mode-help').textContent = 'Start a new round at each beep. Rest for the remainder of the interval.';
  updateCapFields();
  renderTimer();
});
$('cap-enabled').addEventListener('change', updateCapFields);
for (const id of ['cap-minutes', 'cap-seconds']) {
  $(id).addEventListener('input', () => { $('cap-error').hidden = true; });
}
for (const id of ['duration-minutes', 'duration-seconds']) {
  $(id).addEventListener('input', () => {
    $('duration-error').hidden = true;
    if (timer.phase === 'ready') renderTimer();
  });
}
function renderTimer() {
  let elapsed = elapsedTime();
  if (timer.phase === 'prep' && elapsed >= 10000) {
    timer.phase = 'workout';
    timer.elapsed = elapsed - 10000;
    timer.startedAt = performance.now();
    elapsed = timer.elapsed;
    if (timer.running && timer.mode !== 'emom' && (timer.cap === null || elapsed < timer.cap)) beep(true);
  }
  // Clamp to the exact cap even if a frame arrives late or the tab was hidden.
  if (timer.phase === 'workout' && timer.cap !== null && elapsed >= timer.cap) {
    completeWorkout(timer.mode === 'for-time' ? 'cap' : `${timer.mode}-complete`, timer.cap);
    elapsed = timer.elapsed;
  }
  if (timer.mode === 'emom' && timer.phase === 'workout') {
    const round = Math.floor(elapsed / timer.interval) + 1;
    if (round !== timer.lastRound) {
      // Derive rounds from elapsed time; don't accumulate drift or replay missed signals.
      timer.lastRound = round;
      if (timer.running) beep(true);
    }
  }
  if (timer.phase === 'prep' && timer.running) {
    const remaining = Math.ceil((10000 - elapsed) / 1000);
    // One beep per second, never a burst of missed beeps after switching tabs.
    if (remaining !== lastCountdownSecond && beep()) lastCountdownSecond = remaining;
  }
  let shownTime = elapsed;
  if (timer.mode === 'amrap') shownTime = timer.phase === 'ready' ? (readDuration('duration', false) || 0) : Math.max(0, timer.cap - elapsed);
  if (timer.mode === 'emom') {
    shownTime = timer.phase === 'ready' ? (readEmom(false)?.interval || 0)
      : timer.result === 'emom-complete' ? 0 : timer.interval - (elapsed % timer.interval);
  }
  if (timer.phase === 'prep') shownTime = 10000 - elapsed;
  const display = formatTime(shownTime);
  $('timer-display').setAttribute('aria-label', `${timer.phase === 'prep' ? 'Preparation time remaining' : timer.mode === 'emom' ? 'Interval time remaining' : timer.mode === 'amrap' ? 'Workout time remaining' : 'Workout time elapsed'} in minutes, seconds, and milliseconds`);
  if ($('timer-display').textContent !== display) $('timer-display').textContent = display;
  let status = 'Ready · 10-second preparation countdown';
  if (timer.phase === 'prep') status = `Get into position${timer.running ? '' : ' · Paused'}`;
  if (timer.phase === 'workout') status = `For Time${timer.running ? '' : ' · Paused'}${timer.cap === null ? '' : ` · Cap ${formatTime(timer.cap)}`}`;
  if (timer.phase === 'finished') status = `${timer.result === 'cap' ? 'Time cap reached' : 'Finished'} · Final time ${formatTime(timer.elapsed)}`;
  if (timer.mode === 'amrap' && timer.phase === 'workout') status = `AMRAP · Time remaining${timer.running ? '' : ' · Paused'}`;
  if (timer.mode === 'amrap' && timer.phase === 'finished') {
    status = `${timer.result === 'amrap-complete' ? 'AMRAP complete' : 'AMRAP ended early'} · Elapsed ${formatTime(timer.elapsed)} · Remaining ${formatTime(shownTime)}`;
  }
  $('round-status').hidden = timer.mode !== 'emom';
  $('clock-round').hidden = timer.mode !== 'emom';
  if (timer.mode === 'emom') {
    const clockRound = timer.phase === 'ready' || timer.phase === 'prep' ? 0
      : Math.min(timer.rounds, Math.floor(elapsed / timer.interval) + 1);
    const clockRoundText = `R${clockRound}`;
    if ($('clock-round').textContent !== clockRoundText) {
      $('clock-round').textContent = clockRoundText;
      $('clock-round').setAttribute('aria-label', `Round ${clockRound}`);
    }
    let roundStatus;
    if (timer.phase === 'ready') {
      const config = readEmom(false);
      roundStatus = config ? `${config.rounds} rounds · Total workout ${formatTime(config.rounds * config.interval)}` : 'Choose an interval and number of rounds.';
    } else if (timer.phase === 'prep') roundStatus = `Up next: Round 1 of ${timer.rounds}`;
    else if (timer.phase === 'finished') roundStatus = `${Math.min(timer.rounds, Math.floor(elapsed / timer.interval))} of ${timer.rounds} rounds completed`;
    else roundStatus = `Round ${Math.floor(elapsed / timer.interval) + 1} of ${timer.rounds}`;
    if ($('round-status').textContent !== roundStatus) $('round-status').textContent = roundStatus;
    if (timer.phase === 'workout') status = `EMOM · Interval remaining${timer.running ? '' : ' · Paused'}`;
    if (timer.phase === 'finished') status = `${timer.result === 'emom-complete' ? 'EMOM complete' : 'EMOM ended early'} · Elapsed ${formatTime(elapsed)}`;
  }
  if ($('timer-status').textContent !== status) $('timer-status').textContent = status;
  $('start').disabled = timer.running || timer.phase === 'finished';
  $('start').textContent = timer.phase === 'ready' || timer.phase === 'finished' ? 'Start' : 'Resume';
  $('pause').disabled = !timer.running;
  $('finish').disabled = timer.phase !== 'workout';
  for (const id of ['workout-mode', 'cap-enabled', 'cap-minutes', 'cap-seconds', 'duration-minutes', 'duration-seconds', 'emom-interval', 'interval-minutes', 'interval-seconds', 'emom-rounds']) {
    $(id).disabled = timer.phase !== 'ready';
  }
}
$('start').addEventListener('click', () => {
  if (timer.running || timer.phase === 'finished') return;
  if (timer.phase === 'ready') {
    let cap;
    if (timer.mode === 'emom') {
      const config = readEmom();
      if (!config) return;
      timer.interval = config.interval;
      timer.rounds = config.rounds;
      timer.lastRound = 0;
      cap = config.interval * config.rounds;
    } else cap = readTimeCap();
    if (cap === false) return;
    timer.cap = cap;
    $('cap-error').hidden = true;
    $('duration-error').hidden = true;
    $('interval-error').hidden = true;
    $('emom-error').hidden = true;
    timer.phase = 'prep';
  }
  unlockAudio();
  timer.startedAt = performance.now();
  timer.running = true;
  renderTimer();
});
$('pause').addEventListener('click', () => {
  renderTimer();
  if (!timer.running) return;
  stopBeeps();
  timer.elapsed = elapsedTime();
  timer.running = false;
  renderTimer();
});
function resetTimer() {
  stopBeeps();
  lastCountdownSecond = null;
  Object.assign(timer, { phase: 'ready', running: false, elapsed: 0, startedAt: 0, cap: null, result: null, interval: null, rounds: 0, lastRound: 0 });
  $('reset-confirmation').hidden = true;
  $('cap-error').hidden = true;
  $('duration-error').hidden = true;
  $('interval-error').hidden = true;
  $('emom-error').hidden = true;
  renderTimer();
}
$('finish').addEventListener('click', () => {
  renderTimer();
  if (timer.phase !== 'workout') return;
  completeWorkout('finish', elapsedTime());
  renderTimer();
});
$('reset').addEventListener('click', () => {
  renderTimer();
  if (timer.phase === 'prep' || timer.phase === 'workout') {
    $('reset-confirmation').hidden = false;
    $('cancel-reset').focus();
  } else resetTimer();
});
$('cancel-reset').addEventListener('click', () => {
  $('reset-confirmation').hidden = true;
  $('reset').focus();
});
$('confirm-reset').addEventListener('click', () => {
  resetTimer();
  $('start').focus();
});
// Draw on each screen refresh, but measure time independently of frame rate.
function animateTimer() {
  if (timer.running) renderTimer();
  requestAnimationFrame(animateTimer);
}
requestAnimationFrame(animateTimer);

function renderBar() {
  const bar = Number($('bar-weight').value);
  const perSide = plates.reduce((sum, plate) => sum + plate.weight, 0);
  $('total').textContent = displayWeight(bar + 2 * perSide);
  $('total-unit').textContent = `${unit} total`;
  $('breakdown').textContent = `${displayWeight(bar)} ${unit} bar + ${displayWeight(perSide)} ${unit} per side × 2`;
  $('unit-toggle').textContent = unit === 'lb' ? 'POUNDS ⇄' : 'KILOGRAMS ⇄';
  $('unit-toggle').setAttribute('aria-label', `Switch to ${unit === 'lb' ? 'kilograms' : 'pounds'}`);
  $('unit-toggle').setAttribute('aria-pressed', String(unit === 'kg'));
  $('conversion-note').hidden = unit !== 'kg';
  for (const option of $('bar-weight').options) {
    option.textContent = `${displayWeight(Number(option.value))} ${unit} bar`;
  }
  for (const side of ['left-plates', 'right-plates']) {
    $(side).replaceChildren();
    for (const plate of plates) {
      const element = document.createElement('span');
      element.className = 'plate';
      element.style.backgroundColor = plate.color;
      element.style.height = `${plate.height}px`;
      element.textContent = displayWeight(plate.weight);
      element.style.fontSize = unit === 'kg' ? '8px' : '10px';
      $(side).append(element);
    }
  }
  $('rack').setAttribute('aria-label', `${displayWeight(bar)} ${unit} bar. Plates on each side: ${plates.map(p => displayWeight(p.weight) + ' ' + unit).join(', ') || 'none'}. Total ${displayWeight(bar + 2 * perSide)} ${unit}.`);
  $('remove').disabled = plates.length === 0;
  $('clear').disabled = plates.length === 0;
  // Keep labels readable on narrow phone screens.
  document.querySelectorAll('#plate-options button').forEach((button, index) => {
    button.disabled = plates.length >= 8;
    button.textContent = `+ ${displayWeight(plateTypes[index].weight)} ${unit}`;
    button.setAttribute('aria-label', `Add ${displayWeight(plateTypes[index].weight)} ${unit} to each side`);
  });
}
for (const plate of plateTypes) {
  const button = document.createElement('button');
  button.textContent = `+ ${plate.weight} lb`;
  button.setAttribute('aria-label', `Add ${plate.weight} pounds to each side`);
  button.style.setProperty('--plate-color', plate.color);
  button.addEventListener('click', () => { if (plates.length < 8) plates.push(plate); renderBar(); });
  $('plate-options').append(button);
}
$('bar-weight').addEventListener('change', renderBar);
$('unit-toggle').addEventListener('click', () => {
  unit = unit === 'lb' ? 'kg' : 'lb';
  renderBar();
});
$('remove').addEventListener('click', () => { plates.pop(); renderBar(); });
$('clear').addEventListener('click', () => { plates = []; renderBar(); });
renderTimer();
renderBar();
