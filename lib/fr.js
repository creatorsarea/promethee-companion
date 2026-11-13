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

// What the Promethee app shows after a session (league, place, places climbed, Focus Rate earned):
// get_my_fr_rank_delta returns the standing before and after the last rescore. Read-only. The rules
// below mirror the app: places only within the same league, 0 when holding or dropping, none on a
// promotion; Focus Rate earned is the score difference, floored at 0.
async function fetchRankDelta(token) {
  const r = await api('POST', '/rest/v1/rpc/get_my_fr_rank_delta', token, { body: '{}', headers: { 'Content-Type': 'application/json' } });
  const row = Array.isArray(r) ? r[0] : r;
  if (!row || typeof row !== 'object' || !row.tier_key) return null;
  const tierOf = v => (typeof v === 'string' && TIERS.includes(v) ? v : null);
  const pos = v => { const n = num(v); return n != null && n > 0 ? Math.round(n) : null; };
  const tierTo = tierOf(row.tier_key), tierFrom = tierOf(row.prev_tier_key);
  const rankTo = pos(row.rank_in_tier), rankFrom = pos(row.prev_rank_in_tier);
  const score = num(row.score), prevScore = num(row.prev_score);
  const scoreDelta = score != null && prevScore != null ? score - prevScore : null;
  let kind = 'ranked', places = null;
  if (tierFrom && tierTo) {
    const a = TIERS.indexOf(tierFrom), b = TIERS.indexOf(tierTo);
    if (b > a) kind = 'promoted';
    else if (a !== b || rankFrom == null || rankTo == null) kind = 'held';
    else { const f = rankFrom - rankTo; kind = f > 0 ? 'climbed' : 'held'; places = f > 0 ? f : 0; }
  }
  return { kind, tierFrom, tierTo, rankFrom, rankTo, places, score, prevScore, scoreDelta,
    pointsEarned: scoreDelta == null ? null : Math.max(0, Math.round(scoreDelta)), provisional: row.provisional === true };
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

module.exports = { fetchFrState, fetchRankDelta, loadHistory, record, gainFor, TIERS };
