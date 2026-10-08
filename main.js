'use strict';
// Promethee Companion: a small mascot above the taskbar that shows the live session
// state (switches, switch malus, focus score computed like Promethee) and warns on an
// app switch. Clicking it opens Card Studio (end-of-session card generator).
const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen, powerMonitor } = require('electron');
const fs = require('fs');
const path = require('path');
const { resolve } = require('./lib/paths');
const { readAll } = require('./lib/db');
const { loadToken } = require('./lib/token');
const { fetchMyPosts } = require('./lib/api');
const { publishOrEdit } = require('./lib/publish');
const { Worker } = require('worker_threads');
const { computeIdle, createSampler } = require('./lib/idle');
const { computeView } = require('./lib/companion-view');
const foreground = require('./lib/foreground');

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
    width: 1320, height: 940, backgroundColor: '#0b0908', title: 'Promethee Card Studio',
    icon: trayIcon(64),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  studioWin.setMenuBarVisibility(false);
  studioWin.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  studioWin.on('closed', () => { studioWin = null; });
}

ipcMain.handle('studio:init', async () => {
  const paths = resolve();
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

  return {
    ok: true, appVersion: paths.appVersion, profile, sessions, posts, fonts, availableTiers, tokenWarning,
    defaultTier: cfg.lastTier && availableTiers.includes(cfg.lastTier) ? cfg.lastTier : (availableTiers.includes('diamond') ? 'diamond' : availableTiers[0] || 'diamond'),
    handle: cfg.handle || ('@' + String(profile.displayName || 'user').toLowerCase().replace(/\s+/g, '')),
  };
});

ipcMain.handle('studio:tierImage', async (_e, tier) => {
  try { const paths = resolve(); const f = path.join(paths.tiersDir, tier + '.png'); return fs.existsSync(f) ? toDataURL(f, 'image/png') : null; }
  catch { return null; }
});

ipcMain.handle('studio:publish', async (_e, payload) => {
  try {
    const paths = resolve();
    const { token, uid, secondsLeft } = loadToken(paths);
    const posts = await fetchMyPosts(token, uid);
    const existing = posts[payload.sessionId] || null;
    const frames = payload.frames.map(b64 => Buffer.from(b64, 'base64'));
    const res = await publishOrEdit({
      token, uid, sessionId: payload.sessionId,
      eventId: existing ? existing.eventId : null,
      body: payload.body || null, title: null, clientVersion: paths.appVersion,
      frames, delayMs: payload.delayMs, hidden: !!payload.hidden,
    });
    patchConfig({ lastTier: payload.tier, handle: payload.handle });
    return { ok: true, tokenMinutes: Math.round(secondsLeft / 60), ...res };
  } catch (err) { return { ok: false, error: err.message }; }
});

// ======================================================================
// Companion window
// ======================================================================
const SIZES = { S: 130, M: 165, L: 200 };   // mascot size in px
let compWin = null, tray = null, dragTimer = null;

function compSize() { return SIZES[readConfig().companionSize] || SIZES.M; }
function compBounds(m) {
  // mascot + headroom for the alert flames + room for the box in front of it
  return { width: Math.round(m * 1.6), height: Math.round(m * 1.5) };
}
// "Docked" height: like BongoCat, the box in front of the mascot sits ON the taskbar
// (top of the stats box = top of the taskbar). The companion can be placed higher on
// the screen, never lower. dockOffset = stats box height, measured by the renderer.
const SNAP_PX = 28;
let dockOffset = null;
function getDockOffset() { return dockOffset != null ? dockOffset : (readConfig().dockOffset || Math.round(compSize() * 0.36)); }
function dockY(disp, h) {
  const wa = disp.workArea, b = disp.bounds;
  return Math.min(wa.y + wa.height - h + getDockOffset(), b.y + b.height - h);  // never below the screen
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
  const pos = cfg.companionPos ? placeWindow(cfg.companionPos.x, cfg.companionPos.docked !== false ? 1e6 : cfg.companionPos.y, width, height) : defaultPos(width, height);
  compWin = new BrowserWindow({
    width, height, x: pos.x, y: pos.y,
    frame: false, transparent: true, resizable: false, maximizable: false, minimizable: false, fullscreenable: false,
    alwaysOnTop: true, skipTaskbar: true, hasShadow: false, show: false,
    // never takes the focus: Promethee must keep seeing your real app in the foreground
    focusable: false,
    backgroundColor: '#00000000', title: APP_TITLE,
    webPreferences: { preload: path.join(__dirname, 'preload-companion.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  compWin.setAlwaysOnTop(true, 'screen-saver');
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
  return { fonts, size: compSize() };
});
ipcMain.on('companion:hover', (_e, over) => { if (compWin) compWin.setIgnoreMouseEvents(!over, { forward: true }); });
ipcMain.on('companion:click', () => openStudio());
// stats box height (renderer) -> docking line; re-dock if we are docked
ipcMain.on('companion:boxH', (_e, h) => {
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
  if (!compWin) return;
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
  if (compWin) {
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
    // keep the session clock running between DB reads (the malus drops as time passes)
    const elapsed = live.paused ? 0 : (now - dbReadAt) / 1000;
    live = { ...live, trackedSeconds: live.trackedSeconds + elapsed };
  }
  let idleSeconds = 0;
  if (live && live.active) {
    idleSeconds = computeIdle({ startedAtMs: live.startedAt, endedAtMs: now, trackedSeconds: live.trackedSeconds, samples: sampler.samples() }).idleSeconds;
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

const loginArgs = () => (app.isPackaged ? [] : [app.getAppPath()]);
function setAutoLaunch(on) {
  app.setLoginItemSettings({ openAtLogin: on, path: process.execPath, args: loginArgs() });
  patchConfig({ autoLaunch: on });
}
function isAutoLaunch() {
  try { return app.getLoginItemSettings({ path: process.execPath, args: loginArgs() }).openAtLogin; }
  catch { return !!readConfig().autoLaunch; }
}

function buildTrayMenu() {
  const cfg = readConfig();
  const visible = compWin && compWin.isVisible();
  const size = cfg.companionSize || 'M';
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Ouvrir Card Studio', click: openStudio },
    { type: 'separator' },
    { label: visible ? 'Masquer le compagnon' : 'Afficher le compagnon', click: () => toggleCompanion() },
    { label: 'Taille', submenu: [['S', 'Petit'], ['M', 'Moyen'], ['L', 'Grand']].map(([k, l]) => ({
      label: l, type: 'radio', checked: size === k,
      click: () => { patchConfig({ companionSize: k, companionPos: null }); rebuildCompanion(); buildTrayMenu(); },
    })) },
    { label: 'Remettre en bas à droite', click: () => { patchConfig({ companionPos: null }); rebuildCompanion(); } },
    { type: 'separator' },
    { label: 'Lancer au démarrage de Windows', type: 'checkbox', checked: isAutoLaunch(), click: i => setAutoLaunch(i.checked) },
    { type: 'separator' },
    { label: 'Quitter', click: () => { app.isQuitting = true; app.quit(); } },
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
  sampler = createSampler(() => powerMonitor.getSystemIdleTime());
  foreground.start();
  createCompanion();

  tray = new Tray(trayIcon(32));
  tray.setToolTip(APP_TITLE);
  tray.on('click', () => toggleCompanion());
  tray.on('double-click', openStudio);
  buildTrayMenu();

  const cfg = readConfig();
  if (cfg.autoLaunch === undefined) setAutoLaunch(true);   // first run: start with Windows

  pollDb().then(() => pushView(true));
  setInterval(pollDb, 2000);
  setInterval(() => pushView(false), 250);
  // keep it above the taskbar (Windows sometimes drops topmost after fullscreen apps)
  setInterval(() => { if (compWin && compWin.isVisible()) compWin.setAlwaysOnTop(true, 'screen-saver'); }, 30000);
  screen.on('display-metrics-changed', () => { if (!readConfig().companionPos) rebuildCompanion(); });
  powerMonitor.on('resume', () => { if (compWin && compWin.isVisible()) compWin.setAlwaysOnTop(true, 'screen-saver'); });
}

// the companion lives in the tray: closing Card Studio must not quit the app
app.on('window-all-closed', () => {});
app.on('before-quit', () => { foreground.stop(); if (sampler) sampler.stop(); if (worker) worker.terminate(); });
