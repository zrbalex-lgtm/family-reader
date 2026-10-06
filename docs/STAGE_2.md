# Stage 2 — Library

## Upgrade your tested Stage 1 repository

1. Copy the contents of this package's `family-reader` folder into the root of your existing repository, replacing the corresponding project files. Keep your `.git` directory, repository configuration and environment values.
2. Commit and push to `main`. Include `package.json`, `package-lock.json`, all updated/new `src` files, `tests/library.test.js`, and the workflow.
3. Open GitHub **Actions → Deploy Family Reader to GitHub Pages**.
4. Wait for **Check Svelte**, **Test metadata, library rules and security**, **Build**, and **Deploy** to finish.
5. Reload the deployed Pages site.

**No schema migration or new repository variables are needed.** Keep the Stage 1 Supabase tables, RLS policies, private `library` bucket and family accounts.

No local build, test runner, development server or browser preview was used for this stage, as requested. Automated checks are configured to run in GitHub Actions. Their results are not yet known.

## What is implemented

- Shared Books and Documents shelves, loaded from Supabase with pagination beyond the API's default row limit.
- Multiple file selection and desktop drag-and-drop for `.fb2`, `.fb2.zip` and `.docx`.
- Sequential upload queue with per-file states, actual transfer progress, retry and dismissal.
- FB2 byte decoding, including XML-declared Windows-1251 and UTF-16 BOMs; title, composed author names, series/index, language and plain-text annotation.
- Cover extraction from embedded FB2 binary data, JPEG thumbnails up to 360 × 540, private Storage downloads and text-cover fallbacks.
- DOCX title from `docProps/core.xml` or the filename. DOCX files retain their original bytes.
- SHA-256 duplicate checks before upload plus handling of concurrent database uniqueness conflicts.
- Instant case-insensitive title/author/series search with `ё` and `е` treated equally.
- Recently added, title and author sorting. Tap a card to inspect metadata.
- Delete confirmation. Any family user may delete a book and its file/cover; progress and bookmarks cascade in Postgres.
- Refresh button and refresh after reconnecting or returning to the visible library.

## Duplicate rules

- Plain FB2: hash the original XML bytes.
- Zipped FB2: hash the uncompressed FB2 bytes. Thus the same `.fb2` inside differently compressed ZIP files is still a duplicate.
- DOCX: hash the original DOCX bytes.
- A renamed but byte-identical file is a duplicate. Re-saving a Word document or changing FB2 encoding can change its digest even if the visible content looks the same.
- A ZIP must contain exactly one FB2 book. Archives containing multiple books must be split before upload.

## Storage behavior

- The file limit is 50 MiB, matching the Stage 1 bucket. Adjust `MAX_FILE_BYTES` in `src/lib/files.js` together with the bucket limit if this changes.
- Uploaded originals use `books/<new-uuid>/source.fb2`, `source.fb2.zip` or `source.docx`. Covers use the same folder's `cover.jpg`.
- Filenames are not used as Storage paths. Objects are immutable and uploaded with `upsert: false`.
- The UI shows metadata-processing stages and real upload percentages. The percentage measures transfer progress; a file is complete only after **Added to library** appears.
- Invalid/unsupported covers do not block a valid book upload. External cover URLs are not fetched.
- No public URLs or privileged keys are introduced.

## Interrupted operations and cleanup

Storage and Postgres do not share a transaction. The app records a small, per-user and per-project cleanup journal in browser storage before making file changes.

- When insertion succeeds, the journal entry is removed.
- If an insert response is lost, the app checks whether its row exists before reporting failure.
- A confirmed duplicate race removes only the losing upload's unique objects.
- Deletion removes the database row first, then removes unreferenced Storage objects. A Storage failure leaves cleanup pending without reintroducing the deleted book.
- Recovery always checks that no book references a path before attempting Storage removal. A database lookup failure leaves the files untouched.
- Interrupted operations have a ten-minute grace period before automatic cleanup, so another tab cannot clean up an active upload. Retry runs while the app is open or when the same user returns. Individual upload operations time out before the grace period ends.
- Pending cleanup does not automatically repeat a database deletion that failed.
- Keep the uploading tab open. The queue itself is in memory and is not an offline/resumable uploader.

Browser cleanup is best effort: clearing browser data before recovery also clears its journal. A server-side cleanup job is not included in this stage. Backgrounding an iPhone may pause or interrupt a large upload; return to the tab and use Retry if needed.

## Test on the deployed site

- [ ] Upload an FB2 with a cover and multiple author-name parts. Check title, author, series, language and annotation in details.
- [ ] Upload a Windows-1251 FB2 containing Cyrillic text, including `ё`.
- [ ] Upload an `.fb2.zip`. Upload the same uncompressed FB2 and confirm **Already in library**.
- [ ] Upload a DOCX with a saved document title, then one without a title. Check the fallback filename.
- [ ] Select multiple mixed formats. A bad file should fail independently while the remaining queue continues.
- [ ] Try an empty file, unsupported extension, damaged ZIP and archive containing two FB2 books.
- [ ] Search with different capitalization and interchange `е`/`ё`; search by title, author and series.
- [ ] Try all three sort options and both shelves.
- [ ] Sign in on a second device/user and confirm the shared library appears after refresh.
- [ ] Delete as a different family member. Check that the row, original file and cover disappear.
- [ ] Cancel a delete confirmation and verify the book stays.
- [ ] Upload the same book concurrently from two devices: only one database record should remain.
- [ ] Interrupt a transfer, reconnect and retry. Refresh first if the outcome was uncertain.
- [ ] Check iPhone/iPad portrait and landscape, keyboard focus and dialogs.

GitHub tests cover byte decoding, metadata, ZIP bounds, fingerprints, search, cleanup safety, and the existing Stage 1 RLS checks. Real uploads, browser touch layout and cross-device behavior still need the deployed-site checks above.

## Scope boundary

This is Stage 2 only. Cards open details. The FB2 reader is Stage 3; reader settings, reading progress, badges and Continue reading are Stage 4; bookmarks/TOC/footnotes are Stage 5; DOCX viewing is Stage 6; PWA/offline work is Stage 7.

Stop and wait for the user to test before starting Stage 3.
