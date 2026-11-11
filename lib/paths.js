'use strict';
// Resolve Promethee's local folders (Windows and macOS).
//
// Windows: data in %APPDATA%\Promethee, Squirrel installs in %LOCALAPPDATA%\Promethee\app-<version>.
// macOS:   data in ~/Library/Application Support/Promethee, app in /Applications/Promethee.app
//          (or ~/Applications/Promethee.app), resources in Contents/Resources.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const IS_MAC = process.platform === 'darwin';

const ROAMING = IS_MAC
  ? path.join(os.homedir(), 'Library', 'Application Support', 'Promethee')   // DB, session.bin
  : path.join(process.env.APPDATA || '', 'Promethee');                      // DB, session.bin, Local State
const LOCAL = path.join(process.env.LOCALAPPDATA || '', 'Promethee');       // Windows: app-<version> installs

function parseVer(name) {
  const m = /^app-(\d+)\.(\d+)\.(\d+)$/.exec(name);
  return m ? [+m[1], +m[2], +m[3]] : null;
}

function latestAppDirWin() {
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

function bundleVersion(bundle) {
  try {
    return execFileSync('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', path.join(bundle, 'Contents', 'Info.plist')], { encoding: 'utf8' }).trim();
  } catch { return 'unknown'; }
}

function appDirMac() {
  const candidates = [
    '/Applications/Promethee.app',
    path.join(os.homedir(), 'Applications', 'Promethee.app'),
  ];
  const bundle = candidates.find(c => fs.existsSync(path.join(c, 'Contents', 'Resources')));
  if (!bundle) throw new Error(`No Promethee.app in ${candidates.join(' or ')}`);
  return { resources: path.join(bundle, 'Contents', 'Resources'), version: bundleVersion(bundle) };
}

function resolve() {
  const app = IS_MAC ? appDirMac() : latestAppDirWin();
  const assets = path.join(app.resources, 'assets');
  return {
    roaming: ROAMING,
    dbPath: path.join(ROAMING, 'promethee.db'),
    walPath: path.join(ROAMING, 'promethee.db-wal'),
    sessionBin: path.join(ROAMING, 'session.bin'),
    localState: path.join(ROAMING, 'Local State'),   // Windows only (holds the DPAPI-wrapped AES key)
    appVersion: app.version,
    asarPath: path.join(app.resources, 'app.asar'),
    assetsDir: assets,
    tiersDir: path.join(assets, 'tiers'),
    fontsDir: path.join(assets, 'fonts'),
  };
}

module.exports = { resolve };
