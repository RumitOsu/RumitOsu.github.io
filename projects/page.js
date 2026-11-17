'use strict';
/* Small helpers for project pages built on page.css. It loads after ../../app.js, which already
   handles the backdrop picker, the motion switch, the nav, the pointer light and scroll reveals.
   This file adds the reading progress line, the picture viewer, gallery arrows, a flag for
   visuals that should only animate while on screen, and a warning about unfinished placeholders.
   Everything here is optional: the page reads the same with JavaScript turned off. */
(function () {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const root = document.documentElement;
  const still = () => root.classList.contains('motion-off') || matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- reading progress ---------- */
  const sheet = $('.sheet');
  if (sheet) {
    const bar = document.createElement('div');
    bar.className = 'progress';
    bar.setAttribute('aria-hidden', 'true');
    document.body.append(bar);
    let queued = false;
    const update = () => {
      queued = false;
      const r = sheet.getBoundingClientRect();
      const span = r.height - innerHeight * 0.6;
      const read = span > 0 ? Math.min(1, Math.max(0, (innerHeight * 0.4 - r.top) / span)) : 1;
      bar.style.setProperty('--read', read.toFixed(4));
    };
    const ask = () => { if (!queued) { queued = true; requestAnimationFrame(update); } };
    addEventListener('scroll', ask, { passive: true });
    addEventListener('resize', ask);
    update();
  }

  /* ---------- picture viewer ---------- */
  // Any image with the class "zoomable" opens larger when clicked, with its caption underneath.
  const zoomables = $$('img.zoomable');
  if (zoomables.length && window.HTMLDialogElement) {
    const box = document.createElement('dialog');
    box.className = 'lightbox';
    box.innerHTML = '<img alt=""><p><span></span><button type="button">close ✕</button></p>';
    document.body.append(box);
    const big = $('img', box), caption = $('span', box);
    box.addEventListener('click', (e) => { if (e.target === box || e.target.closest('button')) box.close(); });
    for (const img of zoomables) {
      img.tabIndex = 0;
      img.setAttribute('role', 'button');
      img.setAttribute('aria-label', 'Open larger: ' + (img.alt || 'image'));
      const open = () => {
        big.src = img.dataset.full || img.currentSrc || img.src;
        big.alt = img.alt;
        const fig = img.closest('figure');
        caption.textContent = fig && $('figcaption', fig) ? $('figcaption', fig).textContent.trim() : img.alt;
        box.showModal();
      };
      img.addEventListener('click', open);
      img.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    }
  }

  /* ---------- gallery arrows ---------- */
  for (const gallery of $$('.gallery')) {
    const track = $('.gallery-track', gallery);
    if (!track) continue;
    const nav = document.createElement('div');
    nav.className = 'gallery-nav';
    nav.innerHTML = '<button type="button" aria-label="Previous">←</button><button type="button" aria-label="Next">→</button>';
    gallery.append(nav);
    const [prev, next] = $$('button', nav);
    const step = () => (track.firstElementChild ? track.firstElementChild.getBoundingClientRect().width + 16 : track.clientWidth);
    const sync = () => {
      prev.disabled = track.scrollLeft < 4;
      next.disabled = track.scrollLeft + track.clientWidth > track.scrollWidth - 4;
      nav.hidden = track.scrollWidth <= track.clientWidth + 4;
    };
    prev.addEventListener('click', () => track.scrollBy({ left: -step(), behavior: still() ? 'auto' : 'smooth' }));
    next.addEventListener('click', () => track.scrollBy({ left: step(), behavior: still() ? 'auto' : 'smooth' }));
    track.addEventListener('scroll', sync, { passive: true });
    addEventListener('resize', sync);
    sync();
  }

  /* ---------- animate only while on screen ---------- */
  // Elements with data-inview get the class "inview" while they are visible, so a page's CSS
  // animations can run only then (and its scripts can listen for the "inview" event).
  const watched = $$('[data-inview]');
  if (watched.length && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        entry.target.classList.toggle('inview', entry.isIntersecting);
        entry.target.dispatchEvent(new CustomEvent('inview', { detail: entry.isIntersecting }));
      }
    }, { threshold: 0.25 });
    watched.forEach((el) => io.observe(el));
  } else {
    watched.forEach((el) => el.classList.add('inview'));
  }

  /* ---------- unfinished placeholders ---------- */
  const todos = $$('.todo');
  if (todos.length) console.warn(`This page still has ${todos.length} placeholder(s) to fill in:`, todos.map((t) => t.textContent.trim()));
})();
