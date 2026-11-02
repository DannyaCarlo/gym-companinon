// Disclosure only: the existing plate buttons retain all calculation behavior.
(() => {
  const panel = document.getElementById('plate-panel');
  const toggle = document.getElementById('plate-toggle');
  const bar = document.getElementById('bar-tool');
  const nav = document.querySelector('.tool-switcher');
  let pending = false;
  function layout() {
    if (panel.hidden || bar.hidden) return;
    document.getElementById('sheet-total').textContent = document.getElementById('loaded-weight').textContent;
    document.getElementById('sheet-plates').textContent = document.getElementById('plates-per-side').textContent;
    // Measure the natural inline layout before deciding whether to float it.
    panel.classList.remove('plate-sheet');
    const viewport = window.visualViewport;
    const bottom = Math.min(nav.getBoundingClientRect().top,
      viewport ? viewport.offsetTop + viewport.height : window.innerHeight);
    const overflow = panel.getBoundingClientRect().bottom + 16 > bottom;
    panel.classList.toggle('plate-sheet', overflow);
    if (overflow) {
      panel.style.setProperty('--sheet-bottom', `${Math.max(0, window.innerHeight - bottom) + 8}px`);
      panel.style.setProperty('--sheet-height', `${Math.max(96, bottom - (viewport?.offsetTop || 0) - 16)}px`);
    }
  }
  function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; layout(); });
  }
  function close(restoreFocus = true) {
    panel.hidden = true;
    panel.classList.remove('plate-sheet');
    toggle.setAttribute('aria-expanded', 'false');
    if (restoreFocus) toggle.focus({ preventScroll: true });
  }
  toggle.addEventListener('click', () => {
    if (!panel.hidden) return close();
    panel.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    layout();
  });
  document.getElementById('plate-close').addEventListener('click', () => close());
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !panel.hidden) { event.preventDefault(); close(); }
  });
  nav.addEventListener('click', () => { if (bar.hidden) close(false); });
  window.addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('scroll', schedule);
  // Recheck after unit switches, target edits, and adding/removing plates.
  new MutationObserver(schedule).observe(document.getElementById('plates-per-side'), { childList: true, subtree: true, characterData: true });
  new ResizeObserver(schedule).observe(document.getElementById('breakdown'));
})();
