'use strict';
// Promethee Companion: a small mascot above the taskbar that shows the live session
// state (switches, switch penalty, focus score computed like Promethee) and warns on an
// app switch. Clicking it opens Card Studio (end-of-session card generator).
const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen, powerMonitor, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { resolve } = require('./lib/paths');
const { readAll, fmtDur, fmtSession } = require('./lib/db');
const { loadToken } = require('./lib/token');
const fr = require('./lib/fr');
const social = require('./lib/social');
const stats = require('./lib/stats');
const update = require('./lib/update');
const { loadSceneIcons } = require('./lib/icons');
const { findAnonKey, isAnon } = require('./lib/anonkey');
const { setAnonKey } = require('./lib/api');
// Public anon key: read from the installed Promethee (cached per app version in config.json).
function ensureAnon(paths) {
  const cfg = readConfig();
  if (cfg.anonKey && cfg.anonKeyFor === paths.appVersion && isAnon(cfg.anonKey)) return setAnonKey(cfg.anonKey);
  let k = null;
  try { k = findAnonKey(paths.asarPath); } catch {}
  if (!k && cfg.anonKey && isAnon(cfg.anonKey)) k = cfg.anonKey; // keep the previous one if the new bundle cannot be read
  if (k) { setAnonKey(k); patchConfig({ anonKey: k, anonKeyFor: paths.appVersion }); }
}
const FR_FILE = path.join(app.getPath('userData'), 'fr-history.json');
async function snapFr() { try { const _p = resolve(); ensureAnon(_p); const { token } = loadToken(_p); const st = await fr.fetchFrState(token); if (st) { fr.record(FR_FILE, st); return st; } } catch {} return null; }
const { fetchMyPosts } = require('./lib/api');
const { publishOrEdit } = require('./lib/publish');
const { Worker } = require('worker_threads');
const { computeIdle, createSampler } = require('./lib/idle');
const { computeView } = require('./lib/companion-view');
const foreground = require('./lib/foreground');
const macLoginItem = require('./lib/login-item-mac');

const IS_MAC = process.platform === 'darwin';

const APP_TITLE = 'Promethee Companion';
app.setName('promethee-companion');
app.setAppUserModelId('fr.creatorsarea.promethee-companion');

// ---------------- config ----------------
const CONFIG = path.join(app.getPath('userData'), 'config.json');
const OLD_CONFIG = path.join(app.getPath('appData'), 'promethee-card-studio', 'config.json');
const readConfig = () => {
  try { return JSON.parse(fs.readFileSync(CONFIG, 'utf8')); } catch {}
  try { return JSON.parse(fs.readFileSync(OLD_CONFIG, 'utf8')); } catch {}   // keep Card Studio prefs
  return {};
};
const writeConfig = o => { try { fs.mkdirSync(path.dirname(CONFIG), { recursive: true }); fs.writeFileSync(CONFIG, JSON.stringify(o, null, 2)); } catch {} };
const patchConfig = p => { const c = { ...readConfig(), ...p }; writeConfig(c); return c; };
const toDataURL = (file, mime) => `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;

// ---------------- single instance ----------------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => openStudio());
  app.whenReady().then(boot);
}

// ======================================================================
// Card Studio window (unchanged feature set: build + publish the session card)
// ======================================================================
const TIERS = ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'legend'];
let studioWin = null;

function openStudio() {
  if (studioWin && !studioWin.isDestroyed()) {
    if (studioWin.isMinimized()) studioWin.restore();
    studioWin.show(); studioWin.focus();
    return;
  }
  studioWin = new BrowserWindow({
    width: 1320, height: 940, minWidth: 900, minHeight: 640, backgroundColor: '#0a0807', title: APP_TITLE,
    icon: trayIcon(64),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  studioWin.setMenuBarVisibility(false);
  studioWin.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  studioWin.on('closed', () => { studioWin = null; if (IS_MAC && app.dock) app.dock.hide(); });
  // macOS: the companion runs without a Dock icon (see boot); Card Studio is a normal window, so
  // it gets one while it is open, to be found again with the Dock or Cmd-Tab.
  if (IS_MAC && app.dock) app.dock.show().catch(() => {});
}

ipcMain.handle('studio:init', async () => {
  const paths = resolve();
  ensureAnon(paths);
  const { profile, sessions } = await readAll(paths, 30);
  const fontFile = n => path.join(paths.fontsDir, n);
  const fonts = {
    prometheeCondensed: toDataURL(fontFile('PrometheeCondensed.ttf'), 'font/ttf'),
    dmSans: toDataURL(fontFile('DMSans.ttf'), 'font/ttf'),
    dmMono: toDataURL(fontFile('DMMono-Medium.ttf'), 'font/ttf'),
  };
  const availableTiers = TIERS.filter(t => fs.existsSync(path.join(paths.tiersDir, t + '.png')));
  const cfg = readConfig();

  let posts = {}, tokenWarning = null;
  try { const { token, uid } = loadToken(paths); posts = await fetchMyPosts(token, uid); }
  catch (e) { tokenWarning = e.message; }
  const frNow = await snapFr();
  const frHistory = fr.loadHistory(FR_FILE);
  for (const s of sessions) s.frGain = fr.gainFor(frHistory, s.startedAt, s.endedAt);

  return {
    ok: true, appVersion: paths.appVersion, profile, sessions, posts, fonts, icons: loadSceneIcons(paths), availableTiers, tokenWarning, frNow,
    defaultTier: cfg.lastTier && availableTiers.includes(cfg.lastTier) ? cfg.lastTier : (availableTiers.includes('diamond') ? 'diamond' : availableTiers[0] || 'diamond'),
    handle: cfg.handle || ('@' + String(profile.displayName || 'user').toLowerCase().replace(/\s+/g, '')),
    audience: ['everyone', 'friends', 'only_me'].includes(cfg.lastAudience) ? cfg.lastAudience : 'only_me',
    cardStyle: cfg.cardStyle === 'centre' ? 'center' : (['companion', 'center'].includes(cfg.cardStyle) ? cfg.cardStyle : 'classic'), // 'centre' = legacy value
  };
});

// Running session (from the cache the companion refreshes every 2 s): shaped like a finished
// session so the card preview can use it, flagged live. null when nothing is running.
ipcMain.handle('studio:live', async () => {
  const st = db;
  if (!st || !st.active) return null;
  const tracked = st.trackedSeconds + (st.paused ? 0 : (Date.now() - dbReadAt) / 1000);
  const hours = Math.max(tracked / 3600, 1 / 60), sw = Number(st.appSwitchCount) || 0;
  const penalty = Math.min(35, (sw / hours) * 2), d = fmtDur(tracked);
  return {
    live: true, sessionId: st.sessionId, task: st.task || null, startedAt: st.startedAt, endedAt: null, paused: !!st.paused,
    durMin: d.durMin, durLabel: d.label, xp: '+0', session: fmtSession(st.startedAt, Date.now()),
    companion: { switches: sw, focus: Math.round(100 - penalty), penalty: Math.round(penalty), trackedSeconds: Math.round(tracked), idleSeconds: 0, bonusXp: null },
  };
});
// Same data as studio:init for the session list, refreshed after a session ends
ipcMain.handle('studio:sessions', async () => {
  try {
    const paths = resolve(); ensureAnon(paths);
    const { sessions } = await readAll(paths, 30);
    let posts = {}; try { const { token, uid } = loadToken(paths); posts = await fetchMyPosts(token, uid); } catch {}
    const frNow = await snapFr();
    const h = fr.loadHistory(FR_FILE);
    for (const s of sessions) s.frGain = fr.gainFor(h, s.startedAt, s.endedAt);
    return { ok: true, sessions, posts, frNow };
  } catch (e) { return { ok: false, error: e.message }; }
});
// Update notice: checked a little after startup, then every 6 hours; shown in the tray menu and the
// Card Studio header. Opening is limited to links into this repository.
let updateInfo = null;
async function refreshUpdate() {
  updateInfo = await update.checkForUpdate(app.getVersion());
  if (tray) buildTrayMenu();
}
ipcMain.handle('studio:updateInfo', () => updateInfo);
ipcMain.handle('studio:openUpdate', () => { if (updateInfo && update.isOwnUrl(updateInfo.url)) shell.openExternal(updateInfo.url); });

// Stats section: local numbers (no network) and an on-demand comparison with other people
ipcMain.handle('studio:stats', async () => {
  try { return { ok: true, stats: await stats.localStats(resolve()) }; } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('studio:compare', async (_e, { mode, force } = {}) => {
  try {
    const paths = resolve(); ensureAnon(paths); const { token, uid } = loadToken(paths);
    return { ok: true, data: await stats.compare(token, uid, mode === 'following' ? 'following' : 'global', !!force) };
  } catch (e) { return { ok: false, error: e.message }; }
});
// Optional "follow the author" button (explicit click only)
ipcMain.handle('studio:followState', async () => {
  try { const paths = resolve(); ensureAnon(paths); const { token, uid } = loadToken(paths); return { ok: true, state: await social.followState(token, uid), handle: social.AUTHOR.handle }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('studio:follow', async () => {
  try { const paths = resolve(); ensureAnon(paths); const { token, uid } = loadToken(paths); await social.follow(token); return { ok: true, state: await social.followState(token, uid) }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('studio:tierImage', async (_e, tier) => {
  try { const paths = resolve(); const f = path.join(paths.tiersDir, tier + '.png'); return fs.existsSync(f) ? toDataURL(f, 'image/png') : null; }
  catch { return null; }
});

ipcMain.handle('studio:publish', async (_e, payload) => {
  try {
    const paths = resolve();
    ensureAnon(paths);
    const { token, uid, secondsLeft } = loadToken(paths);
    const posts = await fetchMyPosts(token, uid);
    const existing = posts[payload.sessionId] || null;
    const toFrame = f => (typeof f === 'string' ? Buffer.from(f, 'base64') : { buffer: Buffer.from(f.data, 'base64'), x: f.x, y: f.y });
    const frames = payload.frames.map(toFrame);
    const displayFrames = Array.isArray(payload.displayFrames) && payload.displayFrames.length ? payload.displayFrames.map(toFrame) : null;
    const res = await publishOrEdit({
      token, uid, sessionId: payload.sessionId,
      eventId: existing ? existing.eventId : null,
      body: payload.body || null, title: null, clientVersion: paths.appVersion,
      frames, displayFrames, delayMs: payload.delayMs,
      audience: ['everyone', 'friends', 'only_me'].includes(payload.audience) ? payload.audience : 'only_me',
      currentAudience: existing ? (existing.audience || (existing.hidden ? 'only_me' : 'everyone')) : null,
    });
    patchConfig({ lastTier: payload.tier, handle: payload.handle, lastAudience: res.audience, ...(payload.cardStyle ? { cardStyle: payload.cardStyle } : {}) });
    return { ok: true, tokenMinutes: Math.round(secondsLeft / 60), ...res };
  } catch (err) { return { ok: false, error: err.message }; }
});

// ---- "companion" card variant: rendered frame by frame in an offscreen window ----
// The scene (renderer/scene) runs the real companion renderer on a virtual clock; we step it
// one frame at a time and capture the pixels. Card Studio encodes each frame to WebP.
let sceneWin = null;
ipcMain.handle('studio:sceneBegin', async (_e, data) => {
  try {
    if (sceneWin && !sceneWin.isDestroyed()) sceneWin.destroy();
    sceneWin = new BrowserWindow({
      show: false, width: 1920, height: 1024, useContentSize: true, frame: false,
      webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
    });
    // recent Electron versions clamp an offscreen window to the screen size at creation: force the real size
    sceneWin.setContentSize(1920, 1024);
    sceneWin.webContents.setFrameRate(60);
    await sceneWin.loadFile(path.join(__dirname, 'renderer', 'scene', 'scene.html'), { query: { capture: '1' } });
    await sceneWin.webContents.executeJavaScript(`window.__scene.setup(${JSON.stringify(data)})`);
    const frames = await sceneWin.webContents.executeJavaScript('window.__scene.frames()');
    const fps = await sceneWin.webContents.executeJavaScript('window.__scene.FPS');
    return { ok: true, frames, fps };
  } catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('studio:sceneFrame', async (_e, i) => {
  if (!sceneWin || sceneWin.isDestroyed()) throw new Error('scene not started');
  await sceneWin.webContents.executeJavaScript(`window.__scene.frame(${Number(i) | 0})`);
  const img = await sceneWin.webContents.capturePage({ x: 0, y: 0, width: 1920, height: 1024 });
  const { width, height } = img.getSize();
  return { width, height, bgra: img.toBitmap() };
});
ipcMain.handle('studio:sceneEnd', () => { if (sceneWin && !sceneWin.isDestroyed()) sceneWin.destroy(); sceneWin = null; return true; });
ipcMain.handle('studio:saveConfig', (_e, p) => { patchConfig(p || {}); return true; });

// ======================================================================
// Companion window
// ======================================================================
const SIZES = { S: 130, M: 165, L: 200 };   // mascot size in px
let compWin = null, tray = null, dragTimer = null;

function compSize() { return SIZES[readConfig().companionSize] || SIZES.M; }
// macOS: the companion lives at the top centre of the screen, under the menu bar, where the
// MacBook notch is (the macOS counterpart of "sitting on the taskbar"). The bottom-right corner
// stays available from the tray menu.
const notchMode = () => IS_MAC && readConfig().macPlacement !== 'corner';
function compBounds(m) {
  // notch: the box hangs in the middle, a small mascot sits at its right
  if (notchMode()) return { width: Math.round(m * 2.4), height: Math.round(m * 0.8) };
  // mascot + headroom for the alert flames + room for the box in front of it
  return { width: Math.round(m * 1.6), height: Math.round(m * 1.5) };
}
// Top centre of the display that has the menu bar, just under it. The menu bar height is the
// gap between the display bounds and its work area. Notched MacBook displays have a ~37-38 pt
// menu bar (24-25 pt elsewhere): there the box is drawn attached, black, as if it were the notch
// growing down. Other notch apps that draw inside the notch itself stay untouched.
const NOTCH_MENU_BAR_MIN = 32;
function notchPlacement(w) {
  const disp = screen.getPrimaryDisplay(), b = disp.bounds, wa = disp.workArea;
  const menuBar = wa.y - b.y;
  return { x: b.x + Math.round((b.width - w) / 2), y: wa.y, attached: !!disp.internal && menuBar >= NOTCH_MENU_BAR_MIN };
}
// "Docked" height: like BongoCat, the box in front of the mascot sits ON the taskbar
// (top of the stats box = top of the taskbar). The companion can be placed higher on
// the screen, never lower. dockOffset = stats box height, measured by the renderer.
const SNAP_PX = 28;
let dockOffset = null;
function getDockOffset() { return dockOffset != null ? dockOffset : (readConfig().dockOffset || Math.round(compSize() * 0.36)); }
// macOS has no taskbar under the screen corner: the Dock can sit on any edge, be short, or hide
// itself. The work area (visible frame) already excludes the menu bar and a visible Dock, so the
// companion docks on its bottom edge, fully inside it. With an auto-hidden Dock that is the
// bottom of the screen, and the Dock slides in under the companion (which stays on top).
function dockY(disp, h) {
  const wa = disp.workArea, b = disp.bounds;
  const dip = IS_MAC ? 0 : getDockOffset();
  return Math.min(wa.y + wa.height - h + dip, b.y + b.height - h);  // never below the screen
}
function defaultPos(w, h) {
  const disp = screen.getPrimaryDisplay(), wa = disp.workArea;
  return { x: wa.x + wa.width - w - 24, y: dockY(disp, h) };
}
function placeWindow(x, y, w, h) {
  const disp = screen.getDisplayNearestPoint({ x: Math.round(x + w / 2), y: Math.round(y + h / 2) }), d = disp.workArea;
  const dy = dockY(disp, h);
  const docked = y >= dy - SNAP_PX;
  return {
    x: Math.min(Math.max(x, d.x - Math.round(w * 0.3)), d.x + d.width - Math.round(w * 0.7)),
    y: docked ? dy : Math.max(y, d.y),
    docked,
  };
}

function createCompanion() {
  const m = compSize(), { width, height } = compBounds(m);
  const cfg = readConfig();
  const pos = notchMode() ? notchPlacement(width) : cfg.companionPos ? placeWindow(cfg.companionPos.x, cfg.companionPos.docked !== false ? 1e6 : cfg.companionPos.y, width, height) : defaultPos(width, height);
  compWin = new BrowserWindow({
    width, height, x: pos.x, y: pos.y,
    frame: false, transparent: true, resizable: false, maximizable: false, minimizable: false, fullscreenable: false,
    alwaysOnTop: true, skipTaskbar: true, hasShadow: false, show: false,
    // never takes the focus: Promethee must keep seeing your real app in the foreground
    focusable: false,
    backgroundColor: '#00000000', title: APP_TITLE,
    // macOS: focusable:false alone still activates the app on click/drag (Promethee would then see
    // Electron in the foreground). A non-activating panel never takes the focus, like Windows.
    ...(IS_MAC ? { type: 'panel' } : {}),
    webPreferences: { preload: path.join(__dirname, 'preload-companion.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  compWin.setAlwaysOnTop(true, 'screen-saver');
  // macOS: follow the user across Spaces and over full-screen apps, like the Windows overlay
  if (IS_MAC) compWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  compWin.setIgnoreMouseEvents(true, { forward: true });
  compWin.loadFile(path.join(__dirname, 'companion', 'index.html'));
  compWin.once('ready-to-show', () => { if (!readConfig().companionHidden) compWin.showInactive(); pushView(true); });
  compWin.on('closed', () => { compWin = null; });
}

function rebuildCompanion() {
  if (compWin && !compWin.isDestroyed()) compWin.destroy();
  createCompanion();
}

ipcMain.handle('companion:init', () => {
  let fonts = null;
  try {
    const p = resolve(), f = n => path.join(p.fontsDir, n);
    fonts = {
      display: toDataURL(f('PrometheeCondensed.ttf'), 'font/ttf'),
      mono: toDataURL(f('DMMono-Medium.ttf'), 'font/ttf'),
      sans: toDataURL(f('DMSans.ttf'), 'font/ttf'),
    };
  } catch {}
  let notch = null;
  if (notchMode()) notch = { attached: notchPlacement(compBounds(compSize()).width).attached };
  return { fonts, size: compSize(), notch };
});
ipcMain.on('companion:hover', (_e, over) => { if (compWin) compWin.setIgnoreMouseEvents(!over, { forward: true }); });
ipcMain.on('companion:click', () => openStudio());
// stats box height (renderer) -> docking line; re-dock if we are docked
ipcMain.on('companion:boxH', (_e, h) => {
  if (notchMode()) return;   // fixed place in the notch: no docking line
  h = Math.round(Number(h) || 0);
  if (h < 20 || h > 200 || h === getDockOffset()) return;
  dockOffset = h; patchConfig({ dockOffset: h });
  const cfg = readConfig();
  if (compWin && (!cfg.companionPos || cfg.companionPos.docked !== false)) {
    const b = compWin.getBounds(), p = placeWindow(b.x, 1e6, b.width, b.height);
    compWin.setBounds({ x: p.x, y: p.y, width: b.width, height: b.height });
  }
});
ipcMain.on('companion:dragStart', () => {
  if (!compWin || notchMode()) return;   // the notch place is fixed
  const c = screen.getCursorScreenPoint(), b = compWin.getBounds();
  const off = { x: c.x - b.x, y: c.y - b.y }, size = compBounds(compSize());
  let last = '';
  clearInterval(dragTimer);
  dragTimer = setInterval(() => {
    if (!compWin) return clearInterval(dragTimer);
    const p = screen.getCursorScreenPoint();
    const pos = placeWindow(p.x - off.x, p.y - off.y, size.width, size.height);
    const k = pos.x + ',' + pos.y;
    if (k === last) return;
    last = k;
    // setBounds with a fixed size: setPosition alone can make the window creep in size on scaled displays
    compWin.setBounds({ x: pos.x, y: pos.y, width: size.width, height: size.height });
  }, 16);
});
ipcMain.on('companion:dragEnd', () => {
  clearInterval(dragTimer); dragTimer = null;
  if (compWin && !notchMode()) {
    const b = compWin.getBounds(), p = placeWindow(b.x, b.y, b.width, b.height);
    patchConfig({ companionPos: { x: b.x, y: b.y, docked: p.docked } });
  }
});

// ---------------- live data loop ----------------
let worker = null, reqId = 0;
const pendingReq = new Map();
function liveStatusAsync(p) {
  if (!worker) {
    worker = new Worker(path.join(__dirname, 'lib', 'live-worker.js'));
    worker.on('message', m => { const r = pendingReq.get(m.id); if (!r) return; pendingReq.delete(m.id); m.ok ? r.resolve(m.result) : r.reject(new Error(m.error)); });
    worker.on('error', e => { for (const r of pendingReq.values()) r.reject(e); pendingReq.clear(); worker = null; });
    worker.on('exit', () => { worker = null; });
  }
  const id = ++reqId;
  return new Promise((resolve, reject) => { pendingReq.set(id, { resolve, reject }); worker.postMessage({ id, paths: p }); });
}

let paths = null, db = null, dbReadAt = 0, dbStamp = '', reading = false, lastSent = '';
let sampler = null;

function statStamp() {
  try {
    const a = fs.statSync(paths.dbPath), w = fs.existsSync(paths.walPath) ? fs.statSync(paths.walPath) : null;
    return `${a.mtimeMs}:${a.size}:${w ? w.mtimeMs + ':' + w.size : '-'}`;
  } catch { return ''; }
}

// Reading the DB is costly (it is big), so only re-read when the DB or its WAL changed,
// or every 30s as a safety net.
async function pollDb() {
  if (reading) return;
  reading = true;
  try {
    if (!paths) paths = resolve();
    const stamp = statStamp();
    if (stamp && stamp === dbStamp && Date.now() - dbReadAt < 30000) return;
    const st = await liveStatusAsync(paths);
    db = st; dbReadAt = Date.now(); dbStamp = stamp;
    sampler.follow(st);
  } catch (e) {
    paths = null;                       // Promethee updated / moved: re-resolve next time
    db = { active: false, error: e.message }; dbReadAt = Date.now();
    sampler.follow(null);
  } finally { reading = false; }
}

function currentView() {
  const now = Date.now();
  let live = db;
  if (live && live.active) {
    // keep the session clock running between DB reads (the penalty drops as time passes)
    const elapsed = live.paused ? 0 : (now - dbReadAt) / 1000;
    live = { ...live, trackedSeconds: live.trackedSeconds + elapsed };
  }
  let idleSeconds = 0;
  if (live && live.active) {
    idleSeconds = computeIdle({ startedAtMs: live.startedAt, endedAtMs: now, trackedSeconds: live.trackedSeconds, samples: sampler.samples(), callIntervals: live.callIntervals || [] }).idleSeconds;
  }
  return computeView({ db: live, fg: foreground.getForeground(), now, idleSeconds, samplerSince: sampler.since() });
}

function pushView(force) {
  if (!compWin || compWin.isDestroyed()) return;
  const v = currentView();
  const key = JSON.stringify(v);
  if (!force && key === lastSent) return;
  lastSent = key;
  compWin.webContents.send('companion:view', v);
}

// ---------------- tray + auto-launch ----------------
function trayIcon(size) {
  const img = nativeImage.createFromPath(path.join(__dirname, 'companion', 'assets', 'focus', 'body.png'));
  if (img.isEmpty()) return img;
  return img.crop({ x: 96, y: 98, width: 342, height: 352 }).resize({ width: size, height: size, quality: 'best' });
}
// macOS menu bar: an 18 pt template image (only its alpha is used), drawn by macOS in the menu
// bar's color so it stays readable in light and dark mode, @2x for Retina screens.
function menuBarIcon() {
  const img = nativeImage.createFromBuffer(trayIcon(36).toPNG(), { scaleFactor: 2 });
  img.setTemplateImage(true);
  return img;
}

const loginArgs = () => (app.isPackaged ? [] : [app.getAppPath()]);
// macOS from source: a LaunchAgent (see lib/login-item-mac.js); packaged builds and Windows:
// the system login item.
const macLaunchAgent = () => IS_MAC && !app.isPackaged;
function setAutoLaunch(on) {
  if (macLaunchAgent()) macLoginItem.setEnabled(on, [process.execPath, app.getAppPath()]);
  else app.setLoginItemSettings({ openAtLogin: on, path: process.execPath, args: loginArgs() });
  patchConfig({ autoLaunch: on });
}
function isAutoLaunch() {
  try {
    if (macLaunchAgent()) return macLoginItem.isEnabled();
    return app.getLoginItemSettings({ path: process.execPath, args: loginArgs() }).openAtLogin;
  } catch { return !!readConfig().autoLaunch; }
}

function buildTrayMenu() {
  const cfg = readConfig();
  const visible = compWin && compWin.isVisible();
  const size = cfg.companionSize || 'M';
  tray.setContextMenu(Menu.buildFromTemplate([
    ...(updateInfo ? [{ label: `Update available: v${updateInfo.latest} (open)`, click: () => shell.openExternal(updateInfo.url) }] : []),
    { label: 'Open Card Studio', click: openStudio },
    { type: 'separator' },
    { label: visible ? 'Hide companion' : 'Show companion', click: () => toggleCompanion() },
    { label: 'Size', submenu: [['S', 'Small'], ['M', 'Medium'], ['L', 'Large']].map(([k, l]) => ({
      label: l, type: 'radio', checked: size === k,
      click: () => { patchConfig({ companionSize: k, companionPos: null }); rebuildCompanion(); buildTrayMenu(); },
    })) },
    ...(IS_MAC ? [{ label: 'Position', submenu: [['notch', 'Top centre (notch)'], ['corner', 'Bottom right']].map(([k, l]) => ({
      label: l, type: 'radio', checked: (cfg.macPlacement === 'corner' ? 'corner' : 'notch') === k,
      click: () => { patchConfig({ macPlacement: k, companionPos: null }); rebuildCompanion(); buildTrayMenu(); },
    })) }] : []),
    ...(notchMode() ? [] : [{ label: 'Reset position (bottom right)', click: () => { patchConfig({ companionPos: null }); rebuildCompanion(); } }]),
    { type: 'separator' },
    { label: IS_MAC ? 'Open at login' : 'Launch at Windows startup', type: 'checkbox', checked: isAutoLaunch(), click: i => setAutoLaunch(i.checked) },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } },
  ]));
}

function toggleCompanion(force) {
  if (!compWin) return;
  const show = typeof force === 'boolean' ? force : !compWin.isVisible();
  if (show) { compWin.showInactive(); compWin.setAlwaysOnTop(true, 'screen-saver'); } else compWin.hide();
  patchConfig({ companionHidden: !show });
  buildTrayMenu();
}

// ---------------- boot ----------------
function boot() {
  // macOS: the companion is a menu bar utility. Without this, a Dock icon and a Cmd-Tab entry
  // would stay for a window that never takes the focus. Card Studio brings the icon back while open.
  if (IS_MAC && app.dock) app.dock.hide();
  sampler = createSampler(() => powerMonitor.getSystemIdleTime());
  foreground.start();
  createCompanion();

  tray = new Tray(IS_MAC ? menuBarIcon() : trayIcon(32));
  tray.setToolTip(APP_TITLE);
  // macOS opens the menu on click (the menu has Show/Hide and Open Card Studio)
  if (!IS_MAC) {
    tray.on('click', () => toggleCompanion());
    tray.on('double-click', openStudio);
  }
  buildTrayMenu();

  const cfg = readConfig();
  // first run: start with Windows. macOS: opt-in from the menu, login items there are expected to
  // be the user's choice (and macOS announces each new one with a "Background item" notification).
  if (cfg.autoLaunch === undefined && !IS_MAC) setAutoLaunch(true);

  pollDb().then(() => pushView(true));
  setInterval(pollDb, 2000);
  setTimeout(snapFr, 20000); setInterval(snapFr, 10 * 60e3);
  setTimeout(refreshUpdate, 15000); setInterval(refreshUpdate, 6 * 3600e3);
  setInterval(() => pushView(false), 250);
  // keep it above the taskbar (Windows sometimes drops topmost after fullscreen apps)
  setInterval(() => { if (compWin && compWin.isVisible()) compWin.setAlwaysOnTop(true, 'screen-saver'); }, 30000);
  screen.on('display-metrics-changed', () => { if (notchMode() || !readConfig().companionPos) rebuildCompanion(); });
  powerMonitor.on('resume', () => { if (compWin && compWin.isVisible()) compWin.setAlwaysOnTop(true, 'screen-saver'); });
}

// the companion lives in the tray: closing Card Studio must not quit the app
app.on('window-all-closed', () => {});
app.on('before-quit', () => { foreground.stop(); if (sampler) sampler.stop(); if (worker) worker.terminate(); });
