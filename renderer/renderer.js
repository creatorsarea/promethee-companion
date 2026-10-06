'use strict';
// UI orchestration: session picker, live preview, publish/edit.
const FPS = 12, T = 4.0, QUALITY = 0.95;

const $ = id => document.getElementById(id);
const cv = $('cv'), ctx = cv.getContext('2d');
const makeCanvas = (w, h) => { const o = document.createElement('canvas'); o.width = w; o.height = h; return o; };

let tierImg = null;
let sessions = [], posts = {}, profile = { streak: 0 };
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
async function setTier(tier) { tierImg = await loadImage(await window.studio.tierImage(tier)); }

// --- live in-progress-session tracker (switch counter) ---
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function fmtElapsed(sec) { const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60); return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`; }

function renderLive(st) {
  const card = $('live'), empty = $('liveEmpty'), stats = $('liveStats'), grace = $('liveGrace');
  if (!st || !st.active) {
    card.className = 'live off';
    $('liveTitle').textContent = 'Session en cours';
    $('liveMeta').textContent = (st && st.error) ? 'indisponible' : '';
    empty.style.display = 'block'; stats.style.display = 'none'; grace.className = 'grace';
    return;
  }
  card.className = 'live on' + (st.paused ? ' paused' : '');
  $('liveTitle').textContent = st.task || 'Session en cours';
  $('liveMeta').textContent = (st.paused ? 'en pause · ' : '') + fmtElapsed(st.trackedSeconds);
  empty.style.display = 'none'; stats.style.display = 'flex';
  const sw = $('liveSwitch'); sw.textContent = st.appSwitchCount; sw.className = 'n' + (st.appSwitchCount > 0 ? ' warn' : '');
  $('liveFocus').textContent = st.focusFromSwitches;
  $('livePenalty').textContent = '-' + st.switchPenalty;
  $('liveApps').innerHTML = (st.topDurable && st.topDurable.length)
    ? st.topDurable.map(a => `<b>${esc(a.app)}</b> ${a.minutes}m`).join('<br>') : '';
  if (st.pending) {
    grace.className = 'grace show';
    const back = st.pending.returnTo ? ` sur <b>${esc(st.pending.returnTo)}</b>` : '';
    grace.innerHTML = `Tu es sur <b>${esc(st.pending.app)}</b> depuis ${st.pending.wallSecsOnApp}s. Reviens${back} avant qu'il atteigne 20s, sinon <b>+1 switch</b> (~-${st.nextSwitchCost} pts focus).`;
  } else {
    grace.className = 'grace';
  }

  const tip = $('liveTip');
  if (st.atCap && st.secondsToClearCap > 0) {
    tip.className = 'live-tip show';
    tip.innerHTML = `Tu es au plafond de malus (<b>35 pts</b>). Reste <b>${fmtElapsed(st.secondsToClearCap)}</b> de plus sans nouveau switch pour repasser a <b>${st.targetMalus} pts</b>.`;
  } else if (st.switchPenalty > 0) {
    tip.className = 'live-tip show';
    tip.innerHTML = `Malus actuel <b>-${st.switchPenalty} pts</b> (sous le plafond de 35). Garde tes detours < 20s pour qu'ils ne comptent pas.`;
  } else {
    tip.className = 'live-tip good show';
    tip.innerHTML = `Focus <b>propre</b> pour l'instant, aucun switch penalisant. Continue comme ca.`;
  }
}

async function pollLive() {
  let st = null;
  try { st = await window.studio.live(); } catch {}
  renderLive(st);
}
function startLivePolling() { pollLive(); setInterval(pollLive, 4000); }

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
}

async function init() {
  const info = await window.studio.init();
  if (!info || !info.ok) { $('status').textContent = 'Erreur init : ' + (info && info.error); return; }
  $('appv').textContent = 'Promethee ' + info.appVersion + (info.tokenWarning ? ' · token indisponible (autocomplete off)' : '');
  sessions = info.sessions; posts = info.posts || {}; profile = info.profile;

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
  sel.addEventListener('change', async () => { await setTier(sel.value); });

  applySession(0);
  $('publish').disabled = false;
  loop();
  startLivePolling();
}

async function publish() {
  const btn = $('publish'); btn.disabled = true;
  const st = $('status'); st.textContent = 'Generation des frames…';
  if (rafId) cancelAnimationFrame(rafId), rafId = null;

  const d = cardData();
  PrometheeCard.resetLayout();
  const N = Math.round(FPS * T), frames = [];
  for (let i = 0; i < N; i++) {
    PrometheeCard.drawFrame(ctx, d, { tierImg }, makeCanvas, i / FPS, T);
    frames.push(cv.toDataURL('image/webp', QUALITY).split(',')[1]);
    if (i % 6 === 0) { st.textContent = `Generation des frames… ${i + 1}/${N}`; await new Promise(r => setTimeout(r)); }
  }
  st.textContent = 'Assemblage et publication…';

  const res = await window.studio.publish({
    sessionId: current.sessionId, frames, delayMs: Math.round(1000 / FPS),
    body: $('body').value, tier: d.tier, handle: d.user, hidden: $('hidden').checked,
  });

  if (res.ok) {
    posts[current.sessionId] = { eventId: res.eventId, body: $('body').value, hidden: $('hidden').checked };
    const verb = res.mode === 'edit' ? 'Mis a jour' : (res.hidden ? 'Publie (cache)' : 'Publie (public)');
    st.textContent = `${verb} · ${(res.bytes / 1048576).toFixed(2)} Mo\nservi: ${res.servedType}, anime: ${res.servedAnimated ? 'oui' : 'NON'}, identique: ${res.servedIdentical ? 'oui' : 'NON'}\nevent: ${res.eventId || '(n/a)'}`;
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
