'use strict';
/* global CompanionFlames */
// Renders the companion from the view pushed by the main process:
//   { mode: 'veille'|'focus'|'alerte', stats: {switches, malus, focus, late}|null,
//     alert: {returnTo, deadlineMs, windowMs}|null, paused }
(function () {
  var LAYOUT = {"canvas":1254,"states":{"focus":[{"id":"body","src":"assets/focus/body.png","x":0,"y":0,"w":1254,"h":1254},{"id":"left_hand","src":"assets/focus/left_hand.png","x":59,"y":394,"w":372,"h":385},{"id":"right_hand","src":"assets/focus/right_hand.png","x":840,"y":671,"w":400,"h":306}],"veille":[{"id":"body","src":"assets/veille/body.png","x":0,"y":0,"w":1254,"h":1254},{"id":"left_hand","src":"assets/veille/left_hand.png","x":230,"y":659,"w":188,"h":352},{"id":"right_hand","src":"assets/veille/right_hand.png","x":783,"y":746,"w":184,"h":321}],"alerte":[{"id":"body","src":"assets/alerte/body.png","x":0,"y":0,"w":1254,"h":1254},{"id":"left_hand","src":"assets/alerte/left_hand.png","x":72,"y":206,"w":340,"h":474},{"id":"right_hand","src":"assets/alerte/right_hand.png","x":805,"y":318,"w":417,"h":372}]}};
  // Effects (canvas units). Big flames sit behind the shaking rig: they only deform.
  var FX = {
    focus: [], veille: [],
    alerte: [
      { t: 'swoosh', x: 28, y: 320, w: 64, h: 150 }, { t: 'swoosh', x: 1162, y: 340, w: 64, h: 150, flip: 1 },
      { t: 'flame', mood: 'fierce', x: 90, y: -260, w: 840, h: 1460, rot: -6, big: 1 },
      { t: 'flame', mood: 'fierce', x: 600, y: -20, w: 680, h: 1220, rot: -20, flip: 1, big: 1, delay: -0.4 },
    ],
  };
  var ADJ = { alerte: { right_hand: { rot: -18, dx: 70, dy: -10 } } };
  var ORDER = { focus: ['body', 'left_hand', 'right_hand'], veille: ['body', 'left_hand', 'right_hand'], alerte: ['right_hand', 'body', 'left_hand'] };
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
    if (st === 'veille') ZS.forEach(function (z, i) {
      h += '<div class="zsvg z' + i + '" style="left:' + pct(z[0]) + ';top:' + pct(z[1]) + ';width:' + pct(z[2]) + ';height:' + pct(z[2]) + '"><div class="zin">' + CompanionFlames.zSVG('z' + (uid++)) + '</div></div>';
    });
    h += '</div><div class="hitbox hit"></div>';
    mascot.className = 'mascot st-' + st;
    mascot.innerHTML = h;
    clearTimeout(waveTimer);
    if (st === 'focus') { mascot.classList.add('waving'); waveTimer = setTimeout(function () { mascot.classList.remove('waving'); }, 2300); }
  }

  // ---- the front box: open button (veille), stats (focus / pause), countdown (alerte) ----
  function renderBox(v) {
    var key, html;
    if (v.mode === 'alerte' && v.alert) {
      key = 'alert:' + v.alert.returnTo;
      html = '<div class="back">Back to <span id="cdApp"></span></div><div class="cd" id="cd">10.0</div>';
    } else if (!v.stats) {
      key = 'open';
      html = '<button class="openbtn" id="openBtn" type="button">Open app</button>';
    } else {
      var s = v.stats;
      var ch = s.challenge && !celebrated[s.challenge.id] ? s.challenge : null;
      key = 'stats:' + JSON.stringify([s.switches, s.malus, s.focus, s.late, v.paused, ch && ch.id, ch && ch.xp]);
      var warn = s.late ? '<span class="warnbadge">!<span class="tt">Companion started after the session began: idle time before it launched is unknown, so focus may differ slightly from Promethee.</span></span>' : '';
      html = (ch ? '<div class="chal" id="chal"><span class="chal-k">Challenge</span><span class="chal-xp">+' + ch.xp + ' XP</span><span class="chal-t" id="chalT">--:--</span></div>' : '') +
        (v.paused ? '<span class="paused-tag">Paused</span>' : '') + '<div class="dash">' +
        '<div class="stat" id="statSw"><span class="num sw">' + s.switches + '</span><span class="lbl">switch</span></div>' +
        '<div class="stat"><span class="num ml">' + (s.malus > 0 ? '-' + s.malus : '0') + '</span><span class="lbl">penalty</span></div>' +
        '<div class="stat"><span class="num fc">' + s.focus + '</span><span class="lbl">focus ' + warn + '</span></div></div>';
    }
    if (key === boxKey) return;
    boxKey = key;
    fbox.className = 'fbox hit' + (v.mode === 'alerte' ? ' is-alert' : '');
    fbox.innerHTML = html;
    if (key.indexOf('stats:') === 0) measureBox();
    if (v.mode === 'alerte') { var app = document.getElementById('cdApp'); if (app) app.textContent = v.alert.returnTo || ''; }
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
    var c = document.getElementById('chal'); if (c) c.remove();
    var p = document.createElement('span'); p.className = 'xpwin'; p.textContent = '+' + xp + ' XP';
    flash.appendChild(p); setTimeout(function () { p.remove(); }, 2300);
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
    var sw = document.getElementById('statSw'); if (!sw) return;
    var p = document.createElement('span'); p.className = 'plus1'; p.textContent = '+1';
    sw.appendChild(p); setTimeout(function () { p.remove(); }, 1700);
    sw.classList.remove('hit1'); void sw.offsetWidth; sw.classList.add('hit1');
    setTimeout(function () { sw.classList.remove('hit1'); }, 1100);
  }
  function showOkFlash() {
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
      var first = state === null; state = v.mode;
      buildMascot(state);
      if (!first) { mascot.classList.add('pop'); setTimeout(function () { mascot.classList.remove('pop'); }, 360); }
    }
    renderBox(v);
    // end of an alert: back in time -> green check; too late -> "+1" on the switch counter
    if (prev && prev.mode === 'alerte' && prev.alert && v.mode === 'focus') {
      if (Date.now() < prev.alert.deadlineMs - 150) showOkFlash(); else showPlusOne();
    } else if (prev && prev.stats && v.stats && v.stats.switches > prev.stats.switches && Date.now() - lastPlusAt > 15000) {
      showPlusOne();   // a switch counted without us seeing the alert end
    }
    clearInterval(chalTimer); chalTimer = null;
    if (v.mode !== 'alerte' && v.stats && v.stats.challenge) { tickChallenge(); chalTimer = setInterval(tickChallenge, 500); }
    clearInterval(cdTimer); cdTimer = null;
    if (v.mode === 'alerte' && v.alert) { tickCountdown(); cdTimer = setInterval(tickCountdown, 100); }
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
    if (hit !== over && !down) { over = hit; window.companion.hover(hit); }
    if (down && !dragging && (Math.abs(e.screenX - down.x) > 3 || Math.abs(e.screenY - down.y) > 3)) { setDragging(true); window.companion.dragStart(); }
  });
  window.addEventListener('mousedown', function (e) {
    if (e.button !== 0 || !(e.target.closest && e.target.closest('.hit'))) return;
    if (e.target.closest('.warnbadge') || e.target.closest('.openbtn')) return;
    down = { x: e.screenX, y: e.screenY };
  });
  window.addEventListener('mouseup', function () {
    if (!down) return;
    if (dragging) { window.companion.dragEnd(); setDragging(false); }
    down = null;
  });
  fbox.addEventListener('click', function (e) { if (e.target.closest('.openbtn')) window.companion.click(); });
  // during a session there is no button: double-click the companion (or its box) to open Card Studio
  window.addEventListener('dblclick', function (e) {
    if (!(e.target.closest && e.target.closest('.hit')) || e.target.closest('.openbtn') || e.target.closest('.warnbadge')) return;
    window.companion.click();
  });
  document.addEventListener('mouseleave', function () { if (!down && over) { over = false; window.companion.hover(false); } });

  // ---- boot ----
  window.companion.init().then(function (cfg) {
    document.documentElement.style.setProperty('--m', cfg.size + 'px');
    if (cfg.fonts) {
      var st = document.createElement('style');
      st.textContent = "@font-face{font-family:'PromDisplay';src:url(" + cfg.fonts.display + ")}" +
        "@font-face{font-family:'PromMono';src:url(" + cfg.fonts.mono + ")}" +
        "@font-face{font-family:'PromSans';src:url(" + cfg.fonts.sans + ")}";
      document.head.appendChild(st);
    }
    if (!view) render({ mode: 'veille', stats: null, alert: null });
  });
  window.companion.onView(render);
})();
