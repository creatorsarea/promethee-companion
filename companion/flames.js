// Hand-drawn animated flames for Promethee Companion (SVG + SMIL path morphing).
// flameSVG({mood, uid}) -> markup for a 100x160 flame whose base is at the bottom center.
// mood: 'calm' (focus), 'sleepy' (idle), 'angry' (alert)
(function (root) {
  var OUTLINE = '#2b0503';
  function outer(tx, ty, a, b) { // tip (tx,ty), a/b = side bulge offsets
    return 'M50 158 C' + (22 - a) + ' 156 ' + (8 - a) + ' 134 ' + (10 - a) + ' 108 C' + (12 - a) + ' 82 30 66 38 44 C42 32 40 20 ' + tx + ' ' + ty +
      ' C62 26 ' + (70 + b) + ' 44 ' + (78 + b) + ' 60 C' + (90 + b) + ' 84 ' + (94 + b) + ' 108 ' + (90 + b) + ' 128 C86 148 72 158 50 158 Z';
  }
  function inner(tx, ty, a) {
    return 'M50 150 C34 148 ' + (26 - a) + ' 134 ' + (28 - a) + ' 118 C' + (30 - a) + ' 102 40 92 44 78 C46 70 46 62 ' + tx + ' ' + ty +
      ' C58 70 ' + (64 + a) + ' 82 ' + (68 + a) + ' 94 C' + (74 + a) + ' 110 74 128 68 140 C64 148 58 150 50 150 Z';
  }
  function core(ty) {
    return 'M50 146 C42 146 38 138 40 128 C42 118 48 ' + (ty + 8) + ' 50 ' + ty + ' C54 ' + (ty + 8) + ' 60 120 60 130 C60 140 56 146 50 146 Z';
  }
  function side(tx, ty) {
    return 'M24 132 C14 128 8 118 10 106 C11 98 ' + (tx + 4) + ' ' + (ty + 8) + ' ' + tx + ' ' + ty + ' C' + (tx + 6) + ' ' + (ty + 14) + ' 20 112 24 118 C27 122 30 128 24 132 Z';
  }
  var MOODS = {
    calm:   { dur: 1.15, o: [[34, 4, 0, 0], [46, 0, 2, -2], [30, 9, -1, 2]], i: [[40, 50, 0], [49, 44, 2], [37, 56, -1]], c: [104, 98, 108], s: [[6, 86], [9, 80], [4, 90]],
              g1: '#e83a00', g2: '#f07a18', i1: '#f39a1c', i2: '#ffd25a' },
    sleepy: { dur: 2.6, o: [[38, 10, 0, 0], [44, 6, 1, -1], [34, 13, -1, 1]], i: [[42, 56, 0], [47, 52, 1], [40, 60, -1]], c: [108, 104, 110], s: [[6, 92], [8, 88], [5, 95]],
              g1: '#e0461a', g2: '#ef8a2a', i1: '#f2a53a', i2: '#ffd978' },
    fierce: { dur: 0.85, o: [[33, 2, -1, 2], [46, 1, 2, -2], [29, 5, -2, 3]], i: [[38, 48, -1], [50, 44, 2], [36, 52, -1]], c: [102, 96, 105], s: [[4, 82], [8, 77], [2, 86]],
              g1: '#d81f00', g2: '#f05a10', i1: '#f2801c', i2: '#ffc64a' },
    angry:  { dur: 0.42, o: [[30, 0, -2, 3], [52, 2, 4, -3], [26, 6, -3, 4]], i: [[36, 46, -1], [54, 42, 3], [34, 52, -2]], c: [100, 92, 104], s: [[2, 80], [10, 74], [0, 86]],
              g1: '#d81f00', g2: '#f05a10', i1: '#f2801c', i2: '#ffc64a' }
  };
  function anim(vals, dur, delay) {
    return '<animate attributeName="d" dur="' + dur + 's" begin="' + (delay || 0) + 's" repeatCount="indefinite" calcMode="spline" ' +
      'keyTimes="0;0.33;0.66;1" keySplines=".45 0 .55 1;.45 0 .55 1;.45 0 .55 1" values="' + vals.concat([vals[0]]).join(';') + '"/>';
  }
  function flameSVG(opts) {
    var m = MOODS[opts.mood || 'calm'], u = opts.uid || ('f' + Math.random().toString(36).slice(2, 7)), d = opts.delay || 0;
    var O = m.o.map(function (p) { return outer(p[0], p[1], p[2], p[3]); });
    var I = m.i.map(function (p) { return inner(p[0], p[1], p[2]); });
    var Cc = m.c.map(core);
    var Sd = m.s.map(function (p) { return side(p[0], p[1]); });
    return '<svg viewBox="0 0 100 160" preserveAspectRatio="xMidYMax meet" style="overflow:visible;width:100%;height:100%;display:block">' +
      '<defs><linearGradient id="' + u + 'o" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + m.g1 + '"/><stop offset="1" stop-color="' + m.g2 + '"/></linearGradient>' +
      '<linearGradient id="' + u + 'i" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + m.i1 + '"/><stop offset="1" stop-color="' + m.i2 + '"/></linearGradient></defs>' +
      '<path d="' + Sd[0] + '" fill="url(#' + u + 'o)" stroke="' + OUTLINE + '" stroke-width="5" stroke-linejoin="round">' + anim(Sd, m.dur * 0.9, d - 0.2) + '</path>' +
      '<path d="' + O[0] + '" fill="url(#' + u + 'o)" stroke="' + OUTLINE + '" stroke-width="6" stroke-linejoin="round">' + anim(O, m.dur, d) + '</path>' +
      '<path d="' + I[0] + '" fill="url(#' + u + 'i)">' + anim(I, m.dur, d - m.dur * 0.15) + '</path>' +
      '<path d="' + Cc[0] + '" fill="#fff1a6" opacity=".85">' + anim(Cc, m.dur * 0.8, d - m.dur * 0.3) + '</path>' +
      '<path d="M40 70 C38 82 34 92 33 104" fill="none" stroke="#fff6d0" stroke-width="4" stroke-linecap="round" opacity=".55"/>' +
      '</svg>';
  }
  // small angular spark (alert)
  function sparkSVG(uid) {
    return '<svg viewBox="0 0 40 60" style="overflow:visible;width:100%;height:100%;display:block">' +
      '<path d="M8 58 C6 40 14 26 30 4 C28 20 34 26 36 34 C38 44 30 56 8 58 Z" fill="#f05a10" stroke="#2b0503" stroke-width="4" stroke-linejoin="round"/>' +
      '<path d="M14 50 C14 40 20 32 28 20 C28 32 32 38 30 44 C28 50 22 52 14 50 Z" fill="#ffc64a"/></svg>';
  }
  // motion lines beside the fists (alert)
  function swooshSVG() {
    return '<svg viewBox="0 0 60 140" style="overflow:visible;width:100%;height:100%;display:block">' +
      '<path d="M40 6 C14 30 8 80 30 134" fill="none" stroke="#2b0503" stroke-width="14" stroke-linecap="round"/>' +
      '<path d="M40 6 C14 30 8 80 30 134" fill="none" stroke="#f05a10" stroke-width="7" stroke-linecap="round"/></svg>';
  }
  // hand-drawn "Z" for the sleep state: thick rounded stroke, dark outline, warm gradient, glossy highlight
  function zSVG(uid) {
    var d = 'M28 18 L74 18 L28 82 L76 82';
    return '<svg viewBox="0 0 100 100" style="overflow:visible;width:100%;height:100%;display:block">' +
      '<defs><linearGradient id="' + uid + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd25a"/><stop offset="1" stop-color="#f08a10"/></linearGradient></defs>' +
      '<path d="' + d + '" fill="none" stroke="' + OUTLINE + '" stroke-width="40" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="' + d + '" fill="none" stroke="url(#' + uid + ')" stroke-width="23" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M32 14 L60 14" fill="none" stroke="#fff6d0" stroke-width="5" stroke-linecap="round" opacity=".85"/>' +
      '<path d="M36 79 L48 79" fill="none" stroke="#fff6d0" stroke-width="4" stroke-linecap="round" opacity=".5"/>' +
      '</svg>';
  }
  root.CompanionFlames = { flameSVG: flameSVG, sparkSVG: sparkSVG, swooshSVG: swooshSVG, zSVG: zSVG };
})(typeof window !== 'undefined' ? window : globalThis);
