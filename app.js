// STATE: the information the app remembers while the page is open.
const timer = { phase: 'ready', running: false, elapsed: 0, startedAt: 0 };
let plates = []; // Store one side only; every plate represents a matching pair.
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
function renderTimer() {
  let elapsed = elapsedTime();
  if (timer.phase === 'prep' && elapsed >= 10000) {
    timer.phase = 'workout';
    timer.elapsed = elapsed - 10000;
    timer.startedAt = performance.now();
    elapsed = timer.elapsed;
  }
  const seconds = timer.phase === 'prep' ? Math.max(0, Math.ceil((10000 - elapsed) / 1000)) : Math.floor(elapsed / 1000);
  $('timer-display').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
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
setInterval(renderTimer, 100);

function renderBar() {
  const bar = Number($('bar-weight').value);
  const perSide = plates.reduce((sum, plate) => sum + plate.weight, 0);
  $('total').textContent = bar + 2 * perSide;
  $('breakdown').textContent = `${bar} lb bar + ${perSide} lb per side × 2`;
  for (const side of ['left-plates', 'right-plates']) {
    $(side).replaceChildren();
    for (const plate of plates) {
      const element = document.createElement('span');
      element.className = 'plate';
      element.style.backgroundColor = plate.color;
      element.style.height = `${plate.height}px`;
      element.textContent = plate.weight;
      $(side).append(element);
    }
  }
  $('rack').setAttribute('aria-label', `${bar} pound bar. Plates on each side: ${plates.map(p => p.weight + ' pounds').join(', ') || 'none'}. Total ${bar + 2 * perSide} pounds.`);
  $('remove').disabled = plates.length === 0;
  $('clear').disabled = plates.length === 0;
  // Keep labels readable on narrow phone screens.
  document.querySelectorAll('#plate-options button').forEach(button => { button.disabled = plates.length >= 8; });
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
$('remove').addEventListener('click', () => { plates.pop(); renderBar(); });
$('clear').addEventListener('click', () => { plates = []; renderBar(); });
renderTimer();
renderBar();
