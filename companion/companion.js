'use strict';
/* global CompanionFlames */
// Renders the companion from the view pushed by the main process:
//   { mode: 'idle'|'focus'|'alert', stats: {switches, penalty, focus, late}|null,
//     alert: {returnTo, deadlineMs, windowMs}|null, paused }
(function () {
  var LAYOUT = {"canvas":1254,"states":{"focus":[{"id":"body","src":"assets/focus/body.png","x":0,"y":0,"w":1254,"h":1254},{"id":"left_hand","src":"assets/focus/left_hand.png","x":59,"y":394,"w":372,"h":385},{"id":"right_hand","src":"assets/focus/right_hand.png","x":840,"y":671,"w":400,"h":306}],"idle":[{"id":"body","src":"assets/idle/body.png","x":0,"y":0,"w":1254,"h":1254},{"id":"left_hand","src":"assets/idle/left_hand.png","x":230,"y":659,"w":188,"h":352},{"id":"right_hand","src":"assets/idle/right_hand.png","x":783,"y":746,"w":184,"h":321}],"alert":[{"id":"body","src":"assets/alert/body.png","x":0,"y":0,"w":1254,"h":1254},{"id":"left_hand","src":"assets/alert/left_hand.png","x":72,"y":206,"w":340,"h":474},{"id":"right_hand","src":"assets/alert/right_hand.png","x":805,"y":318,"w":417,"h":372}]}};
  // Effects (canvas units). Big flames sit behind the shaking rig: they only deform.
  var FX = {
    focus: [], idle: [],
    alert: [
      { t: 'swoosh', x: 28, y: 320, w: 64, h: 150 }, { t: 'swoosh', x: 1162, y: 340, w: 64, h: 150, flip: 1 },
      { t: 'flame', mood: 'fierce', x: 90, y: -260, w: 840, h: 1460, rot: -6, big: 1 },
      { t: 'flame', mood: 'fierce', x: 600, y: -20, w: 680, h: 1220, rot: -20, flip: 1, big: 1, delay: -0.4 },
    ],
  };
  var ADJ = { alert: { right_hand: { rot: -18, dx: 70, dy: -10 } } };
  var ORDER = { focus: ['body', 'left_hand', 'right_hand'], idle: ['body', 'left_hand', 'right_hand'], alert: ['right_hand', 'body', 'left_hand'] };
  var ZS = [[830, 240, 125], [935, 110, 175], [1065, -40, 235]];
  var C = LAYOUT.canvas, uid = 0;
  var pct = function (v) { return (v / C * 100) + '%'; };

  var mascot = document.getElementById('mascot'), fbox = document.getElementById('fbox'), flash = document.getElementById('flash'), root = document.getElementById('root');
  var state = null, view = null, cdTimer = null, waveTimer = null, boxKey = '', lastPlusAt = 0;
  var chalTimer = null, celebrated = {}, seenDone = null;

  function fxHTML(f) {
    var tr = (f.flip ? 'scaleX(-1) ' : '') + 'rotate(' + (f.rot || 0) + 'deg)';
    var svg = f.t === 'flame' ? CompanionFlames.flameSVG({ mood: f.mood, uid: 'u' + (uid++), delay: f.delay || 0 }) : CompanionFlames.swooshSVG();
    return '<div class="fx fx-' + f.t + (f.big ? ' fx-big' : '') + '" style="left:' + pct(f.x) + ';top:' + pct(f.y) + ';width:' + pct(f.w) + ';height:' + pct(f.h) +
      ';transform:' + tr + ';transform-origin:50% 100%"><div class="fx-inner">' + svg + '</div></div>';
  }

  function buildMascot(st) {
    var h = '<div class="shadow"></div>';
    var fx = FX[st];
    if (fx.some(function (f) { return f.big; })) { h += '<div class="bgfx">'; fx.forEach(function (f) { if (f.big) h += fxHTML(f); }); h += '</div>'; }
    h += '<div class="rig">';
    fx.forEach(function (f) { if (!f.big) h += fxHTML(f); });
    var byId = {}; LAYOUT.states[st].forEach(function (l) { byId[l.id] = l; });
    ORDER[st].forEach(function (id) {
      var l = byId[id], a = (ADJ[st] && ADJ[st][id]) || {};
      h += '<div class="layer l-' + l.id + '" style="left:' + pct(l.x + (a.dx || 0)) + ';top:' + pct(l.y + (a.dy || 0)) + ';width:' + pct(l.w) + ';height:' + pct(l.h) +
        (a.rot ? ';transform:rotate(' + a.rot + 'deg)' : '') + '"><img src="' + l.src + '" alt="" draggable="false"></div>';
    });
    if (st === 'idle') ZS.forEach(function (z, i) {
      h += '<div class="zsvg z' + i + '" style="left:' + pct(z[0]) + ';top:' + pct(z[1]) + ';width:' + pct(z[2]) + ';height:' + pct(z[2]) + '"><div class="zin">' + CompanionFlames.zSVG('z' + (uid++)) + '</div></div>';
    });
    h += '</div><div class="hitbox hit"></div>';
    mascot.className = 'mascot st-' + st;
    mascot.innerHTML = h;
    clearTimeout(waveTimer);
    if (st === 'focus') { mascot.classList.add('waving'); waveTimer = setTimeout(function () { mascot.classList.remove('waving'); }, 2300); }
  }

  // ---- the front box: open button (idle), stats (focus / pause), countdown (alert) ----
  function renderBox(v) {
    var key, html;
    if (v.mode === 'alert' && v.alert) {
      key = 'alert:' + v.alert.returnTo;
      html = '<div class="back">Back to <span id="cdApp"></span></div><div class="cd" id="cd">10.0</div>';
    } else if (!v.stats) {
      key = 'open';
      html = '<button class="openbtn" id="openBtn" type="button">Open app</button>';
    } else {
      var s = v.stats;
      var ch = s.challenge && !celebrated[s.challenge.id] ? s.challenge : null;
      key = 'stats:' + JSON.stringify([s.switches, s.penalty, s.focus, s.late, v.paused, ch && ch.id, ch && ch.xp]);
      var warn = s.late ? '<span class="warnbadge">!<span class="tt">Companion started after the session began: idle time before it launched is unknown, so focus may differ slightly from Promethee.</span></span>' : '';
      html = (ch ? '<div class="chal" id="chal"><span class="chal-k">Challenge</span><span class="chal-xp">+' + ch.xp + ' XP</span><span class="chal-t" id="chalT">--:--</span></div>' : '') +
        (v.paused ? '<span class="paused-tag">Paused</span>' : '') + '<div class="dwrap"><div class="dash">' +
        '<div class="stat" id="statSw"><span class="num sw">' + s.switches + '</span><span class="lbl">switch</span></div>' +
        '<div class="stat"><span class="num ml">' + (s.penalty > 0 ? '-' + s.penalty : '0') + '</span><span class="lbl">penalty</span></div>' +
        '<div class="stat"><span class="num fc">' + s.focus + '</span><span class="lbl">focus ' + warn + '</span></div></div>' +
        // shown over the stats on hover, for people who don't know about the double-click (same size: the box height docks the window)
        '<span class="hoveropen" aria-hidden="true">Open app</span></div>';
    }
    if (key === boxKey) return;
    boxKey = key;
    fbox.className = 'fbox hit' + (v.mode === 'alert' ? ' is-alert' : '');
    fbox.innerHTML = html;
    if (key.indexOf('stats:') === 0) measureBox();
    if (v.mode === 'alert') { var app = document.getElementById('cdApp'); if (app) app.textContent = v.alert.returnTo || ''; }
  }

  // the stats box height decides how low the window docks (box top = taskbar top)
  function measureBox() {
    var send = function () { if (fbox.offsetHeight) window.companion.boxHeight(fbox.offsetHeight); };
    requestAnimationFrame(send);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(send);
  }

  function tickCountdown() {
    var el = document.getElementById('cd');
    if (!el || !view || !view.alert) return;
    el.textContent = (Math.max(0, view.alert.deadlineMs - Date.now()) / 1000).toFixed(1);
  }

  // ---- bonus challenge: time left, then a golden "+XP" when it's done ----
  function fmtLeft(sec) { sec = Math.max(0, Math.ceil(sec)); var m = Math.floor(sec / 60), x = sec % 60; return m + ':' + (x < 10 ? '0' : '') + x; }
  function tickChallenge() {
    var ch = view && view.stats && view.stats.challenge;
    var el = document.getElementById('chalT');
    if (!ch || celebrated[ch.id]) return;
    var left = ch.endsAt ? (ch.endsAt - Date.now()) / 1000 : ch.frozenSec;
    if (el) el.textContent = fmtLeft(left);
    if (ch.endsAt && left <= 0) celebrate(ch.id, ch.xp);
  }
  function celebrate(id, xp) {
    if (celebrated[id]) return;
    celebrated[id] = true;
    peek(2600);
    var c = document.getElementById('chal'); if (c) c.remove();
    var p = document.createElement('span'); p.className = 'xpwin'; p.textContent = '+' + xp + ' XP';
    popOut(p, flash);
    setTimeout(function () { p.remove(); }, 2300);
    fbox.classList.remove('gold'); void fbox.offsetWidth; fbox.classList.add('gold');
    setTimeout(function () { fbox.classList.remove('gold'); }, 1400);
    mascot.classList.add('pop'); setTimeout(function () { mascot.classList.remove('pop'); }, 360);
  }
  function checkChallenges(v) {
    var done = (v.stats && v.stats.bonusDone) || [];
    if (seenDone === null) { seenDone = {}; done.forEach(function (b) { seenDone[b.id] = true; celebrated[b.id] = true; }); return; }
    done.forEach(function (b) {
      if (seenDone[b.id]) return;
      seenDone[b.id] = true;
      celebrate(b.id, b.xp);          // no-op if our own timer already celebrated it
    });
  }

  function showPlusOne() {
    lastPlusAt = Date.now();
    peek(1800);
    var sw = document.getElementById('statSw'); if (!sw) return;
    var p = document.createElement('span'); p.className = 'plus1'; p.textContent = '+1';
    popOut(p, sw, sw); setTimeout(function () { p.remove(); }, 1700);
    sw.classList.remove('hit1'); void sw.offsetWidth; sw.classList.add('hit1');
    setTimeout(function () { sw.classList.remove('hit1'); }, 1100);
  }
  function showOkFlash() {
    peek(1000);
    var d = document.createElement('div'); d.className = 'okflash';
    d.innerHTML = '<svg viewBox="0 0 100 100" width="100%" height="100%"><path d="M22 52 L42 72 L80 30" fill="none" stroke="#0d2a14" stroke-width="20" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M22 52 L42 72 L80 30" fill="none" stroke="#4ade80" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    flash.appendChild(d); setTimeout(function () { d.remove(); }, 900);
  }

  function render(v) {
    var prev = view;
    if (v.stats) checkChallenges(v);
    view = v;
    if (v.mode !== state) {
      var first = state === null;
      if (!first && (state === 'idle') !== (v.mode === 'idle') && !v.paused) peek(2500);   // session started / ended
      state = v.mode;
      buildMascot(state);
      if (!first) { mascot.classList.add('pop'); setTimeout(function () { mascot.classList.remove('pop'); }, 360); }
    }
    renderBox(v);
    // end of an alert: back in time -> green check; too late -> "+1" on the switch counter
    if (prev && prev.mode === 'alert' && prev.alert && v.mode === 'focus') {
      if (Date.now() < prev.alert.deadlineMs - 150) showOkFlash(); else showPlusOne();
    } else if (prev && prev.stats && v.stats && v.stats.switches > prev.stats.switches && Date.now() - lastPlusAt > 15000) {
      showPlusOne();   // a switch counted without us seeing the alert end
    }
    clearInterval(chalTimer); chalTimer = null;
    if (v.mode !== 'alert' && v.stats && v.stats.challenge) { tickChallenge(); chalTimer = setInterval(tickChallenge, 500); }
    clearInterval(cdTimer); cdTimer = null;
    if (v.mode === 'alert' && v.alert) { tickCountdown(); cdTimer = setInterval(tickCountdown, 100); }
    updateOpen();
  }

  // ---- mouse: click-through except over .hit; mascot and box = drag, button = open Card Studio ----
  var over = false, down = null, dragging = false;
  function setDragging(on) {
    dragging = on;
    root.classList.toggle('dragging', on);
    document.querySelectorAll('svg').forEach(function (svg) { try { on ? svg.pauseAnimations() : svg.unpauseAnimations(); } catch (e) {} });
  }
  window.addEventListener('mousemove', function (e) {
    var hit = !!(e.target && e.target.closest && e.target.closest('.hit'));
    if (hit !== over && !down) { over = hit; window.companion.hover(hit); setHover(hit); }
    if (notch) showTip(e.target.closest && e.target.closest('.warnbadge'));
    if (down && !dragging && (Math.abs(e.screenX - down.x) > 3 || Math.abs(e.screenY - down.y) > 3)) { setDragging(true); window.companion.dragStart(); }
  });
  window.addEventListener('mousedown', function (e) {
    if (e.button !== 0 || !(e.target.closest && e.target.closest('.hit'))) return;
    if (e.target.closest('.warnbadge') || e.target.closest('.openbtn')) return;
    down = { x: e.screenX, y: e.screenY };
  });
  var justDragged = false, lastOpen = 0;
  window.addEventListener('mouseup', function () {
    if (!down) return;
    if (dragging) { window.companion.dragEnd(); setDragging(false); justDragged = true; setTimeout(function () { justDragged = false; }, 0); }
    down = null;
  });
  // one open per gesture: a double-click also fires two clicks
  function openStudio() { var now = Date.now(); if (now - lastOpen < 700) return; lastOpen = now; window.companion.click(); }
  fbox.addEventListener('click', function (e) {
    if (e.target.closest('.openbtn')) return openStudio();
    // stats box: a plain click (not the end of a drag, not on the warning badge) opens Card Studio, like the hover button says
    if (!justDragged && e.target.closest('.dwrap') && !e.target.closest('.warnbadge')) openStudio();
  });
  // the companion itself (and its box) still opens Card Studio on double-click
  window.addEventListener('dblclick', function (e) {
    if (!(e.target.closest && e.target.closest('.hit')) || e.target.closest('.openbtn') || e.target.closest('.warnbadge')) return;
    openStudio();
  });
  document.addEventListener('mouseleave', function () { showTip(null); if (!down && over) { over = false; window.companion.hover(false); setHover(false); } });

  // ---- macOS notch: hidden in the notch, springs out on an alert, a hover or a peek ----
  // Same look and motion as boringNotch (ContentView.swift / NotchShape.swift): a black NotchShape
  // whose top corners curve out into the menu bar and whose bottom corners are rounded, going from
  // the notch's own size (top radius 6, bottom 14) to the open size (19, 24) with a spring
  // (open: response 0.42 s, damping 0.8; close: 0.45 s, damping 1.0). The content scales from 0.8
  // anchored at the top and fades in (smooth, 0.35 s), clipped by the same shape.
  var notch = null, hovering = false, peekUntil = 0, peekTimer = null, leaveTimer = null;
  var R_CLOSED = { top: 6, bottom: 14 }, R_OPEN = { top: 19, bottom: 24 }, PAD = 12;
  var SPRING_OPEN = { response: 0.42, damping: 0.8 }, SPRING_CLOSE = { response: 0.45, damping: 1.0 }, SPRING_CONTENT = { response: 0.35, damping: 1.0 };
  var nshape, npath, nclip, ncontent, nzone;
  var shapeS = { x: 0, v: 0, to: 0 }, contentS = { x: 0, v: 0, to: 0 }, raf = 0, lastT = 0;

  // NotchShape.path(in:) for a rect centred in the window, top at y=0
  function notchPath(w, h, tr, br) {
    var W = root.clientWidth, x0 = (W - w) / 2, x1 = x0 + w;
    tr = Math.max(0, Math.min(tr, w / 4)); br = Math.max(0, Math.min(br, (w - 2 * tr) / 2, h - tr));
    var f = function (n) { return n.toFixed(2); };
    return 'M' + f(x0) + ' 0' +
      'Q' + f(x0 + tr) + ' 0 ' + f(x0 + tr) + ' ' + f(tr) +
      'L' + f(x0 + tr) + ' ' + f(h - br) +
      'Q' + f(x0 + tr) + ' ' + f(h) + ' ' + f(x0 + tr + br) + ' ' + f(h) +
      'L' + f(x1 - tr - br) + ' ' + f(h) +
      'Q' + f(x1 - tr) + ' ' + f(h) + ' ' + f(x1 - tr) + ' ' + f(h - br) +
      'L' + f(x1 - tr) + ' ' + f(tr) +
      'Q' + f(x1 - tr) + ' 0 ' + f(x1) + ' 0Z';
  }
  // SwiftUI spring(response, dampingFraction), mass 1: stiffness (2pi/response)^2, damping 4pi*zeta/response
  function stepSpring(s, p, dt) {
    var k = Math.pow(2 * Math.PI / p.response, 2), c = 4 * Math.PI * p.damping / p.response;
    for (var t = dt; t > 0; t -= 1 / 240) {           // fixed sub-steps: stable at any frame rate
      var h = Math.min(t, 1 / 240);
      s.v += (-k * (s.x - s.to) - c * s.v) * h;
      s.x += s.v * h;
    }
    if (Math.abs(s.x - s.to) < 1e-3 && Math.abs(s.v) < 1e-3) { s.x = s.to; s.v = 0; return false; }
    return true;
  }
  function frame(t) {
    var dt = Math.min(0.05, lastT ? (t - lastT) / 1000 : 1 / 60); lastT = t;
    var a = stepSpring(shapeS, shapeS.to ? SPRING_OPEN : SPRING_CLOSE, dt);
    var b = stepSpring(contentS, SPRING_CONTENT, dt);
    draw();
    raf = a || b ? requestAnimationFrame(frame) : 0;
    if (!raf) lastT = 0;
  }
  function draw() {
    var top = notch.topPad, cw = ncontent.offsetWidth, ch = ncontent.offsetHeight;
    var closed = { w: notch.width, h: top };
    var open = { w: Math.max(notch.width + 2 * R_OPEN.top, cw + 2 * (R_OPEN.top + PAD)), h: top + ch + PAD };
    root.style.setProperty('--nbottom', open.h + 'px');   // where the layer under the shape starts
    var p = shapeS.x, L = function (a, b) { return a + (b - a) * p; };
    var w = L(closed.w, open.w), h = Math.max(0, L(closed.h, open.h));
    var d = notchPath(w, h, L(R_CLOSED.top, R_OPEN.top), L(R_CLOSED.bottom, R_OPEN.bottom));
    npath.setAttribute('d', d);
    nclip.style.clipPath = "path('" + d + "')";
    // boringNotch: shadow while open (black 0.7, radius 6)
    nshape.style.filter = p > 0.05 ? 'drop-shadow(0 0 6px rgba(0,0,0,' + (0.7 * Math.min(1, p)).toFixed(2) + '))' : 'none';
    var c = contentS.x;
    ncontent.style.top = top + 'px';
    ncontent.style.opacity = Math.max(0, Math.min(1, c)).toFixed(3);
    ncontent.style.transform = 'translateX(-50%) scale(' + (0.8 + 0.2 * c).toFixed(4) + ')';
    root.classList.toggle('open', shapeS.to === 1);
  }
  function animate() { if (!raf) raf = requestAnimationFrame(frame); }

  // ---- what pops out of the box: the "+1", the "+XP" reward, the "!" note ----
  // Above the taskbar these rise over the box. In the notch, everything above the open shape's
  // bottom edge is the menu bar and the physical notch (hidden), and the shape clips its content.
  // So there they all go into one layer that starts at the shape's bottom edge (.nbelow, outside
  // the clip, top = --nbottom set by draw()), and companion.css (html.notch .nbelow) makes them
  // appear under the shape and travel down. The window is taller for that (compBounds, main.js).
  var nbelow = null, ntip = null;
  // host: where the element goes outside the notch; under: element to stay centred under in the notch
  function popOut(el, host, under) {
    if (!notch) { host.appendChild(el); return; }
    if (under) {
      // centre of `under` in window coordinates, without the content's opening scale
      var r = under.getBoundingClientRect(), c = root.clientWidth / 2, sc = 0.8 + 0.2 * contentS.x;
      el.style.left = (c + (r.left + r.width / 2 - c) / sc) + 'px';
    }
    nbelow.appendChild(el);
  }
  // hover note of a badge (its .tt text): pure CSS above the taskbar, in the layer under the notch
  function showTip(badge) {
    var tt = badge && badge.querySelector('.tt');
    if (!tt) { if (ntip) ntip.classList.remove('on'); return; }
    if (!ntip) { ntip = document.createElement('div'); ntip.className = 'ntip'; popOut(ntip); }
    ntip.textContent = tt.textContent;
    ntip.classList.add('on');
  }

  function setupNotch(n) {
    notch = n;
    var de = document.documentElement;
    de.classList.add('notch'); if (n.attached) de.classList.add('notch-attached');
    var NS = 'http://www.w3.org/2000/svg';
    nshape = document.createElementNS(NS, 'svg'); nshape.setAttribute('class', 'nshape');
    npath = document.createElementNS(NS, 'path'); nshape.appendChild(npath);
    nclip = document.createElement('div'); nclip.className = 'nclip';
    ncontent = document.createElement('div'); ncontent.className = 'ncontent';
    ncontent.appendChild(mascot); ncontent.appendChild(document.querySelector('.front'));
    nclip.appendChild(ncontent);
    nzone = document.createElement('div'); nzone.className = 'nzone hit';
    nzone.style.width = n.width + 'px'; nzone.style.height = Math.max(n.topPad, 6) + 'px';
    nbelow = document.createElement('div'); nbelow.className = 'nbelow';
    root.appendChild(nshape); root.appendChild(nclip); root.appendChild(nzone); root.appendChild(nbelow);
    draw();
    updateOpen();
    // the box changes size (stats, countdown, +1...): follow it while open
    if (window.ResizeObserver) new ResizeObserver(function () { if (shapeS.x > 0) { draw(); } }).observe(ncontent);
  }
  function updateOpen() {
    if (!notch) return;
    var alert = !!(view && view.mode === 'alert');
    var open = alert || hovering || Date.now() < peekUntil ? 1 : 0;
    if (open === shapeS.to) return;
    if (!open) showTip(null);
    shapeS.to = open; contentS.to = open;
    animate();
  }
  // short look out of the notch (session start / end, a switch counted, a challenge done)
  function peek(ms) {
    if (!notch) return;
    peekUntil = Math.max(peekUntil, Date.now() + ms);
    clearTimeout(peekTimer); peekTimer = setTimeout(updateOpen, peekUntil - Date.now() + 20);
    updateOpen();
  }
  function setHover(on) {
    if (!notch) return;
    clearTimeout(leaveTimer);
    if (on) { hovering = true; updateOpen(); }
    else leaveTimer = setTimeout(function () { hovering = false; updateOpen(); }, 500);
  }
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    SPRING_OPEN = SPRING_CLOSE = SPRING_CONTENT = { response: 0.05, damping: 1 };
  }

  // ---- boot ----
  window.companion.init().then(function (cfg) {
    document.documentElement.style.setProperty('--m', cfg.size + 'px');
    if (cfg.notch) setupNotch(cfg.notch);   // macOS: lives in the notch (below)
    if (cfg.fonts) {
      var st = document.createElement('style');
      st.textContent = "@font-face{font-family:'PromDisplay';src:url(" + cfg.fonts.display + ")}" +
        "@font-face{font-family:'PromMono';src:url(" + cfg.fonts.mono + ")}" +
        "@font-face{font-family:'PromSans';src:url(" + cfg.fonts.sans + ")}";
      document.head.appendChild(st);
    }
    if (!view) render({ mode: 'idle', stats: null, alert: null });
  });
  window.companion.onView(render);
})();
