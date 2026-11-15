'use strict';
/* Portfolio home: theme switching, pointer light on cards, the two small project
   animations, scroll reveals, and the email copy button. The animated backdrop itself
   lives in backdrop.js. No libraries, no tracking. */

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const root = document.documentElement;
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage is optional */ } }
};

let motion = !reduce.matches && store.get('tk-motion') !== 'off';

/* ---------- themes ---------- */
const THEMES = ['pond', 'steppe', 'embers'];
const themeButtons = $$('[data-theme-pick]');
let theme = THEMES.includes(root.dataset.theme) ? root.dataset.theme : 'pond';

function applyTheme(name) {
  theme = name;
  root.dataset.theme = name;
  for (const b of themeButtons) b.setAttribute('aria-pressed', String(b.dataset.themePick === name));
  if (window.Backdrop) window.Backdrop.setTheme(name);
}
function switchTheme(name, x, y) {
  if (name === theme) return;
  store.set('tk-theme', name);
  // The new scene opens out in a circle from the button that was pressed.
  if (!motion || !document.startViewTransition) { applyTheme(name); return; }
  const far = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  const transition = document.startViewTransition(() => applyTheme(name));
  transition.ready.then(() => {
    root.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${far}px at ${x}px ${y}px)`] },
      { duration: 750, easing: 'cubic-bezier(.3, .7, .2, 1)', pseudoElement: '::view-transition-new(root)' }
    );
  }).catch(() => {});
}
for (const b of themeButtons) {
  b.addEventListener('click', () => {
    const r = b.getBoundingClientRect();
    switchTheme(b.dataset.themePick, r.left + r.width / 2, r.top + r.height / 2);
  });
}

/* ---------- pointer light on cards ---------- */
for (const el of $$('[data-spot]')) {
  let queued = false, x = 0, y = 0;
  el.addEventListener('pointermove', (e) => {
    x = e.clientX; y = e.clientY;
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      const r = el.getBoundingClientRect();
      el.style.setProperty('--mx', `${x - r.left}px`);
      el.style.setProperty('--my', `${y - r.top}px`);
    });
  }, { passive: true });
}

/* ---------- "Who Gets the Call?" dots ---------- */
const grid = $('#call-grid');
const caption = $('#call-caption');
const phaseLabel = $('#call-phase');
// Twenty calls, ten patients who come back, and four who are in both groups.
const CALLED = [3, 8, 12, 17, 21, 26, 34, 39, 43, 45, 52, 58, 61, 66, 70, 77, 83, 88, 91, 96];
const BACK = [12, 34, 58, 83, 6, 29, 47, 64, 75, 93];
const PHASES = [
  { label: 'day 0', text: 'A nurse has time for twenty calls.', ms: 2400 },
  { label: 'day 0', text: 'The model picks the twenty it is most worried about.', ms: 3400 },
  { label: 'day 30', text: 'A month later ten are back, and four of them got a call.', ms: 5600 }
];
let phase = 0, phaseTimer = 0, gridVisible = false;

for (let i = 0; grid && i < 100; i++) {
  const dot = document.createElement('i');
  const c = CALLED.indexOf(i), b = BACK.indexOf(i);
  if (c > -1) dot.classList.add('called');
  if (b > -1) dot.classList.add('back');
  dot.style.setProperty('--i', c > -1 ? c : b > -1 ? b + 4 : 0);
  grid.append(dot);
}
function setPhase(n) {
  phase = n;
  grid.dataset.phase = n;
  caption.textContent = PHASES[n].text;
  phaseLabel.textContent = PHASES[n].label;
}
function runPhases() {
  clearTimeout(phaseTimer);
  if (!grid || !motion || !gridVisible || document.hidden) return;
  phaseTimer = setTimeout(() => { setPhase((phase + 1) % PHASES.length); runPhases(); }, PHASES[phase].ms);
}
function syncGrid() {
  if (!grid) return;
  if (!motion) { clearTimeout(phaseTimer); setPhase(2); return; }
  runPhases();
}
if (grid) setPhase(motion ? 0 : 2);
if (grid) new IntersectionObserver(([entry]) => {
  gridVisible = entry.isIntersecting;
  if (gridVisible && motion) setPhase(0);
  runPhases();
}, { threshold: 0.35 }).observe(grid);
document.addEventListener('visibilitychange', runPhases);

/* ---------- motion switch ---------- */
const motionButton = $('#motion');
function syncMotion() {
  root.classList.toggle('motion-off', !motion);
  motionButton.textContent = motion ? 'motion: on' : 'motion: off';
  motionButton.setAttribute('aria-pressed', String(!motion));
  motionButton.setAttribute('aria-label', motion ? 'Pause background motion' : 'Turn background motion on');
  if (window.Backdrop) window.Backdrop.setMotion(motion);
  syncGrid();
}
motionButton.addEventListener('click', () => { motion = !motion; store.set('tk-motion', motion ? 'on' : 'off'); syncMotion(); });
reduce.addEventListener('change', (e) => { if (e.matches) motion = false; syncMotion(); });

/* ---------- nav, reveals, copy ---------- */
const nav = $('.nav');
const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 12);
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) if (entry.isIntersecting) { entry.target.classList.add('in'); io.unobserve(entry.target); }
  }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
  $$('.reveal').forEach((el) => io.observe(el));
} else {
  $$('.reveal').forEach((el) => el.classList.add('in'));
}

// The terminal card types itself out the first time it comes into view.
const term = $('.term');
function checkTerm() {
  if (!term) return;
  const r = term.getBoundingClientRect();
  if (r.top < window.innerHeight * 0.8 && r.bottom > 0) {
    term.classList.add('play');
    window.removeEventListener('scroll', checkTerm);
  }
}
window.addEventListener('scroll', checkTerm, { passive: true });
checkTerm();

const toast = $('#toast');
let toastTimer = 0;
function say(message) {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('on'), 2600);
}
const copyButton = $('#copy');
if (copyButton) copyButton.addEventListener('click', async () => {
  const email = $('.prompt-mail').textContent.trim();
  try {
    await navigator.clipboard.writeText(email);
    say('Email address copied.');
  } catch {
    const range = document.createRange();
    range.selectNodeContents($('.prompt-mail'));
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
    say('Address selected. Press Ctrl+C to copy it.');
  }
});

applyTheme(theme);
syncMotion();
