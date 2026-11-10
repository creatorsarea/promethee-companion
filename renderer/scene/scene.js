'use strict';
/* global PrometheeCard */
// End-of-session card, "companion" variant. The usual card (card.js, with a layout that
// frees the bottom), a Windows-like taskbar, a cursor switching apps, and the real
// companion renderer (companion.js) driven by a scripted 20 s scenario that uses the
// session's real numbers (switches / penalty / focus / last bonus challenge).
//
// Two modes:
//   live    (Card Studio preview, iframe): real time, loops forever. Data via postMessage.
//   capture (?capture=1, offscreen window): virtual clock; __scene.frame(i) renders t=i/FPS.
(function () {
  const W = 1920, H = 1024, FPS = 12, DUR = 16, M = 285, TB = 102;   // DUR: multiple of the card's 4 s pulse
  const LAYOUT = { em: 400, ey: 300, railY: 780, railRight: 1100, railItems: ['STREAK', 'XP'] };
  const REST = [1250, 720];
  const capture = !!window.__capture;

  const cv = document.getElementById('card'), ctx = cv.getContext('2d');
  const cursor = document.getElementById('cursor'), tb = document.getElementById('tb');
  const makeCanvas = (w, h) => { const o = document.createElement('canvas'); o.width = w; o.height = h; return o; };
  document.documentElement.style.setProperty('--m', M + 'px');
  document.documentElement.style.setProperty('--tb', TB + 'px');

  let D = null, tierImg = null, viewCb = null, companionLoaded = false, appPos = {};
  let plan = null, cycleStart = 0, cycle = 0;

  // ---------- data ----------
  function penaltyFor(sw, trackedSec) { const h = Math.max((trackedSec || 3600) / 3600, 1 / 60); return Math.min(35, (sw / h) * 2); }
  function buildPlan(d) {
    const c = d.companion || {}, n = Math.max(0, c.switches | 0), tracked = c.trackedSeconds || 3600;
    const S2 = { switches: n, penalty: c.penalty != null ? c.penalty : Math.round(penaltyFor(n, tracked)), focus: c.focus != null ? c.focus : 100, late: false };
    const hasLate = n > 0;
    let S1 = S2;
    if (hasLate) {
      const m1 = penaltyFor(n - 1, tracked), m2 = penaltyFor(n, tracked);
      S1 = { switches: n - 1, penalty: Math.round(m1), focus: Math.max(0, Math.min(100, Math.round(S2.focus + (m2 - m1)))), late: false };
    }
    const xp = c.bonusXp || null;
    // the action starts right away (like the duration count-up), no idle intro
    const views = [
      [0.0, () => ({ mode: 'focus', stats: { ...S1, challenge: null, bonusDone: [] }, alert: null })],
      [1.0, now => ({ mode: 'alert', stats: S1, alert: { returnTo: 'VS Code', deadlineMs: now + 4000, windowMs: 10000 } })],
      [2.5, () => ({ mode: 'focus', stats: { ...S1, challenge: null, bonusDone: [] }, alert: null })],
    ];
    // after the alert shows, the cursor only waits ~0.8 s before going back (same speed)
    const cur = [[0, ...REST], [0.7, 'claude'], [0.8, 'claude', 1], [1.6, 'claude'],
      [2.3, 'vscode'], [2.4, 'vscode', 1], [4.2, 'vscode'], [5.2, ...REST]];
    const active = [[0, 'vscode'], [0.8, 'claude'], [2.4, 'vscode']];
    if (hasLate) {
      views.push([5.7, now => ({ mode: 'alert', stats: S1, alert: { returnTo: 'VS Code', deadlineMs: now + 3000, windowMs: 10000 } })]);
      views.push([8.7, () => ({ mode: 'focus', stats: { ...S2, challenge: null, bonusDone: [] }, alert: null })]);
      cur.splice(cur.length - 1, 1, [4.6, 'vscode'], [5.3, 'warp'], [5.4, 'warp', 1], [6.2, 'warp'], [7.2, ...REST]);
      active.push([5.4, 'warp']);
    }
    if (xp) {
      views.push([10.0, (now, id) => ({ mode: 'focus', stats: { ...S2, challenge: { id, xp, endsAt: now + 3000, frozenSec: null }, bonusDone: [] }, alert: null })]);
      views.push([13.2, (now, id) => ({ mode: 'focus', stats: { ...S2, challenge: null, bonusDone: [{ id, xp }] }, alert: null })]);
    }
    cur.push([DUR, ...REST]);
    return { views, cur, active, clicks: cur.filter(k => k[3]).map(k => k[0]) };
  }

  // ---------- taskbar ----------
  function buildTaskbar() {
    // icons come from the installed Promethee app (see lib/icons.js); neutral placeholders otherwise
    const START = '<svg width="34" height="34" viewBox="0 0 24 24" fill="#e9e1d7">' + [5, 12, 19].map(y => [5, 12, 19].map(x => `<circle cx="${x}" cy="${y}" r="1.9"/>`).join('')).join('') + '</svg>';
    const LETTER = { claude: 'C', vscode: 'V', warp: 'W', promethee: 'P' };
    const SEARCH = '<svg width="21" height="21" viewBox="0 0 16 16"><circle cx="6.5" cy="6.5" r="5" fill="none" stroke="#9a8f86" stroke-width="1.8"/><path d="M10.5 10.5L15 15" stroke="#9a8f86" stroke-width="1.8" stroke-linecap="round"/></svg>';
    // static markup only (constants above); everything dynamic is built with DOM APIs
    const staticNode = html => { const t = document.createElement('template'); t.innerHTML = html; return t.content; };
    const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
    const ic = k => {
      const d = el('div', 'ic'); d.dataset.app = k;
      const src = D && D.icons && D.icons[k];
      if (k === 'start') d.appendChild(staticNode(START));
      else if (typeof src === 'string' && src.startsWith('data:image/')) { const img = el('img'); img.src = src; img.alt = ''; d.appendChild(img); }
      else { const ph = el('span', 'ph'); ph.textContent = LETTER[k] || ''; d.appendChild(ph); }
      return d;
    };
    const search = el('div', 'search'); search.appendChild(staticNode(SEARCH)); search.appendChild(document.createTextNode('Search'));
    const clk = el('div', 'clk'); clk.id = 'clk';
    tb.replaceChildren(ic('start'), search, ic('vscode'), ic('claude'), ic('warp'), ic('promethee'), el('span', 'sp'), clk);
    ['vscode', 'claude', 'warp', 'promethee'].forEach(k => tb.querySelector(`[data-app="${k}"]`).classList.add('run'));
    appPos = {};
    tb.querySelectorAll('.ic').forEach(e => { const r = e.getBoundingClientRect(); appPos[e.dataset.app] = [r.left + r.width / 2 - 2, r.top + r.height / 2 - 4]; });
  }
  function setClock() {
    const el = document.getElementById('clk'); if (!el || !D) return;
    el.replaceChildren(document.createTextNode(D.clock || ''), document.createElement('br'), document.createTextNode(D.date || ''));
  }

  // ---------- per-frame drawing ----------
  function curAt(t) {
    const C = plan.cur;
    let a = C[0], b = C[C.length - 1];
    for (let i = 0; i < C.length - 1; i++) if (t >= C[i][0] && t <= C[i + 1][0]) { a = C[i]; b = C[i + 1]; break; }
    const P = k => (typeof k[1] === 'string' ? appPos[k[1]] : [k[1], k[2]]);
    const pa = P(a), pb = P(b), u = b[0] === a[0] ? 1 : (t - a[0]) / (b[0] - a[0]);
    const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
    return [pa[0] + (pb[0] - pa[0]) * e, pa[1] + (pb[1] - pa[1]) * e];
  }
  let lastClick = -1;
  function draw(t) {
    if (!D || !plan) return;
    PrometheeCard.drawFrame(ctx, D.card, { tierImg }, makeCanvas, t, 4.0, LAYOUT);
    const [cx, cy] = curAt(t);
    cursor.style.transform = `translate(${cx}px,${cy}px)`;
    cursor.classList.toggle('down', plan.clicks.some(c => t >= c - 0.06 && t <= c + 0.1));
    let act = plan.active[0][1]; for (const [tt, k] of plan.active) if (t >= tt) act = k;
    tb.querySelectorAll('.ic').forEach(e => e.classList.toggle('act', e.dataset.app === act));
    const ci = plan.clicks.findIndex(c => t >= c && t < c + 0.12);
    if (ci >= 0 && ci !== lastClick) {
      lastClick = ci;
      const r = document.createElement('div'); r.className = 'ripple'; r.style.left = (cx + 3) + 'px'; r.style.top = (cy + 3) + 'px';
      document.body.appendChild(r); setTimeout(() => r.remove(), 500);
    }
  }

  // ---------- scenario ----------
  function schedule() {
    if (!viewCb) return;
    cycle += 1; lastClick = -1;
    const id = 'bonus-' + cycle;
    cycleStart = Date.now();
    for (const [t, make] of plan.views) setTimeout(() => viewCb(make(Date.now(), id)), t * 1000);
  }
  function dock() {
    // the stats box top sits on the taskbar top
    const fb = document.getElementById('fbox'); const h = fb ? fb.offsetHeight : 0;
    if (h) document.documentElement.style.setProperty('--rb', (TB - 2 - h) + 'px');
  }

  // companion renderer API (companion.js talks to window.companion)
  window.companion = {
    init: () => Promise.resolve({ size: M, fonts: D && D.fonts ? { display: D.fonts.prometheeCondensed, mono: D.fonts.dmMono, sans: D.fonts.dmSans } : null }),
    onView: cb => { viewCb = cb; },
    hover() {}, click() {}, dragStart() {}, dragEnd() {}, boxHeight() { dock(); },
  };

  function loadImage(src) { return new Promise(r => { if (!src) return r(null); const i = new Image(); i.onload = () => r(i); i.onerror = () => r(null); i.src = src; }); }
  async function loadFonts(f) {
    if (!f) return;
    for (const [name, url] of [['PrometheeCondensed', f.prometheeCondensed], ['DMSans', f.dmSans], ['DMMono', f.dmMono], ['PromSans', f.dmSans], ['PromMono', f.dmMono]]) {
      try { const ff = new FontFace(name, `url(${url})`); await ff.load(); document.fonts.add(ff); } catch (e) {}
    }
  }
  function loadCompanion() {
    return new Promise(res => {
      if (companionLoaded) return res();
      const s = document.createElement('script'); s.src = 'companion.js';
      s.onload = () => { companionLoaded = true; res(); }; document.body.appendChild(s);
    });
  }

  async function setup(data) {
    D = data; PrometheeCard.resetLayout();
    plan = buildPlan(D);
    await loadFonts(D.fonts);
    tierImg = await loadImage(D.tierImage);
    buildTaskbar(); setClock();
    await loadCompanion();
  }
  function update(data) {
    const tierChanged = !D || data.tierImage !== D.tierImage;
    D = { ...D, ...data }; PrometheeCard.resetLayout(); setClock();
    if (tierChanged) loadImage(D.tierImage).then(i => { tierImg = i; });
  }

  // ---------- live mode (preview) ----------
  let liveRunning = false;
  function liveLoop() {
    const t = (Date.now() - cycleStart) / 1000;
    if (t >= DUR) { schedule(); }
    draw(Math.min(DUR, (Date.now() - cycleStart) / 1000));
    requestAnimationFrame(liveLoop);
  }
  window.addEventListener('message', async e => {
    const m = e.data || {};
    if (m.type === 'setup') {
      const restart = !liveRunning || (D && JSON.stringify(D.companion) !== JSON.stringify(m.data.companion));
      await setup(m.data);
      if (!liveRunning) { liveRunning = true; schedule(); setTimeout(dock, 300); requestAnimationFrame(liveLoop); }
      else if (restart) schedule();
    } else if (m.type === 'update') update(m.data);
  });

  // ---------- capture mode ----------
  const nativeFrame = () => new Promise(r => window.__nativeRAF(() => window.__nativeRAF(r)));
  window.__scene = {
    FPS, DUR, W, H,
    frames: () => Math.round(DUR * FPS),
    setup: async data => { await setup(data); await document.fonts.ready; return true; },
    frame: async i => {
      if (i === 0) { schedule(); window.__advance(30); dock(); }
      else window.__advance(1000 / FPS);
      draw(i / FPS);
      await nativeFrame();
      return true;
    },
  };
  if (!capture) window.parent && window.parent !== window && window.parent.postMessage({ type: 'scene-ready' }, '*');
})();
