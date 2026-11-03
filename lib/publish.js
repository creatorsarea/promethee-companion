'use strict';
// Build the animated WebP from frames and publish OR update a session post.
const crypto = require('crypto');
const WebP = require('node-webpmux');
const { api, BASE } = require('./api');

const BUCKET = 'feed-images';
const MAX_BYTES = 8 * 1024 * 1024;
// Feed image naming used by Promethee since 1.3.33: "<uuid>_<W>x<H>.webp" lets the feed reserve
// the right aspect ratio before the image loads, and when the long edge is over 1200 px the
// feed loads the display copy "<uuid>_<W>x<H>.d.webp" (long edge 1200). Without the size in
// the name the feed loads the full file and only learns its ratio once it has downloaded.
const DISPLAY_LONG_EDGE = 1200;
const needsDisplayCopy = (w, h) => Math.max(w, h) > DISPLAY_LONG_EDGE;
const displayDims = (w, h) => { const k = DISPLAY_LONG_EDGE / Math.max(w, h); return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) }; };
const displayPathOf = p => p.replace(/\.(webp)$/i, '.d.$1');
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
  const buf = await img.save(null, { width, height, loop: 0, bgColor: [0, 0, 0, 0] });
  buf.width = width; buf.height = height;
  return buf;
}
const upload = (token, path, buf) => api('POST', `/storage/v1/object/${BUCKET}/${path}`, token, {
  body: buf, headers: { 'Content-Type': 'image/webp', 'cache-control': 'max-age=31536000', 'x-upsert': 'false' },
});

// opts: { token, uid, sessionId, eventId|null, body, title, clientVersion, frames, displayFrames, delayMs, hidden, audience }
async function publishOrEdit(opts) {
  const webp = await muxAnimated(opts.frames, opts.delayMs);
  if (webp.length > MAX_BYTES) throw new Error(`WebP too heavy (${(webp.length / 1048576).toFixed(1)} MB > 8 MB).`);
  const { width: W, height: H } = webp;

  // display copy (animated, long edge 1200) when the card is bigger than that
  let display = null;
  if (needsDisplayCopy(W, H) && opts.displayFrames) {
    display = await muxAnimated(opts.displayFrames, opts.delayMs);
    const want = displayDims(W, H);
    if (display.width !== want.w || display.height !== want.h) throw new Error(`Apercu feed ${display.width}x${display.height}, attendu ${want.w}x${want.h}.`);
    if (display.length > MAX_BYTES) throw new Error(`Feed preview too heavy (${(display.length / 1048576).toFixed(1)} MB).`);
  }

  // the size goes in the name only when the matching display copy exists (or is not needed):
  // a sized name over 1200 px makes the feed ask for the .d copy
  const id = crypto.randomUUID();
  const sized = !needsDisplayCopy(W, H) || !!display;
  const imagePath = `${opts.uid}/${sized ? `${id}_${W}x${H}` : id}.webp`;
  const displayPath = display ? displayPathOf(imagePath) : null;
  if (display) await upload(opts.token, displayPath, display);
  try { await upload(opts.token, imagePath, webp); }
  catch (err) { if (displayPath) await removeObjects(opts.token, [displayPath]); throw err; }

  const cleanup = () => removeObjects(opts.token, displayPath ? [imagePath, displayPath] : [imagePath]);

  let mode, eventId = opts.eventId || null;
  try {
    if (opts.eventId) {
      mode = 'edit';
      const r = await rpc(opts.token, 'edit_feed_post', { p_event_id: opts.eventId, p_body: opts.body ?? null, p_image_path: imagePath, p_title: opts.title ?? null });
      // edit returns replaced_image_path; the old image is cleaned by the app server-side
      void r;
    } else {
      mode = 'publish';
      // Same routes as the app itself: public posts go through publish_feed_session; a post with
      // an image that is not public goes through publish_feed_session_v2 with an audience
      // ('only_me' = "cache"). publish_feed_session_hidden is the app's bare "skipped" post
      // (session id + title only), it does not carry an image or a body.
      const audience = opts.audience || (opts.hidden ? 'only_me' : 'everyone');
      const args = { p_session_id: opts.sessionId, p_title: opts.title ?? null, p_body: opts.body ?? null, p_image_path: imagePath, p_client_version: opts.clientVersion };
      const r = audience === 'everyone'
        ? await rpc(opts.token, 'publish_feed_session', args)
        : await rpc(opts.token, 'publish_feed_session_v2', { ...args, p_audience: audience });
      const row = Array.isArray(r) ? r[0] : r;
      eventId = typeof row === 'string' ? row : (row?.eventId || row?.event_id || null);
    }
  } catch (err) { await cleanup(); throw err; }

  const res = await fetch(`${BASE}/storage/v1/object/public/${BUCKET}/${imagePath}`);
  const served = Buffer.from(await res.arrayBuffer());
  let displayOk = null;
  if (displayPath) { const d = await fetch(`${BASE}/storage/v1/object/public/${BUCKET}/${displayPath}`); displayOk = d.ok; }
  return {
    mode, imagePath, displayPath, displayOk, eventId, bytes: webp.length, displayBytes: display ? display.length : 0, width: W, height: H,
    url: `${BASE}/storage/v1/object/public/${BUCKET}/${imagePath}`,
    servedOk: res.ok, servedType: res.headers.get('content-type'),
    servedAnimated: served.includes(Buffer.from('ANIM')), servedIdentical: served.equals(webp),
  };
}

async function removeObjects(token, prefixes) {
  await api('DELETE', `/storage/v1/object/${BUCKET}`, token, { body: JSON.stringify({ prefixes }), headers: { 'Content-Type': 'application/json' } }).catch(() => {});
}

module.exports = { publishOrEdit, muxAnimated, displayDims, displayPathOf, needsDisplayCopy };
