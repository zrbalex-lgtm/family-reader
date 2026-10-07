# Family Reader — Stage 5

A private family library for FB2 books and DOCX songbooks. Built with **Vite, Svelte 5, JavaScript ES modules and Supabase v2**, for **GitHub Pages**.

**Stages 1–4 are done. Stage 5 (bookmarks, table of contents, footnotes) is implemented and awaiting testing — see [docs/STAGE_5.md](docs/STAGE_5.md). Stop here before Stage 6.**

Already running Stage 1? Start with [the Stage 2 upgrade and test guide](docs/STAGE_2.md). No database migration or new repository variables are needed.

Included:

- Username/password sign-in, hidden `username@reader.local` mapping, no registration UI.
- Persistent Supabase sessions and token refresh, protected hash routes, logout for the current browser.
- Private profiles, editable display names and a responsive dark interface with safe-area padding.
- Shared Books/Documents shelves, multi-file upload and drag-and-drop, FB2/DOCX metadata, private cover thumbnails, SHA-256 duplicates, instant search, sorting and confirmed deletion.
- Per-file transfer progress, retry controls and recovery of unfinished Storage cleanup.
- One SQL migration: all five tables, indexes, profile trigger, RLS, private Storage bucket and policies.
- GitHub Pages Actions deployment on pushes to `main`, with the correct repository base path.
- Automated metadata, archive, search, cleanup, configuration and PostgreSQL policy tests in GitHub Actions.

## Supported browsers

The oldest family device is an iPad on **iPadOS 16.7 (Safari 16)**, so this is the minimum:

- iPhone / iPad: iOS / iPadOS **16** or newer (Safari 16+), in Safari or as a Home Screen app.
- Desktop: current Chrome, Edge, Firefox and Safari (Chrome/Edge 100+, Firefox 100+, Safari 15.4+).

The Vite build targets Safari 15 / iOS 15 (`build.target` and `build.cssTarget` in `vite.config.js`), giving a small safety margin. The code avoids features Safari 16 lacks (View Transitions, container queries, `color-mix()`, `:has()`-dependent layout, `Promise.withResolvers`); prefixed `-webkit-` fallbacks are included for hyphenation, `user-select`, `backdrop-filter` and column breaks, and `vh` fallbacks precede `svh`. Full screen uses the prefixed WebKit API where the standard one is missing and is hidden on iPhone.

## 1. Create a Supabase project

1. Open [Supabase](https://supabase.com/dashboard) and create a **dedicated project** for Family Reader.
2. Choose a region, set a database password and wait for the project to finish provisioning.
3. Copy the **Project URL** and **anon public key** from the project's Connect/API settings. Depending on the dashboard version, the JWT-based anon key is under **Settings → API Keys → Legacy API Keys**.
4. Keep these two values for the GitHub repository variables below.

The anon key is designed to be included in browser code. Security is enforced by Postgres and Storage RLS. **Never use a `service_role` key, `sb_secret_…` key or the database password in the frontend.** Builds reject privileged keys. The client also accepts a Supabase `sb_publishable_…` browser key if your project uses the newer format; the environment variable name stays `VITE_SUPABASE_ANON_KEY`.

## 2. Run the database migration

1. Open **SQL Editor → New query** in Supabase.
2. Paste the complete contents of [`supabase/schema.sql`](supabase/schema.sql).
3. Click **Run**. The whole migration runs in a transaction.
4. In Table Editor, check that `books`, `profiles`, `reading_progress`, `bookmarks` and `user_settings` exist and have RLS enabled.

The migration can be re-run for this schema without deleting records. It also creates profiles for Auth users that already exist. Use later incremental migrations for future schema changes; `CREATE TABLE IF NOT EXISTS` does not upgrade an arbitrary pre-existing table definition.

The SQL Editor normally runs with administrator privileges and bypasses RLS. Reading every user's rows there is expected; it is **not** a test of browser access.

## 3. Check the private Storage bucket

The migration creates the **`library`** bucket automatically. Under **Storage**, confirm:

- Bucket name: `library`.
- **Public bucket: OFF**.
- File size limit: **50 MiB** by default. Adjust this limit later if your documents need more, within your Supabase project's limit.
- Three policies on `storage.objects`: authenticated SELECT, INSERT and DELETE, restricted to `bucket_id = 'library'`.

If creating the bucket manually before running the migration, use **New bucket → `library`**, keep Public OFF, and then run the migration to install the policies. No additional MIME allowlist is applied because devices can report different MIME types for FB2 and DOCX files. The Stage 2 uploader validates extensions and document structure before upload.

Use this in a dedicated project. Existing permissive policies in a reused project can grant additional access because Postgres permissive policies combine with OR.

## 4. Disable public sign-ups

In **Authentication → Sign In / Providers** (or **Authentication → Settings**, depending on the dashboard):

1. Turn **Allow new users to sign up** OFF.
2. Keep **Email/password** sign-in enabled.
3. Keep **anonymous sign-ins** OFF and leave social/phone providers disabled.

This setting is essential: hiding a registration button alone does not disable the public sign-up endpoint. The library policy deliberately allows any authenticated account in this dedicated project.

## 5. Create family accounts manually

Open **Authentication → Users → Add user → Create new user**. Create an email/password user, not an invitation:

1. Choose a username such as `alex`, `olga`, `daniel` or `misha`.
2. Enter the internal email as **`<username>@reader.local`**, for example `alex@reader.local`.
3. Set a password meeting your project's password policy.
4. Enable **Auto Confirm User** / **Auto-confirm email**.
5. Create the user.

Usernames use **1–32 ASCII letters, digits, hyphens or underscores**, beginning with a letter or digit. Create the internal email in lowercase. Login trims surrounding spaces and ignores username capitalization. Passwords are not trimmed or case-normalized.

No mailbox is needed. Do not send invitation or password-recovery emails to these internal addresses. Family members see only **Username** and **Password** in the app. A `profiles` row is created automatically, with the username as the initial display name; change it in the app's Settings. Unicode display names are supported.

For password recovery, the administrator sets a new password using trusted Supabase administration tools; there is no email recovery flow in this app. Never add an admin key to the browser to perform this.

## 6. GitHub checks and deployment

This project is tested and built in GitHub Actions. No local testing or preview is required. The workflow uses Node 24, installs from the lockfile, checks Svelte, runs the automated tests, builds the frontend and deploys it to Pages.

For an existing Stage 1 repository, copy in the updated source files and lockfile, commit and push to main. Keep your existing repository variables and Supabase configuration. See [docs/STAGE_2.md](docs/STAGE_2.md) for the exact upgrade checklist.

The npm scripts used by CI remain in package.json. Local preview/combined verification scripts have been removed. There is no mock login, default password or bundled test configuration.

## 7. Create the GitHub repository

Create an empty GitHub repository, for example **`family-reader`**. Put the *contents* of this project at the repository root: `package.json`, `src`, `.github`, `supabase`, and the rest. Do not nest the project inside another `family-reader` directory.

Using Git from the extracted project directory:

```sh
git init
git add .
git commit -m "Implement Family Reader stage 2"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/family-reader.git
```

Set up repository variables and Pages before the initial push. `.env.local`, `node_modules` and `dist` are ignored by Git. Include `package-lock.json` and the `.github/workflows/deploy.yml` file.

## 8. Set GitHub repository variables

Under **Settings → Secrets and variables → Actions → Variables**, create these **repository variables**:

| Name | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | Your Supabase Project URL |
| `VITE_SUPABASE_ANON_KEY` | Your Supabase anon public key |

The workflow reads `vars`, not `secrets`. These browser configuration values are injected at build time; the built site contains the public key. If you change either variable, rerun the workflow to rebuild the site.

The workflow uses `GITHUB_REPOSITORY` to derive the exact base path, so a repository named `our-books` automatically builds under `/our-books/`. The local fallback is `VITE_REPO_NAME`, then `family-reader`. A repository named `USERNAME.github.io` uses `/`.

## 9. Enable Pages and deploy

1. In your GitHub repository, open **Settings → Pages**.
2. Under **Build and deployment → Source**, select **GitHub Actions**.
3. Push the first commit:

   ```sh
   git push -u origin main
   ```

4. Under **Actions**, watch **Deploy Family Reader to GitHub Pages**. It installs locked dependencies, checks Svelte, runs metadata and policy tests, builds, uploads `dist`, and deploys.
5. Open the deployment URL, normally `https://YOUR_USERNAME.github.io/family-reader/`.

Every subsequent push to `main` redeploys. You can also choose **Run workflow** manually. The deploy job uses the `github-pages` environment and the `pages: write` / `id-token: write` permissions. The build job only reads the repository and Pages configuration.

In Supabase **Authentication → URL Configuration**, set **Site URL** to the deployed URL. Username/password login does not use redirect callbacks; URL session detection is disabled to keep the hash available for routing.

Routes look like `.../family-reader/#/library` and `.../family-reader/#/settings`, so direct links and refreshes work without a Pages SPA rewrite.

## 10. Test on GitHub Pages

For Stage 2, use [the deployed-site checklist](docs/STAGE_2.md#test-on-the-deployed-site). The following account checks remain useful when setting up a new project:

- [ ] Signed out, visit `#/settings`: the login screen appears.
- [ ] Enter a wrong password: a clear error appears without revealing account existence.
- [ ] Sign in using only the username. A display name appears in the header.
- [ ] Refresh or close/reopen the browser: the session persists.
- [ ] Open Settings, change the display name and save. Refresh: the new name remains.
- [ ] Sign in as the same user on another device: the saved name appears.
- [ ] Sign in as a second user: they see their own name.
- [ ] Sign out: the browser returns to login; protected routes stay inaccessible.
- [ ] The first user's other devices stay signed in when one browser signs out.
- [ ] Rotate the phone/tablet and use keyboard navigation on desktop. Fields and buttons remain usable.
- [ ] On GitHub Pages, open `#/settings` directly and refresh it: the app loads.

Automated checks run in GitHub Actions on pushes to main or when you select **Run workflow**. This Stage 2 package has not been tested or built locally, as requested. Check the Actions results before testing the deployed site.

The SQL tests execute the actual migration twice in an isolated PostgreSQL engine via PGlite. They verify grants, two-user RLS isolation, owner-spoofing rejection, duplicate hashes, profile creation, Storage policies and book-deletion cascades. The fixture supplies minimal Supabase-owned auth/storage objects; it does **not** emulate the Auth HTTP service, token refresh, Storage file transfers, or GitHub Actions. Those need the live checks above after configuration.

## Security and data model

| Resource | Signed out | Authenticated family member |
| --- | --- | --- |
| `books` | No access | Read, insert as themselves, delete any book; no UPDATE grant |
| `profiles` | No access | Read/write/delete only their own `user_id` |
| `reading_progress` | No access | Read/write/delete only their own `user_id` |
| `bookmarks` | No access | Read/write/delete only their own `user_id` |
| `user_settings` | No access | Read/write/delete only their own `user_id`, per device class |
| `library` Storage objects | No access | Read/upload/delete; no overwrite policy |

`reading_progress.percent` is **0–100**, not a fraction. Positions are JSON objects with the requested FB2/DOCX shapes, interpreted by the respective reader in later stages. Storage paths are bucket-relative, not public URLs. New files should use immutable unique paths and `upsert: false`.

Deleting a book cascades to progress and bookmarks. Deleting database rows does not delete Storage bytes: the app calls the Storage API for the file and cover and records unfinished cleanup for retry. Do not delete `storage.objects` directly with SQL.

The session is stored by supabase-js in browser localStorage, isolated by project and base path. Raw passwords are passed only to Supabase Auth and are never logged or persisted by the app. IndexedDB progress, the sync queue and reader settings are keyed by project, base path and user id. They are separated, not cleared, on logout so unsent progress is not lost; Stage 7 adds cache lifecycle and safe account switching.

## Project structure

```text
.github/workflows/deploy.yml  GitHub Pages CI and deployment
supabase/schema.sql          Tables, indexes, RLS, profiles trigger, private bucket
src/App.svelte               Session gate and hash routes
src/routes/Login.svelte      Username/password login
src/routes/Library.svelte    Uploads, library grid, search and delete dialogs
src/routes/Settings.svelte   Profile and logout
src/routes/Reader.svelte     FB2 reader screen, gestures and toolbar
src/lib/fb2/book.js          FB2 reading model, chunks and positions
src/lib/fb2/render.js        Safe FB2 → DOM translation
src/lib/fb2/paginator.js     CSS-column pagination
src/lib/sync.js              Reading progress: IndexedDB queue and Supabase sync
src/lib/reader-settings.js   Reader themes, fonts and per-device settings
src/lib/idb.js               Small IndexedDB key-value wrapper
src/lib/device.js            Device class and label
src/lib/fullscreen.js        Fullscreen API helpers
src/components/ReaderSettings.svelte  Reader settings sheet
src/components/ReaderContents.svelte  Contents and bookmarks sheet
src/components/EndOfBook.svelte       End-of-book screen
src/lib/bookmarks.js         Private bookmarks via Supabase
src/reader.css               Reader styling
src/lib/supabase.js          Public Supabase client
src/lib/auth.js              Session/profile lifecycle
src/lib/username.js          Canonical username mapping
src/lib/router.js            Hash navigation
src/lib/config.js            Frontend key validation and Pages base
src/lib/library.js           Library state, upload queue and deletion
src/lib/library-api.js       Supabase library operations
src/lib/upload-transport.js  Real upload progress via the SDK transport
src/lib/cleanup.js           Durable recovery of unfinished file cleanup
src/lib/fb2/parser.js         FB2 metadata and embedded covers
src/lib/docx/metadata.js      DOCX title metadata
src/lib/archives.js          Bounded ZIP extraction
src/lib/xml.js               XML decoding and safe parsing
src/lib/prepare-upload.js    File preparation, thumbnails and fingerprints
src/components/              Covers, upload list, dialogs, brand and icons
src/app.css                  Shared responsive UI
src/library.css              Library, upload and dialog styling
src/tokens.css               Shared design variables
tests/                       Tests executed by GitHub Actions
docs/BUILD_SPEC.md           Requirements and stage boundaries
docs/STAGE_2.md              Upgrade instructions and deployed-site checks
docs/STAGE_3.md              FB2 reader test checklist
docs/STAGE_4.md              Settings and sync test checklist
docs/STAGE_5.md              Bookmarks, contents and footnotes checklist
```

## Implementation order

1. **Complete:** skeleton, SQL/RLS, login, Pages workflow.
2. **Complete:** upload, metadata, covers, duplicates, search, delete.
3. **Complete:** FB2 byte decoding, parsing, rendering, pagination, navigation.
4. **Complete:** reader settings, progress sync and Continue reading.
5. **Implemented; awaiting testing:** bookmarks, table of contents and footnotes.
6. DOCX viewer, dark mode, zoom, search, wake lock and remembered position.
7. PWA shell, installation, IndexedDB cache/queue and offline polish.

JSZip is included. IndexedDB uses a small built-in wrapper; reader web fonts load on demand from Google Fonts. Later stages will add docx-preview and vite-plugin-pwa. Do not register a service worker before the PWA stage. Each stage requires a separate test-and-review handoff before continuing.

## Troubleshooting

- **Setup screen / build fails:** check both environment values, replace placeholders, rerun Actions. Do not paste a database password or a privileged key.
- **Incorrect username/password:** confirm the internal email matches `username@reader.local`, the user was auto-confirmed, and email/password login is enabled.
- **Profile could not load:** check the connection, confirm the migration ran successfully and verify the account has a row in `profiles`. Re-running the migration backfills missing profiles.
- **User creation fails:** inspect the SQL migration and database logs; an error in the Auth profile trigger can block user creation.
- **Pages 404 / blank page:** confirm the workflow deployed successfully, the project files are at the repo root, and use the repository URL with its trailing slash and hash routes.
- **Actions permission error:** confirm Pages source is GitHub Actions, Pages is available for your repository, and repository/environment rules permit the workflow to deploy.
- **Changes to repo variables have no effect:** rerun Actions. Vite environment variables are compiled into the frontend, not read at page load.

## Reference documentation

- [Vite: GitHub Pages deployment](https://vite.dev/guide/static-deploy.html#github-pages)
- [GitHub: custom Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- [Supabase: Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase: managing user data](https://supabase.com/docs/guides/auth/managing-user-data)
- [Supabase: Auth configuration](https://supabase.com/docs/guides/auth/general-configuration)
- [Supabase: API keys](https://supabase.com/docs/guides/getting-started/api-keys)
