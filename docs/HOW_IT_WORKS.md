# How it works

Technical notes for people who want to understand or contribute to the project. The README only covers
installation and usage.

## The companion

| State | When | Display |
|---|---|---|
| Idle | no session (or session paused) | sleeping, Zzz |
| Focus | session running | waves once, box: switches, penalty, focus |
| Alert | you left your app | flames, "Back to <app>" + countdown |

- **Click**: opens Card Studio. **Drag**: moves the companion (position is remembered). On macOS
  in the notch, the place is fixed and dragging does nothing.
- **macOS notch**: hidden while idle or focused; springs out of the notch for the alert, on hover of
  the notch, and for short peeks (session start/end, a switch counted, a challenge done). It looks
  and moves like boringNotch: a black NotchShape (top corners curving into the menu bar, rounded
  bottom corners; radii 6/14 closed, 19/24 open) drawn in SVG, going from the exact notch size
  (read from AppKit's `auxiliaryTopLeftArea`/`auxiliaryTopRightArea` and `safeAreaInsets`,
  `lib/notch-mac.js`) to the content size with a damped spring (open: response 0.42 s, damping 0.8;
  close: 0.45 s, 1.0), the content scaling from 0.8 at the top and fading in, clipped by the same
  shape. The window itself never moves; outside the shape it is transparent and click-through.
  Nothing is drawn above the notch's bottom edge, where the menu bar and the physical notch would
  hide it: what rises over the box above the taskbar (the "!" note, the "+1", the "+XP" reward)
  shows under the open shape instead and travels down, in a layer that starts at the shape's bottom
  edge (`.nbelow` in `companion.css`); the window is taller to make room for it.
  `"notchWidth"` in `config.json` overrides the measured width.
- **Tray icon**: show/hide, size (small/medium/large), reset position (bottom right),
  launch at startup, quit.
- The window never takes focus, so Promethee keeps seeing your app.

## The numbers

Everything is computed like Promethee, from its local DB (`promethee.db` + `-wal`, read with
sql.js in a separate thread, only when it changes):

- **Switches**: "durable" segments (>= 2 samples of 10 s), `switches = segments - 1`, with the
  same app filters (explorer, dwm, ...).
- **Penalty**: `min(35, switches per hour x 2)`.
- **Focus**: `100 - penalty - idle`, with `idle = idle share x 50`. Idle time is not in
  Promethee's DB: the companion samples it itself every 15 s (same API, same 120 s threshold,
  same block merging). A **!** appears next to focus if the companion was started after the
  session began.
- **Alert**: foreground app detection (real time) only decides whether the alert is shown.
  The countdown targets the moment Promethee will count the switch (2nd sample on the new app),
  exact as soon as the DB has seen the detour.

## Card Studio

- **Data**: last sessions read from the local DB.
- **Emblems / fonts**: read from `...\Local\Promethee\app-<latest version>\resources\assets\`.
- **Token**: read and decrypted locally from `session.bin` (Windows: DPAPI + AES-GCM; macOS:
  Keychain + AES-CBC, see below), never logged or sent anywhere else. If it is expired, open
  Promethee and retry.
- **Publishing**: uploads the raw WebP (and its `.d.webp` display copy if the long edge exceeds
  1200 px), then calls `publish_feed_session`. "Publish hidden" goes through
  `publish_feed_session_v2` with the `only_me` audience, like the app does for a private post
  with an image.
- **Card styles** (dropdown): Classic, Center (big session time in the middle, rank emblem as
  background, big rank above the STREAK / XP / FOCUS RATE strip, no league name, place change
  or session id) and Companion.
- **Pauses**: since Promethee 1.3.34, window events recorded during a pause
  (`sessions.break_log`, plus the current pause) are ignored for app switches, top apps and call
  time. The live tracker does the same.
- Encoding (`renderer/renderer.js`): `FPS`, `T`, `QUALITY`. Lower them if the file exceeds 8 MB.

## Automatic card data

- **Automatic**: duration, XP, streak (computed like the app, from active days), companion stats,
  league and rank in the league (read-only RPC `get_my_fr_state`, token read locally), FR gained
  (score difference between two readings, local history `fr-history.json`, one reading every
  10 min).
- **Manual**: places gained (not shown in the Center style), and rank/FR of older sessions that
  have no reading.
- **Public anon key**: no longer hardcoded, read from the installed Promethee `app.asar`
  (`lib/anonkey.js`, asar header + main bundle only) and cached in `config.json` per app version.
- **Note**: the local `rank_snapshots` table is NOT the league rank (small values like 18, 53),
  so it is no longer used for the Center style.

## Follow button

Card Studio shows an optional "Follow @zaros" button (hidden if you already follow, or if you are the
author). It only acts on click, with your own token, through `follow_or_request_v1` (same RPC as the
app; a private account receives a follow request instead). Nothing is followed automatically.
To use it for your own fork, change `AUTHOR` in `lib/social.js`.

## Window layout

The window opens on a loading screen (a single animated line). Once the sessions,
stats and league data are loaded it shows two tabs, **Stats** and **Session** (publish or edit a session); the last
opened tab is remembered.

In the **Session** tab, a session that is currently running is listed first and selected by default, with its live
numbers (duration, switches, penalty, focus). The preview refreshes every few seconds and the publish button stays
disabled until Promethee stops the session; the list then reloads and the finished session is selected, ready to
publish. Without a running session, the latest finished session is selected. To add a tab, add a `data-tab` button and a matching `pane<Name>` section in
`renderer/index.html`.

## Stats section

Under the preview, Card Studio shows your stats and a comparison with other people.

- **Local (no network)**: last 7 days vs the previous 7, streak (frozen days bridge the chain but are
  not counted, like `user_profile.current_streak`), longest session, best hour, best day, 14-day chart.
- **Comparison**: "Everyone, this week" ranks the members of the app's weekly board
  (`get_public_leaderboard_weekly_offset`, 500 first by XP, the largest list the app itself fetches) by
  focus time. It always shows 10 rows: the top 10 if you are in it, otherwise the 10 positions around
  yours (25th shows 20th to 29th). "People I follow" (`get_following_list`, then
  `get_user_focus_history_local_v1` per account, 15 accounts max, 4 requests at a time) ranks the
  accounts you follow by focus over the last 7 days. Read-only, same RPCs as the app, your own token.
  Results are cached for 10 minutes; "Refresh" forces a reload. Names are rendered as plain text.
## Visibility

The "Visible to" menu (Everyone, Friends, Only me) matches the app's audiences. A new post goes through
`publish_feed_session` (everyone) or `publish_feed_session_v2` (friends, only me). For a post that is
already published, changing the menu before "Update session" also calls `set_feed_event_audience`. The
last choice is remembered; the default is "Only me".

## Update notice

`lib/update.js` asks the public GitHub API for the latest release (`releases/latest`, no token, a generic
User-Agent) 15 seconds after startup and then every 6 hours. If its tag is newer than the version in
`package.json` (plain `major.minor.patch` comparison), the tray menu gets an "Update available" entry and the
Card Studio header a small link, which can be dismissed per version. Only links into this repository are ever
opened. Every failure (offline, rate limit, private repository, no release yet) is silent.

To announce an update: bump `version` in `package.json`, then publish a GitHub release whose tag is
`v<version>`. Drafts and pre-releases are ignored.

## Taskbar icons on the card

The "companion" card shows a small taskbar. Its app icons are not shipped in this repository: `lib/icons.js` reads
them from the installed Promethee app (`resources/assets/app-icons`, plus `simple-icons/warp.svg` for Warp) and
passes them to the scene as data URLs. If a file is missing (for example after a Promethee update that moves
assets), the scene shows a neutral lettered placeholder instead. The "start" button is a generic dot grid.

## Platforms

The platform specific parts, and how each one is done:

| Part | Windows | macOS |
|---|---|---|
| Data folder (`lib/paths.js`) | `%APPDATA%\Promethee` | `~/Library/Application Support/Promethee` (same files) |
| App resources (`lib/paths.js`) | newest `%LOCALAPPDATA%\Promethee\app-x.y.z\resources` | `/Applications/Promethee.app/Contents/Resources` (or `~/Applications`), version from `CFBundleShortVersionString` |
| Token key (`lib/token.js`) | `Local State` key unwrapped with DPAPI (PowerShell), AES-256-GCM | password of the Keychain item "Promethee Safe Storage" / "Promethee Key" (`security find-generic-password`), PBKDF2-SHA1 (salt `saltysalt`, 1003 rounds, 16 bytes), AES-128-CBC with an IV of 16 spaces (Chromium's `os_crypt`) |
| Foreground app (`lib/foreground.js`) | PowerShell loop, `GetForegroundWindow` | `osascript -l JavaScript` loop, `NSWorkspace.frontmostApplication` (no permission; no window title) |
| Place (`main.js`) | above the taskbar, bottom right, stats box on the taskbar | in the notch: the window starts at the top of a notched display (built-in display with a menu bar of 32 pt or more), under the menu bar otherwise, centred; the panel slides out on an alert; bottom right as an option |
| Window | `focusable: false` | also `type: 'panel'` (non-activating, so clicking it does not make Electron the foreground app), visible on all Spaces and over full-screen apps |
| Tray | notification area icon, click = show/hide | menu bar template icon, click = menu; no Dock icon except while Card Studio is open |
| Start at login | `app.setLoginItemSettings`, on by default | a LaunchAgent when run from source (`lib/login-item-mac.js`, `setLoginItemSettings` would start bare Electron), off by default |

Both platforms read the same DB: on macOS `window_events` has `bundle_id` and `exe_name` is the
lowercased executable name (`orca`, `safari`), which is what the foreground reader reports too, so
the "back to your app" alert compares the same values. Call detection (`lib/calls.js`) already
covers the macOS app names (`zoom.us`, `Microsoft Teams`, `FaceTime`...). Idle time uses Electron's
`powerMonitor`, which works on both.
