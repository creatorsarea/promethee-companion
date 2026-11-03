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

const styleLayout = () => (cardStyle === 'center' ? { center: true } : undefined);

function loop() {
  const t = ((performance.now() - t0) / 1000) % T;
  PrometheeCard.drawFrame(ctx, cardData(), { tierImg }, makeCanvas, t, T, styleLayout());
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
  cardStyle = style === 'companion' ? 'companion' : style === 'center' ? 'center' : 'classic';
  $('cardStyle').value = cardStyle;
  const f = $('scene'), cw = $('cw');
  if (cardStyle === 'companion') {
    cw.classList.add('is-scene'); f.hidden = false;
    if (!f.src) f.src = 'scene/scene.html'; else postScene('setup');
    fitScene();
    $('hint').textContent = "Preview of the companion variant (real session numbers: switches, penalty, focus, last challenge). The WebP is generated frame by frame when you publish.";
  } else {
    cw.classList.remove('is-scene'); f.hidden = true;
    $('hint').textContent = 'Live animated preview. The final WebP is generated when you publish.';
  }
}
window.addEventListener('message', e => {
  if (e.data && e.data.type === 'scene-ready') { sceneReady = true; postScene('setup'); }
});
new ResizeObserver(fitScene).observe(document.getElementById('cw'));

function applySession(idx) {
  current = sessions[idx];
  // rank = place inside the league (what the app shows after a session); only known live, so it is
  // filled for the latest session; older ones keep the value typed by hand
  if (idx === 0 && frNow && frNow.rank != null) $('rank').value = frNow.rank;
  else if (!$('rank').dataset.touched) $('rank').value = current.rank ?? 1;
  if (current.frGain != null) $('fr').value = current.frGain;
  $('streak').value = current.streak ?? profile.streak ?? 0;
  const ex = posts[current.sessionId];
  const btn = $('publish'), ps = $('poststate'), hid = $('hidden');
  if (ex) {
    $('body').value = ex.body || '';
    btn.textContent = 'Update session';
    hid.checked = ex.hidden; hid.disabled = true;
    ps.innerHTML = `Already published (${ex.hidden ? 'hidden' : 'public'}). The button updates image + text.`;
  } else {
    $('body').value = '';
    btn.textContent = 'Publish session';
    hid.disabled = false;
    ps.textContent = 'Not published yet. The button creates the post.';
  }
  postScene('setup');
}

let frNow = null;
// ---- helpers ----
const fmtH = sec => { const m = Math.round((sec || 0) / 60), h = Math.floor(m / 60); return h ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`; };
const fmtDay = d => new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- optional "follow the author": offered on the loading screen, then as a small chip in the
// header while it still applies. Acts only on click; nothing is followed automatically. ----
let followInfo = null, lastFollowClick = 0;
function setupFollow(r) {
  if (!r || !r.ok || r.state !== 'none') return;   // self, already following, request pending, or unavailable
  followInfo = r;
  for (const id of ['offerBtn', 'chipBtn']) { $(id).textContent = 'Follow @' + r.handle; $(id).addEventListener('click', doFollow); }
  $('offer').hidden = false;
}
async function doFollow() {
  $('offerBtn').disabled = $('chipBtn').disabled = true; lastFollowClick = Date.now();
  const res = await window.studio.follow();
  const msg = res.ok ? (res.state === 'requested' ? 'Follow request sent. Thank you!' : 'Thank you, that means a lot!') : 'Could not follow: ' + res.error;
  $('offerText').textContent = msg; $('chipText').textContent = msg;
  if (!res.ok) { $('offerBtn').disabled = $('chipBtn').disabled = false; return; }
  $('offerBtn').hidden = $('chipBtn').hidden = true; followInfo = null;
  setTimeout(() => { $('chip').classList.add('fade'); $('offer').style.opacity = 0; setTimeout(() => { $('chip').hidden = true; }, 950); }, 4000);
}

// ---- stats tab ----
function fig(k, v, s) { const f = el('div', 'fig'); f.append(el('div', 'k', k), el('div', 'v', v), el('div', 's', s || '')); return f; }
function renderStats(st) {
  const diff = st.weekSec - st.prevWeekSec, pct = st.prevWeekSec ? Math.round((diff / st.prevWeekSec) * 100) : null;
  $('heroVal').textContent = fmtH(st.weekSec);
  const tr = $('heroTrend'); tr.replaceChildren();
  if (pct == null) tr.textContent = `${st.sessionsWeek} sessions`;
  else { const b = el('b', diff >= 0 ? 'up' : 'down', `${diff >= 0 ? '▲' : '▼'} ${Math.abs(pct)}%`); tr.append(b, ` vs the week before, ${st.sessionsWeek} sessions`); }
  const figs = $('figs'); figs.replaceChildren(
    fig('Streak', `${st.streak} d`, `best ${st.maxStreak} d, ${st.activeDays30} of the last 30 days`),
    fig('Longest session', st.longest ? fmtH(st.longest.sec) : '-', st.longest ? fmtDay(st.longest.day) : ''),
    fig('Best hour', st.bestHour == null ? '-' : `${String(st.bestHour).padStart(2, '0')}:00`, st.bestDay ? `best day ${fmtH(st.bestDay.sec)} on ${fmtDay(st.bestDay.day)}` : ''));
  const bars = $('bars'), days = $('days'); bars.replaceChildren(); days.replaceChildren();
  const max = Math.max(1, ...st.series.map(x => x.sec));
  st.series.forEach((x, i) => {
    const b = el('div', 'b' + (i === st.series.length - 1 ? ' today' : '')), bar = el('i');
    bar.style.height = Math.max(2, Math.round((x.sec / max) * 100)) + '%'; b.title = `${fmtDay(x.day)}: ${fmtH(x.sec)}`; b.append(bar); bars.append(b);
    days.append(el('span', '', x.day.slice(8)));
  });
}

let cmpMode = 'global';
async function loadCompare(mode, force) {
  cmpMode = mode;
  $('tabGlobal').setAttribute('aria-pressed', mode === 'global'); $('tabFollowing').setAttribute('aria-pressed', mode === 'following');
  const list = $('cmpList'), note = $('cmpNote'); list.replaceChildren(el('div', 'cmpnote', 'Loading…')); note.textContent = '';
  let r; try { r = await window.studio.compare(mode, force); } catch (e) { r = { ok: false, error: String(e) }; }
  if (mode !== cmpMode) return; // another tab was selected meanwhile
  list.replaceChildren();
  if (!r || !r.ok) { list.append(el('div', 'cmpnote', 'Could not load this list: ' + (r && r.error ? r.error : 'unknown error'))); return; }
  const rows = r.data.rows, max = Math.max(1, ...rows.map(x => x.weekSec));
  if (rows.length < 2) { list.append(el('div', 'cmpnote', mode === 'following' ? 'You do not follow anybody yet.' : 'Nobody to show yet.')); return; }
  rows.forEach((u, i) => {
    const row = el('div', 'cmprow' + (u.isMe ? ' me' : '')), tr = el('div', 'tr'), fill = el('i');
    fill.style.width = Math.max(1, Math.round((u.weekSec / max) * 100)) + '%'; tr.append(fill);
    row.append(el('div', 'n', String(u.pos ?? i + 1)), el('div', 'nm', u.name), tr, el('div', 't', fmtH(u.weekSec)));
    list.append(row);
  });
  note.textContent = r.data.note ? r.data.note[0].toUpperCase() + r.data.note.slice(1) : '';
}
$('tabGlobal').addEventListener('click', () => loadCompare('global', false));
$('tabFollowing').addEventListener('click', () => loadCompare('following', false));
$('cmpRefresh').addEventListener('click', () => loadCompare(cmpMode, true));

// ---- tabs (more can be added: a button with data-tab + a pane with id pane<Name>) ----
function showTab(name, remember = true) {
  const tabs = [...document.querySelectorAll('#tabs [data-tab]')];
  if (!tabs.some(t => t.dataset.tab === name)) name = tabs[0].dataset.tab;
  for (const t of tabs) {
    const on = t.dataset.tab === name; t.setAttribute('aria-selected', on);
    const pane = $('pane' + t.dataset.tab[0].toUpperCase() + t.dataset.tab.slice(1)); if (pane) pane.hidden = !on;
    if (on) { $('ink').style.width = t.offsetWidth + 'px'; $('ink').style.transform = `translateX(${t.offsetLeft}px)`; }
  }
  if (name === 'session') fitScene();
  if (remember) { try { localStorage.setItem('tab', name); } catch {} }
}
document.querySelectorAll('#tabs [data-tab]').forEach(t => t.addEventListener('click', () => showTab(t.dataset.tab)));
window.addEventListener('resize', () => { const cur = document.querySelector('#tabs [aria-selected="true"]'); if (cur) showTab(cur.dataset.tab, false); });

// ---- boot: loading screen, then everything is ready at once ----
const STEPS = ['Reading your sessions', 'Working out your stats', 'Comparing with everyone'];
async function boot() {
  const t0b = Date.now(), msg = $('loadMsg');
  msg.textContent = STEPS[0];
  const followP = window.studio.followState().then(setupFollow).catch(() => {});
  await init();                                   // sessions, fonts, preview (hidden for now)
  document.body.classList.add('fonts');
  msg.textContent = STEPS[1];
  const statsR = await window.studio.stats().catch(() => null);
  msg.textContent = STEPS[2];
  await window.studio.compare('global', false).catch(() => {});   // warms the 10 min cache
  await followP;
  if (statsR && statsR.ok) renderStats(statsR.stats);
  loadCompare('global', false);
  // keep the screen up long enough to read the offer (and the thank-you after a click)
  while (Date.now() < Math.max(t0b + 2200, lastFollowClick ? lastFollowClick + 2800 : 0)) await sleep(150);
  if (followInfo) { $('chipText').textContent = ''; $('chip').hidden = false; }
  let tab = 'session'; try { tab = localStorage.getItem('tab') || tab; } catch {}
  $('app').classList.add('in'); showTab(tab, false);
  $('loader').classList.add('out'); setTimeout(() => { $('loader').hidden = true; }, 750);
}

async function init() {
  const info = await window.studio.init();
  if (!info || !info.ok) { $('status').textContent = 'Init error: ' + (info && info.error); return; }
  $('appv').textContent = 'Promethee ' + info.appVersion + (info.tokenWarning ? ', token unavailable so rank, league and FR are not filled in' : '');
  frNow = info.frNow || null; sessions = info.sessions; posts = info.posts || {}; profile = info.profile; fonts = info.fonts;

  for (const [name, url] of [['PrometheeCondensed', info.fonts.prometheeCondensed], ['DMSans', info.fonts.dmSans], ['DMMono', info.fonts.dmMono]]) {
    try { const ff = new FontFace(name, `url(${url})`); await ff.load(); document.fonts.add(ff); } catch {} // a missing font must never block startup
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
    if (tkey === ((info.frNow && info.frNow.tier) || info.defaultTier)) o.selected = true; sel.appendChild(o);
  }
  await setTier(sel.value);
  sel.addEventListener('change', async () => { await setTier(sel.value); postScene('update'); });
  for (const id of ['handle', 'rank', 'streak', 'places', 'fr']) $(id).addEventListener('input', () => { if (id === 'rank') $('rank').dataset.touched = '1'; postScene('update'); });

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
        if (i % 4 === 0) st.textContent = `Generating companion variant… ${i + 1}/${N} (quality ${Math.round(q * 100)}, ${(bytes / 1048576).toFixed(1)} MB + preview ${(disp.bytes / 1048576).toFixed(1)} MB)`;
        if (bytes > MAX_WEBP || disp.bytes > MAX_WEBP) break;
      }
    } finally { await window.studio.sceneEnd(); }
    if (bytes <= MAX_WEBP && disp && disp.bytes <= MAX_WEBP && frames.length === N) {
      return { ok: true, frames, displayFrames: disp.frames, delayMs: Math.round(1000 / begin.fps), bytes };
    }
    st.textContent = `Too heavy (${(bytes / 1048576).toFixed(1)} MB), retrying at lower quality…`;
  }
  return { ok: false, error: 'the companion variant exceeds 8 MB even at low quality' };
}

async function publish() {
  const btn = $('publish'); btn.disabled = true;
  const st = $('status'); st.textContent = 'Generating frames…';
  if (rafId) cancelAnimationFrame(rafId), rafId = null;

  const d = cardData();
  let frames = [], displayFrames = null, delayMs = Math.round(1000 / FPS);
  if (cardStyle === 'companion') {
    const r = await companionFrames(st);
    if (!r.ok) { st.textContent = 'Error: ' + r.error; t0 = performance.now(); loop(); btn.disabled = false; return; }
    frames = r.frames; displayFrames = r.displayFrames; delayMs = r.delayMs;
  } else {
    PrometheeCard.resetLayout();
    const N = Math.round(FPS * T), ds = displaySize(cv.width, cv.height);
    const disp = makeAnimEncoder(ds.w, ds.h, 0.9);
    for (let i = 0; i < N; i++) {
      PrometheeCard.drawFrame(ctx, d, { tierImg }, makeCanvas, i / FPS, T, styleLayout());
      frames.push(cv.toDataURL('image/webp', QUALITY).split(',')[1]);
      disp.add(cv);
      if (i % 6 === 0) { st.textContent = `Generating frames… ${i + 1}/${N}`; await new Promise(r => setTimeout(r)); }
    }
    displayFrames = disp.frames;
  }
  st.textContent = 'Assembling and publishing…';

  const res = await window.studio.publish({
    sessionId: current.sessionId, frames, displayFrames, delayMs,
    body: $('body').value, tier: d.tier, handle: d.user, hidden: $('hidden').checked, cardStyle,
  });

  if (res.ok) {
    posts[current.sessionId] = { eventId: res.eventId, body: $('body').value, hidden: $('hidden').checked };
    const verb = res.mode === 'edit' ? 'Updated' : (res.hidden ? 'Published (hidden)' : 'Published (public)');
    st.textContent = `${verb} · ${(res.bytes / 1048576).toFixed(2)} MB (feed preview ${res.displayBytes ? (res.displayBytes / 1048576).toFixed(2) + ' MB' : 'none'})\nserved: ${res.servedType}, animated: ${res.servedAnimated ? 'yes' : 'NO'}, identical: ${res.servedIdentical ? 'yes' : 'NO'}\nevent: ${res.eventId || '(n/a)'}`;
    const a = document.createElement('a'); a.href = res.url; a.textContent = res.url; a.target = '_blank';
    st.appendChild(document.createElement('br')); st.appendChild(a);
    applySession(parseInt($('sessionSel').value, 10)); // refresh labels/state
  } else {
    st.textContent = 'Error: ' + res.error;
  }
  t0 = performance.now(); loop(); btn.disabled = false;
}

$('publish').addEventListener('click', publish);
boot().catch(e => { $('loadMsg').textContent = 'Something went wrong: ' + e.message; $('loadMsg').style.opacity = 1; });
