# Promethee Companion

A small companion above the Windows taskbar that tracks your Promethee session live, plus
**Card Studio** (opened by clicking the companion) to generate and publish the end-of-session
card as an animated WebP.

## Install

Node 18+ required.

```
cd companion
npm install
npm start
```

On first launch the app registers itself to start with Windows (can be turned off from the
tray icon).

## The companion

| State | When | Display |
|---|---|---|
| Idle | no session (or session paused) | sleeping, Zzz |
| Focus | session running | waves once, box: switches, penalty, focus |
| Alert | you left your app | flames, "Back to <app>" + countdown |

- **Click**: opens Card Studio. **Drag**: moves the companion (position is remembered).
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
- **Token**: read and decrypted locally from `session.bin` (DPAPI + AES-GCM), never logged or
  sent anywhere else. If it is expired, open Promethee and retry.
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

The window opens on a loading screen (a single line, with the optional follow offer under it). Once the sessions,
stats and league data are loaded it shows two tabs, **Stats** and **Session** (publish or edit a session); the last
opened tab is remembered. To add a tab, add a `data-tab` button and a matching `pane<Name>` section in
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
