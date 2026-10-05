// Shared card renderer (Canvas 2D). Draws one animated frame of the session card.
// Pure drawing logic, no DOM/Node deps, so it runs in the app and in tests.
(function (global) {
  'use strict';

  const W = 1920, H = 1024;
  const CREAM = '#f4eadf', DIM = '#968b82', DIM2 = '#706760';
  const ORANGE = '#e1633a', ORANGE_SOFT = '#e87850';

  // Tint used for the soft glow behind the emblem, per tier.
  const GLOW = {
    bronze: '170,100,55', silver: '150,160,172', gold: '210,170,70',
    platinum: '150,196,198', diamond: '104,150,190', legend: '220,90,72',
    champion: '150,196,198'
  };

  const easeOut = x => { x = Math.max(0, Math.min(1, x)); return 1 - Math.pow(1 - x, 3); };

  function tx(ctx, x, y, s, font, fill, align, base, ls) {
    ctx.font = font; ctx.fillStyle = fill;
    ctx.textAlign = align || 'left'; ctx.textBaseline = base || 'alphabetic';
    ctx.letterSpacing = (ls || 0) + 'px';
    ctx.fillText(s, x, y);
    ctx.letterSpacing = '0px';
  }
  function measure(ctx, s, font, ls) {
    ctx.font = font; ctx.letterSpacing = (ls || 0) + 'px';
    const w = ctx.measureText(s).width; ctx.letterSpacing = '0px'; return w;
  }
  function roundRect(ctx, x, y, w, h, r, fill) {
    ctx.beginPath(); ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
  }

  // Original fallback gem (used only when the tier asset is missing).
  function drawGem(octx, size, tier) {
    const P = {
      bronze: ['#e0aa78', '#be784a', '#a06034', '#6e3e20', '#4a2814'],
      silver: ['#e6ecf2', '#b0bac6', '#8c96a3', '#5c6572', '#3a404a'],
      gold: ['#f8e096', '#e0ba5c', '#c69c3c', '#967024', '#644a16'],
      platinum: ['#e0f0f2', '#b0d0d2', '#8cb4b8', '#5c8286', '#38565a'],
      diamond: ['#def4f7', '#96bad6', '#6e96b6', '#405e7b', '#223448'],
      legend: ['#f8ba96', '#e47860', '#d05646', '#96322c', '#601e1c']
    }[tier] || ['#def4f7', '#96bad6', '#6e96b6', '#405e7b', '#223448'];
    const [light, midl, mid, dark, edge] = P;
    const ex = size / 2, ey = size / 2, R = size * 0.30;
    const Tp = [ex, ey - 1.15 * R], Lg = [ex - R, ey - 0.10 * R], Rg = [ex + R, ey - 0.10 * R], B = [ex, ey + 1.32 * R];
    const Ta = [ex - 0.40 * R, ey - 0.55 * R], Tb = [ex + 0.40 * R, ey - 0.55 * R], M = [ex, ey - 0.10 * R], Pc = [ex, ey + 0.46 * R];
    const poly = (pts, c) => { octx.beginPath(); octx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) octx.lineTo(pts[i][0], pts[i][1]); octx.closePath(); octx.fillStyle = c; octx.fill(); };
    const line = (pts, st, w) => { octx.beginPath(); octx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) octx.lineTo(pts[i][0], pts[i][1]); octx.strokeStyle = st; octx.lineWidth = w; octx.lineJoin = 'round'; octx.stroke(); };
    poly([Tp, Rg, B, Lg], mid);
    poly([Tp, Ta, Tb], light); poly([Tp, Ta, Lg], midl); poly([Tp, Tb, Rg], dark);
    poly([Ta, Lg, M], mid); poly([Ta, M, Tb], light); poly([Tb, M, Rg], dark);
    poly([Lg, Rg, Pc], mid); poly([Lg, Pc, B], midl); poly([Rg, Pc, B], edge);
    line([Lg, Rg], 'rgba(16,24,34,.6)', R * 0.016);
    line([Tp, Rg, B, Lg, Tp], 'rgba(228,240,250,.6)', R * 0.024);
    line([Ta, Tb], 'rgba(228,240,250,.45)', R * 0.016);
    line([[ex - 0.62 * R, ey - 0.44 * R], [ex - 0.12 * R, ey - 0.14 * R]], 'rgba(255,255,255,.7)', R * 0.036);
  }

  // Build an emblem layer (tier image or fallback gem) with an optional glint sweep.
  function emblemLayer(makeCanvas, tierImg, size, tier, t, T) {
    const off = makeCanvas(size, size);
    const o = off.getContext('2d');
    if (tierImg && tierImg.width) o.drawImage(tierImg, 0, 0, size, size);
    else drawGem(o, size, tier);
    const gs = (t - 1.6) / 0.8; // glint window
    if (gs >= 0 && gs <= 1) {
      o.save();
      o.globalCompositeOperation = 'source-atop'; // keep within emblem pixels
      const x0 = -size * 0.25 + gs * size * 1.5;
      const grad = o.createLinearGradient(x0 - 90, 0, x0 + 90, size);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(0.5, 'rgba(255,255,255,0.45)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      o.fillStyle = grad; o.fillRect(0, 0, size, size);
      o.restore();
    }
    return off;
  }

  let _heroY = null;
  function heroY(ctx, fdur, durSample) {
    if (_heroY === null) {
      const sz = parseInt(fdur, 10);
      ctx.font = fdur; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
      const m = ctx.measureText(durSample);
      const top = -(m.actualBoundingBoxAscent || sz * 0.5);
      const bot = sz * 0.46 + 32; // label baseline area
      const zoneC = (112 + 846) / 2;
      _heroY = zoneC - (top + bot) / 2;
    }
    return _heroY;
  }
  function resetLayout() { _heroY = null; }

  // data: {user,durMin,tier,tierName,rank,places,fr,streak,xp,session}
  // assets: {tierImg|null}; makeCanvas(w,h) -> offscreen canvas
  function drawFrame(ctx, data, assets, makeCanvas, t, T) {
    // background
    ctx.fillStyle = '#0b0908'; ctx.fillRect(0, 0, W, H);
    let g = ctx.createRadialGradient(470, 330, 0, 470, 330, 560);
    g.addColorStop(0, 'rgba(58,37,26,.75)'); g.addColorStop(1, 'rgba(58,37,26,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    g = ctx.createRadialGradient(960, 512, 320, 960, 512, 1150);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.62)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    const EM = 460, ex = 470, ey = 330;
    const p = 0.5 + 0.5 * Math.sin(2 * Math.PI * t / T);
    const dy = Math.round(6 * Math.sin(2 * Math.PI * t / T));
    // glow pulse behind emblem
    const gc = GLOW[data.tier] || GLOW.diamond;
    const gg = ctx.createRadialGradient(ex, ey + dy, 0, ex, ey + dy, EM * 0.62);
    gg.addColorStop(0, `rgba(${gc},${(0.16 + 0.20 * p).toFixed(3)})`);
    gg.addColorStop(1, `rgba(${gc},0)`);
    ctx.fillStyle = gg; ctx.fillRect(ex - EM, ey - EM, EM * 2, EM * 2);
    // emblem
    const layer = emblemLayer(makeCanvas, assets.tierImg, EM, data.tier, t, T);
    ctx.drawImage(layer, ex - EM / 2, ey - EM / 2 + dy);

    // header
    tx(ctx, 90, 78, 'PROMETHEE', '600 34px DMSans', CREAM, 'left', 'alphabetic', 5);
    tx(ctx, W - 90, 78, data.user, '30px DMSans', DIM, 'right', 'alphabetic', 0);
    ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(90, 112); ctx.lineTo(W - 90, 112); ctx.stroke();

    tx(ctx, ex, ey + EM * 0.52, 'LIGUE ' + data.tierName.toUpperCase(), '600 42px DMSans', CREAM, 'center', 'alphabetic', 1);
    const rk = 'RANK #' + data.rank, frk = '26px DMMono', wrk = measure(ctx, rk, frk, 4);
    const ry0 = ey + EM * 0.52 + 58;
    roundRect(ctx, ex - wrk / 2 - 20, ry0, wrk + 40, 46, 23, 'rgba(255,255,255,.08)');
    tx(ctx, ex, ry0 + 23, rk, frk, CREAM, 'center', 'middle', 4);

    const k = easeOut(t / 1.2);
    const py = ry0 + 70;
    const pv = parseInt(data.places, 10) || 0;
    if (pv !== 0) {
      const pl = Math.round(Math.abs(pv) * k) + ' places', fpl = '600 74px DMSans';
      const wfinal = measure(ctx, Math.abs(pv) + ' places', fpl, 0);
      const sx = ex - (wfinal + 40) / 2;
      ctx.fillStyle = ORANGE; ctx.beginPath();
      if (pv > 0) { ctx.moveTo(sx, py + 54); ctx.lineTo(sx + 30, py + 54); ctx.lineTo(sx + 15, py + 20); }
      else { ctx.moveTo(sx, py + 22); ctx.lineTo(sx + 30, py + 22); ctx.lineTo(sx + 15, py + 56); }
      ctx.closePath(); ctx.fill();
      tx(ctx, sx + 48, py + 62, pl, fpl, ORANGE, 'left', 'alphabetic', 0);
    }
    const frn = parseInt(data.fr, 10);
    if (Number.isFinite(frn) && frn !== 0) {
      const s = (frn >= 0 ? '+' : '') + Math.round(frn * k) + ' FR';
      tx(ctx, ex, py + 124, s, '600 44px DMSans', ORANGE_SOFT, 'center', 'alphabetic', 0);
    }

    // hero duration (count-up), vertically centered on the content zone
    const mins = Math.round(data.durMin * k);
    const dur = Math.floor(mins / 60) + 'H ' + String(mins % 60).padStart(2, '0') + 'M';
    let sz = 440;
    const sample = Math.floor(data.durMin / 60) + 'H ' + String(data.durMin % 60).padStart(2, '0') + 'M';
    while (sz > 60 && measure(ctx, sample, sz + 'px PrometheeCondensed', 0) > 820) sz -= 4;
    const fdur = sz + 'px PrometheeCondensed';
    const HY = heroY(ctx, fdur, sample);
    tx(ctx, 1410, HY, dur, fdur, CREAM, 'center', 'middle', 0);
    tx(ctx, 1410, HY + sz * 0.46, 'TOTAL SESSION', '32px DMMono', DIM, 'center', 'alphabetic', 10);

    // rail
    const rail = 846;
    ctx.strokeStyle = 'rgba(255,255,255,.07)';
    ctx.beginPath(); ctx.moveTo(90, rail); ctx.lineTo(W - 90, rail); ctx.stroke();
    const streakVal = Math.round((parseInt(data.streak, 10) || 0) * k) + ' J';
    const items = [['STREAK', streakVal], ['XP', data.xp], ['SESSION', data.session]];
    const segw = (W - 180) / 3;
    items.forEach((it, i) => {
      const x = 90 + segw * i + 32;
      tx(ctx, x, rail + 46, it[0], '24px DMMono', DIM2, 'left', 'alphabetic', 4);
      tx(ctx, x, rail + 96, String(it[1]), '600 38px DMSans', CREAM, 'left', 'alphabetic', 0);
      if (i > 0) { ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.beginPath(); ctx.moveTo(90 + segw * i, rail + 16); ctx.lineTo(90 + segw * i, rail + 88); ctx.stroke(); }
    });
  }

  const api = { drawFrame, resetLayout, W, H };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.PrometheeCard = api;
})(typeof window !== 'undefined' ? window : globalThis);
