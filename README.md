# Clip Remote

A phone remote for the hair clip: a web page that talks to the clip over Bluetooth (Chrome on Android). After the
first visit it is saved on the phone and works without internet.

Files: `index.html` (the page), `app.js` (Bluetooth, controls and the preview), `sw.js` (the offline copy),
`manifest.webmanifest` and the two icons (so it can be added to the home screen).

## Put it online (once)

Chrome only allows Bluetooth on secure (https) pages, so the page needs a home. GitHub Pages is free:

1. On github.com, make a new repository, for example `clip-remote` (Public).
2. "Add file" > "Upload files", drag in all the files in this folder, and "Commit changes".
3. Settings > Pages > Source: "Deploy from a branch", Branch: `main`, folder `/ (root)`, Save.
4. After a minute the page is at `https://YOUR-NAME.github.io/clip-remote/`.

## On the phone

Open that address in Chrome, then menu > "Add to Home screen" (or "Install app"). From then on, open it from its icon.

## Changing it later

Upload the changed files again, and raise the version in `sw.js` (`clip-remote-v1` to `-v2`, ...). The phone picks up
the new version the next time the app is opened with internet.

## Needs

The clip's firmware with the `.state` command (October 2026 or later). Older firmware still works, but the page can't
show the clip's current settings.
