'use strict';
// UI orchestration: session picker, live preview, publish/edit.
const FPS = 12, T = 4.0, QUALITY = 0.95;

const $ = id => document.getElementById(id);
const cv = $('cv'), ctx = cv.getContext('2d');
const makeCanvas = (w, h) => { const o = document.createElement('canvas'); o.width = w; o.height = h; return o; };

let tierImg = null, tierUrl = null, fonts = null;
let sessions = [], posts = {}, profile = { streak: 0 };
let cardStyle = 'classic', sceneReady = false;
let current = null;        // selected session object
let rafId = null, t0 = performance.now();

function cardData() {
  return {
    user: $('handle').value, tier: $('tier').value, tierName: $('tier').selectedOptions[0].text,
    rank: $('rank').value, places: $('places').value, fr: $('fr').value,
    streak: parseInt($('streak').value, 10) || 0,
    durMin: current.durMin, xp: current.xp, session: current.session, displayName: profile.displayName,
  };
}

function loop() {
  const t = ((performance.now() - t0) / 1000) % T;
  PrometheeCard.drawFrame(ctx, cardData(), { tierImg }, makeCanvas, t, T);
  rafId = requestAnimationFrame(loop);
}
function loadImage(url) { return new Promise(res => { if (!url) return res(null); const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = url; }); }
async function setTier(tier) { tierUrl = await window.studio.tierImage(tier); tierImg = await loadImage(tierUrl); }

// ---- "companion" variant: preview in an iframe (live), frames rendered offscreen at publish ----
const pad2 = n => String(n).padStart(2, '0');
function sceneData() {
  const end = new Date(current.endedAt || Date.now());
  return {
    card: cardData(), tierImage: tierUrl, fonts, companion: current.companion || null,
    clock: `${pad2(end.getHours())}:${pad2(end.getMinutes())}`,
    date: `${pad2(end.getDate())}/${pad2(end.getMonth() + 1)}/${end.getFullYear()}`,
  };
}
function postScene(type) {
  const f = $('scene');
  if (cardStyle !== 'companion' || !sceneReady || !current) return;
  f.contentWindow.postMessage({ type, data: sceneData() }, '*');
}
function fitScene() {
  const cw = $('cw'), f = $('scene');
  f.style.transform = `scale(${cw.clientWidth / 1920})`;
}
function setCardStyle(style) {
  cardStyle = style === 'companion' ? 'companion' : 'classic';
  $('cardStyle').value = cardStyle;
  const f = $('scene'), cw = $('cw');
  if (cardStyle === 'companion') {
    cw.classList.add('is-scene'); f.hidden = false;
    if (!f.src) f.src = 'scene/scene.html'; else postScene('setup');
    fitScene();
    $('hint').textContent = "Apercu de la variante compagnon (chiffres reels de la session : switch, malus, focus, dernier defi). Le WebP est genere image par image au moment de publier.";
  } else {
    cw.classList.remove('is-scene'); f.hidden = true;
    $('hint').textContent = 'Apercu anime en direct. Le rendu final (WebP) est genere au moment de publier.';
  }
}
window.addEventListener('message', e => {
  if (e.data && e.data.type === 'scene-ready') { sceneReady = true; postScene('setup'); }
});
new ResizeObserver(fitScene).observe(document.getElementById('cw'));

function applySession(idx) {
  current = sessions[idx];
  $('sessbox').innerHTML =
    `duree  <b>${current.durLabel}</b>\nxp     <b>${current.xp}</b>\nstreak <b>${current.streak ?? profile.streak ?? 0} J</b>\n${current.session}` +
    (current.task ? `\ntache  <b>${current.task}</b>` : '');
  $('rank').value = current.rank ?? 1;
  $('streak').value = current.streak ?? profile.streak ?? 0;
  const ex = posts[current.sessionId];
  const btn = $('publish'), ps = $('poststate'), hid = $('hidden');
  if (ex) {
    $('body').value = ex.body || '';
    btn.textContent = 'Mettre a jour la session';
    hid.checked = ex.hidden; hid.disabled = true;
    ps.innerHTML = `Deja publie (${ex.hidden ? 'cache' : 'public'}). Le bouton met a jour image + texte.`;
  } else {
    $('body').value = '';
    btn.textContent = 'Publier la session';
    hid.disabled = false;
    ps.textContent = 'Pas encore publie. Le bouton cree le post.';
  }
  postScene('setup');
}

async function init() {
  const info = await window.studio.init();
  if (!info || !info.ok) { $('status').textContent = 'Erreur init : ' + (info && info.error); return; }
  $('appv').textContent = 'Promethee ' + info.appVersion + (info.tokenWarning ? ' · token indisponible (autocomplete off)' : '');
  sessions = info.sessions; posts = info.posts || {}; profile = info.profile; fonts = info.fonts;

  for (const [name, url] of [['PrometheeCondensed', info.fonts.prometheeCondensed], ['DMSans', info.fonts.dmSans], ['DMMono', info.fonts.dmMono]]) {
    const ff = new FontFace(name, `url(${url})`); await ff.load(); document.fonts.add(ff);
  }
  await document.fonts.ready;

  const ssel = $('sessionSel'); ssel.innerHTML = '';
  sessions.forEach((s, i) => { const o = document.createElement('option'); o.value = i; o.textContent = (posts[s.sessionId] ? '● ' : '○ ') + s.pickLabel; ssel.appendChild(o); });
  ssel.value = '0';
  ssel.addEventListener('change', () => applySession(parseInt(ssel.value, 10)));

  $('handle').value = info.handle;
  const sel = $('tier'); sel.innerHTML = '';
  for (const tkey of (info.availableTiers.length ? info.availableTiers : ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'legend'])) {
    const o = document.createElement('option'); o.value = tkey; o.textContent = tkey.charAt(0).toUpperCase() + tkey.slice(1);
    if (tkey === info.defaultTier) o.selected = true; sel.appendChild(o);
  }
  await setTier(sel.value);
  sel.addEventListener('change', async () => { await setTier(sel.value); postScene('update'); });
  for (const id of ['handle', 'rank', 'streak', 'places', 'fr']) $(id).addEventListener('input', () => postScene('update'));

  applySession(0);
  setCardStyle(info.cardStyle);
  $('cardStyle').addEventListener('change', () => { setCardStyle($('cardStyle').value); window.studio.saveConfig({ cardStyle }); });
  $('publish').disabled = false;
  loop();
}

// Render the companion variant frame by frame (offscreen window, virtual clock) and encode
// it as an animated WebP where each frame only carries the region that changed since the
// previous one (the card is mostly static, so a 20 s loop stays under 8 MB).
// Lowers the quality and retries if the result would still be too heavy.
const MAX_WEBP = 7.5 * 1024 * 1024;
function changedRect(cur, ref, w, h, thr) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    let row = y * w * 4;
    for (let x = 0; x < w; x++, row += 4) {
      if (Math.abs(cur[row] - ref[row]) > thr || Math.abs(cur[row + 1] - ref[row + 1]) > thr || Math.abs(cur[row + 2] - ref[row + 2]) > thr) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  x0 -= x0 % 2; y0 -= y0 % 2;                         // WebP frame offsets must be even
  return { x: x0, y: y0, w: Math.min(w - x0, x1 - x0 + 1), h: Math.min(h - y0, y1 - y0 + 1) };
}
// Promethee (1.3.33+) names feed images "<uuid>_<W>x<H>.webp" and, when the long edge is
// over 1200 px, shows a "display copy" "<uuid>_<W>x<H>.d.webp" (long edge 1200) in the feed;
// the full image only opens on click. Its own uploader cannot resize an animated WebP, so we
// build the display copy ourselves, animated, from the same frames.
const DISPLAY_LONG_EDGE = 1200;
function displaySize(w, h) {
  const k = DISPLAY_LONG_EDGE / Math.max(w, h);
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}
// Animated encoder: each frame after the first only carries the region that changed.
// add(src) draws src (any canvas) scaled to w x h.
function makeAnimEncoder(w, h, q) {
  const cnv = makeCanvas(w, h), c2 = cnv.getContext('2d', { willReadFrequently: true });
  const crop = makeCanvas(2, 2), cctx = crop.getContext('2d');
  c2.imageSmoothingQuality = 'high';
  let ref = null;
  const enc = { frames: [], bytes: 0 };
  enc.add = src => {
    c2.drawImage(src, 0, 0, w, h);
    const px = c2.getImageData(0, 0, w, h).data;
    let r = { x: 0, y: 0, w, h };
    if (ref) r = changedRect(px, ref, w, h, 6) || { x: 0, y: 0, w: 2, h: 2 };
    if (!ref) ref = new Uint8ClampedArray(px);
    else for (let y = r.y; y < r.y + r.h; y++) { const o = (y * w + r.x) * 4; ref.set(px.subarray(o, o + r.w * 4), o); }
    crop.width = r.w; crop.height = r.h;
    cctx.drawImage(cnv, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    const b64 = crop.toDataURL('image/webp', q).split(',')[1];
    enc.frames.push(enc.frames.length === 0 ? b64 : { data: b64, x: r.x, y: r.y });
    enc.bytes += b64.length * 0.75;
  };
  return enc;
}

async function companionFrames(st) {
  const enc = makeCanvas(1920, 1024), ectx = enc.getContext('2d');
  const crop = makeCanvas(2, 2), cctx = crop.getContext('2d');
  for (const q of [0.82, 0.7, 0.58]) {
    const begin = await window.studio.sceneBegin(sceneData());
    if (!begin.ok) return { ok: false, error: begin.error };
    const N = begin.frames, frames = []; let bytes = 0, ref = null, id = null, disp = null;
    try {
      for (let i = 0; i < N; i++) {
        const f = await window.studio.sceneFrame(i);
        const src = new Uint8Array(f.bgra.buffer, f.bgra.byteOffset, f.bgra.byteLength);
        if (!id || id.width !== f.width || id.height !== f.height) { id = new ImageData(f.width, f.height); enc.width = f.width; enc.height = f.height; }
        const px = id.data;
        for (let k = 0; k < src.length; k += 4) { px[k] = src[k + 2]; px[k + 1] = src[k + 1]; px[k + 2] = src[k]; px[k + 3] = 255; }
        ectx.putImageData(id, 0, 0);
        let r = { x: 0, y: 0, w: f.width, h: f.height };
        if (ref) r = changedRect(px, ref, f.width, f.height, 6) || { x: 0, y: 0, w: 2, h: 2 };
        // reference = what the viewer sees: update it only where we emit pixels
        if (!ref) ref = new Uint8ClampedArray(px);
        else for (let y = r.y; y < r.y + r.h; y++) { const o = (y * f.width + r.x) * 4; ref.set(px.subarray(o, o + r.w * 4), o); }
        crop.width = r.w; crop.height = r.h;
        cctx.drawImage(enc, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
        const b64 = crop.toDataURL('image/webp', q).split(',')[1];
        frames.push(i === 0 ? b64 : { data: b64, x: r.x, y: r.y });
        bytes += b64.length * 0.75;
        if (!disp) { const ds = displaySize(f.width, f.height); disp = makeAnimEncoder(ds.w, ds.h, q); }
        disp.add(enc);
        if (i % 4 === 0) st.textContent = `Generation de la variante compagnon… ${i + 1}/${N} (qualite ${Math.round(q * 100)}, ${(bytes / 1048576).toFixed(1)} Mo + apercu ${(disp.bytes / 1048576).toFixed(1)} Mo)`;
        if (bytes > MAX_WEBP || disp.bytes > MAX_WEBP) break;
      }
    } finally { await window.studio.sceneEnd(); }
    if (bytes <= MAX_WEBP && disp && disp.bytes <= MAX_WEBP && frames.length === N) {
      return { ok: true, frames, displayFrames: disp.frames, delayMs: Math.round(1000 / begin.fps), bytes };
    }
    st.textContent = `Trop lourd (${(bytes / 1048576).toFixed(1)} Mo), nouvel essai en qualite plus basse…`;
  }
  return { ok: false, error: 'la variante compagnon depasse 8 Mo meme en qualite basse' };
}

async function publish() {
  const btn = $('publish'); btn.disabled = true;
  const st = $('status'); st.textContent = 'Generation des frames…';
  if (rafId) cancelAnimationFrame(rafId), rafId = null;

  const d = cardData();
  let frames = [], displayFrames = null, delayMs = Math.round(1000 / FPS);
  if (cardStyle === 'companion') {
    const r = await companionFrames(st);
    if (!r.ok) { st.textContent = 'Erreur : ' + r.error; t0 = performance.now(); loop(); btn.disabled = false; return; }
    frames = r.frames; displayFrames = r.displayFrames; delayMs = r.delayMs;
  } else {
    PrometheeCard.resetLayout();
    const N = Math.round(FPS * T), ds = displaySize(cv.width, cv.height);
    const disp = makeAnimEncoder(ds.w, ds.h, 0.9);
    for (let i = 0; i < N; i++) {
      PrometheeCard.drawFrame(ctx, d, { tierImg }, makeCanvas, i / FPS, T);
      frames.push(cv.toDataURL('image/webp', QUALITY).split(',')[1]);
      disp.add(cv);
      if (i % 6 === 0) { st.textContent = `Generation des frames… ${i + 1}/${N}`; await new Promise(r => setTimeout(r)); }
    }
    displayFrames = disp.frames;
  }
  st.textContent = 'Assemblage et publication…';

  const res = await window.studio.publish({
    sessionId: current.sessionId, frames, displayFrames, delayMs,
    body: $('body').value, tier: d.tier, handle: d.user, hidden: $('hidden').checked, cardStyle,
  });

  if (res.ok) {
    posts[current.sessionId] = { eventId: res.eventId, body: $('body').value, hidden: $('hidden').checked };
    const verb = res.mode === 'edit' ? 'Mis a jour' : (res.hidden ? 'Publie (cache)' : 'Publie (public)');
    st.textContent = `${verb} · ${(res.bytes / 1048576).toFixed(2)} Mo (apercu feed ${res.displayBytes ? (res.displayBytes / 1048576).toFixed(2) + ' Mo' : 'aucun'})\nservi: ${res.servedType}, anime: ${res.servedAnimated ? 'oui' : 'NON'}, identique: ${res.servedIdentical ? 'oui' : 'NON'}\nevent: ${res.eventId || '(n/a)'}`;
    const a = document.createElement('a'); a.href = res.url; a.textContent = res.url; a.target = '_blank';
    st.appendChild(document.createElement('br')); st.appendChild(a);
    applySession(parseInt($('sessionSel').value, 10)); // refresh labels/state
  } else {
    st.textContent = 'Erreur : ' + res.error;
  }
  t0 = performance.now(); loop(); btn.disabled = false;
}

$('publish').addEventListener('click', publish);
init().catch(e => { $('status').textContent = 'Erreur : ' + e.message; });
