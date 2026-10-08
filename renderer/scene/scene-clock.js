'use strict';
// Virtual clock for frame-exact capture (?capture=1). Must load before any other script.
// Replaces Date / timers / requestAnimationFrame with a clock that only moves when
// __advance(ms) is called, and steps CSS (Web Animations) + SVG (SMIL) animations by the
// same amount, so every captured frame is exactly t = i / FPS. In live mode it does nothing.
(function () {
  const capture = /[?&]capture=1\b/.test(location.search);
  window.__capture = capture;
  window.__nativeRAF = window.requestAnimationFrame.bind(window);
  if (!capture) return;

  const start = 1800000000000;
  let now = start, seq = 1;
  const timers = new Map();   // id -> { at, fn, args, iv }

  const RealDate = Date;
  class VDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(now); else super(...a); }
    static now() { return now; }
  }
  window.Date = VDate;
  try { Object.defineProperty(performance, 'now', { value: () => now - start, configurable: true }); } catch (e) {}

  window.setTimeout = (fn, ms, ...args) => { const id = seq++; timers.set(id, { at: now + Math.max(0, Number(ms) || 0), fn, args }); return id; };
  window.setInterval = (fn, ms, ...args) => { const iv = Math.max(1, Number(ms) || 1), id = seq++; timers.set(id, { at: now + iv, fn, args, iv }); return id; };
  window.clearTimeout = window.clearInterval = id => { timers.delete(id); };
  window.requestAnimationFrame = fn => window.setTimeout(() => fn(now - start), 16);
  window.cancelAnimationFrame = id => { timers.delete(id); };

  window.__advance = ms => {
    const end = now + ms;
    for (;;) {
      let nid = null, nt = Infinity;
      for (const [id, t] of timers) if (t.at <= end && t.at < nt) { nt = t.at; nid = id; }
      if (nid === null) break;
      const t = timers.get(nid);
      now = t.at;
      if (t.iv) t.at += t.iv; else timers.delete(nid);
      try { if (typeof t.fn === 'function') t.fn(...t.args); } catch (e) { console.error(e); }
    }
    now = end;
    for (const a of document.getAnimations()) { try { a.pause(); a.currentTime = (a.currentTime || 0) + ms; } catch (e) {} }
    document.querySelectorAll('svg').forEach(s => { try { s.pauseAnimations(); s.setCurrentTime(s.getCurrentTime() + ms / 1000); } catch (e) {} });
  };
})();
