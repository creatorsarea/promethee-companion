'use strict';
// Live in-progress-session tracker.
// Reads window_events for the currently running session (ended_at IS NULL) via the
// same sql.js + WAL overlay reader as db.js, and reproduces Promethee's own scoring
// logic byte-for-byte so the switch counter matches what the app will record:
//   - each window_event sample counts for a FIXED 10s (QA), not the wall-clock gap
//   - a "durable" segment needs >= 20s (MIN_DWELL, $D) i.e. >= 2 consecutive samples
//   - appSwitchCount = durableSegments.length - 1   (the penalising count)
//   - focus score (0..100): 100 - idlePenalty - switchPenalty   (YXe)
//       switchPenalty = min(35, (appSwitchCount / hours) * 2)
// Source: Promethee main bundle fns Uie/qXe/Wo/UF/YXe, constants QA=10 $D=20 Fz=100.
// openDb (sql.js) is required lazily inside liveStatus so the pure scoring helpers
// can be imported/tested without the native-free WASM dep present.

const SAMPLE_SECONDS = 10;   // QA (scoring weight per sample)
const MIN_DWELL = 20;        // $D (durable segment threshold, >= 2 samples)
const FZ = 100;              // Fz
// Real window-capture cadence while a session is active (Promethee: Urt() -> Crt = 1e4).
// A pending segment (1 sample) locks into a switch at its 2nd capture tick, i.e.
// ~CAPTURE_INTERVAL_MS after its first sample. That is the real grace window.
const CAPTURE_INTERVAL_MS = 10000;
const IS_WIN = process.platform === 'win32';

// Windows system executables Promethee excludes from segments (W6e).
const EXCLUDED_EXE = new Set([
  'explorer.exe', 'shellexperiencehost.exe', 'shellhost.exe', 'sihost.exe',
  'searchhost.exe', 'searchapp.exe', 'searchui.exe', 'startmenuexperiencehost.exe',
  'windows start experience host.exe', 'textinputhost.exe', 'lockapp.exe',
  'systemsettings.exe', 'widgets.exe', 'dwm.exe', 'ctfmon.exe',
]);
// App names Promethee excludes (Zse) - mostly macOS, kept for parity.
const EXCLUDED_APP = new Set([
  'loginwindow', 'windowserver', 'dock', 'system settings', 'systemsettings',
  'system preferences', 'control center', 'controlcenter', 'notification center',
  'notificationcenter', 'spotlight', 'screensaverengine', 'software update',
  'systemuiserver', 'windowmanager', 'coreservicesuiagent', 'talagent',
  'textinputmenuagent', 'airplayuiagent', 'universalcontrol', 'softwareupdated',
  'login', 'assistantd', 'pkd', 'coreaudiod', 'wallpaper', 'finder', 'rize',
  'duetexperienced', 'studentd', 'usereventagent', 'secinitd', 'trustd',
]);

// UF: basename of an exe path, lowercased.
function exeBasename(p) {
  const t = typeof p === 'string' ? p.trim() : '';
  return t ? (t.split(/[\\/]/).pop() || '').toLowerCase() : '';
}
// Wo: should this app/exe be counted as a real foreground app?
function isTrackedApp(appName, exeName) {
  const n = typeof appName === 'string' ? appName.trim() : '';
  if (!n) return false;
  const r = exeBasename(exeName);
  if (r && EXCLUDED_EXE.has(r)) return false;
  let s = n.toLowerCase();
  if (IS_WIN && s.endsWith('.exe')) s = s.slice(0, -4);
  return !EXCLUDED_APP.has(s);
}

// Reproduces qXe: build raw segments then durable (>=20s) segments.
function buildSegments(events) {
  const sorted = events
    .filter(e => e.app_name)
    .sort((a, b) => Number(a.recorded_at || 0) - Number(b.recorded_at || 0));

  const segments = [];
  let rawSwitches = 0, prevKey = null;
  for (const e of sorted) {
    const app = (String(e.app_name || 'Unknown').trim()) || 'Unknown';
    const bundle = e.bundle_id || null;
    const key = bundle ? `${app}::${bundle}` : app;
    if (prevKey && prevKey !== key) rawSwitches += 1;
    prevKey = key;                           // updated even for filtered apps (matches qXe)
    if (!isTrackedApp(app, e.exe_name)) continue;
    const last = segments[segments.length - 1];
    if (last && last.key === key) {
      last.samples += 1; last.seconds += SAMPLE_SECONDS; last.lastAt = Number(e.recorded_at || 0);
    } else {
      segments.push({ key, app, exe: exeBasename(e.exe_name), samples: 1, seconds: SAMPLE_SECONDS, startAt: Number(e.recorded_at || 0), lastAt: Number(e.recorded_at || 0) });
    }
  }

  const durable = [];
  for (const s of segments) {
    if (s.seconds < MIN_DWELL) continue;
    const last = durable[durable.length - 1];
    if (last && last.key === s.key) { last.samples += s.samples; last.seconds += s.seconds; }
    else durable.push({ key: s.key, app: s.app, exe: s.exe, samples: s.samples, seconds: s.seconds });
  }

  return {
    segments, durable,
    appSwitchCount: Math.max(0, durable.length - 1),
    rawAppSwitchCount: rawSwitches,
  };
}

// Sum durable-segment time per app (for a deduped "top apps" display).
function aggregateByApp(durable) {
  const m = new Map();
  for (const s of durable) m.set(s.key, { app: s.app, seconds: (m.get(s.key)?.seconds || 0) + s.seconds });
  return [...m.values()].sort((a, b) => b.seconds - a.seconds);
}

// YXe: focus score 0..100. idleSeconds optional (unknown live -> 0, score is then "hors idle").
function focusScore({ trackedSeconds, idleSeconds = 0, appSwitchCount }) {
  if (!trackedSeconds) return { score: 0, switchPenalty: 0, idlePenalty: 0 };
  const idleFrac = Math.max(0, Math.min(1, idleSeconds / trackedSeconds));
  const hours = Math.max(trackedSeconds / 3600, 1 / 60);
  const switchesPerHour = appSwitchCount / hours;
  const idlePenalty = idleFrac * 50;
  const switchPenalty = Math.min(35, switchesPerHour * 2);
  const score = Math.round(Math.max(0, Math.min(FZ, FZ - idlePenalty - switchPenalty)));
  return { score, switchPenalty: Number(switchPenalty.toFixed(1)), idlePenalty: Number(idlePenalty.toFixed(1)), switchesPerHour: Number(switchesPerHour.toFixed(2)) };
}

function activeSession(db) {
  // in-progress session = no ended_at, not deleted, most recent.
  const cols = 'id,started_at,task';
  const tryExec = sql => { try { const r = db.exec(sql); return r.length ? r[0] : null; } catch { return null; } };
  // prefer pause-aware columns; fall back if migrations differ.
  let res = tryExec("SELECT id,started_at,task,IFNULL(total_pause_ms,0),pause_started_at FROM sessions WHERE ended_at IS NULL AND IFNULL(deleted,0)=0 ORDER BY started_at DESC LIMIT 1");
  if (res) { const v = res.values[0]; return v && { id: v[0], startedAt: Number(v[1]), task: v[2] || null, totalPauseMs: Number(v[3] || 0), pauseStartedAt: v[4] != null ? Number(v[4]) : null }; }
  res = tryExec(`SELECT ${cols} FROM sessions WHERE ended_at IS NULL AND IFNULL(deleted,0)=0 ORDER BY started_at DESC LIMIT 1`);
  if (res) { const v = res.values[0]; return v && { id: v[0], startedAt: Number(v[1]), task: v[2] || null, totalPauseMs: 0, pauseStartedAt: null }; }
  return null;
}

async function liveStatus(paths) {
  const { openDb } = require('./db');
  const db = await openDb(paths);
  try {
    const sess = activeSession(db);
    if (!sess) return { active: false };

    const stmt = db.prepare('SELECT app_name,bundle_id,exe_name,recorded_at FROM window_events WHERE session_id=:sid ORDER BY recorded_at ASC');
    stmt.bind({ ':sid': sess.id });
    const events = [];
    while (stmt.step()) events.push(stmt.getAsObject());
    stmt.free();

    const now = Date.now();
    const pausedNow = sess.pauseStartedAt ? Math.max(0, now - sess.pauseStartedAt) : 0;
    const trackedSeconds = Math.max(0, (now - sess.startedAt - sess.totalPauseMs - pausedNow) / 1000);

    const seg = buildSegments(events);
    const fs = focusScore({ trackedSeconds, idleSeconds: 0, appSwitchCount: seg.appSwitchCount });

    // Current (last) segment: is a new, not-yet-durable segment pending? (grace window)
    const lastSeg = seg.segments[seg.segments.length - 1] || null;
    const lastDurable = seg.durable.length ? seg.durable[seg.durable.length - 1] : null;
    const lastDurableKey = lastDurable ? lastDurable.key : null;
    let pending = null;
    if (lastSeg && lastSeg.seconds < MIN_DWELL && lastSeg.key !== lastDurableKey) {
      const wallSecsOnApp = Math.max(0, Math.round((now - lastSeg.startAt) / 1000));
      pending = {
        app: lastSeg.app,
        exe: lastSeg.exe || null,                     // exe basename of the detour app
        returnTo: lastDurable ? lastDurable.app : null, // app to go back to so no new switch
        returnToExe: lastDurable ? (lastDurable.exe || null) : null,
        secondsTracked: lastSeg.seconds,              // Promethee accounting (samples*10)
        wallSecsOnApp,                                // smoother wall-clock display
        graceLeft: Math.max(0, MIN_DWELL - lastSeg.seconds),
        startAt: lastSeg.startAt,                     // epoch ms of the 1st (only) sample
        deadlineMs: lastSeg.startAt + CAPTURE_INTERVAL_MS, // locks at the next capture tick
        windowMs: CAPTURE_INTERVAL_MS,                // full bar = this many ms
      };
    }

    // cost of one more penalising switch at the current pace
    const hours = Math.max(trackedSeconds / 3600, 1 / 60);
    const nextSwitchCost = Math.min(35, ((seg.appSwitchCount + 1) / hours) * 2) - fs.switchPenalty;

    // switch penalty caps at 35 pts when switches/hour >= 17.5. If currently capped,
    // how much longer must the session run WITHOUT a new switch to drop to the first
    // point below the cap (34 pts of malus = focus 66)? The cap is fixed, so the target
    // value is always 34.
    const TARGET_MALUS = 34;
    const TARGET_RATE = TARGET_MALUS / 2; // 17 switches/hour
    const atCap = (seg.appSwitchCount / hours) * 2 >= 35;
    const secondsToClearCap = atCap
      ? Math.max(0, Math.ceil((seg.appSwitchCount / TARGET_RATE) * 3600 - trackedSeconds))
      : 0;

    return {
      active: true,
      sessionId: sess.id,
      task: sess.task,
      paused: !!sess.pauseStartedAt,
      startedAt: sess.startedAt,
      trackedSeconds: Math.round(trackedSeconds),
      sampleCount: events.length,
      // epoch ms of the most recent window_event: Promethee's capture ticks run every
      // CAPTURE_INTERVAL_MS from there, so we can predict when a detour will lock.
      lastSampleAt: events.length ? Number(events[events.length - 1].recorded_at || 0) : null,
      captureIntervalMs: CAPTURE_INTERVAL_MS,
      appSwitchCount: seg.appSwitchCount,
      rawAppSwitchCount: seg.rawAppSwitchCount,
      focusFromSwitches: fs.score,          // 100 - switchPenalty (idle not included live)
      switchPenalty: fs.switchPenalty,
      switchesPerHour: fs.switchesPerHour,
      nextSwitchCost: Number(Math.max(0, nextSwitchCost).toFixed(1)),
      atCap,
      secondsToClearCap,
      targetMalus: 34,
      currentApp: lastSeg ? lastSeg.app : null,
      currentExe: lastSeg ? (lastSeg.exe || null) : null,
      pending,
      topDurable: aggregateByApp(seg.durable).slice(0, 4)
        .map(s => ({ app: s.app, minutes: Math.round(s.seconds / 60) })),
    };
  } finally {
    db.close();
  }
}

module.exports = { liveStatus, buildSegments, focusScore, isTrackedApp, CAPTURE_INTERVAL_MS };
