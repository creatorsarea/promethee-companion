'use strict';
// The Supabase public "anon" key is the same for every Promethee user and is shipped inside the
// app itself. Instead of hardcoding it, read it from the installed app.asar (only the small
// main-process bundle is read, not the whole 270 MB archive) and cache it per app version.
// Electron patches `fs` so that .asar files look like folders; `original-fs` is the untouched one
// (plain Node, e.g. in tests, has no such module).
let fs; try { fs = require('original-fs'); } catch { fs = require('fs'); }

const JWT = /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}/g;

function isAnon(tok) {
  try {
    const p = JSON.parse(Buffer.from(tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    return p && p.role === 'anon' && p.iss === 'supabase' && typeof p.ref === 'string';
  } catch { return false; }
}

// Lists { path, offset, size } of the files in an asar, reading only its header.
function asarFiles(fd) {
  const head = Buffer.alloc(16);
  fs.readSync(fd, head, 0, 16, 0);
  const jsonLen = head.readUInt32LE(12);
  const dataStart = 8 + head.readUInt32LE(4);
  const json = Buffer.alloc(jsonLen);
  fs.readSync(fd, json, 0, jsonLen, 16);
  const out = [];
  (function walk(node, base) {
    for (const [name, n] of Object.entries(node.files || {})) {
      const p = base ? base + '/' + name : name;
      if (n.files) walk(n, p);
      else if (n.size != null && n.offset != null && !n.unpacked) out.push({ path: p, offset: dataStart + Number(n.offset), size: n.size });
    }
  })(JSON.parse(json.toString('utf8')), '');
  return out;
}

function findAnonKey(asarPath, maxFileBytes = 6 * 1024 * 1024) {
  const fd = fs.openSync(asarPath, 'r');
  try {
    const files = asarFiles(fd).filter(f => /\.js$/.test(f.path) && f.size <= maxFileBytes);
    // main-process bundle first, then everything else that is small enough
    files.sort((a, b) => (/(^|\/)build\/index-/.test(b.path) ? 1 : 0) - (/(^|\/)build\/index-/.test(a.path) ? 1 : 0));
    for (const f of files) {
      const buf = Buffer.alloc(f.size);
      fs.readSync(fd, buf, 0, f.size, f.offset);
      const txt = buf.toString('latin1');
      if (!txt.includes('eyJ')) continue;
      for (const m of txt.matchAll(JWT)) if (isAnon(m[0])) return m[0];
    }
    return null;
  } finally { fs.closeSync(fd); }
}

module.exports = { findAnonKey, isAnon };
