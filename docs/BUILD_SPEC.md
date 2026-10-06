# Family Reader — continuing requirements

Build only the stage the user requests. Stop after each stage, summarize, and wait for testing before proceeding. Stage 1 is complete and tested. Stage 2 is implemented in this package; wait for the user to test before Stage 3. Run automated tests/builds in GitHub Actions only; do not run local tests, builds or browser previews unless the user changes this instruction. Do not silently substitute another hosting provider or framework.

## Fixed architecture

- Vite + Svelte 5 + JavaScript ES modules; hash-based routes.
- GitHub Pages via Actions on push to main. Vite base is the repository name.
- Supabase Auth, Postgres and private Storage, using supabase-js v2 with the frontend anon key only. RLS enforces all access rules.
- Configuration: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY from GitHub repository variables.
- Username/password only. Internal address: username@reader.local; users created manually with auto-confirm. No public sign-up. Private profiles.display_name. Persistent sessions; logout in Settings.
- JSZip for .fb2.zip, docx-preview for DOCX, Dexie or idb-keyval for IndexedDB, vite-plugin-pwa for PWA.
- English UI and code comments. Mobile-first iPhone/iPad portrait/landscape plus desktop, safe areas, dark-friendly, minimal layout; no content jumping when reader toolbars appear/disappear.

## Data model already provided by Stage 1

Use supabase/schema.sql. Shared books have kind, title, author, series/index, language, annotation, file/cover paths, unique SHA-256, size, uploader and timestamp. Progress is per user/book with position JSON, percent, device label and timestamp. Bookmarks are private with position, excerpt, note and timestamp. Settings are per user/device class (phone/tablet/desktop). Profiles use user_id and display_name.

Any authenticated family user can read/add/delete books and read/upload/delete library Storage objects. Personal rows are accessible only where user_id = auth.uid(). Book deletion cascades progress/bookmarks; application code must also remove file and cover via the Storage API.

## Stage 2 — Library

- Books (FB2) and Documents (DOCX) tabs. Cover grid with title, author and eventual progress badges. Sort recently added/title/author.
- Instant title/author/series search, case-insensitive with ё and е treated equally.
- Button plus drag/drop; multiple .fb2, .fb2.zip, .docx files; per-file progress.
- FB2 title-info: book-title, authors composed from first/middle/last names, sequence name/number, lang, annotation; coverpage refers to binary data. Extract cover, resize thumbnail, upload separately.
- DOCX title from docProps/core.xml dc:title or filename.
- SHA-256 duplicates: skip with “Already in library”. Database uniqueness handles concurrent uploads.
- Delete confirmation, database cascade and file/cover removal; handle partial failures and orphan cleanup.
- Current user's Continue reading row ordered by updated_at desc and progress badges become functional in Stage 4.

## Stage 3 — FB2 reader

- Read bytes and detect XML declaration encoding, including windows-1251, then TextDecoder and DOMParser. Accept zip containers.
- Render section headings, p, poem/stanza/v, epigraph, cite, subtitle, emphasis, strong, empty-line and binary images via blob URLs. Safely translate XML rather than injecting untrusted markup.
- Paginated only. One top-level section/chapter in viewport-sized CSS columns; translateX for page changes. Seamless previous/next chapter transitions. Chunk long sections for phones.
- Left/right thirds tap, swipe, keyboard arrows, Space and PageUp/PageDown; center tap toggles toolbar.
- Toolbar: library, chapter page X of Y, overall percent, slider; TOC/bookmarks/settings land in their respective stages.
- Index every block. Stable position = {section, paragraph, charOffset}, using first visible paragraph. Relayout after resize, rotation or font changes must restore paragraph position, never page number.

## Stage 4 — Settings and sync

- Instant CSS-variable settings per user + device class: Cyrillic-capable Literata/PT Serif/PT Sans/Inter/system fonts; font size, line height, margins, justify, hyphens:auto with book lang.
- Light, Sepia, Dark and OLED Black themes plus custom background/text colors.
- IndexedDB progress on every page turn or scroll stop, debounced server push around 3 seconds plus visibilitychange/pagehide best-effort flush. Queue before network attempts.
- On open, fetch server state. If newer than local and noticeably different, offer “Continue from where you left off on another device (N%)?”. Handle out-of-order writes and user isolation.
- Continue reading sorted by updated_at desc, with percent.

## Stage 5 — Bookmarks, TOC, footnotes

- Bookmark current stable position, excerpt and optional note; list, jump, delete.
- TOC from section titles.
- body name="notes" footnotes open in a popup from note links.

## Stage 6 — DOCX songbook

- docx-preview preserves actual page dimensions, margins and breaks; chords align above lyrics using spaces. Be explicit about renderer/font limitations discovered during testing; do not promise arbitrary Word fidelity without sample verification.
- Dark mode defaults on: filter invert(1) hue-rotate(180deg) on pages, black surround, toggle original light.
- Zoom pages as an image using transform:scale, with correctly scaled scroll geometry. App-handled pinch, stable focal point, +/- and Fit page / Fit width / 100%.
- Vertical page scrolling, page indicator and page up/down.
- Case-insensitive text search, ё = е, all-match highlighting visible through dark inversion, counter and next/previous centering matches.
- Screen Wake Lock while viewing, toggle and reacquire on visibilitychange.
- Persist {page, scrollRatio, zoom, dark} per user/book.
- Detect missing DOCX fonts; use metric-compatible fallbacks where available, show a small warning naming missing fonts.

## Stage 7 — PWA and offline polish

- vite-plugin-pwa, installable standalone shell, icons/theme color, repository-scoped service worker and base-safe URLs.
- Cache opened files and parsed data in IndexedDB; make opened books readable offline.
- Per-user offline progress queue, durable writes, flush on reconnect, conflict handling, safe account switching and cache lifecycle.
- Verify iPhone/iPad/desktop install, updates, rotation, reopen offline, queued sync and multi-device conflicts.

## Suggested modules as they become needed

src/lib/fb2/parser.js, src/lib/fb2/paginator.js, src/lib/docx/viewer.js, src/lib/cache.js and src/lib/sync.js. Preserve the existing auth client, hash router and deployment setup. Add dependencies only when their stage requires them.
