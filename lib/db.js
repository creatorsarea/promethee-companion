'use strict';
// Read Promethee's local SQLite DB with sql.js (WASM, no native module).
// Applies the -wal overlay so a just-finished session is visible even before
// SQLite checkpoints it into the main .db file.
const fs = require('fs');
const initSqlJs = require('sql.js');

function applyWal(dbBuf, walBuf) {
  if (!walBuf || walBuf.length < 32) return dbBuf;
  const wv = new DataView(walBuf.buffer, walBuf.byteOffset, walBuf.length);
  const magic = wv.getUint32(0);
  if (magic !== 0x377f0682 && magic !== 0x377f0683) return dbBuf;
  let ps = wv.getUint32(8); if (ps === 1) ps = 65536;
  const salt1 = wv.getUint32(16), salt2 = wv.getUint32(20);
  const fsz = 24 + ps, nf = Math.floor((walBuf.length - 32) / fsz);
  let pages = new Map(), committed = null, dbSize = null;
  for (let i = 0; i < nf; i++) {
    const off = 32 + i * fsz;
    const pno = wv.getUint32(off), cs = wv.getUint32(off + 4);
    const s1 = wv.getUint32(off + 8), s2 = wv.getUint32(off + 12);
    if (s1 !== salt1 || s2 !== salt2) break;
    pages.set(pno, off + 24);
    if (cs !== 0) { committed = new Map(pages); dbSize = cs; }
  }
  if (committed === null) return dbBuf;
  const out = Buffer.alloc(dbSize * ps);
  dbBuf.copy(out, 0, 0, Math.min(dbBuf.length, out.length));
  for (const [pno, poff] of committed) {
    if (pno >= 1 && pno <= dbSize) walBuf.copy(out, (pno - 1) * ps, poff, poff + ps);
  }
  return out;
}

const pad2 = n => String(n).padStart(2, '0');
function fmtDur(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return { durMin: Math.round(sec / 60), label: `${h}H ${pad2(m)}M` };
}
function fmtSession(st, en) {
  const ds = new Date(Number(st)), de = new Date(Number(en));
  const date = ds.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }).toUpperCase();
  const t = d => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${date} · ${t(ds)} – ${t(de)}`;
}
const localDate = ms => { const d = new Date(Number(ms)); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };


// --- streak (matches Promethee: active day = local date covered by a >=600s session,
// from its start date to its end date; streak at D = consecutive active days ending at D) ---
const STREAK_MIN_SEC = 600;
function enCA(ms) { return new Date(Number(ms)).toLocaleDateString('en-CA'); }
function addDays(dateStr, delta) { const [y, m, d] = dateStr.split('-').map(Number); const o = new Date(y, m - 1, d); o.setDate(o.getDate() + delta); return o.toLocaleDateString('en-CA'); }
function buildActiveDays(rawSessions) {
  const set = new Set();
  for (const r of rawSessions) {
    if (r.ended_at == null || (r.duration_seconds || 0) < STREAK_MIN_SEC) continue;
    const start = new Date(Number(r.started_at)); start.setHours(0, 0, 0, 0);
    const end = new Date(Number(r.ended_at)); end.setHours(0, 0, 0, 0);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) continue;
    for (let dd = new Date(start), guard = 0; dd <= end && guard < 367; dd.setDate(dd.getDate() + 1), guard++) set.add(dd.toLocaleDateString('en-CA'));
  }
  return set;
}
function streakAsOf(activeDays, dateStr) {
  const prev = addDays(dateStr, -1);
  let anchor = activeDays.has(dateStr) ? dateStr : (activeDays.has(prev) ? prev : null);
  if (!anchor) return 0;
  let i = 0, a = anchor;
  while (activeDays.has(a)) { i += 1; a = addDays(a, -1); }
  return i;
}

let SQLP = null;
async function openDb(paths) {
  if (!SQLP) {
    const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');
    SQLP = initSqlJs({ wasmBinary: fs.readFileSync(wasmPath) });
  }
  const SQL = await SQLP;
  const dbBuf = fs.readFileSync(paths.dbPath);
  const walBuf = fs.existsSync(paths.walPath) ? fs.readFileSync(paths.walPath) : null;
  return new SQL.Database(applyWal(dbBuf, walBuf));
}

async function readAll(paths, limit = 30) {
  const db = await openDb(paths);
  const rows = sql => { const r = db.exec(sql); return r.length ? r[0].values : []; };
  const one = sql => { const r = db.exec(sql); return r.length ? r[0].values[0] : null; };

  const profile = { streak: 0, displayName: 'Zaros' };
  try { const r = one('SELECT current_streak,display_name FROM user_profile LIMIT 1'); if (r) { profile.streak = r[0] || 0; if (r[1]) profile.displayName = r[1]; } } catch {}

  // rank by day
  const rankByDate = {};
  let latestRank = null;
  try {
    for (const [date, rank, cap] of rows('SELECT date,rank,captured_at FROM rank_snapshots ORDER BY captured_at DESC')) {
      if (!(date in rankByDate)) rankByDate[date] = rank;
      if (latestRank === null) latestRank = rank;
    }
  } catch {}

  // all ended sessions (for the active-days set used by streak)
  const allRaw = rows('SELECT started_at,ended_at,duration_seconds FROM sessions WHERE ended_at IS NOT NULL AND IFNULL(deleted,0)=0')
    .map(([started_at, ended_at, duration_seconds]) => ({ started_at, ended_at, duration_seconds }));
  const activeDays = buildActiveDays(allRaw);

  const sessions = [];
  for (const [id, st, en, dur, xp, task] of rows(
    `SELECT id,started_at,ended_at,duration_seconds,xp_earned,task FROM sessions
     WHERE ended_at IS NOT NULL AND IFNULL(deleted,0)=0 ORDER BY ended_at DESC LIMIT ${limit}`)) {
    const d = fmtDur(dur);
    sessions.push({
      sessionId: id, task: task || null,
      durMin: d.durMin, durLabel: d.label,
      xp: '+' + xp, session: fmtSession(st, en),
      rank: rankByDate[localDate(st)] ?? latestRank ?? 1,
      streak: streakAsOf(activeDays, enCA(en)),
      startedAt: Number(st),
      pickLabel: `${d.label} · ${fmtSession(st, en)}${task ? ' · ' + task : ''}`,
    });
  }
  db.close();
  if (!sessions.length) throw new Error('Aucune session terminee dans la DB.');
  return { profile, sessions };
}

module.exports = { readAll, openDb, applyWal };
