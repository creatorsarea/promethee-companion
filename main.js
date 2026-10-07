'use strict';
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { resolve } = require('./lib/paths');
const { readAll } = require('./lib/db');
const { loadToken } = require('./lib/token');
const { fetchMyPosts } = require('./lib/api');
const { publishOrEdit } = require('./lib/publish');
const { liveStatus } = require('./lib/live');
const foreground = require('./lib/foreground');

const TIERS = ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'legend'];
const CONFIG = path.join(app.getPath('userData'), 'config.json');
const readConfig = () => { try { return JSON.parse(fs.readFileSync(CONFIG, 'utf8')); } catch { return {}; } };
const writeConfig = o => { try { fs.writeFileSync(CONFIG, JSON.stringify(o, null, 2)); } catch {} };
const toDataURL = (file, mime) => `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;

function createWindow() {
  const win = new BrowserWindow({
    width: 1320, height: 940, backgroundColor: '#0b0908', title: 'Promethee Card Studio',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
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

  // existing posts (best effort: needs a valid token)
  let posts = {}, tokenWarning = null;
  try { const { token, uid } = loadToken(paths); posts = await fetchMyPosts(token, uid); }
  catch (e) { tokenWarning = e.message; }

  return {
    ok: true, appVersion: paths.appVersion, profile, sessions, posts, fonts, availableTiers, tokenWarning,
    defaultTier: cfg.lastTier && availableTiers.includes(cfg.lastTier) ? cfg.lastTier : (availableTiers.includes('diamond') ? 'diamond' : availableTiers[0] || 'diamond'),
    handle: cfg.handle || ('@' + String(profile.displayName || 'user').toLowerCase().replace(/\s+/g, '')),
  };
});

ipcMain.handle('studio:live', async () => {
  try { return await liveStatus(resolve()); }
  catch (err) { return { active: false, error: err.message }; }
});

// real-time foreground app (cosmetic: drives the grace bar only, never the numbers)
ipcMain.handle('studio:foreground', () => { try { return foreground.getForeground(); } catch { return { ok: false }; } });

ipcMain.handle('studio:tierImage', async (_e, tier) => {
  try { const paths = resolve(); const f = path.join(paths.tiersDir, tier + '.png'); return fs.existsSync(f) ? toDataURL(f, 'image/png') : null; }
  catch { return null; }
});

ipcMain.handle('studio:publish', async (_e, payload) => {
  try {
    const paths = resolve();
    const { token, uid, secondsLeft } = loadToken(paths);
    // re-check server state for this session so we never create a duplicate
    const posts = await fetchMyPosts(token, uid);
    const existing = posts[payload.sessionId] || null;
    const frames = payload.frames.map(b64 => Buffer.from(b64, 'base64'));
    const res = await publishOrEdit({
      token, uid, sessionId: payload.sessionId,
      eventId: existing ? existing.eventId : null,
      body: payload.body || null, title: null, clientVersion: paths.appVersion,
      frames, delayMs: payload.delayMs, hidden: !!payload.hidden,
    });
    writeConfig({ ...readConfig(), lastTier: payload.tier, handle: payload.handle });
    return { ok: true, tokenMinutes: Math.round(secondsLeft / 60), ...res };
  } catch (err) { return { ok: false, error: err.message }; }
});

app.whenReady().then(() => { foreground.start(); createWindow(); });
app.on('window-all-closed', () => { foreground.stop(); app.quit(); });
