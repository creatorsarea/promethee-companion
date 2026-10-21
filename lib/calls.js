'use strict';
// Video-call detection, same rules as Promethee 1.3.33. Time spent in a call does not count
// as idle (you are not touching the keyboard, but you are working).
//   - native apps: by exe name, then by app name (Zoom, Teams, Webex, FaceTime, Skype...)
//   - browsers: by window title (meet.google.com, "Meet - abc-defg-hij", zoom.us, Teams
//     meeting URLs, webex.com, whereby.com, gather.town), with the " - <browser>" suffix
//     removed first on Windows.
const SAMPLE_SECONDS = 10;
const IS_WIN = process.platform === 'win32';

const CALL_EXE = new Map([
  ['zoom', 'Zoom'], ['teams', 'Microsoft Teams'], ['ms-teams', 'Microsoft Teams'], ['msteams', 'Microsoft Teams'],
  ['webex', 'Webex'], ['webexmta', 'Webex'], ['atmgr', 'Webex'], ['facetime', 'FaceTime'], ['skype', 'Skype'],
  ['whereby', 'Whereby'], ['g2mui', 'GoTo Meeting'], ['gotomeeting', 'GoTo Meeting'], ['bluejeans', 'BlueJeans'],
  ['around', 'Around'], ['gather', 'Gather'], ['meet', 'Google Meet'],
]);
const CALL_APP = new Map([
  ['zoom', 'Zoom'], ['zoom.us', 'Zoom'], ['zoom meetings', 'Zoom'], ['zoom workplace', 'Zoom'],
  ['microsoft teams', 'Microsoft Teams'], ['teams', 'Microsoft Teams'], ['webex', 'Webex'],
  ['cisco webex meetings', 'Webex'], ['webex meetings', 'Webex'], ['facetime', 'FaceTime'], ['skype', 'Skype'],
  ['whereby', 'Whereby'], ['goto meeting', 'GoTo Meeting'], ['gotomeeting', 'GoTo Meeting'],
  ['bluejeans', 'BlueJeans'], ['around', 'Around'], ['gather', 'Gather'], ['google meet', 'Google Meet'],
]);
const CALL_TITLE = [
  [/(^|[\s\-–—|])meet\.google\.com/i, 'Google Meet'],
  [/^meet\s*[-–—]\s*[a-z]{3}-[a-z]{4}-[a-z]{3}(\s|$)/i, 'Google Meet'],
  [/^google meet$/i, 'Google Meet'],
  [/(^|[\s\-–—|])zoom\.us/i, 'Zoom'],
  [/^zoom meeting$/i, 'Zoom'],
  [/^join zoom meeting$/i, 'Zoom'],
  [/^launch meeting\s*[-–—]\s*zoom$/i, 'Zoom'],
  [/teams\.microsoft\.com\/l\/meetup-join\//i, 'Microsoft Teams'],
  [/teams\.microsoft\.com\/_#\/(pre-join-)?calling(\/|\?|$)/i, 'Microsoft Teams'],
  [/teams\.live\.com\/meet\//i, 'Microsoft Teams'],
  [/^(meeting|call|meet now)(\s+(in|with)\s+[^|]+)?\s*\|\s*microsoft teams$/i, 'Microsoft Teams'],
  [/(^|[\s\-–—|])[a-z0-9.-]*webex\.com/i, 'Webex'],
  [/(^|[\s\-–—|])whereby\.com/i, 'Whereby'],
  [/(^|[\s\-–—|])gather\.town/i, 'Gather'],
];
const MEET_LOOSE = /^meet\s*[-–—]\s+\S/i;
const NOT_MEET_GOOGLE_APP = /(^|\s[-–—|]\s)google\s+(docs|drive|sheets|slides|forms|keep|calendar|search)(\s|$)/i;
const NOT_MEET_FILE = /\.(docx?|xlsx?|pptx?|pdf|txt|md|csv|key|pages|numbers)(\s|$)/i;

const BROWSERS = new Set(['chrome', 'google chrome', 'google chrome canary', 'google chrome beta', 'google chrome dev',
  'chromium', 'safari', 'safari technology preview', 'firefox', 'firefox developer edition', 'mozilla firefox', 'arc',
  'dia', 'brave browser', 'brave', 'microsoft edge', 'edge', 'opera', 'opera gx', 'vivaldi', 'orion', 'duckduckgo',
  'zen browser', 'zen']);
const BROWSERS_WIN = new Set(['opera internet browser', 'opera gx internet browser', 'comet']);
const TITLE_SUFFIXES = new Set([...BROWSERS, ...BROWSERS_WIN, 'mozilla firefox private browsing']);
const SEPARATORS = [' - ', ' — ', ' – '];

// Promethee labels a browser tab with the FIRST matching entry of its site list (an endsWith
// pass over the whole list, then an includes pass). Only "Google Meet" counts as a call, but
// any other entry that matches first wins, so the whole list is needed.
// ["needle", "Label", "s" = suffix only | "w" = whole word]
const SITES = [["adsmanager.facebook","Ads Manager"],["business.facebook","Meta Business Suite"],["/ x","X (Twitter)"],["x.com","X (Twitter)"],["twitter.com","X (Twitter)"],["instagram","Instagram","s"],["instagram.com","Instagram"],["facebook","Facebook","s"],["facebook.com","Facebook"],["tiktok","TikTok","s"],["tiktok.com","TikTok"],["snapchat","Snapchat","s"],["snapchat.com","Snapchat"],["linkedin","LinkedIn","s"],["linkedin.com","LinkedIn"],["threads.net","Threads"],["pinterest","Pinterest","s"],["pinterest.com","Pinterest"],["tumblr","Tumblr","s"],["reddit","Reddit","s"],["reddit.com","Reddit"],["bsky","Bluesky"],["mastodon","Mastodon"],["youtube music","YouTube Music"],["music.youtube.com","YouTube Music"],["music.youtube","YouTube Music"],["youtube","YouTube","s"],["youtu.be","YouTube"],["youtube.com","YouTube"],["netflix","Netflix","s"],["netflix.com","Netflix"],["twitch","Twitch","s"],["twitch.tv","Twitch"],["disney","Disney+","s"],["hbomax","HBO Max"],["hulu","Hulu","s"],["primevideo","Prime Video"],["crunchyroll","Crunchyroll"],["vimeo","Vimeo","s"],["chatgpt","ChatGPT"],["chat.openai","ChatGPT"],["claude.ai","Claude"],["gemini.google","Gemini"],["perplexity","Perplexity"],["copilot.microsoft","Copilot"],["grok.com","Grok"],["deepseek.com","DeepSeek"],["chat.deepseek","DeepSeek"],["mistral.ai","Mistral"],["notebooklm","NotebookLM"],["replit.com","Replit"],["v0.dev","v0"],["lovable.dev","Lovable"],["bolt.new","Bolt"],["github","GitHub"],["gitlab","GitLab"],["bitbucket","Bitbucket"],["stack overflow","Stack Overflow"],["stackoverflow","Stack Overflow"],["stack exchange","Stack Exchange"],["localhost","localhost"],["127.0.0.1","localhost"],["vercel","Vercel"],["netlify","Netlify"],["console.aws","AWS"],["supabase","Supabase"],["developer.mozilla","MDN"],["npmjs.com","npm"],["mail.google","Gmail"],["gmail","Gmail"],["google docs","Google Docs"],["docs.google","Google Docs"],["google sheets","Google Sheets"],["sheets.google","Google Sheets"],["google slides","Google Slides"],["slides.google","Google Slides"],["google drive","Google Drive"],["drive.google","Google Drive"],["google calendar","Google Calendar"],["calendar.google","Google Calendar"],["google search","Google Search"],["notion","Notion"],["figma","Figma"],["linear.app","Linear"],["atlassian","Jira"],["jira","Jira"],["confluence","Confluence"],["asana","Asana"],["trello","Trello"],["airtable","Airtable"],["overleaf","Overleaf"],["canva","Canva"],["todoist","Todoist"],["ticktick","TickTick"],["clickup","ClickUp"],["miro.com","Miro"],["discord","Discord"],["web.telegram","Telegram"],["web.whatsapp","WhatsApp"],["messenger.com","Messenger"],["slack.com","Slack"],["meet.google","Google Meet"],["news.ycombinator","Hacker News"],["hacker news","Hacker News"],["substack","Substack"],["medium.com","Medium"],["wikipedia","Wikipedia"],["nytimes","NY Times"],["theguardian","The Guardian"],["theverge","The Verge"],["techcrunch","TechCrunch"],["chess.com","Chess.com"],["lichess","Lichess"],["leetcode","LeetCode"],["duolingo","Duolingo"],["coursera","Coursera"],["udemy","Udemy"],["khan academy","Khan Academy"],["khanacademy","Khan Academy"],["freecodecamp","freeCodeCamp"],["soundcloud","SoundCloud"],["music.apple","Apple Music"],["amazon music","Amazon Music"],["music.amazon","Amazon Music"],["binance.com","Binance"],["coinbase.com","Coinbase"],["amazon.","Amazon"],["ebay","eBay"],["etsy","Etsy"],["aliexpress","AliExpress"],["ads manager","Ads Manager","w"],["meta business suite","Meta Business Suite","w"],["google ads","Google Ads","w"]];
const TITLE_SEPS = [' - ', ' – ', ' — ', ' | ', ' • ', ' · ', ': ', ' : ', ' » ', ' / '];
const suffixMatch = (t, needle) => t.replace(/^\(\d+\)\s*/, '') === needle || TITLE_SEPS.some(sep => t.endsWith(sep + needle));
const WORD = /[\p{L}\p{N}]/u;
const wordAt = (t, n, i) => !WORD.test(i > 0 ? t[i - 1] : '') && !WORD.test(t[i + n.length] || '');
function hasWord(t, n) { for (let i = t.indexOf(n); i !== -1; i = t.indexOf(n, i + 1)) if (wordAt(t, n, i)) return true; return false; }
function siteLabel(lowTitle) {
  for (const [n, label, o] of SITES) {
    if (o === 's' ? suffixMatch(lowTitle, n) : lowTitle.endsWith(n) && (o !== 'w' || wordAt(lowTitle, n, lowTitle.length - n.length))) return label;
  }
  for (const [n, label, o] of SITES) if (o !== 's' && (o === 'w' ? hasWord(lowTitle, n) : lowTitle.includes(n))) return label;
  return null;
}

const norm = s => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const exeStem = e => { const t = typeof e === 'string' ? e.trim() : ''; return (t ? (t.split(/[\\/]/).pop() || '') : '').toLowerCase().replace(/\.(exe|app)$/i, ''); };
const isBrowser = app => { const t = String(app || '').trim().toLowerCase(); return !!t && (BROWSERS.has(t) || (IS_WIN && BROWSERS_WIN.has(t))); };

function lastSeparator(t) {
  let best = null;
  for (const sep of SEPARATORS) { const i = t.lastIndexOf(sep); if (i !== -1 && (!best || i > best.at)) best = { at: i, end: i + sep.length }; }
  return best;
}
// "Page - Google Chrome" -> "Page" (Windows titles carry the browser name)
function stripBrowserSuffix(title) {
  const t = String(title ?? '').replace(/​/g, '');
  if (!IS_WIN) return t;
  const m = lastSeparator(t);
  if (!m) return t;
  const tail = t.slice(m.end).trim().toLowerCase();
  if (!TITLE_SUFFIXES.has(tail)) return t;
  let s = t.slice(0, m.at);
  if (tail === 'microsoft edge') { const m2 = lastSeparator(s); if (m2) s = s.slice(0, m2.at); s = s.replace(/ and \d+ more pages?$/i, ''); }
  return s;
}
function callFromTitle(title) {
  const t = String(title ?? '').trim();
  if (!t) return null;
  for (const [re, label] of CALL_TITLE) if (re.test(t)) return label;
  return MEET_LOOSE.test(t) && !NOT_MEET_GOOGLE_APP.test(t) && !NOT_MEET_FILE.test(t) ? 'Google Meet' : null;
}

// window_event row -> call label or null
function callOf(ev) {
  const app = ev.app_name ?? ev.appName ?? '', exe = ev.exe_name ?? ev.exeName ?? '', title = ev.window_title ?? ev.windowTitle ?? null;
  if (isBrowser(app)) {
    const byTitle = callFromTitle(stripBrowserSuffix(title));
    if (byTitle) return byTitle;
    if (!title) return null;
    return siteLabel(stripBrowserSuffix(String(title).toLowerCase())) === 'Google Meet' ? 'Google Meet' : null;
  }
  const byExe = CALL_EXE.get(exeStem(exe));
  if (byExe) return byExe;
  const a = norm(app);
  if (!a) return null;
  return CALL_APP.get(a) ?? (a.startsWith('zoom ') || a === 'zoom' ? 'Zoom' : null);
}

// [[start, end]] covered by call samples (each sample = 10 s from its recorded_at), merged
function callIntervals(events, sampleSeconds = SAMPLE_SECONDS) {
  const ms = sampleSeconds * 1000, iv = [];
  for (const ev of events) {
    const at = Number(ev.recorded_at ?? ev.recordedAt);
    if (Number.isFinite(at) && ms > 0 && callOf(ev)) iv.push([at, at + ms]);
  }
  iv.sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [s, e] of iv) { const l = out[out.length - 1]; if (l && s <= l[1]) l[1] = Math.max(l[1], e); else out.push([s, e]); }
  return out;
}

module.exports = { callOf, callIntervals, stripBrowserSuffix };
