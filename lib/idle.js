'use strict';
// Idle time, computed exactly like Promethee.
// Promethee samples powerMonitor.getSystemIdleTime() every 15s while a session runs
// (kept in memory only, never written to its DB), then at session end:
//   - only samples with idle >= 120s count
//   - each one covers [lastInput + 120s, sampleTime], clipped to the session
//   - intervals are merged, summed, capped at the tracked time
// We run the same sampler in our own process so the live focus score includes idle.

const IDLE_THRESHOLD_SECONDS = 120;
const SAMPLE_INTERVAL_MS = 15000;

function mergeIntervals(iv) {
  const a = iv.map(([s, e]) => [Number(s), Number(e)])
    .filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e > s)
    .sort((x, y) => x[0] - y[0]);
  if (!a.length) return [];
  const out = [a[0]];
  for (const [s, e] of a.slice(1)) {
    const last = out[out.length - 1];
    if (s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

function computeIdle({ startedAtMs, endedAtMs, trackedSeconds, samples, idleThresholdSeconds = IDLE_THRESHOLD_SECONDS }) {
  const start = Number(startedAtMs) || 0;
  const end = Number(endedAtMs) || start;
  const tracked = Math.max(0, Math.floor(Number(trackedSeconds) || Math.max(0, (end - start) / 1000)));
  if (tracked === 0 || end <= start) return { idleSeconds: 0, idleBlockCount: 0 };
  const intervals = [];
  for (const h of samples) {
    const rec = Number(h && h.recordedAt), idle = Number(h && h.idleSeconds);
    if (!Number.isFinite(rec) || !Number.isFinite(idle) || idle < idleThresholdSeconds) continue;
    const graceStart = rec - idle * 1000 + idleThresholdSeconds * 1000;
    const s = Math.max(start, graceStart);
    const e = Math.min(end, rec);
    if (e > s) intervals.push([s, e]);
  }
  const merged = mergeIntervals(intervals);
  const idleSeconds = Math.min(tracked, Math.floor(merged.reduce((a, [s, e]) => a + (e - s), 0) / 1000));
  return { idleSeconds, idleBlockCount: merged.length };
}

// Sampler: one per process. getIdle() is powerMonitor.getSystemIdleTime (injected so the
// module stays testable outside Electron).
function createSampler(getIdle) {
  let sessionId = null, samples = [], timer = null, startedAt = 0;
  const sample = () => { try { samples.push({ recordedAt: Date.now(), idleSeconds: Number(getIdle()) || 0 }); } catch {} };
  return {
    // Called on every DB poll. Starts/stops/resets sampling to follow the active session.
    // Samples are skipped while the session is paused.
    follow(session) {
      const id = session && session.active ? session.sessionId : null;
      if (id !== sessionId) {
        sessionId = id; samples = []; startedAt = Date.now();
        if (timer) { clearInterval(timer); timer = null; }
        if (id) { sample(); timer = setInterval(() => { if (!this.paused) sample(); }, SAMPLE_INTERVAL_MS); }
      }
      this.paused = !!(session && session.paused);
    },
    paused: false,
    samples: () => samples,
    // ms timestamp when we started sampling this session (for the "late start" badge)
    since: () => startedAt,
    stop() { if (timer) clearInterval(timer); timer = null; },
  };
}

module.exports = { computeIdle, mergeIntervals, createSampler, IDLE_THRESHOLD_SECONDS, SAMPLE_INTERVAL_MS };
