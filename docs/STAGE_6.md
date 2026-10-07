# Stage 6 — DOCX songbook viewer

## Upgrade

Push to `main` and wait for **Deploy Family Reader to GitHub Pages**. **No migration, repository variable or npm change is needed.**

The renderer is **docx-preview 0.4.1** (Apache-2.0), vendored unmodified in `src/vendor/docx-preview/` because the build environment could not reach the npm registry. It is bundled by Vite, loaded only when a document is opened, and needs no CDN. See that folder's README for switching to the npm package later.

## What is implemented

- Route `#/view/<id>`. Tapping a DOCX card opens it; the **i** button (now on every card) shows details, and the details dialog has **Open** / **Read**.
- **Rendering**: real page size, margins and orientation; explicit page and section breaks plus the page breaks Word saved in the file; headers, footers, footnotes, images and the document's embedded fonts. Spaces are preserved and tab stops are computed, so chords stay above the right syllables.
- **Safety**: documents are untrusted. Embedded HTML (“altChunks”), scripts, frames and event attributes are removed; links keep only `http(s)`, `mailto` and internal targets and open in a new tab. Image and font blob URLs are revoked when the viewer closes.
- **Dark mode** (default): each page is inverted (`invert(1) hue-rotate(180deg)`) on a black surround; photos and search highlights are inverted back so they look normal. The sun/moon button shows the original light pages.
- **Zoom** as an image (`transform: scale`) with correctly scaled scrolling: two-finger pinch on iPhone/iPad (the browser's own page zoom is blocked), Ctrl/⌘ + wheel or trackpad pinch on desktop — the point under the fingers/cursor stays in place. Buttons: −, +, **Fit page**, **Fit width**, **100%**; Ctrl/⌘ + `=`/`-`/`0`. Fit modes stay active after rotation. Default: Fit width (max 150 %).
- **Navigation**: vertical scrolling, **Page X / N** (top bar; a small corner badge when the bars are hidden), ▲▼ buttons, PageUp/PageDown/Space/Shift+Space, Home/End, arrow keys. Tap the page to hide/show the bars.
- **Search** (magnifier or Ctrl/⌘+F): case-insensitive, `ё` = `е`, matches across Word's split text runs, all matches highlighted (also in dark mode), current match in orange, counter, ▲▼ / Enter / Shift+Enter centre the previous/next match.
- **Keep screen on** (eye button, where the Screen Wake Lock API exists — Safari 16.4+, Chrome, Edge): on by default, remembered per device, re-acquired when you return to the tab.
- **Remembered position** per user and document: `{page, scrollRatio, zoom, dark, fit}` in `reading_progress`, saved locally first and synced like FB2 progress (only after you scroll, zoom or toggle). On open, the newer of this device's and the server's position is used.
- **Missing fonts**: fonts the document uses but the device lacks are listed in a small dismissible notice. Calibri, Cambria, Arial/Helvetica, Times New Roman and Courier New are replaced by metric-compatible Carlito, Caladea, Arimo, Tinos and Cousine from Google Fonts (same character widths, so line breaks and chord positions stay close).
- Library: songbooks show no percent/progress bar and never appear in Continue reading.

## Known renderer limitations

docx-preview converts Word to HTML; it is not Word. Expect: line breaks can differ slightly from Word where fonts differ; text boxes, shapes, WordArt, columns and complex tables may be simplified; page breaks come from explicit breaks and the breaks Word saved when the file was last saved — files last saved by other editors (Google Docs, LibreOffice, Pages) may lack them, making a page taller than A4 (all text is still shown). Wake Lock may not work in a Home Screen app on iPadOS/iOS before 18.4.

## Test on the deployed site

Use 2–3 real songbooks, ideally the most complicated ones.

- [ ] Open a songbook: pages look like in Word (page size, margins, fonts, page count). Compare the page count with Word.
- [ ] **Chords**: lines with chords above lyrics are aligned exactly as in Word, in light and dark mode, at 100 % and at Fit width.
- [ ] Dark mode default: black background, light text, photos look normal. Toggle to light pages and back; reopen → the choice is remembered.
- [ ] iPad/iPhone: pinch to zoom in/out — the spot under your fingers stays put, scrolling works at all zoom levels, Safari's own page zoom never kicks in. Desktop: Ctrl+wheel / trackpad pinch.
- [ ] Fit page, Fit width, 100 %, −/+; rotate the device in Fit width → it refits.
- [ ] Page X / N updates while scrolling; ▲▼ and PageUp/PageDown jump to page tops.
- [ ] Search a word with different capitals and with `е` instead of `ё`: all matches highlighted, counter correct, ▲▼ centres each match, in both light and dark mode.
- [ ] Keep screen on: leave the iPad untouched longer than its auto-lock time → the screen stays on. Switch tabs and back → still on. Turn it off → the screen locks normally.
- [ ] Scroll to page 7 at some zoom, close, reopen → same page, zoom and mode. Open the same songbook on another device → it opens there too.
- [ ] Missing-font notice appears on iPhone/iPad for Calibri documents and names the substitutes.
- [ ] A DOCX with a web link: the link opens in a new tab. A damaged/renamed non-DOCX shows a clear error.
- [ ] FB2 books still open in the reader; library progress badges are unchanged for books.

## Fixes after Stage 6

**Root causes**

- **Position never restored.** When the viewer closed, it saved the position one last time by reading the scroll offset from the page. Svelte had already removed the viewer from the page at that moment, and a detached element reports a scroll offset of 0. So every close overwrote the real position with page 1, and because that save was the newest, it won on the next open. In addition, leaving the app on iPhone/iPad only sent already-queued saves; a save still waiting in its short timer was lost when Safari froze the tab. Now the position is kept as plain state (`{page, pages, zoom, mode, dark}`) and saved on every page change, zoom/mode change, dark toggle, on close, on `visibilitychange` and on `pagehide` — never read from the DOM. It is restored only after rendering, font substitution and tab stops are final.
- **▲▼ page buttons stuck.** "Next page" scrolled to 8 px above the next page's top (a margin), and the page detection then still counted that position as the previous page, so the next press scrolled to the same place again. Replaced by real page-by-page navigation.

**Changes**

- **One page at a time** (`src/lib/docx/pager.js`): only the current page and its neighbours are displayed (fast on old iPads with 250-page songbooks). Swipe, tap the left/right third, ◀ ▶ buttons, ←/→/↑/↓, PageUp/PageDown, Space/Shift+Space move exactly one page with a slide animation; Home/End jump to the first/last page.
- **Zoomed in**: one-finger drag pans inside the page; dragging on past the left/right edge follows the finger and turns the page when released (springs back if short). Tap zones and ◀ ▶ still turn pages. Pinch zoom keeps the spot under the fingers in place. Desktop: wheel pans, scrolling on past the page bottom/top turns the page, Ctrl/⌘ + wheel zooms.
- **Zoom modes** Fit page (default), Fit width and 100 % / custom are kept per document and re-applied on rotation.
- **Song list** (list button): built when the document opens and cached per file in IndexedDB, so reopening is instant. Word heading styles ("Heading 1" / "Заголовок 1", any style or paragraph with an outline level) are used first. Without headings (or with only a few), the first line of each page is used, but only when it is formatted like most other page starts, so a song continuing on the next page is not listed twice. Filter box (case-insensitive, ё = е), current song highlighted, tap to jump.
- **Continue reading** now includes songbooks with **Page X / Y**; grid and list cards show the same.
- Fonts are now checked and substituted **before** rendering, so chord tab stops are measured with the final fonts.

### Test the fixes

Songbook (110–250 songs) on the iPad (iPadOS 16) and iPhone
- [ ] Opens on page 1 in Fit page; **Page 1 / N** in the toolbar, N matches Word.
- [ ] Swipe left/right, tap the right/left third, ◀ ▶ buttons: exactly one page per action, with a smooth slide. No turn before page 1 or after the last page (short spring-back).
- [ ] Fit width: drag up/down pans inside the page; a horizontal swipe turns the page.
- [ ] Pinch to ~250 %: one finger pans in all directions; at the right edge, keep dragging left → page turns; tap zones still turn pages. Pinch out back to Fit page.
- [ ] Rotate in Fit page and Fit width: the page refits.
- [ ] Song list: opens fast; titles match the songs; a song spanning two pages is listed once; filter "елка" finds "Ёлка"; current song highlighted; tap jumps to its page. Close and reopen the document: the list appears instantly.
- [ ] Restore: go to page 37, set Fit width (or a custom zoom) and light mode, go back to the library → **Continue reading** shows "Page 37 / N". Reopen → page 37, same zoom/mode and light mode.
- [ ] Restore after leaving the app: go to page 12, switch to another app (or lock the iPad) for a minute, close the Safari tab or app, reopen → page 12.
- [ ] Open the same songbook on a second device → the last page from the first device.
- [ ] Search: matches on other pages open that page and centre the match; ▲▼ walk through all matches.
- [ ] Chords still aligned (compare 3 songs with Word), including on the iPad with substituted fonts.

Desktop
- [ ] ←/→, PageUp/PageDown, Space, Home/End; mouse wheel pans and turns at the page edge; Ctrl + wheel zooms around the cursor.

## Scope boundary

Stage 7 (PWA, installation, offline cache for books and documents, offline queue polish) is next.

Stop and wait for testing before Stage 7.
