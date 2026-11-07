'use strict';
// Update check: asks GitHub (public API, no token, nothing about the user is sent) for the latest
// release of the project and compares it with the running version. Failing quietly is the rule:
// offline, rate limited, private repo or no release yet all simply mean "nothing to show".
const REPO = 'creatorsarea/promethee-companion';
const RELEASES_URL = `https://github.com/${REPO}/releases`;

function parse(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(v || '').trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
function isNewer(latest, current) {
  const a = parse(latest), b = parse(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
// Only links into this repository are ever opened from the app.
const isOwnUrl = u => typeof u === 'string' && u.startsWith(`https://github.com/${REPO}/`);

async function fetchLatest() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'promethee-companion' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  const j = await res.json();
  if (!j || !j.tag_name) return null;
  return { tag: String(j.tag_name), url: isOwnUrl(j.html_url) ? j.html_url : RELEASES_URL };
}

// Returns { current, latest, url } when a newer release exists, otherwise null.
async function checkForUpdate(current) {
  try {
    const l = await fetchLatest();
    return l && isNewer(l.tag, current) ? { current, latest: l.tag.replace(/^v/, ''), url: l.url } : null;
  } catch { return null; }
}

module.exports = { checkForUpdate, isNewer, isOwnUrl, RELEASES_URL };
