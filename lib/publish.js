'use strict';
// Build the animated WebP from frames and publish OR update a session post.
const crypto = require('crypto');
const WebP = require('node-webpmux');
const { api, BASE } = require('./api');

const BUCKET = 'feed-images';
const MAX_BYTES = 8 * 1024 * 1024;
const rpc = (token, name, args) => api('POST', `/rest/v1/rpc/${name}`, token, { body: JSON.stringify(args), headers: { 'Content-Type': 'application/json' } });

// frames: Buffer (full frame) or { buffer, x, y } (only the region that changed since the
// previous frame, drawn over it: keeps long animations small). The first frame is full.
async function muxAnimated(frames, delayMs) {
  await WebP.Image.initLib();
  const first = Buffer.isBuffer(frames[0]) ? frames[0] : frames[0].buffer;
  const img = new WebP.Image();
  await img.load(first);
  const width = img.width, height = img.height;
  await img.convertToAnim();
  img.frames.length = 0;
  for (const f of frames) {
    if (Buffer.isBuffer(f)) img.frames.push(await WebP.Image.generateFrame({ buffer: f, delay: delayMs }));
    // ANMF stores offsets divided by 2 (offsets are even)
    else img.frames.push(await WebP.Image.generateFrame({ buffer: f.buffer, x: (f.x | 0) >> 1, y: (f.y | 0) >> 1, delay: delayMs, blend: false, dispose: false }));
  }
  return img.save(null, { width, height, loop: 0, bgColor: [0, 0, 0, 0] });
}

// opts: { token, uid, sessionId, eventId|null, body, title, clientVersion, frames:[Buffer], delayMs, hidden }
async function publishOrEdit(opts) {
  const webp = await muxAnimated(opts.frames, opts.delayMs);
  if (webp.length > MAX_BYTES) throw new Error(`WebP trop lourd (${(webp.length / 1048576).toFixed(1)} Mo > 8 Mo).`);

  const imagePath = `${opts.uid}/${crypto.randomUUID()}.webp`;
  await api('POST', `/storage/v1/object/${BUCKET}/${imagePath}`, opts.token, {
    body: webp, headers: { 'Content-Type': 'image/webp', 'cache-control': 'max-age=31536000', 'x-upsert': 'false' },
  });

  const cleanup = async () => { await api('DELETE', `/storage/v1/object/${BUCKET}`, opts.token, { body: JSON.stringify({ prefixes: [imagePath] }), headers: { 'Content-Type': 'application/json' } }).catch(() => {}); };

  let mode, eventId = opts.eventId || null;
  try {
    if (opts.eventId) {
      mode = 'edit';
      const r = await rpc(opts.token, 'edit_feed_post', { p_event_id: opts.eventId, p_body: opts.body ?? null, p_image_path: imagePath, p_title: opts.title ?? null });
      // edit returns replaced_image_path; the old image is cleaned by the app server-side
      void r;
    } else {
      mode = 'publish';
      const fn = opts.hidden ? 'publish_feed_session_hidden' : 'publish_feed_session';
      const r = await rpc(opts.token, fn, { p_session_id: opts.sessionId, p_title: opts.title ?? null, p_body: opts.body ?? null, p_image_path: imagePath, p_client_version: opts.clientVersion });
      const row = Array.isArray(r) ? r[0] : r;
      eventId = row?.eventId || row?.event_id || null;
    }
  } catch (err) { await cleanup(); throw err; }

  const res = await fetch(`${BASE}/storage/v1/object/public/${BUCKET}/${imagePath}`);
  const served = Buffer.from(await res.arrayBuffer());
  return {
    mode, imagePath, eventId, bytes: webp.length,
    url: `${BASE}/storage/v1/object/public/${BUCKET}/${imagePath}`,
    servedOk: res.ok, servedType: res.headers.get('content-type'),
    servedAnimated: served.includes(Buffer.from('ANIM')), servedIdentical: served.equals(webp),
  };
}

module.exports = { publishOrEdit, muxAnimated };
