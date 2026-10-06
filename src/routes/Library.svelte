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

  const VIEW_KEY = 'family-reader:library-view';
  const FINISHED = 99.5;

  function progressLabel(percent) {
    return percent >= FINISHED ? 'Finished' : Math.floor(percent) + '%';
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
  const visible = $derived(filterAndSortBooks($library.books, kind, search, sort));
  const count = $derived($library.books.filter((book) => book.kind === kind).length);
  // Books with saved progress, most recently read first; finished books drop out of the row.
  const continueBooks = $derived(kind !== 'fb2' || search ? [] : $library.books
    .filter((book) => book.kind === 'fb2' && $progress.has(book.id) && $progress.get(book.id).percent < FINISHED)
    .sort((a, b) => $progress.get(b.id).updatedAt - $progress.get(a.id).updatedAt)
    .slice(0, 12));
  const uploading = $derived($uploads.some((row) => ['queued', 'processing'].includes(row.status)));

  onMount(() => {
    const refresh = () => {
      online = navigator.onLine;
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
  function openBook(book) {
    if (book.kind === 'fb2') navigate('/read/' + book.id);
    else selected = book;
  }
  function readSelected() {
    const id = selected.id;
    selected = null;
    navigate('/read/' + id);
  }
  function formatDate(value) {
    return new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(value));
  }
</script>

<svelte:window ondragenter={dragEnter} ondragover={dragOver} ondragleave={dragLeave} ondrop={drop} onoffline={() => online = false} />

<main class="content library-content" id="main" tabindex="-1">
  <div class="library-heading-row">
    <div class="page-heading">
      <span class="eyebrow">YOUR SHARED SHELVES</span>
      <h1>Library</h1>
      <p class="muted">Books and documents for your family.</p>
    </div>
    <button class="button primary" type="button" onclick={() => picker.click()} disabled={!online}><Icon name="upload" size={19} /> Upload files</button>
    <input class="visually-hidden" tabindex="-1" type="file" bind:this={picker} accept={ACCEPTED_FILES} multiple onchange={chooseFiles} aria-label="Choose books or documents to upload" />
  </div>

  <div class="library-tabs" aria-label="Library type">
    <button class:active={kind === 'fb2'} aria-pressed={kind === 'fb2'} onclick={() => kind = 'fb2'}><Icon name="book" size={19} /> Books <span class="tab-count">{$library.books.filter((book) => book.kind === 'fb2').length}</span></button>
    <button class:active={kind === 'docx'} aria-pressed={kind === 'docx'} onclick={() => kind = 'docx'}><Icon name="document" size={19} /> Documents <span class="tab-count">{$library.books.filter((book) => book.kind === 'docx').length}</span></button>
  </div>

  <div class="library-controls">
    <div class="search-field">
      <Icon name="search" size={20} />
      <label for="library-search" class="visually-hidden">Search title, author or series</label>
      <input id="library-search" type="search" bind:value={search} placeholder="Search title, author or series" autocomplete="off" />
    </div>
    <div class="sort-field">
      <label for="library-sort">Sort by</label>
      <select id="library-sort" bind:value={sort}><option value="recent">Recently added</option><option value="title">Title</option><option value="author">Author</option></select>
    </div>
    <div class="view-toggle" role="group" aria-label="Library layout">
      <button class="icon-button" type="button" class:active={view === 'grid'} aria-pressed={view === 'grid'} aria-label="Grid view" title="Grid view" onclick={() => setView('grid')}><Icon name="grid" size={20} /></button>
      <button class="icon-button" type="button" class:active={view === 'list'} aria-pressed={view === 'list'} aria-label="List view" title="List view" onclick={() => setView('list')}><Icon name="list" size={20} /></button>
    </div>
    <button class="icon-button refresh-button" type="button" onclick={refreshLibrary} aria-label="Refresh library" title="Refresh library" disabled={$library.loading || !online}><Icon name="refresh" size={21} /></button>
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
          {@const percent = $progress.get(book.id).percent}
          <button class="continue-card" type="button" onclick={() => navigate('/read/' + book.id)} aria-label={'Continue ' + book.title + ', ' + progressLabel(percent)}>
            <BookCover {book} progress={percent} />
            <span class="continue-text">
              <span class="book-title">{book.title}</span>
              <span class="book-author">{book.author || 'Unknown author'}</span>
              <span class="continue-percent">{progressLabel(percent)}</span>
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
    <p class="results-count" aria-live="polite">{search ? visible.length + ' of ' + count : count} {kind === 'fb2' ? (count === 1 ? 'book' : 'books') : (count === 1 ? 'document' : 'documents')}{#if $library.loading} · Refreshing…{/if}</p>
    <div class={view === 'list' ? 'book-list' : 'book-grid'}>
      {#each visible as book (book.id)}
        <article class="book-card">
          <button class="book-open" type="button" onclick={() => openBook(book)} aria-label={(book.kind === 'fb2' ? 'Read ' : 'View details for ') + book.title}>
            <BookCover {book} progress={$progress.get(book.id)?.percent ?? null} />
            <span class="book-title">{book.title}</span>
            <span class="book-author">{book.author || (book.kind === 'docx' ? 'Document' : 'Unknown author')}</span>
            {#if book.series}<span class="book-series-line">{book.series}{#if book.series_index !== null} · {book.series_index}{/if}</span>{/if}
          </button>
          <div class="book-card-footer">
            <span class="book-progress">{#if $progress.has(book.id)}{progressLabel($progress.get(book.id).percent)}{/if}</span>
            <span class="book-series">{book.series || formatBytes(book.size_bytes)}{#if book.series && book.series_index !== null} · {book.series_index}{/if}</span>
            {#if book.kind === 'fb2'}<button class="icon-button details-book" type="button" aria-label={'Details for ' + book.title} title="Book details" onclick={() => selected = book}><Icon name="info" size={18} /></button>{/if}
            <button class="icon-button delete-book" type="button" aria-label={'Delete ' + book.title} title="Delete from library" onclick={() => confirmDelete(book)} disabled={!online}><Icon name="trash" size={18} /></button>
          </div>
        </article>
      {/each}
    </div>
    <p class="upload-hint shelf-hint">{uploading ? 'Keep this tab open while your files upload.' : 'Drop files anywhere to add them to your library.'}</p>
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
    <div class="detail-footer">{#if selected.kind === 'fb2'}<button class="button primary" type="button" onclick={readSelected}><Icon name="book" size={18} /> Read</button>{:else}<p class="muted">Documents open in a later stage.</p>{/if}<button class="button danger-outline" onclick={() => confirmDelete(selected)} disabled={!online}><Icon name="trash" size={18} /> Delete</button></div>
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
