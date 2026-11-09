'use strict';
// Taskbar icons of the card scene. They are read from the installed Promethee app
// (resources/assets) on the user's machine, never shipped in this repository. Anything missing
// falls back to a neutral placeholder in the scene.
const fs = require('fs');
const path = require('path');

const PNGS = { claude: 'app-icons/claude.png', vscode: 'app-icons/visual-studio-code.png', promethee: 'app-icons/promethee.png' };

function png(file) {
  try { return 'data:image/png;base64,' + fs.readFileSync(file).toString('base64'); } catch { return null; }
}
// Promethee only has a monochrome SVG for Warp: put it on a dark rounded tile.
function warp(dir) {
  try {
    const svg = fs.readFileSync(path.join(dir, 'simple-icons', 'warp.svg'), 'utf8');
    const m = /<path[^>]*\sd="([^"]+)"/.exec(svg);
    if (!m) return null;
    const tile = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="5.5" fill="#1d1d26"/><g transform="translate(4.8 4.8) scale(.6)" fill="#eceaf2"><path d="${m[1]}"/></g></svg>`;
    return 'data:image/svg+xml;base64,' + Buffer.from(tile).toString('base64');
  } catch { return null; }
}

function loadSceneIcons(paths) {
  const dir = paths.assetsDir, out = {};
  for (const [k, f] of Object.entries(PNGS)) out[k] = png(path.join(dir, f));
  out.warp = warp(dir);
  return out;
}

module.exports = { loadSceneIcons };
