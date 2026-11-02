'use strict';
// Focus Rate standing, read-only (get_my_fr_state is what the Promethee app itself calls).
// The score only changes when the app rescores, so the FR gained by a session is the difference
// between the score before the session and the score after it: we keep a small local history.
const fs = require('fs');
const { api } = require('./api');

const TIERS = ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'legend'];
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null));

async function fetchFrState(token) {
  const r = await api('POST', '/rest/v1/rpc/get_my_fr_state', token, { body: '{}', headers: { 'Content-Type': 'application/json' } });
  const row = Array.isArray(r) ? r[0] : r;
  if (!row || typeof row !== 'object') return null;
  const tier = typeof row.tier_key === 'string' && TIERS.includes(row.tier_key) ? row.tier_key : null;
  return { tier, rank: num(row.rank_in_tier), score: num(row.score), provisional: row.provisional === true, ts: Date.now() };
}

function loadHistory(file) { try { const h = JSON.parse(fs.readFileSync(file, 'utf8')); return Array.isArray(h) ? h : []; } catch { return []; } }

// Appends a snapshot when something changed (or after 6 h), keeps the last 400.
function record(file, snap) {
  const h = loadHistory(file);
  const last = h[h.length - 1];
  if (!last || last.score !== snap.score || last.tier !== snap.tier || last.rank !== snap.rank || snap.ts - last.ts > 6 * 3600e3) {
    h.push(snap);
    try { fs.writeFileSync(file, JSON.stringify(h.slice(-400))); } catch {}
  }
  return h;
}

// FR gained by a session = score now (or at its end) minus the last score seen before it started.
function gainFor(history, startMs, endMs) {
  const before = [...history].reverse().find(s => s.ts <= startMs && s.score != null);
  const after = history.find(s => s.ts >= (endMs || startMs) && s.score != null);
  if (!before || !after) return null;
  return Math.round(after.score - before.score);
}

module.exports = { fetchFrState, loadHistory, record, gainFor, TIERS };
