# Stage 7 — Installable app, offline reading, library redesign

## Upgrade

Push to `main` and wait for **Deploy Family Reader to GitHub Pages**. **No migration, repository variable or npm change is needed.**

`vite-plugin-pwa` could not be installed (the build environment has no npm registry access), so the service worker is hand-written (`src/sw/service-worker.js`) and a small plugin in `vite.config.js` writes `dist/sw.js` with the list of every built and public file and a version hash. No new dependency.

## What is implemented

**Installable app**
- `public/manifest.webmanifest` (standalone, dark theme colour, relative `start_url`/`scope`, so it works under `/family-reader/`), app icons: `apple-touch-icon.png` (180 px, iPhone/iPad), `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` (Android). Regenerate them with `python3 scripts/make_icons.py public` (Pillow).
- Service worker limited to the app's folder. The whole app shell, including the lazily loaded DOCX renderer, is cached at installation, so the app opens offline. Reader web fonts (Google Fonts) are cached the first time they are used.
- **Updates**: when a new version has been downloaded, the library/settings show “A new version is available — Reload”. It never reloads by itself and is not shown inside a book.

**Offline reading**
- Every book or songbook you open is stored on the device (IndexedDB). Later openings use the stored copy first — faster, and offline. Storage paths are immutable, so stored copies never go stale.
- Up to **400 MB** are kept; the least recently opened files are removed first. Files of books deleted from the library are removed on the next library refresh.
- The library list and covers are stored too, so the library looks the same offline. Offline, books that are not downloaded are dimmed; a ✓ marks downloaded books. The details sheet (⋯) has **Save offline / Remove offline copy**.
- **Settings → Offline storage** shows the number of files and space used and can clear all downloads (progress and bookmarks are kept).
- Offline after the login token expired (about an hour), Supabase cannot refresh it. The app then keeps using the stored session for local reading; the real session returns automatically when the connection is back.
- **Bookmarks** added or deleted offline are queued per user and sent when the connection returns. Reading progress already worked this way (Stage 4); settings are stored locally first.
- Personal data (progress, bookmarks, settings, queues) is always stored per user. Downloaded book files are shared on the device, because every family member can read every book anyway. Signing out keeps unsent changes for that user; they are sent when the same user signs in again.

**Library redesign**
- One compact sticky header: logo, **Books / Documents** switch with counts, refresh (hidden on phones; the library refreshes when you return to it), upload and account. One controls row: search, sort (Recent / Title / Author), grid/list toggle.
- The page title, subtitle and large upload button are gone; book tiles are smaller (3 per row on iPhone, about 5 on iPad portrait), with 1-line authors. Delete moved into the details sheet (⋯ on each card).
- Continue reading is a slim row of small cards.

## Fix: status bar blur and cut-off bottom bar

With `apple-mobile-web-app-status-bar-style: black-translucent` the Home Screen app drew under the status bar. iOS then blurred a band of whatever was just below the status bar (the first text line or the toolbar title), and the app window it drew was shorter than the screen, which left a dark strip at the bottom. This happened without any blur effect in our CSS. A first attempt to stretch the reader to the full screen height made it worse: the part below the drawn window was cut off. The app now uses a solid `black` status bar, so iOS starts the app below the status bar. If an already installed Home Screen app still shows the old behaviour, delete its icon and add it to the Home Screen again (iOS may keep the status bar style from the time of installation).

- [ ] Home Screen app on iPhone: no blurred line below the status bar (text or toolbar title); the reader's bottom bar and page indicator are fully visible down to the home indicator.

## Reopen the open book on launch

A Home Screen app always starts at its `start_url` (the library) and iOS does not restore the page that was open. The app now remembers, per user, which book or songbook is open; when the app is launched at the library and a book was open when it was closed, that book opens again at the saved position. Leaving a book through Back / Close forgets it, so the next launch shows the library.

- [ ] Open a book, turn a few pages, close the app from the app switcher, reopen: the same book at the same page.
- [ ] Go back to the library, close the app, reopen: the library.
- [ ] Same with a songbook.

## Limits worth knowing

- **Use the Home Screen app for offline reading on iPhone/iPad.** Safari can delete a website's stored data after about 7 days without visits; Home Screen apps are exempt. The Home Screen app has its own storage and login, separate from Safari.
- Uploading, deleting, the first opening of a book, account changes and signing out need a connection.
- The first visit after an update downloads the new app files once (about 1 MB).

## Test

Install
- [ ] iPhone and iPad (iPadOS 16): Safari → Share → **Add to Home Screen**. The icon is the gold book on dark background; the name is “Family Reader”. The app opens without Safari bars; sign in once.
- [ ] Android/desktop Chrome or Edge: install from the address bar or menu; the icon looks right in the launcher.

Offline
- [ ] Online, open two books and one songbook. Their cards show ✓.
- [ ] Airplane mode, close the app completely, reopen: the library and covers appear, other books are dimmed, a tap on a dimmed one explains why. The three opened items open and keep their position; reader fonts and themes work.
- [ ] Offline: turn pages, add and delete a bookmark, change settings. Go online: within a few seconds another device shows the new position and bookmark.
- [ ] Leave the app offline for more than an hour, reopen: still signed in and reading works.
- [ ] Details → **Save offline** on a book you have not opened; airplane mode → it opens. **Remove offline copy** → dimmed again offline.
- [ ] Settings → Offline storage shows the count and size; **Clear downloads** empties it.

Updates
- [ ] After the next deployment, reopen the app: “A new version is available — Reload” appears in the library; Reload switches to the new version. It does not appear inside a book.

Library layout
- [ ] iPhone portrait: header + controls take about a quarter of the screen or less; 3 tiles per row; Books/Documents switch, upload and account work; ⋯ opens details with Read/Open, Save offline and Delete.
- [ ] iPad portrait/landscape and desktop: tiles are smaller than before, header stays visible while scrolling, grid/list toggle and sort work.

Accounts
- [ ] Sign in as a second family member on the same device: no progress, bookmarks or settings of the first user appear; downloaded books are still available offline.
