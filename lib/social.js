'use strict';
// Optional "follow the author" button. Only ever runs on an explicit click in Card Studio,
// with the user's own token, through the same RPCs the Promethee app uses.
const { api } = require('./api');

// Public Promethee user id of the author (@zaros).
const AUTHOR = { id: 'e90c5615-6c1e-40f7-aca0-ce4ba1317786', handle: 'zaros' };

const post = (token, fn, body) =>
  api('POST', '/rest/v1/rpc/' + fn, token, { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });

// -> 'self' | 'following' | 'requested' | 'none'
async function followState(token, viewerId) {
  if (viewerId === AUTHOR.id) return 'self';
  const r = await post(token, 'get_follow_status', { p_viewer_id: viewerId, p_target_id: AUTHOR.id });
  const row = Array.isArray(r) ? r[0] : r;
  if (row && row.viewer_follows_target) return 'following';
  const req = await api('GET', `/rest/v1/follow_requests?select=target_id&requester_id=eq.${viewerId}&target_id=eq.${AUTHOR.id}`, token);
  return Array.isArray(req) && req.length ? 'requested' : 'none';
}

async function follow(token) { await post(token, 'follow_or_request_v1', { p_target: AUTHOR.id }); }

module.exports = { AUTHOR, followState, follow };
