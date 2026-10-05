'use strict';
// Read-side API helpers (need the user's token: RLS lets a user read their own rows).
const BASE = 'https://auth.promethee.io';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFubnFuZml0bGFmZmNhZHR1bnVrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5ODk5NjIsImV4cCI6MjA5MDU2NTk2Mn0.ZFQjIWNtjGOLLIz5L17IMd0RPcsJr7wmphwCFcmW23M';

async function api(method, url, token, { body, headers = {} } = {}) {
  const res = await fetch(BASE + url, { method, body, headers: { apikey: ANON, Authorization: `Bearer ${token}`, ...headers } });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  if (!res.ok) throw new Error(`HTTP ${res.status} ${method} ${url} : ${text.slice(0, 300)}`);
  return json ?? text;
}

// Map of session_id -> { eventId, body, hidden } for the user's existing session posts.
async function fetchMyPosts(token, uid) {
  const rows = await api('GET',
    `/rest/v1/feed_events?select=id,completed_session_id,body,hidden_at,event_type&user_id=eq.${uid}` +
    `&completed_session_id=not.is.null&order=created_at.desc&limit=200`, token);
  const map = {};
  for (const r of rows) {
    const sid = r.completed_session_id;
    if (sid && !(sid in map)) map[sid] = { eventId: r.id, body: r.body || '', hidden: !!r.hidden_at };
  }
  return map;
}

module.exports = { api, fetchMyPosts, BASE, ANON };
