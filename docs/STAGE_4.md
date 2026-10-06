# Stage 4 — Reader settings and progress sync

## Upgrade

Push to `main` and wait for **Deploy Family Reader to GitHub Pages** to finish. **No database migration, new repository variable or npm dependency is needed.** The existing `reading_progress` and `user_settings` tables and their RLS policies are used as they are.

Two deliberate deviations from the build spec, because the build environment could not reach the npm registry:

- IndexedDB is accessed through a small built-in wrapper (`src/lib/idb.js`) instead of Dexie/idb-keyval.
- Literata, PT Serif, PT Sans and Inter are loaded on demand from Google Fonts (only the selected font, all with Cyrillic) instead of bundled packages. The system fonts need no download. Stage 7 can bundle or cache them for offline use.

## What is implemented

**Reader settings** (Aa button in the reader toolbar)

- Themes: Light, Sepia, Dark, Black (OLED) and Custom with your own background and text colours.
- Font (Literata, PT Serif, PT Sans, Inter, system serif, system sans), text size, line spacing, side margins, justify and hyphenation (uses the book's language).
- Full screen moved here from Stage 3 (the old browser preference is carried over once).
- Changes apply instantly. Layout changes re-paginate and keep the same paragraph; theme changes only repaint.
- Saved per user and per device class (phone / tablet / desktop): to IndexedDB at once and to `user_settings` about a second later. The newest copy wins when a device opens the reader. iPads count as tablets even in desktop mode.
- Settings page: a Reader card shows this device's class and can reset the reader settings.

**Progress sync**

- Every page turn or jump is written to IndexedDB and a per-user queue before any network attempt, then pushed about 3 seconds after you stop, and also when the tab is hidden, closed, comes back online, or the reader is closed.
- Out-of-order writes are safe: the server row is only updated when the incoming `updated_at` is newer, otherwise inserted if missing. A slow, older write from one device cannot overwrite newer progress from another.
- Only real reading moves are saved. Opening a book, rotating, resizing or changing settings never counts, so they cannot replace a newer position from another device.
- On open, the reader starts at this device's last position immediately. If the server copy is newer and noticeably different (another chapter or more than a few paragraphs away), it asks: **“Continue from where you left off on iPad (N%)?”** — Continue or Stay here. Turning a page also dismisses it. A device that has never opened the book waits up to 2.5 s for the server position and opens there.
- Records are keyed by user, so signing in as someone else on the same browser never shows or sends the previous user's progress. Unsent progress of a signed-out user stays queued in that browser and is sent when that user signs in again.

**Library**

- **Continue reading** row on the Books shelf (hidden while searching): your started, unfinished books ordered by last read, with percent.
- Progress bar on covers and percent (or **Finished** at ≥ 99.5%) in the grid footer and list rows.

## Test on the deployed site

Settings
- [ ] Open a book, tap the centre, tap **Aa**. Switch all five themes; Custom shows two colour pickers and applies them.
- [ ] Change font, size, line spacing and margins: the text re-flows instantly and the first line on screen stays (nearly) the same. Toggle justify and hyphenation in a Russian book.
- [ ] Reload the page and reopen: the settings are kept. Open the same account on a second phone: it gets the phone settings; an iPad/desktop keeps its own.
- [ ] Settings page → Reader card shows the correct device type; **Reset reader settings** restores defaults (check in a book).
- [ ] Full screen switch in the sheet behaves like the toolbar button (desktop/iPad only).

Progress
- [ ] Read a few pages, go back to the library: the book appears in **Continue reading** with the right percent; the cover shows a progress bar.
- [ ] Reload the browser and reopen the book: it opens on the same page.
- [ ] Read further on device A, wait ~5 s (or lock the screen). Open the book on device B, where you were earlier: the **Continue from where you left off on …** prompt appears; **Continue** jumps there, **Stay here** keeps the current page.
- [ ] Open a book on a device that has never opened it: it starts at the server position, without a prompt.
- [ ] Turn pages offline (airplane mode), close the reader, go online: after a few seconds another device sees the new position.
- [ ] Reach the last page: the library shows **Finished** and the book leaves Continue reading.
- [ ] Sign in as a second user in the same browser: no progress badges or Continue reading from the first user.
- [ ] Delete a book with progress: it disappears from Continue reading after refresh.

## End-of-book screen

- Turning forward from the last page (tap, swipe or keyboard) opens **The End** with the cover, title, author and **Back to library**, **Close** (back to the last page) and **Read again** (back to the start; this is saved as new progress).
- The last page shows 100%, but saved progress only becomes 100% when **The End** appears; it is then saved and synced like any other move. Only books at 100% count as finished.
- A finished book opens on its last page on every device; turning forward shows **The End** again.
- Turning back from the first page does nothing. While **The End** is open, Esc closes it and page keys are ignored.
- `EndOfBook.svelte` accepts an optional `extra` snippet, reserved for a later rating control.

### Test the end screen

- [ ] On the last page, tap the right third, swipe left and press → / Space: **The End** appears each time after closing.
- [ ] **Close** returns to the last page; **Back to library** opens the library.
- [ ] After **The End**, the library shows **Finished** on the book in both Grid and List, and it is gone from Continue reading.
- [ ] Reach the last page but leave without turning forward: the book is not marked Finished.
- [ ] Reopen the finished book on another device (portrait and landscape): it opens on the last page; turning forward shows **The End**.
- [ ] **Read again**: the book opens at the start; the library shows it in Continue reading again.
- [ ] On the very first page, tap left / swipe right / press ←: nothing happens, no overlay or toolbar.
- [ ] Check **The End** in Light, Sepia and Black themes and on a phone with a notch.

## Scope boundary

Bookmarks, table of contents and footnotes are Stage 5. DOCX viewing is Stage 6. Caching books for offline reading, the service worker and full offline polish are Stage 7.

Stop and wait for testing before Stage 5.
