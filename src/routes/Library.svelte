<script>
  import { onMount } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import BookCover from '../components/BookCover.svelte';
  import Modal from '../components/Modal.svelte';
  import UploadQueue from '../components/UploadQueue.svelte';
  import { library, uploads, refreshLibrary, enqueueFiles, deleteBook, retryCleanup } from '../lib/library.js';
  import { filterAndSortBooks } from '../lib/library-query.js';
  import { ACCEPTED_FILES, formatBytes } from '../lib/files.js';
  import { navigate } from '../lib/router.js';
  import { progress, refreshProgress } from '../lib/sync.js';
  import { auth, displayName } from '../lib/auth.js';
  import { offlineFiles, downloadForOffline, removeOfflineFile, refreshOfflineIndex } from '../lib/offline.js';

  const VIEW_KEY = 'family-reader:library-view';
  // Progress reaches 100 only when the reader shows the end-of-book screen.
  const FINISHED = 100;

  // FB2: percent or Finished. DOCX songbooks: "Page X / Y" (they are browsed, never finished).
  function progressLabel(book) {
    const entry = $progress.get(book.id);
    if (!entry) return '';
    if (book.kind === 'docx') {
      const page = Math.max(0, Math.trunc(Number(entry.position?.page)) || 0) + 1;
      const pages = Math.trunc(Number(entry.position?.pages)) || 0;
      return pages ? `Page ${page} / ${pages}` : `Page ${page}`;
    }
    return entry.percent >= FINISHED ? 'Finished' : Math.floor(entry.percent) + '%';
  }

  function openPath(book) {
    return (book.kind === 'fb2' ? '/read/' : '/view/') + book.id;
  }

  let kind = $state('fb2');
  let search = $state('');
  let sort = $state('recent');
  let view = $state(savedView());
  let picker = $state();
  let dragDepth = $state(0);
  let online = $state(navigator.onLine);
  let selected = $state(null);
  let deleting = $state(null);
  let deleteBusy = $state(false);
  let deleteError = $state('');
  let notice = $state('');
  let offlineBusy = $state(false);
  const name = $derived(displayName($auth));
  const initials = $derived([...name][0]?.toUpperCase() || 'R');
  const bookCount = $derived($library.books.filter((book) => book.kind === 'fb2').length);
  const docCount = $derived($library.books.filter((book) => book.kind === 'docx').length);
  const visible = $derived(filterAndSortBooks($library.books, kind, search, sort));
  const count = $derived($library.books.filter((book) => book.kind === kind).length);
  // Books and songbooks with saved progress, most recently opened first; finished books drop out.
  const continueBooks = $derived(search ? [] : $library.books
    .filter((book) => $progress.has(book.id) && (book.kind === 'docx' || $progress.get(book.id).percent < FINISHED))
    .sort((a, b) => $progress.get(b.id).updatedAt - $progress.get(a.id).updatedAt)
    .slice(0, 12));
  const uploading = $derived($uploads.some((row) => ['queued', 'processing'].includes(row.status)));

  onMount(() => {
    const refresh = () => {
      online = navigator.onLine;
      void refreshOfflineIndex();
      if (document.visibilityState === 'visible' && online) { void refreshLibrary(); void retryCleanup(); void refreshProgress(); }
    };
    window.addEventListener('online', refresh);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    refresh();
    return () => {
      window.removeEventListener('online', refresh);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  });

  function chooseFiles(event) {
    enqueueFiles(event.currentTarget.files);
    event.currentTarget.value = '';
  }
  function isFileDrag(event) { return Array.from(event.dataTransfer?.types || []).includes('Files'); }
  function dragEnter(event) {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    dragDepth += 1;
  }
  function dragOver(event) {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = online ? 'copy' : 'none';
  }
  function dragLeave(event) {
    if (!isFileDrag(event)) return;
    dragDepth = event.relatedTarget ? Math.max(0, dragDepth - 1) : 0;
  }
  function drop(event) {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    dragDepth = 0;
    if (!online) { notice = 'Connect to the internet before uploading.'; return; }
    enqueueFiles(event.dataTransfer.files);
  }
  function confirmDelete(book) {
    selected = null;
    deleteError = '';
    deleting = book;
  }
  async function remove() {
    if (!deleting || deleteBusy) return;
    deleteBusy = true;
    deleteError = '';
    try {
      const result = await deleteBook(deleting);
      notice = result.pending ? 'Removed from the library. File cleanup will retry automatically.' : 'Removed from the family library.';
      deleting = null;
    } catch (error) { deleteError = error.message; }
    finally { deleteBusy = false; }
  }
  // Grid/List choice is remembered per browser.
  function savedView() {
    try { return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid'; } catch { return 'grid'; }
  }
  function setView(next) {
    view = next;
    try { localStorage.setItem(VIEW_KEY, next); } catch { /* Storage unavailable: keep the choice for this visit. */ }
  }
  // Offline, only books downloaded on this device can be opened.
  function available(book) {
    return online || $offlineFiles.has(book.file_path);
  }
  function openBook(book) {
    if (!available(book)) { notice = `“${book.title}” is not downloaded on this device. Connect to the internet to open it.`; return; }
    navigate(openPath(book));
  }
  async function toggleOffline(book) {
    offlineBusy = true;
    try {
      if ($offlineFiles.has(book.file_path)) await removeOfflineFile(book.file_path);
      else await downloadForOffline(book);
    } catch {
      notice = 'Could not download this file. Check your connection and try again.';
    } finally {
      offlineBusy = false;
    }
  }
  function readSelected() {
    const book = selected;
    selected = null;
    openBook(book);
  }
  function formatDate(value) {
    return new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(value));
  }
</script>

<svelte:window ondragenter={dragEnter} ondragover={dragOver} ondragleave={dragLeave} ondrop={drop} onoffline={() => online = false} ononline={() => online = true} />

<!-- One compact sticky header and one controls row, so most of the screen shows books. -->
<header class="library-header">
  <a class="library-brand" href="#/library" aria-label="Family Reader"><span class="brand-mark"><Icon name="book" size={24} /></span><span class="library-brand-name">Family <span class="brand-light">Reader</span></span></a>
  <div class="shelf-switch" role="group" aria-label="Shelf">
    <button type="button" class:active={kind === 'fb2'} aria-pressed={kind === 'fb2'} onclick={() => kind = 'fb2'}>Books <span class="tab-count">{bookCount}</span></button>
    <button type="button" class:active={kind === 'docx'} aria-pressed={kind === 'docx'} onclick={() => kind = 'docx'}>Documents <span class="tab-count">{docCount}</span></button>
  </div>
  <div class="library-actions">
    <button class="icon-button header-refresh" type="button" onclick={refreshLibrary} aria-label="Refresh library" title="Refresh library" disabled={$library.loading || !online}><Icon name="refresh" size={21} /></button>
    <button class="icon-button" type="button" onclick={() => picker.click()} disabled={!online} aria-label="Upload files" title="Upload FB2, FB2.ZIP or DOCX"><Icon name="upload" size={21} /></button>
    <a class="avatar-link" href="#/settings" aria-label={`Settings for ${name}`} title="Settings"><span class="avatar">{initials}</span></a>
  </div>
  <input class="visually-hidden" tabindex="-1" type="file" bind:this={picker} accept={ACCEPTED_FILES} multiple onchange={chooseFiles} aria-label="Choose books or documents to upload" />
</header>

<main class="content library-content" id="main" tabindex="-1">
  <h1 class="visually-hidden">Library</h1>
  <div class="library-controls">
    <div class="search-field">
      <Icon name="search" size={18} />
      <label for="library-search" class="visually-hidden">Search title, author or series</label>
      <input id="library-search" type="search" bind:value={search} placeholder="Search" autocomplete="off" />
    </div>
    <label for="library-sort" class="visually-hidden">Sort by</label>
    <select id="library-sort" bind:value={sort}><option value="recent">Recent</option><option value="title">Title</option><option value="author">Author</option></select>
    <button class="icon-button control-button" type="button" onclick={() => setView(view === 'grid' ? 'list' : 'grid')}
      aria-label={view === 'grid' ? 'Show as list' : 'Show as grid'} title={view === 'grid' ? 'List view' : 'Grid view'}><Icon name={view === 'grid' ? 'list' : 'grid'} size={19} /></button>
  </div>

  {#if notice}<div class="library-notice" role="status"><span>{notice}</span><button class="icon-button" type="button" aria-label="Dismiss notification" onclick={() => notice = ''}><Icon name="close" size={18} /></button></div>{/if}
  {#if $library.error}<div class="library-notice error" role="alert"><span>{$library.error}</span><button class="text-button" onclick={refreshLibrary} disabled={$library.loading || !online}>Try again</button></div>{/if}
  {#if $library.cleanupPending || $library.cleanupMessage}
    <div class="library-notice"><span>{$library.cleanupMessage || 'Unfinished file cleanup will retry automatically when safe.'}</span><button class="text-button" onclick={retryCleanup} disabled={$library.cleaning || !online}>{$library.cleaning ? 'Checking…' : 'Retry cleanup'}</button></div>
  {/if}
  <UploadQueue />

  {#if continueBooks.length}
    <section class="continue-reading" aria-labelledby="continue-title">
      <h2 id="continue-title">Continue reading</h2>
      <div class="continue-row">
        {#each continueBooks as book (book.id)}
          <button class="continue-card" class:unavailable={!available(book)} type="button" onclick={() => openBook(book)} aria-label={'Continue ' + book.title + ', ' + progressLabel(book)}>
            <BookCover {book} progress={book.kind === 'fb2' ? $progress.get(book.id).percent : null} />
            <span class="continue-text">
              <span class="book-title">{book.title}</span>
              <span class="continue-percent">{progressLabel(book)}</span>
            </span>
          </button>
        {/each}
      </div>
    </section>
  {/if}

  {#if $library.loading && !$library.books.length}
    <div class="library-loading" role="status">Loading your library…</div>
  {:else if !visible.length}
    <section class="empty-library" aria-live="polite">
      <div class="empty-icon"><Icon name={search ? 'search' : kind === 'fb2' ? 'book' : 'document'} size={34} /></div>
      <h2>{search ? 'No matches on this shelf.' : kind === 'fb2' ? 'Room for your next read.' : 'Your documents, together.'}</h2>
      <p>{search ? 'Try another title, author or series.' : kind === 'fb2' ? 'Add your family’s FB2 books to get started.' : 'Add your DOCX songbooks and documents.'}</p>
      {#if search}<button class="button secondary" onclick={() => search = ''}>Clear search</button>
      {:else}<button class="button secondary" onclick={() => picker.click()} disabled={!online}>Choose files</button><p class="upload-hint">Or drop files here · FB2, FB2.ZIP, DOCX · Up to 50 MB each</p>{/if}
    </section>
  {:else}
    {#if search || $library.loading}<p class="results-count" aria-live="polite">{#if search}{visible.length} of {count}{/if}{#if $library.loading}{search ? ' · ' : ''}Refreshing…{/if}</p>{/if}
    <div class={view === 'list' ? 'book-list' : 'book-grid'}>
      {#each visible as book (book.id)}
        <article class="book-card" class:unavailable={!available(book)}>
          <button class="book-open" type="button" onclick={() => openBook(book)} aria-label={(book.kind === 'fb2' ? 'Read ' : 'Open ') + book.title}>
            <!-- The cover bar is for FB2 books only; songbooks show "Page X / Y" below. -->
            <BookCover {book} progress={book.kind === 'fb2' ? $progress.get(book.id)?.percent ?? null : null} />
            <span class="book-title">{book.title}</span>
            <span class="book-author">{book.author || (book.kind === 'docx' ? 'Document' : 'Unknown author')}</span>
            {#if book.series}<span class="book-series-line">{book.series}{#if book.series_index !== null} · {book.series_index}{/if}</span>{/if}
          </button>
          <div class="book-card-footer">
            <span class="book-progress">{progressLabel(book)}</span>
            {#if $offlineFiles.has(book.file_path)}<span class="offline-mark" title="Downloaded for offline reading"><Icon name="check" size={14} /></span>{/if}
            <button class="icon-button details-book" type="button" aria-label={'Details for ' + book.title} title="Details" onclick={() => selected = book}><Icon name="more" size={18} /></button>
          </div>
        </article>
      {/each}
    </div>
    {#if uploading}<p class="upload-hint shelf-hint">Keep this tab open while your files upload.</p>{/if}
  {/if}
</main>

{#if dragDepth > 0}
  <div class="drop-overlay" role="status"><Icon name="upload" size={40} /><strong>{online ? 'Drop files to add to your library' : 'Connect to the internet to upload'}</strong><span>FB2 · FB2.ZIP · DOCX</span></div>
{/if}

{#if selected}
  <Modal title={selected.kind === 'fb2' ? 'Book details' : 'Document details'} onclose={() => selected = null}>
    <div class="book-details">
      <div class="detail-cover"><BookCover book={selected} /></div>
      <div class="detail-text"><h3>{selected.title}</h3>{#if selected.author}<p class="muted">{selected.author}</p>{/if}
        <dl class="metadata-list">
          <div><dt>Format</dt><dd>{selected.kind.toUpperCase()}{selected.file_path.endsWith('.fb2.zip') ? ' (ZIP)' : ''}</dd></div>
          {#if selected.series}<div><dt>Series</dt><dd>{selected.series}{#if selected.series_index !== null} · {selected.series_index}{/if}</dd></div>{/if}
          {#if selected.lang}<div><dt>Language</dt><dd>{selected.lang}</dd></div>{/if}
          <div><dt>File size</dt><dd>{formatBytes(selected.size_bytes)}</dd></div>
          <div><dt>Added</dt><dd>{formatDate(selected.created_at)}</dd></div>
        </dl>
      </div>
    </div>
    {#if selected.annotation}<p class="annotation">{selected.annotation}</p>{/if}
    <p class="offline-status">{$offlineFiles.has(selected.file_path) ? 'Downloaded on this device — readable offline.' : 'Not downloaded on this device. It is saved automatically when you open it.'}</p>
    <div class="detail-footer">
      <button class="button primary" type="button" onclick={readSelected} disabled={!available(selected)}><Icon name={selected.kind === 'fb2' ? 'book' : 'document'} size={18} /> {selected.kind === 'fb2' ? 'Read' : 'Open'}</button>
      <button class="button secondary" type="button" onclick={() => toggleOffline(selected)} disabled={offlineBusy || (!online && !$offlineFiles.has(selected.file_path))}>{offlineBusy ? 'Working…' : $offlineFiles.has(selected.file_path) ? 'Remove offline copy' : 'Save offline'}</button>
      <button class="button danger-outline" onclick={() => confirmDelete(selected)} disabled={!online}><Icon name="trash" size={18} /> Delete</button>
    </div>
  </Modal>
{/if}

{#if deleting}
  <Modal title="Delete from the family library?" busy={deleteBusy} onclose={() => deleting = null}>
    <p class="delete-title">{deleting.title}</p>
    <p class="muted">This removes the file, its cover, and everyone’s reading progress and bookmarks. This cannot be undone.</p>
    {#if deleteError}<p class="alert error" role="alert">{deleteError}</p>{/if}
    <div class="modal-actions">
      <button class="button secondary" type="button" onclick={() => deleting = null} disabled={deleteBusy}>Cancel</button>
      <button class="button danger" type="button" onclick={remove} disabled={deleteBusy || !online}>{deleteBusy ? 'Deleting…' : 'Delete from library'}</button>
    </div>
  </Modal>
{/if}
