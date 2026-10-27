// STATE: the information the app remembers while the page is open.
const timer = { phase: 'ready', running: false, elapsed: 0, startedAt: 0 };
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
function renderTimer() {
  let elapsed = elapsedTime();
  if (timer.phase === 'prep' && elapsed >= 10000) {
    timer.phase = 'workout';
    timer.elapsed = elapsed - 10000;
    timer.startedAt = performance.now();
    elapsed = timer.elapsed;
  }
  const display = formatTime(timer.phase === 'prep' ? 10000 - elapsed : elapsed);
  if ($('timer-display').textContent !== display) $('timer-display').textContent = display;
  const status = timer.phase === 'ready' ? 'Ready · 10-second preparation countdown' : `${timer.phase === 'prep' ? 'Get into position' : 'Workout time'}${timer.running ? '' : ' · Paused'}`;
  if ($('timer-status').textContent !== status) $('timer-status').textContent = status;
  $('start').disabled = timer.running;
  $('start').textContent = timer.phase === 'ready' ? 'Start' : 'Resume';
  $('pause').disabled = !timer.running;
}
$('start').addEventListener('click', () => {
  if (timer.running) return;
  if (timer.phase === 'ready') timer.phase = 'prep';
  timer.startedAt = performance.now();
  timer.running = true;
  renderTimer();
});
$('pause').addEventListener('click', () => {
  timer.elapsed = elapsedTime();
  timer.running = false;
  renderTimer();
});
$('reset').addEventListener('click', () => {
  Object.assign(timer, { phase: 'ready', running: false, elapsed: 0, startedAt: 0 });
  renderTimer();
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
