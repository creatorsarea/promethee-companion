'use strict';
// Size of the MacBook notch, read from AppKit like boringNotch does: the notch is the part of the
// top edge between NSScreen.auxiliaryTopLeftArea and auxiliaryTopRightArea, and its height is
// safeAreaInsets.top. Electron does not expose these, so a one-shot osascript (JavaScript for
// Automation, no permission needed) asks AppKit. Returns null without a notch or on failure.
const { execFileSync } = require('child_process');

const SCRIPT = `
ObjC.import('AppKit');
const s = $.NSScreen.screens.objectAtIndex(0);   // the screen with the menu bar
const top = s.safeAreaInsets.top;
top > 0 ? JSON.stringify({ width: s.frame.size.width - s.auxiliaryTopLeftArea.size.width - s.auxiliaryTopRightArea.size.width, height: top }) : 'null';
`;

function measureNotch() {
  if (process.platform !== 'darwin') return null;
  try {
    const r = JSON.parse(execFileSync('/usr/bin/osascript', ['-l', 'JavaScript', '-e', SCRIPT], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }));
    return r && r.width > 50 && r.width < 600 && r.height > 0 ? r : null;
  } catch { return null; }
}

module.exports = { measureNotch };
