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

## Scope boundary

Stage 7 (PWA, installation, offline cache for books and documents, offline queue polish) is next.

Stop and wait for testing before Stage 7.
