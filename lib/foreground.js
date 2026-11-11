'use strict';
// Real-time foreground-window reader for Windows and macOS, dependency-free.
// A single long-lived helper process (PowerShell on Windows, osascript/JXA on macOS) prints the active
// window every ~0.5s as
//   "<exePath>\t<processName>\t<title>"
// We parse it, apply Promethee's own app filter (Wo via isTrackedApp), and expose the
// current tracked foreground { exe, app, key, sinceMs }.
//
// IMPORTANT: this ONLY drives showing/hiding the grace bar instantly. It never affects
// the switch COUNT or any number shown — those come exclusively from Promethee's DB.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { isTrackedApp } = require('./live');

const PS_SCRIPT = `
$ErrorActionPreference='SilentlyContinue'
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class FGWin {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
}
"@
$tab=[char]9
while($true){
  $h=[FGWin]::GetForegroundWindow()
  $procId=0
  [void][FGWin]::GetWindowThreadProcessId($h,[ref]$procId)
  $p=Get-Process -Id $procId -ErrorAction SilentlyContinue
  $exePath=''
  try{ $exePath=$p.Path }catch{}
  $name=''
  try{ $name=$p.ProcessName }catch{}
  $sb=New-Object System.Text.StringBuilder 512
  [void][FGWin]::GetWindowText($h,$sb,512)
  $t=$sb.ToString() -replace '[\\t\\r\\n]',' '
  Write-Output ($exePath+$tab+$name+$tab+$t)
  Start-Sleep -Milliseconds 500
}
`;

// macOS: NSWorkspace gives the frontmost app without any permission prompt (no window title, which
// would need the Accessibility permission and is not used for the alert). The executable name,
// lowercased, is what Promethee records as exe_name on macOS.
const JXA_SCRIPT = `
ObjC.import('AppKit');
const out = $.NSFileHandle.fileHandleWithStandardOutput;
while (true) {
  const a = $.NSWorkspace.sharedWorkspace.frontmostApplication;
  if (a && !a.isNil()) {
    const exe = a.executableURL && !a.executableURL.isNil() ? ObjC.unwrap(a.executableURL.path) : '';
    const name = a.localizedName && !a.localizedName.isNil() ? ObjC.unwrap(a.localizedName) : '';
    out.writeData($(exe + '\\t' + name + '\\t\\n').dataUsingEncoding($.NSUTF8StringEncoding));
  }
  // the run loop must turn for NSWorkspace to see app switches
  $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.5));
}
`;

let proc = null;
let scriptPath = null;
let buf = '';
let stopped = false;
let state = { ok: false, exe: null, app: null, title: null, key: null, sinceMs: 0, ts: 0 };

function baseLower(p) {
  const t = typeof p === 'string' ? p.trim() : '';
  return t ? (t.split(/[\\/]/).pop() || '').toLowerCase() : '';
}

function handleLine(line) {
  const parts = line.split('\t');
  if (parts.length < 2) return;
  const exePath = parts[0] || '';
  const name = (parts[1] || '').trim();
  const title = parts.slice(2).join(' ').trim();
  const exe = baseLower(exePath);
  const app = name || exe.replace(/\.exe$/, '');
  const now = Date.now();
  state.ts = now;
  if (!app && !exe) return;                 // couldn't read; keep previous tracked app
  if (!isTrackedApp(app, exe || (app + '.exe'))) return; // filtered (explorer, dwm, ...): keep previous
  const key = exe || app.toLowerCase();
  if (key !== state.key) { state.key = key; state.sinceMs = now; }
  state.exe = exe || null;
  state.app = app;
  state.title = title;
  state.ok = true;
}

function onData(chunk) {
  buf += chunk.toString();
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).replace(/\r$/, '');
    buf = buf.slice(nl + 1);
    if (line) handleLine(line);
  }
}

function start() {
  const isMac = process.platform === 'darwin';
  if (process.platform !== 'win32' && !isMac) return; // Windows and macOS only
  if (proc) return;
  try {
    scriptPath = path.join(os.tmpdir(), isMac ? 'promethee-companion-fg.js' : 'promethee-companion-fg.ps1');
    fs.writeFileSync(scriptPath, isMac ? JXA_SCRIPT : PS_SCRIPT, 'utf8');
    proc = isMac
      ? spawn('/usr/bin/osascript', ['-l', 'JavaScript', scriptPath])
      : spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], { windowsHide: true });
    proc.stdout.on('data', onData);
    proc.on('exit', () => {
      proc = null;
      if (!stopped) setTimeout(start, 2000); // respawn if it dies
    });
    proc.on('error', () => { proc = null; });
  } catch { proc = null; }
}

function getForeground() {
  // stale guard: if the poller has not emitted in >8s, treat as unavailable
  if (!state.ok || Date.now() - state.ts > 8000) return { ok: false };
  return { ok: true, exe: state.exe, app: state.app, key: state.key, sinceMs: state.sinceMs, ts: state.ts };
}

function stop() { stopped = true; if (proc) { try { proc.kill(); } catch {} proc = null; } }

module.exports = { start, getForeground, stop };
