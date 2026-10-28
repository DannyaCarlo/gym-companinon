// STATE: the information the app remembers while the page is open.
const timer = { phase: 'ready', running: false, elapsed: 0, startedAt: 0, cap: null, result: null };
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
function readTimeCap() {
  if (!$('cap-enabled').checked) return null;
  const minutesText = $('cap-minutes').value.trim();
  const secondsText = $('cap-seconds').value.trim();
  const minutes = Number(minutesText);
  const seconds = Number(secondsText);
  if (!/^\d+$/.test(minutesText) || !/^\d+$/.test(secondsText) || minutes > 999 || seconds > 59 || minutes * 60 + seconds === 0) {
    $('cap-error').textContent = 'Enter 0–999 whole minutes and 0–59 whole seconds, with a cap of at least 1 second.';
    $('cap-error').hidden = false;
    return false;
  }
  return (minutes * 60 + seconds) * 1000;
}
function updateCapFields() {
  $('cap-fields').hidden = !$('cap-enabled').checked;
  $('cap-error').hidden = true;
}
$('cap-enabled').addEventListener('change', updateCapFields);
for (const id of ['cap-minutes', 'cap-seconds']) {
  $(id).addEventListener('input', () => { $('cap-error').hidden = true; });
}
function renderTimer() {
  let elapsed = elapsedTime();
  if (timer.phase === 'prep' && elapsed >= 10000) {
    timer.phase = 'workout';
    timer.elapsed = elapsed - 10000;
    timer.startedAt = performance.now();
    elapsed = timer.elapsed;
    if (timer.running && (timer.cap === null || elapsed < timer.cap)) beep(true);
  }
  // Clamp to the exact cap even if a frame arrives late or the tab was hidden.
  if (timer.phase === 'workout' && timer.cap !== null && elapsed >= timer.cap) {
    completeWorkout('cap', timer.cap);
    elapsed = timer.elapsed;
  }
  if (timer.phase === 'prep' && timer.running) {
    const remaining = Math.ceil((10000 - elapsed) / 1000);
    // One beep per second, never a burst of missed beeps after switching tabs.
    if (remaining !== lastCountdownSecond && beep()) lastCountdownSecond = remaining;
  }
  const display = formatTime(timer.phase === 'prep' ? 10000 - elapsed : elapsed);
  if ($('timer-display').textContent !== display) $('timer-display').textContent = display;
  let status = 'Ready · 10-second preparation countdown';
  if (timer.phase === 'prep') status = `Get into position${timer.running ? '' : ' · Paused'}`;
  if (timer.phase === 'workout') status = `For Time${timer.running ? '' : ' · Paused'}${timer.cap === null ? '' : ` · Cap ${formatTime(timer.cap)}`}`;
  if (timer.phase === 'finished') status = `${timer.result === 'cap' ? 'Time cap reached' : 'Finished'} · Final time ${formatTime(timer.elapsed)}`;
  if ($('timer-status').textContent !== status) $('timer-status').textContent = status;
  $('start').disabled = timer.running || timer.phase === 'finished';
  $('start').textContent = timer.phase === 'ready' || timer.phase === 'finished' ? 'Start' : 'Resume';
  $('pause').disabled = !timer.running;
  $('finish').disabled = timer.phase !== 'workout';
  for (const id of ['workout-mode', 'cap-enabled', 'cap-minutes', 'cap-seconds']) {
    $(id).disabled = timer.phase !== 'ready';
  }
}
$('start').addEventListener('click', () => {
  if (timer.running || timer.phase === 'finished') return;
  if (timer.phase === 'ready') {
    const cap = readTimeCap();
    if (cap === false) return;
    timer.cap = cap;
    $('cap-error').hidden = true;
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
  Object.assign(timer, { phase: 'ready', running: false, elapsed: 0, startedAt: 0, cap: null, result: null });
  $('reset-confirmation').hidden = true;
  $('cap-error').hidden = true;
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
