'use strict';
// Pure function: turns (Promethee DB live status + real-time foreground + idle) into what
// the companion must show. Numbers come only from the DB (+ our idle sampler, same formula
// as Promethee). The real-time foreground only decides WHEN the alert shows/hides.
const { focusScore } = require('./live');

const LOCKED_HOLD_MS = 0;         // the alert ends right when the switch locks (renderer shows +1)
const FG_SETTLE_MS = 700;         // ignore foreground flickers shorter than this

const norm = s => (typeof s === 'string' ? s.trim().toLowerCase().replace(/\.exe$/, '') : '');

function sameApp(fg, exe, app) {
  if (!fg || !fg.ok) return null;                      // unknown
  if (exe && fg.exe) return fg.exe === exe;
  if (app && fg.app) return norm(fg.app) === norm(app);
  return null;
}

// Predict when a detour that started at `sinceMs` locks into a switch:
// Promethee captures every `interval` ms from `lastSampleAt`; the 1st capture on the new
// app is at T1, and the 2nd one (T1 + interval) makes it a durable segment = +1 switch.
function predictDeadline(sinceMs, lastSampleAt, interval) {
  if (!lastSampleAt) return sinceMs + 2 * interval;
  const k = Math.max(0, Math.ceil((sinceMs - lastSampleAt) / interval));
  return lastSampleAt + k * interval + interval;
}

function computeView({ db, fg, now = Date.now(), idleSeconds = 0, samplerSince = 0 }) {
  if (!db || !db.active) return { mode: 'veille', stats: null, alert: null };

  const fs = focusScore({ trackedSeconds: db.trackedSeconds, idleSeconds, appSwitchCount: db.appSwitchCount });
  const stats = {
    switches: db.appSwitchCount,
    malus: Math.round(fs.switchPenalty),
    focus: fs.score,
    idleSeconds,
    // companion started (or restarted) after the session began: idle before that is unknown
    late: !!(samplerSince && db.startedAt && samplerSince > db.startedAt + 30000),
  };
  // accepted bonus challenge ("stay 15 more minutes"): time left until Promethee grants it
  const bonuses = Array.isArray(db.bonuses) ? db.bonuses : [];
  const live = bonuses.filter(b => b.accepted && !b.completed && !b.deleted && b.targetSec > 0).pop();
  stats.challenge = live ? {
    id: live.id, xp: live.xp,
    // seconds left, only while paused (otherwise the renderer counts down to endsAt)
    frozenSec: db.paused ? Math.max(0, Math.ceil(live.targetSec - db.trackedSeconds)) : null,
    // wall-clock end (stable between pushes); null while paused (the timer is frozen)
    endsAt: db.paused ? null : Math.round((now + (live.targetSec - db.trackedSeconds) * 1000) / 1000) * 1000,
  } : null;
  stats.bonusDone = bonuses.filter(b => b.completed && !b.deleted).map(b => ({ id: b.id, xp: b.xp }));
  if (db.paused) return { mode: 'veille', stats, alert: null, paused: true };

  // "home" = last durable app (the one to go back to)
  const homeApp = db.pending ? db.pending.returnTo : db.currentApp;
  const homeExe = db.pending ? db.pending.returnToExe : db.currentExe;
  if (!homeApp && !homeExe) return { mode: 'focus', stats, alert: null };

  const onHome = sameApp(fg, homeExe, homeApp);
  if (onHome === true) return { mode: 'focus', stats, alert: null };

  const interval = db.captureIntervalMs || 10000;
  let deadlineMs = null;
  if (db.pending && db.pending.returnTo) {
    deadlineMs = db.pending.deadlineMs;                         // exact: DB saw the detour
  } else if (onHome === false && fg.sinceMs && now - fg.sinceMs >= FG_SETTLE_MS) {
    deadlineMs = predictDeadline(fg.sinceMs, db.lastSampleAt, interval); // DB not caught up yet
  }
  if (!deadlineMs || now > deadlineMs + LOCKED_HOLD_MS) return { mode: 'focus', stats, alert: null };

  return {
    mode: 'alerte', stats,
    alert: { returnTo: homeApp || homeExe, deadlineMs, windowMs: interval, exact: !!db.pending },
  };
}

module.exports = { computeView, predictDeadline, LOCKED_HOLD_MS };
