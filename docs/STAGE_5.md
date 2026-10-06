# Stage 5 — Bookmarks, table of contents, footnotes

## Upgrade

Push to `main` and wait for **Deploy Family Reader to GitHub Pages**. **No migration, dependency or variable is needed**: the existing private `bookmarks` table and its RLS policy are used.

## What is implemented

- **Bookmarks** (bookmark icon in the reader toolbar). An empty icon opens **Add bookmark** with an excerpt of the first visible text and an optional note (up to 2,000 characters). A filled icon means this page has a bookmark; tapping it removes the bookmark. A small ribbon in the top-right corner marks bookmarked pages.
  - Bookmarks store the stable position `{section, paragraph, charOffset}`, so they land on the right text after rotation, font changes or on another device.
  - They are private to each user (RLS) and need a connection; an error is shown when offline. Offline queuing belongs to Stage 7.
- **Contents** (list icon in the toolbar) opens a sheet with two tabs:
  - **Contents**: chapter and sub-chapter titles with approximate page and percent. The current chapter is highlighted and scrolled into view; tap to jump.
  - **Bookmarks**: newest first, with chapter, page/percent, date, excerpt and note. Tap to jump, trash icon to delete.
- **Footnotes**: links into the book's `notes`/`comments` body are shown as accent-coloured markers. Tapping one opens the note in a popup (a bottom sheet on phones), rendered with the same safe XML translation and current reader font. Close with ✕, a tap outside or Esc. Page turns are paused while a popup, the contents or the end screen is open.
- Jumping from contents or bookmarks counts as reading and updates synced progress.

## Test on the deployed site

- [ ] Open the toolbar, tap the bookmark icon, add a note, save: the icon becomes filled and a ribbon appears on the page.
- [ ] Turn a page: no ribbon. Turn back: ribbon again. Tap the filled icon: the bookmark is removed.
- [ ] Add 2–3 bookmarks in different chapters. Contents → Bookmarks lists them with chapter, page, excerpt and note; tapping one jumps to the right text; the trash icon deletes it.
- [ ] Rotate or change the font size, then open a bookmark: the same text is shown.
- [ ] Sign in on another device as the same user: the bookmarks are there. As a different user: none are visible.
- [ ] Contents tab: chapters (and sub-chapters, indented) are listed, the current one highlighted; tapping jumps to the chapter start.
- [ ] Book with footnotes: tap a note marker → popup with the note text; close with ✕, tap outside and Esc. Markers are easy to hit on the phone.
- [ ] A book without a notes body: no markers; a book without chapter titles shows a friendly empty Contents tab.
- [ ] Airplane mode: adding a bookmark shows an error and the dialog stays open.

## Scope boundary

The DOCX songbook viewer is Stage 6. PWA, offline books and offline bookmark queuing are Stage 7.

Stop and wait for testing before Stage 6.
