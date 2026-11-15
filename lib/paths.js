'use strict';
// Resolve Promethee's local folders.
//   Windows: data in %APPDATA%\Promethee, app in %LOCALAPPDATA%\Promethee\app-<version> (Squirrel)
//   macOS:   data in ~/Library/Application Support/Promethee, app in /Applications/Promethee.app
// The data folder has the same layout on both (promethee.db, session.bin, Local State).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const IS_MAC = process.platform === 'darwin';

const ROAMING = IS_MAC
  ? path.join(os.homedir(), 'Library', 'Application Support', 'Promethee')
  : path.join(process.env.APPDATA || '', 'Promethee');                  // DB, session.bin, Local State
const LOCAL = path.join(process.env.LOCALAPPDATA || '', 'Promethee');    // app-<version> installs (Windows)

function parseVer(name) {
  const m = /^app-(\d+)\.(\d+)\.(\d+)$/.exec(name);
  return m ? [+m[1], +m[2], +m[3]] : null;
}

// Windows: the newest app-x.y.z folder. Returns its "resources" folder.
function latestWinApp() {
  let best = null, bestV = null, bestName = null;
  for (const e of fs.readdirSync(LOCAL, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const v = parseVer(e.name);
    if (!v) continue;
    if (!bestV || v[0] > bestV[0] || (v[0] === bestV[0] && (v[1] > bestV[1] || (v[1] === bestV[1] && v[2] > bestV[2])))) {
      bestV = v; best = path.join(LOCAL, e.name); bestName = e.name;
    }
  }
  if (!best) throw new Error(`No app-x.y.z folder in ${LOCAL}`);
  return { resources: path.join(best, 'resources'), version: bestName.replace('app-', '') };
}

// macOS: the app bundle, usually /Applications, sometimes ~/Applications (no admin rights).
// The version is the bundle's CFBundleShortVersionString (same number as app-x.y.z on Windows).
const MAC_BUNDLES = ['/Applications/Promethee.app', path.join(os.homedir(), 'Applications', 'Promethee.app')];
// plutil ships with macOS and reads both XML and binary plists
function plistString(plist, key) {
  try { return execFileSync('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', plist], { encoding: 'utf8' }).trim(); }
  catch { return null; }
}
const macCache = new Map();   // the version only changes when the app updates: read it once per mtime
function macApp() {
  for (const bundle of MAC_BUNDLES) {
    const plist = path.join(bundle, 'Contents', 'Info.plist');
    let st; try { st = fs.statSync(plist); } catch { continue; }
    const k = plist + ':' + st.mtimeMs;
    if (!macCache.has(k)) macCache.set(k, { resources: path.join(bundle, 'Contents', 'Resources'), version: plistString(plist, 'CFBundleShortVersionString') || '0.0.0' });
    return macCache.get(k);
  }
  throw new Error(`Promethee.app not found in ${MAC_BUNDLES.join(' or ')}`);
}

function resolve() {
  const app = IS_MAC ? macApp() : latestWinApp();
  const assets = path.join(app.resources, 'assets');
  return {
    roaming: ROAMING,
    dbPath: path.join(ROAMING, 'promethee.db'),
    walPath: path.join(ROAMING, 'promethee.db-wal'),
    sessionBin: path.join(ROAMING, 'session.bin'),
    localState: path.join(ROAMING, 'Local State'),
    appVersion: app.version,
    asarPath: path.join(app.resources, 'app.asar'),
    assetsDir: assets,
    tiersDir: path.join(assets, 'tiers'),
    fontsDir: path.join(assets, 'fonts'),
  };
}

module.exports = { resolve };
