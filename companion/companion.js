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

  var mascot = document.getElementById('mascot'), board = document.getElementById('board');
  var state = null, view = null, cdTimer = null, waveTimer = null;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

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
    if (st === 'alerte') h += '<div class="cdbox hit"><div class="back">Retourne sur <span id="cdApp"></span></div><div class="cd" id="cd">10.0</div></div>';
    mascot.className = 'mascot st-' + st;
    mascot.innerHTML = h;
    clearTimeout(waveTimer);
    if (st === 'focus') { mascot.classList.add('waving'); waveTimer = setTimeout(function () { mascot.classList.remove('waving'); }, 2300); }
  }

  function renderBoard(v) {
    if (v.mode === 'alerte' || !v.stats) { board.innerHTML = ''; return; }
    var s = v.stats;
    var warn = s.late ? '<span class="warnbadge">!<span class="tt">Compagnon lancé après le début de la session : l\'inactivité d\'avant son lancement n\'est pas connue, le focus peut différer un peu de Promethee.</span></span>' : '';
    board.innerHTML = '<div class="board hit"><div class="dash">' +
      (v.paused ? '<span class="paused-tag">En pause</span>' : '') +
      '<div class="stat"><span class="num sw">' + s.switches + '</span><span class="lbl">switch</span></div><div class="divider"></div>' +
      '<div class="stat"><span class="num ml">' + (s.malus > 0 ? '-' + s.malus : '0') + '</span><span class="lbl">malus</span></div><div class="divider"></div>' +
      '<div class="stat"><span class="num fc">' + s.focus + '</span><span class="lbl">focus ' + warn + '</span></div></div></div>';
  }

  function tickCountdown() {
    var el = document.getElementById('cd');
    if (!el || !view || !view.alert) return;
    var left = view.alert.deadlineMs - Date.now();
    if (left > 0) { el.className = 'cd'; el.textContent = (left / 1000).toFixed(1); }
    else { el.className = 'cd locked'; el.textContent = '+1 SWITCH'; }
  }

  function render(v) {
    var prev = view; view = v;
    if (v.mode !== state) {
      var first = state === null; state = v.mode;
      buildMascot(state);
      if (!first) { mascot.classList.add('pop'); setTimeout(function () { mascot.classList.remove('pop'); }, 360); }
    }
    var boardKey = JSON.stringify([v.mode, v.stats, v.paused]);
    if (!prev || boardKey !== JSON.stringify([prev.mode, prev.stats, prev.paused])) renderBoard(v);
    clearInterval(cdTimer); cdTimer = null;
    if (v.mode === 'alerte' && v.alert) {
      var app = document.getElementById('cdApp'); if (app) app.textContent = v.alert.returnTo || '';
      tickCountdown(); cdTimer = setInterval(tickCountdown, 100);
    }
  }

  // ---- mouse: the window is click-through except over .hit elements ----
  var over = false, down = null, dragging = false;
  window.addEventListener('mousemove', function (e) {
    var hit = !!(e.target && e.target.closest && e.target.closest('.hit'));
    if (hit !== over && !down) { over = hit; window.companion.hover(hit); }
    if (down && !dragging && (Math.abs(e.screenX - down.x) > 4 || Math.abs(e.screenY - down.y) > 4)) { dragging = true; window.companion.dragStart(); }
  });
  window.addEventListener('mousedown', function (e) {
    if (e.button !== 0 || !(e.target.closest && e.target.closest('.hit'))) return;
    if (e.target.closest('.warnbadge')) return;
    down = { x: e.screenX, y: e.screenY }; dragging = false;
  });
  window.addEventListener('mouseup', function () {
    if (!down) return;
    if (dragging) window.companion.dragEnd(); else window.companion.click();
    down = null; dragging = false;
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
