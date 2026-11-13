'use strict';
// "Open at login" on macOS when the companion runs from source (`npm start`).
// app.setLoginItemSettings registers the running app bundle, which is Electron.app itself here:
// at login it would open Electron's default window, not the companion (the path/args options
// that fix this on Windows are ignored on macOS). A per-user LaunchAgent can pass the app folder
// as an argument, so that is used instead. A packaged build keeps app.setLoginItemSettings.
const fs = require('fs');
const os = require('os');
const path = require('path');

const LABEL = 'fr.creatorsarea.promethee-companion';
const defaultDir = () => path.join(os.homedir(), 'Library', 'LaunchAgents');
const plistPath = (dir = defaultDir()) => path.join(dir, LABEL + '.plist');

const xml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function plist(programArgs) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${programArgs.map(a => `    <string>${xml(a)}</string>`).join('\n')}
  </array>
  <key>RunAtLoad</key><true/>
  <key>ProcessType</key><string>Interactive</string>
</dict>
</plist>
`;
}

function isEnabled(dir) { return fs.existsSync(plistPath(dir)); }

// programArgs: [electron binary, app folder]. Loaded by launchd at the next login.
function setEnabled(on, programArgs, dir = defaultDir()) {
  const f = plistPath(dir);
  if (!on) { try { fs.unlinkSync(f); } catch {} return; }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(f, plist(programArgs));
}

module.exports = { isEnabled, setEnabled, plistPath, LABEL };
