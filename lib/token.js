'use strict';
// Read and decrypt the Supabase access token locally, exactly like Promethee's safeStorage
// (Chromium os_crypt): DPAPI + AES-GCM on Windows, Keychain + AES-CBC on macOS. The token is
// used only to call the API from this machine and is never logged or sent anywhere else.
const fs = require('fs');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

function dpapiUnprotect(buf) {
  const ps = 'Add-Type -AssemblyName System.Security;' +
    '$b=[Convert]::FromBase64String($env:PROM_B64);' +
    '$d=[Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);' +
    '[Convert]::ToBase64String($d)';
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
    env: { ...process.env, PROM_B64: buf.toString('base64') }, encoding: 'utf8',
  });
  return Buffer.from(out.trim(), 'base64');
}

// The AES key never changes while the app runs, and unwrapping it spawns PowerShell
// (several hundred ms, blocking), so it is unwrapped once per process.
const keyCache = new Map();
function aesKey(localStatePath) {
  if (keyCache.has(localStatePath)) return keyCache.get(localStatePath);
  const k = aesKeyUncached(localStatePath);
  keyCache.set(localStatePath, k);
  return k;
}
function aesKeyUncached(localStatePath) {
  const ls = JSON.parse(fs.readFileSync(localStatePath, 'utf8'));
  const enc = Buffer.from(ls.os_crypt.encrypted_key, 'base64');
  if (enc.subarray(0, 5).toString() !== 'DPAPI') throw new Error('Local State: unexpected key format');
  return dpapiUnprotect(enc.subarray(5));
}

// macOS: Chromium keeps a random password in the login Keychain ("<App> Safe Storage") and
// derives the AES-128 key from it: PBKDF2-HMAC-SHA1, salt "saltysalt", 1003 iterations.
// The Keychain item belongs to Promethee.app, so the first read shows a macOS prompt asking to
// let `security` use it. The key is derived once per process (one prompt per launch at most).
const MAC_SERVICE = 'Promethee Safe Storage', MAC_ACCOUNT = 'Promethee Key';
let macKey = null;
function macAesKey() {
  if (macKey) return macKey;
  let pw;
  try {
    pw = execFileSync('/usr/bin/security', ['find-generic-password', '-w', '-s', MAC_SERVICE, '-a', MAC_ACCOUNT], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 120000,   // the Keychain prompt waits for the user: do not hang forever if nobody answers
    }).replace(/\n$/, '');
  } catch { throw new Error('Promethee key not readable from the Keychain (access denied or Promethee never opened)'); }
  macKey = crypto.pbkdf2Sync(pw, 'saltysalt', 1003, 16, 'sha1');
  return macKey;
}
function macDecrypt(buf) {
  if (buf.subarray(0, 3).toString() !== 'v10') throw new Error('session.bin: unexpected format');
  const d = crypto.createDecipheriv('aes-128-cbc', macAesKey(), Buffer.alloc(16, 0x20));  // IV = 16 spaces
  return Buffer.concat([d.update(buf.subarray(3)), d.final()]).toString('utf8');
}

function decryptSafeStorage(buf, localStatePath) {
  if (process.platform === 'darwin') return macDecrypt(buf);
  const prefix = buf.subarray(0, 3).toString();
  if (prefix === 'v10' || prefix === 'v11') {
    const key = aesKey(localStatePath);
    const nonce = buf.subarray(3, 15), tag = buf.subarray(buf.length - 16), ct = buf.subarray(15, buf.length - 16);
    const d = crypto.createDecipheriv('aes-256-gcm', key, nonce);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
  }
  return dpapiUnprotect(buf).toString('utf8');
}

function findSession(v) {
  if (typeof v === 'string' && v.trim().startsWith('{')) { try { v = JSON.parse(v); } catch { return null; } }
  if (!v || typeof v !== 'object') return null;
  if (typeof v.access_token === 'string') return v;
  for (const c of Object.values(v)) { const r = findSession(c); if (r) return r; }
  return null;
}
function jwtPayload(tok) {
  const p = tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(Buffer.from(p, 'base64').toString('utf8'));
}

function loadToken(paths) {
  const raw = decryptSafeStorage(fs.readFileSync(paths.sessionBin), paths.localState);
  const session = findSession(raw);
  if (!session) throw new Error('access_token not found in session.bin');
  const payload = jwtPayload(session.access_token);
  const left = payload.exp - Math.floor(Date.now() / 1000);
  if (left < 120) throw new Error('Token expired. Open Promethee to refresh the session, then restart.');
  return { token: session.access_token, uid: payload.sub, secondsLeft: left };
}

module.exports = { loadToken };
