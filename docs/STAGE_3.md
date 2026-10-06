# Stage 3 — FB2 reader

## Upgrade

Push to `main` and wait for **Deploy Family Reader to GitHub Pages** to finish. **No database migration, new dependency or repository variable is needed.**

## What is implemented

- Route `#/read/<bookId>`. Tapping an FB2 card opens the reader; the small **i** button on the card (or **Read** in the details dialog) keeps the metadata view. DOCX cards still open details (DOCX viewer is Stage 6).
- The book is downloaded from the private `library` bucket. `.fb2` and `.fb2.zip` are supported; encoding comes from the XML declaration (Windows-1251, UTF-8, UTF-16). XML is translated into DOM elements, never injected as HTML.
- Rendering: section titles (nested levels), `p`, `subtitle`, `epigraph`, `cite`, `annotation`, `poem/stanza/v`, `text-author`, `date`, `emphasis`, `strong`, `sup/sub/strikethrough/code`, `empty-line`, simple tables and embedded `<binary>` images as blob URLs (revoked on close). Note links are styled but inert until Stage 5. The `notes` body is not shown in the main text.
- Paginated only: one top-level section at a time in viewport-sized CSS columns, pages turned with `translateX`. Chapters longer than ~30,000 characters are split into chunks. Wide landscape screens (≥ 1000 px) show a two-column spread.
- Navigation: tap left/right third, horizontal swipe, ←/→, ↑/↓, Space / Shift+Space, PageUp/PageDown. A centre tap toggles the toolbar: back to library, book and chapter title, page X of Y in the chapter (marked ≈ when a chapter is split into chunks), overall percent and a position slider. Esc closes the toolbar.
- Position = `{section, paragraph, charOffset}` of the first visible paragraph. Resize/rotation re-paginates and returns to that paragraph and character, not to the page number.
- The position is kept in memory only: going back to the library and reopening the book in the same tab returns to the same place; a page reload starts from the beginning. Saving/syncing is Stage 4.

## Test on the deployed site

- [ ] Tap an FB2 card: the reader opens full-screen at the first page; the URL is `#/read/<id>`. Browser Back returns to the library.
- [ ] Open a Windows-1251 book and a UTF-8 book: Cyrillic (including `ё`) is correct.
- [ ] Open an `.fb2.zip` book.
- [ ] Turn pages by tapping the right/left third, swiping, and on desktop with arrows, Space, Shift+Space, PageUp/PageDown.
- [ ] At the end of a chapter the next page starts the next chapter; going back from a chapter's first page shows the previous chapter's last page.
- [ ] At the very start/end of the book, a further turn opens the toolbar instead of doing nothing.
- [ ] Centre tap: toolbar appears without the text moving; page X of Y, percent and chapter title look right. Tap again to hide it.
- [ ] Drag the slider to ~50% and release: the reader jumps to about the middle of the book.
- [ ] Check poems, epigraphs, citations, subtitles, bold/italic text and embedded illustrations. Large images must fit on one page.
- [ ] Remember the first words on the page, rotate the iPhone/iPad (portrait ↔ landscape) or resize the desktop window: the same words are still at or near the top of the page.
- [ ] iPhone with a notch / Dynamic Island and iPad: text and toolbars stay clear of the safe areas in both orientations.
- [ ] Open a very long book with a long single chapter on a phone: page turns stay fast (page counts in that chapter are shown with ≈).
- [ ] Go back to the library and reopen the same book: you return to the same page. Reload the page: it starts from the beginning (expected until Stage 4).
- [ ] Open `#/read/not-a-book`: a clear error with **Back to library** appears.
- [ ] Book details (i button) and Delete still work; DOCX cards still open details.

## Scope boundary

Reader settings (fonts, themes, sizes), saved and synced progress, Continue reading and progress badges are Stage 4. Bookmarks, table of contents and footnote popups are Stage 5. The code is prepared for them: typography uses `--reader-*` CSS variables plus `Paginator.relayout()`, positions flow through `src/lib/reading-position.js`, every block has `data-p`, and note links keep their `data-href`.

Stop and wait for testing before Stage 4.
