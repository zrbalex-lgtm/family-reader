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

## Fixes after Stage 5 (iPad / Safari 16)

**Root causes**

1. **Broken pagination on iPad (≈2 pages, missing text).** Safari 16 (WebKit) does not create a multi-column layout for `column-count: 1` with an automatic column width. In portrait, the reader used exactly that, so each chunk became one very tall column clipped at the bottom of the screen: only the first screenful of each chunk was shown, the rest was skipped, and the page estimate collapsed. (Landscape iPads ≥ 1000 px used two columns and were not affected; newer Safari creates columns in both cases.) Fix: an explicit pixel `column-width` (which always creates columns), with the old form as an automatic fallback, a column container height measured in JS from the visible viewport, and a page count based on an end-of-chunk marker. After every layout the reader checks that no text extends below the page and logs `[reader] Column overflow…` in the console if it does.
2. **No page-turn animation on iPad.** A consequence of 1: almost every turn crossed into the next chunk, and chunk/chapter changes were drawn instantly by design. Now page turns slide inside a chapter and across chapter/chunk boundaries (old page slides out, new one slides in), and the page follows the finger during a swipe with resistance at the first/last page. Animations are off only when **Reduce Motion** is enabled in the system settings.
3. **Margins below 44 px had no effect on iPad.** Not a Safari issue: the reader capped the line length at 680 px and increased the margins to keep it. On a 768 px wide iPad that is (768 − 680) / 2 = 44 px. The margin setting now sets the side padding directly; margins only grow automatically if a column would be wider than 1000 px (large desktop windows). Safe-area insets are added only where the device has them.
4. **End screen.** It now behaves like an extra page after the last one: **Close** (closes the book and returns to the library) and **Read again**. Swipe right, tap the left third, or press ←/↑/PageUp/Esc to return to the last page. It slides in from the right.

Also: the build now targets Safari 15 / iOS 15, the visible height follows `visualViewport` (Safari toolbars), and minor CSS fallbacks were added (see README → Supported browsers).

### Test the fixes

iPad on iPadOS 16 (Safari 16) — explicit checks
- [ ] Portrait: open the same book as on the iPhone. The total `~Y` pages is larger than 2 and roughly iPhone pages × (iPhone screen area ÷ iPad screen area). Read 10 pages: the last line of one page continues on the next, nothing is skipped.
- [ ] Change line spacing and font size: no text disappears; page count changes accordingly.
- [ ] Rotate portrait ↔ landscape several times: same text stays at the top, two columns in landscape.
- [ ] Margins: step from 72 px down to 8 px; the side padding changes at every step, including below 44 px.
- [ ] Page turns slide smoothly (tap, swipe, keyboard); while swiping, the page follows the finger and snaps back if released after a short drag. Chapter changes slide too.
- [ ] Safari Web Inspector (Mac → Develop → iPad): no `[reader] Column overflow` warnings while reading.
- [ ] If there is still no animation, check Settings → Accessibility → Motion → Reduce Motion (animations are intentionally off when it is enabled).

All devices
- [ ] Last page → turn forward: **The End** slides in with **Close** and **Read again** only. Swipe right, tap the left side, or press ← / Esc: back to the last page.
- [ ] **Close** returns to the library; **Read again** opens the start of the book.
- [ ] First page → turn back: nothing happens; a short right swipe springs back.
- [ ] iPhone, desktop: pagination, margins and animations still work as before.

## Scope boundary

The DOCX songbook viewer is Stage 6. PWA, offline books and offline bookmark queuing are Stage 7.

Stop and wait for testing before Stage 6.
