'use strict';
// Stats section of Card Studio.
//  - localStats(): everything computed from the local Promethee DB (no network).
//  - compare(): last-7-days focus of people near you in your league, or of the accounts you
//    follow, through the same RPCs the Promethee app uses (read-only, your own token).
const { openDb, buildActiveDays, streakAsOf, enCA, frozenDays } = require('./db');
const { api } = require('./api');

const DAY = 86400e3;
const key = ms => enCA(ms);
const dayKeyBack = n => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - n); return d.toLocaleDateString('en-CA'); };

async function localStats(paths) {
  const db = await openDb(paths);
  const r = db.exec('SELECT started_at,ended_at,duration_seconds FROM sessions WHERE ended_at IS NOT NULL AND IFNULL(deleted,0)=0');
  const rows = (r.length ? r[0].values : []).map(([s, e, d]) => ({ started_at: Number(s), ended_at: Number(e), duration_seconds: Number(d) || 0 }));

  const perDay = {};                       // focus seconds by local start day
  const perHour = new Array(24).fill(0);   // focus seconds by hour of day (wall-clock overlap, scaled to net duration)
  let longest = null;
  for (const s of rows) {
    const k = key(s.started_at);
    perDay[k] = (perDay[k] || 0) + s.duration_seconds;
    if (!longest || s.duration_seconds > longest.sec) longest = { sec: s.duration_seconds, at: s.started_at };
    const wall = Math.max(1, s.ended_at - s.started_at), scale = Math.min(1, (s.duration_seconds * 1000) / wall);
    for (let t = s.started_at, guard = 0; t < s.ended_at && guard < 400; guard++) {
      const h = new Date(t); const next = Math.min(s.ended_at, new Date(h.getFullYear(), h.getMonth(), h.getDate(), h.getHours() + 1).getTime());
      perHour[h.getHours()] += ((next - t) / 1000) * scale; t = next;
    }
  }
  const sum = (from, to) => { let x = 0; for (let i = from; i <= to; i++) x += perDay[dayKeyBack(i)] || 0; return x; };
  const week = sum(0, 6), prevWeek = sum(7, 13);
  const series = []; for (let i = 13; i >= 0; i--) { const k = dayKeyBack(i); series.push({ day: k, sec: Math.round(perDay[k] || 0) }); }
  let bestDay = null; for (const [k, v] of Object.entries(perDay)) if (!bestDay || v > bestDay.sec) bestDay = { day: k, sec: v };
  const bestHour = perHour.some(v => v > 0) ? perHour.indexOf(Math.max(...perHour)) : null;

  const active = buildActiveDays(rows, frozenDays(db));
  const today = key(Date.now());
  const streak = streakAsOf(active, today);
  let activeDays30 = 0; for (let i = 0; i < 30; i++) if (active.has(dayKeyBack(i)) && !active.frozen.has(dayKeyBack(i))) activeDays30++;
  let maxStreak = 0; for (const d of active) { const s = streakAsOf(active, d); if (s > maxStreak) maxStreak = s; }
  return {
    weekSec: Math.round(week), prevWeekSec: Math.round(prevWeek), sessionsWeek: rows.filter(s => key(s.started_at) >= dayKeyBack(6)).length,
    series, streak, maxStreak, activeDays30,
    longest: longest && { sec: longest.sec, day: key(longest.at) }, bestDay: bestDay && { day: bestDay.day, sec: Math.round(bestDay.sec) }, bestHour,
  };
}

// ---- comparison with other people (network) ----
const post = (token, fn, body) => api('POST', '/rest/v1/rpc/' + fn, token, { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
const NEAR = 3; // neighbours kept on each side of you
const cache = new Map(); const TTL = 10 * 60e3, MAX_FOLLOWED = 15;

async function neighbours(token) {
  const rows = await post(token, 'get_fr_tier_board_window', { p_tier_key: null, p_neighbours: NEAR });
  const all = (Array.isArray(rows) ? rows : []).map(u => ({ id: u.id || null, name: u.display_name || u.handle || '?', handle: u.handle || null, weekSec: num(u.week_focus_seconds), isMe: u.is_me === true, place: num(u.rank_in_tier) || null }));
  // the board window also carries the top of the tier: keep only the people right around you
  all.sort((a, b) => (a.place ?? Infinity) - (b.place ?? Infinity));
  const me = all.findIndex(u => u.isMe);
  return me < 0 ? all.slice(0, 2 * NEAR + 1) : all.slice(Math.max(0, me - NEAR), me + NEAR + 1);
}

async function history7(token, uid) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  let rows;
  try { rows = await post(token, 'get_user_focus_history_local_v1', { p_user_id: uid, p_days: 7, p_timezone: tz }); }
  catch { rows = await post(token, 'get_user_focus_history', { p_user_id: uid, p_days: 7 }); }
  return (Array.isArray(rows) ? rows : []).reduce((a, r) => a + num(r.focus_seconds), 0);
}

async function following(token, myId) {
  const list = (await post(token, 'get_following_list', { p_user_id: myId, p_limit: 50 })) || [];
  const people = (Array.isArray(list) ? list : []).filter(u => u && u.id && u.id !== myId).slice(0, MAX_FOLLOWED);
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (i < people.length) {
      const u = people[i++];
      try { out.push({ id: u.id, name: u.display_name || u.handle || '?', handle: u.handle || null, weekSec: await history7(token, u.id), isMe: false }); } catch {}
    }
  }));
  return { rows: out, total: Array.isArray(list) ? list.length : 0 };
}

async function compare(token, myId, mode, force) {
  const k = mode + ':' + myId, hit = cache.get(k);
  if (!force && hit && Date.now() - hit.t < TTL) return hit.v;
  let rows, note = null;
  if (mode === 'following') { const f = await following(token, myId); rows = f.rows; if (f.total > MAX_FOLLOWED) note = `first ${MAX_FOLLOWED} of ${f.total} followed accounts`; }
  else rows = await neighbours(token);
  // same source for everybody: in "following" mode the app's own history RPC is used for you too
  if (mode === 'following') { rows.push({ id: myId, name: 'You', handle: null, weekSec: await history7(token, myId), isMe: true }); }
  else rows = rows.map(u => (u.isMe ? { ...u, name: 'You' } : u));
  rows.sort((a, b) => b.weekSec - a.weekSec);
  const v = { mode, rows, note, at: Date.now() };
  cache.set(k, { t: Date.now(), v });
  return v;
}

module.exports = { localStats, compare };
