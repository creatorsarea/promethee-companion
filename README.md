# Promethee Companion

> **Windows only, for now.** This project has only been developed and tested on Windows. It has not
> been tested on macOS and is not expected to work there as is. A pull request adding macOS support is
> very welcome, I am open to it. The Windows specific parts are listed in
> [docs/HOW_IT_WORKS.md](docs/HOW_IT_WORKS.md).

A small desktop companion for the Promethee focus app. It sits above your
Windows taskbar and follows your session live, and it includes **Card Studio**, where you can look at
your stats and publish the end-of-session card to your Promethee feed.

This is an unofficial project, not affiliated with Promethee. It relies on the app's own local data and
network calls, so a Promethee update can occasionally break it.

## Preview

The end-of-session card, animated (sample data):

![Animated end-of-session card](docs/img/card-demo.webp)

Card Studio, with your stats and a comparison with other people (sample data):

![Stats tab](docs/img/window-stats.webp)

And the Session tab, to publish or edit a card:

![Session tab](docs/img/window-session.webp)

## Requirements

- Windows
- [Node.js](https://nodejs.org) 18 or newer
- The Promethee desktop app, installed, signed in, and opened at least once

## Install

```
git clone https://github.com/creatorsarea/promethee-companion.git
cd promethee-companion
npm install
npm start
```

The companion appears above your taskbar and an icon is added to the notification area. Click the
companion to open Card Studio. On first launch it registers itself to start with Windows; you can turn
that off from the tray icon menu.

## Update

```
git pull
npm install
```

Then quit the companion from the tray icon menu and start it again with `npm start`.

## Privacy

Everything runs on your computer. Your Promethee login token is read locally from the Promethee app's
own session file. It is only sent to Promethee's servers, never anywhere else, and it is never logged.
The stats and ranking views only read data. Something is written to your account only when you press
"Publish session" or "Follow".

The only other network call is a public, anonymous request to GitHub to check whether a newer release
exists (nothing about you is sent). If there is one, a small notice appears in the tray menu and in the
Card Studio header.

## Troubleshooting

| Message | What to do |
|---|---|
| `Token expired` or `token unavailable` | Open the Promethee app so it refreshes your session, then restart the companion. |
| `Promethee public key not found` | Update the Promethee app to its latest version, then restart the companion. |
| `No app-x.y.z folder` | The Promethee app is not installed for your user. Install it and open it once. |
| The companion is off screen or in the wrong place | Right-click the tray icon and choose "Reset position (bottom right)". |

## Contributing

Issues and pull requests are welcome, in particular macOS support. See
[docs/HOW_IT_WORKS.md](docs/HOW_IT_WORKS.md) for how the numbers are computed, which Promethee routes are
used, and the layout of the code.

## License

Copyright (C) 2026 Zaros. Released under the [GNU Affero General Public License v3.0](LICENSE). You can use,
study, modify and share this project, but if you distribute a modified version you must publish its source under
the same license. The license covers this project's own code only. The Promethee name, logo, fonts, league
images and app icons belong to their owners and are read from your own Promethee installation, not shipped here.
