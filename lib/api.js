'use strict';
// Read-side API helpers (need the user's token: RLS lets a user read their own rows).
const BASE = 'https://auth.promethee.io';
let ANON = null;
// Set once at startup from the installed Promethee app (see lib/anonkey.js).
function setAnonKey(k) { ANON = k; }
function getAnonKey() { if (!ANON) throw new Error('Cle publique Promethee introuvable (app.asar illisible). Mets Promethee a jour puis relance.'); return ANON; }

async function api(method, url, token, { body, headers = {} } = {}) {
  const res = await fetch(BASE + url, { method, body, headers: { apikey: getAnonKey(), Authorization: `Bearer ${token}`, ...headers } });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  if (!res.ok) throw new Error(`HTTP ${res.status} ${method} ${url} : ${text.slice(0, 300)}`);
  return json ?? text;
}

// Map of session_id -> { eventId, body, hidden } for the user's existing session posts.
async function fetchMyPosts(token, uid) {
  const rows = await api('GET',
    `/rest/v1/feed_events?select=id,session_id,body,hidden_at,event_type&user_id=eq.${uid}` +
    `&session_id=not.is.null&order=created_at.desc&limit=200`, token);
  const map = {};
  for (const r of rows) {
    const sid = r.session_id;
    if (sid && !(sid in map)) map[sid] = { eventId: r.id, body: r.body || '', hidden: !!r.hidden_at };
  }
  // Promethee >= 1.3.34 keeps a per-post audience ('everyone' | 'friends' | 'only_me'): when it is
  // available it decides what "cache" means. Best effort, hidden_at stays the fallback.
  try {
    const ids = Object.values(map).map(p => p.eventId).slice(0, 200);
    if (ids.length) {
      const aud = await api('POST', '/rest/v1/rpc/get_feed_event_audiences', token, { body: JSON.stringify({ p_event_ids: ids }), headers: { 'Content-Type': 'application/json' } });
      const by = {}; for (const a of Array.isArray(aud) ? aud : []) if (a?.event_id) by[a.event_id] = a.audience;
      for (const p of Object.values(map)) if (by[p.eventId]) { p.audience = by[p.eventId]; p.hidden = by[p.eventId] !== 'everyone'; }
    }
  } catch {}
  return map;
}

module.exports = { api, fetchMyPosts, BASE, setAnonKey, getAnonKey };
