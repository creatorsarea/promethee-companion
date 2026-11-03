'use strict';
// Resolve Promethee's local folders. Windows-only (that is where the app runs).
const fs = require('fs');
const path = require('path');

const ROAMING = path.join(process.env.APPDATA || '', 'Promethee');       // DB, session.bin, Local State
const LOCAL = path.join(process.env.LOCALAPPDATA || '', 'Promethee');    // app-<version> installs

function parseVer(name) {
  const m = /^app-(\d+)\.(\d+)\.(\d+)$/.exec(name);
  return m ? [+m[1], +m[2], +m[3]] : null;
}

function latestAppDir() {
  let best = null, bestV = null, bestName = null;
  for (const e of fs.readdirSync(LOCAL, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const v = parseVer(e.name);
    if (!v) continue;
    if (!bestV || v[0] > bestV[0] || (v[0] === bestV[0] && (v[1] > bestV[1] || (v[1] === bestV[1] && v[2] > bestV[2])))) {
      bestV = v; best = path.join(LOCAL, e.name); bestName = e.name;
    }
  }
  if (!best) throw new Error(`Aucun dossier app-x.y.z dans ${LOCAL}`);
  return { dir: best, version: bestName.replace('app-', '') };
}

function resolve() {
  const app = latestAppDir();
  const assets = path.join(app.dir, 'resources', 'assets');
  return {
    roaming: ROAMING,
    dbPath: path.join(ROAMING, 'promethee.db'),
    walPath: path.join(ROAMING, 'promethee.db-wal'),
    sessionBin: path.join(ROAMING, 'session.bin'),
    localState: path.join(ROAMING, 'Local State'),
    appVersion: app.version,
    asarPath: path.join(app.dir, 'resources', 'app.asar'),
    assetsDir: assets,
    tiersDir: path.join(assets, 'tiers'),
    fontsDir: path.join(assets, 'fonts'),
  };
}

module.exports = { resolve };
