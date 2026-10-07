<script>
  import { onMount, tick } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import ReaderSettings from '../components/ReaderSettings.svelte';
  import EndOfBook from '../components/EndOfBook.svelte';
  import ReaderContents from '../components/ReaderContents.svelte';
  import Modal from '../components/Modal.svelte';
  import { listBookmarks, addBookmark, deleteBookmark } from '../lib/bookmarks.js';
  import { renderNote } from '../lib/fb2/render.js';
  import { auth } from '../lib/auth.js';
  import { navigate } from '../lib/router.js';
  import { friendlyLibraryError } from '../lib/library-api.js';
  import { findBook, openBookBytes } from '../lib/offline.js';
  import { openFb2Book, positionAtPercent } from '../lib/fb2/book.js';
  import { Paginator } from '../lib/fb2/paginator.js';
  import { localProgress, saveProgress, fetchServerProgress, flushProgress } from '../lib/sync.js';
  import { readerSettings, loadReaderSettings, updateReaderSettings, ensureFont, readerStyle, layoutKey } from '../lib/reader-settings.js';
  import { fullscreenSupported, isFullscreen, enterFullscreen, exitFullscreen, onFullscreenChange } from '../lib/fullscreen.js';

  let { bookId } = $props();

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const SWIPE_DISTANCE = 40;
  const TAP_SLOP = 12;
  // Without a local position, wait this long for the server before opening at the start.
  const SERVER_WAIT = 2500;
  const START = { section: 0, paragraph: 0, charOffset: 0 };

  let status = $state('loading');
  let errorMessage = $state('');
  let record = $state(null);
  let info = $state(null);
  let toolbar = $state(false);
  let settingsOpen = $state(false);
  let surface = $state();
  let pageBox = $state();
  let sliderValue = $state(0);
  let dragging = $state(false);
  let fullscreenActive = $state(isFullscreen());
  let remote = $state(null);
  let paginatorReady = $state(false);
  let ended = $state(false);
  let contentsOpen = $state(false);
  let contentsTab = $state('contents');
  let bookmarks = $state([]);
  let bookmarksError = $state('');
  let pageBookmark = $state(null);
  let bookmarkDraft = $state(null);
  let bookmarkNote = $state('');
  let bookmarkBusy = $state(false);
  let bookmarkDialogError = $state('');
  let note = $state(null);
  let noteBody = $state();
  const canFullscreen = fullscreenSupported();

  // Imperative reader objects; not reactive on purpose.
  let paginator = null;
  // Raw state: the parsed book is large and never mutated, so it is not deeply proxied.
  let book = $state.raw(null);
  // Only user-initiated moves are saved; opening, resizing and settings changes are not reading.
  let saveNext = false;
  let movedSinceOpen = false;
  // Set when the reader leaves full screen itself (e.g. Esc), so it is not re-entered on the next tap.
  let fullscreenDismissed = false;
  let enteredFullscreen = false;
  let appliedLayout = '';
  let layoutTimer = 0;

  const userId = $derived($auth.session?.user.id || '');
  const fullscreenWanted = $derived($readerSettings.fullscreen);
  const chapterTitle = $derived(info?.title || record?.title || '');
  // The last page reads as 100%, although saved progress only reaches 100 at the end screen.
  const percentLabel = $derived(Math.floor(dragging ? sliderValue / 10 : info?.atEnd ? 100 : info?.percent || 0) + '%');
  const pageLabel = $derived(info ? `${info.bookPage} / ~${info.bookPages}` : '');
  const chapterLeftLabel = $derived(!info ? '' : info.chapterPagesLeft <= 0 ? 'Last page in chapter'
    : `${info.chapterPagesLeft} ${info.chapterPagesLeft === 1 ? 'page' : 'pages'} left in chapter`);

  function handleChange(next) {
    info = next;
    updatePageBookmark();
    if (!dragging) sliderValue = Math.round(next.percent * 10);
    if (!saveNext) return;
    saveNext = false;
    movedSinceOpen = true;
    // Reading here answers the "continue on another device" question.
    remote = null;
    void saveProgress(userId, bookId, next.position, next.percent);
  }

  async function turn(forward) {
    if (!paginator) return;
    saveNext = true;
    const moved = forward ? await paginator.next() : await paginator.previous();
    if (!moved) {
      saveNext = false;
      // Undo any swipe offset. Forward from the last page ends the book; back from the first page does nothing.
      paginator.settle();
      if (forward) showEnd();
    }
  }

  function updatePageBookmark() {
    pageBookmark = paginator ? bookmarks.find((bookmark) => paginator.isOnCurrentPage(bookmark.position)) || null : null;
  }

  async function loadBookmarks() {
    try {
      bookmarks = await listBookmarks(userId, bookId);
      bookmarksError = '';
    } catch (error) {
      bookmarksError = error.message;
    }
    updatePageBookmark();
  }

  // A filled bookmark icon removes the page's bookmark; an empty one opens the add dialog.
  function toggleBookmark() {
    if (pageBookmark) { void removeBookmark(pageBookmark); return; }
    if (!info || !paginator) return;
    bookmarkDraft = { position: info.position, excerpt: paginator.excerptAt(info.position) };
    bookmarkNote = '';
    bookmarkDialogError = '';
  }

  async function saveBookmark(event) {
    event.preventDefault();
    if (!bookmarkDraft || bookmarkBusy) return;
    bookmarkBusy = true;
    bookmarkDialogError = '';
    try {
      const created = await addBookmark(userId, bookId, bookmarkDraft.position, bookmarkDraft.excerpt, bookmarkNote);
      bookmarks = [created, ...bookmarks];
      bookmarkDraft = null;
      updatePageBookmark();
    } catch (error) {
      bookmarkDialogError = error.message;
    } finally {
      bookmarkBusy = false;
    }
  }

  async function removeBookmark(bookmark) {
    try {
      await deleteBookmark(userId, bookmark.id);
      bookmarks = bookmarks.filter((item) => item.id !== bookmark.id);
      bookmarksError = '';
    } catch (error) {
      bookmarksError = error.message;
      contentsTab = 'bookmarks';
      contentsOpen = true;
    }
    updatePageBookmark();
  }

  function openContents() {
    settingsOpen = false;
    contentsOpen = !contentsOpen;
  }

  function jumpFromContents(position) {
    contentsOpen = false;
    toolbar = false;
    jumpTo(position);
  }

  async function openNote(href) {
    const rendered = book ? renderNote(book, href) : null;
    if (!rendered) return;
    note = { title: rendered.title || 'Note' };
    await tick();
    noteBody?.replaceChildren(rendered.fragment);
  }

  function showEnd() {
    toolbar = false;
    settingsOpen = false;
    ended = true;
    // Finishing is saved and synced like any other progress update.
    if (info) {
      movedSinceOpen = true;
      remote = null;
      void saveProgress(userId, bookId, info.position, 100);
    }
  }

  function readAgain() {
    ended = false;
    jumpTo(START);
  }

  function jumpTo(position) {
    if (!paginator) return;
    saveNext = true;
    void paginator.open(position);
  }

  function jumpToPercent() {
    dragging = false;
    if (book) jumpTo(positionAtPercent(book, sliderValue / 10));
  }

  function continueRemote() {
    const target = remote?.position;
    remote = null;
    if (target) jumpTo(target);
  }

  // Full screen needs a user gesture, so a saved preference is applied on the first tap or key press.
  function applyFullscreenPreference() {
    if (!canFullscreen || !fullscreenWanted || fullscreenDismissed || isFullscreen()) return;
    enteredFullscreen = true;
    void enterFullscreen();
  }

  // Follows the real state: leaves full screen when active, otherwise enters it.
  function toggleFullscreen() {
    const wanted = !fullscreenActive;
    updateReaderSettings({ fullscreen: wanted });
    fullscreenDismissed = false;
    if (wanted) {
      enteredFullscreen = true;
      void enterFullscreen();
    } else {
      void exitFullscreen();
    }
  }

  function closeChrome() {
    toolbar = false;
    settingsOpen = false;
    contentsOpen = false;
  }

  function errorText(error) {
    if (error?.statusCode || error?.status || error?.code) return friendlyLibraryError(error, 'Could not download this book. Check your connection and try again.');
    return error?.message || 'Could not open this book.';
  }

  function differs(a, b) {
    return a.position?.section !== b.position?.section || Math.abs((a.position?.paragraph || 0) - (b.position?.paragraph || 0)) > 3;
  }

  // Layout settings re-paginate to the same paragraph; theme changes only repaint.
  $effect(() => {
    const settings = $readerSettings;
    const key = layoutKey(settings);
    if (!paginatorReady || key === appliedLayout) return;
    appliedLayout = key;
    clearTimeout(layoutTimer);
    layoutTimer = setTimeout(async () => {
      await ensureFont(settings.font);
      if (!paginator) return;
      paginator.setMargin(settings.margin);
      paginator.relayout();
    }, 120);
  });

  onMount(() => {
    let alive = true;
    let resizeObserver = null;
    let resizeTimer = 0;
    let start = null;
    // True once a horizontal drag has started; the page then follows the finger.
    let swiping = false;

    const pointerDown = (event) => {
      if (!event.isPrimary || event.button > 0) return;
      start = { x: event.clientX, y: event.clientY, id: event.pointerId };
      swiping = false;
    };
    const pointerMove = (event) => {
      if (!start || event.pointerId !== start.id) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (!swiping) {
        if (Math.abs(dx) <= TAP_SLOP || Math.abs(dx) <= Math.abs(dy)) return;
        swiping = true;
        // Capture only once dragging, so plain taps still reach note markers.
        try { surface.setPointerCapture(event.pointerId); } catch { /* Not supported: moves still arrive while over the page. */ }
      }
      paginator?.drag(dx);
    };
    const pointerUp = (event) => {
      if (!start || event.pointerId !== start.id) return;
      applyFullscreenPreference();
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      const wasSwiping = swiping;
      start = null;
      swiping = false;
      if (wasSwiping || (Math.abs(dx) > SWIPE_DISTANCE && Math.abs(dx) > Math.abs(dy) * 1.2)) {
        if (Math.abs(dx) > SWIPE_DISTANCE) void turn(dx < 0);
        else paginator?.settle();
        return;
      }
      if (Math.hypot(dx, dy) > TAP_SLOP) return;
      // While the toolbar is open, any tap on the page simply closes it.
      if (toolbar || settingsOpen || contentsOpen) { closeChrome(); return; }
      const marker = event.target instanceof Element ? event.target.closest('.fb-note') : null;
      if (marker?.dataset.href) { void openNote(marker.dataset.href); return; }
      const rect = surface.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width;
      if (x < 1 / 3) void turn(false);
      else if (x > 2 / 3) void turn(true);
      else toolbar = true;
    };
    const pointerCancel = () => {
      if (swiping) paginator?.settle();
      start = null;
      swiping = false;
    };
    // Browser toolbars and rotation change the visual viewport without resizing the page box.
    const scheduleRelayout = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => paginator?.relayout(), 150);
    };
    surface.addEventListener('pointerdown', pointerDown);
    surface.addEventListener('pointermove', pointerMove);
    surface.addEventListener('pointerup', pointerUp);
    surface.addEventListener('pointercancel', pointerCancel);
    window.visualViewport?.addEventListener('resize', scheduleRelayout);
    const stopFullscreenWatch = onFullscreenChange(() => {
      fullscreenActive = isFullscreen();
      if (!fullscreenActive && fullscreenWanted) fullscreenDismissed = true;
    });

    (async () => {
      try {
        if (!UUID.test(bookId)) throw new Error('This book could not be found.');
        const settingsReady = loadReaderSettings(userId);
        // Works offline from the saved library list.
        const found = await findBook(bookId);
        if (!found) throw new Error('This book is no longer in the library.');
        if (found.kind !== 'fb2') { navigate('/view/' + bookId, { replace: true }); return; }
        if (!alive) return;
        record = found;
        // The server position is fetched in parallel with the download.
        const serverPromise = fetchServerProgress(userId, bookId).catch(() => null);
        // The downloaded copy is used when available, so opened books work offline.
        const bytes = await openBookBytes(found);
        if (!alive) return;
        const opened = await openFb2Book(bytes, found.file_path.endsWith('.fb2.zip'));
        if (!alive) { opened.dispose(); return; }
        book = opened;
        await settingsReady;
        await ensureFont($readerSettings.font);
        const local = await localProgress(userId, bookId);
        let startEntry = local;
        if (!local) {
          startEntry = await Promise.race([serverPromise, new Promise((resolve) => setTimeout(() => resolve(null), SERVER_WAIT))]);
        }
        if (!alive) return;
        status = 'ready';
        await tick();
        await document.fonts?.ready;
        if (!alive) return;
        paginator = new Paginator(pageBox, book, handleChange);
        paginator.setMargin($readerSettings.margin);
        appliedLayout = layoutKey($readerSettings);
        // A finished book opens on its last page, whatever the layout on the finishing device was.
        if (startEntry?.percent >= 100) await paginator.openAtEnd();
        else await paginator.open(startEntry?.position || START);
        paginatorReady = true;
        void loadBookmarks();
        // Re-paginate after resize or rotation, keeping the first visible paragraph.
        resizeObserver = new ResizeObserver(scheduleRelayout);
        resizeObserver.observe(pageBox);
        // Offer the other device's position only if it is newer and the user has not moved yet.
        if (local) {
          const server = await serverPromise;
          if (alive && server && !movedSinceOpen && server.updatedAt > local.updatedAt && differs(server, local)) remote = server;
        }
      } catch (error) {
        if (!alive) return;
        errorMessage = errorText(error);
        status = 'error';
      }
    })();

    return () => {
      alive = false;
      surface.removeEventListener('pointerdown', pointerDown);
      surface.removeEventListener('pointermove', pointerMove);
      surface.removeEventListener('pointerup', pointerUp);
      surface.removeEventListener('pointercancel', pointerCancel);
      window.visualViewport?.removeEventListener('resize', scheduleRelayout);
      stopFullscreenWatch();
      // Leave full screen with the reader, but only if the reader entered it.
      if (enteredFullscreen) void exitFullscreen();
      resizeObserver?.disconnect();
      clearTimeout(resizeTimer);
      clearTimeout(layoutTimer);
      paginator?.destroy();
      book?.dispose();
      paginator = null;
      book = null;
      void flushProgress();
    };
  });

  function keydown(event) {
    if (status !== 'ready' || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    // The bookmark dialog handles its own keys (Escape closes it).
    if (bookmarkDraft) return;
    // The end screen is an extra page after the last one: Escape or "back" keys return to it.
    if (ended && !note) {
      const onButton = event.target instanceof Element && event.target.closest('button');
      const back = ['ArrowLeft', 'ArrowUp', 'PageUp'].includes(event.key) || (event.key === ' ' && event.shiftKey && !onButton);
      if (event.key === 'Escape' || back) {
        event.preventDefault();
        ended = false;
      }
      return;
    }
    // Overlays: only Escape works, page keys are ignored.
    if (note || contentsOpen) {
      if (event.key === 'Escape') {
        if (note) note = null;
        else contentsOpen = false;
      }
      return;
    }
    if (event.key === 'Escape') {
      if (settingsOpen) settingsOpen = false;
      else if (toolbar) toolbar = false;
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('input, select, textarea')) return;
    if ((event.key === ' ' || event.key === 'Enter') && target?.closest('button, a')) return;
    const forward = ['ArrowRight', 'ArrowDown', 'PageDown'].includes(event.key) || (event.key === ' ' && !event.shiftKey);
    const backward = ['ArrowLeft', 'ArrowUp', 'PageUp'].includes(event.key) || (event.key === ' ' && event.shiftKey);
    if (forward || backward) {
      event.preventDefault();
      applyFullscreenPreference();
      void turn(forward);
    }
  }
</script>

<svelte:window onkeydown={keydown} />

<main class="reader" id="main" tabindex="-1" style={readerStyle($readerSettings)}>
  <div class="reader-surface" bind:this={surface}>
    <div class="reader-page" bind:this={pageBox} aria-live="off"></div>
  </div>

  {#if status === 'loading'}
    <div class="reader-status" role="status"><p>Opening book…</p></div>
  {:else if status === 'error'}
    <div class="reader-status" role="alert">
      <h1>Can’t open this book</h1>
      <p>{errorMessage}</p>
      <a class="button secondary" href="#/library"><Icon name="back" size={19} /> Back to library</a>
    </div>
  {/if}

  {#if note}
    <div class="note-layer">
      <button class="note-backdrop" type="button" aria-label="Close note" onclick={() => note = null}></button>
      <section class="note-popup" aria-labelledby="note-title">
        <div class="note-head">
          <h2 id="note-title">{note.title}</h2>
          <button class="icon-button" type="button" aria-label="Close note" onclick={() => note = null}><Icon name="close" size={20} /></button>
        </div>
        <div class="note-body" bind:this={noteBody}></div>
      </section>
    </div>
  {/if}

  {#if bookmarkDraft}
    <Modal title="Add bookmark" busy={bookmarkBusy} onclose={() => bookmarkDraft = null}>
      <form onsubmit={saveBookmark}>
        {#if bookmarkDraft.excerpt}<p class="bookmark-preview">{bookmarkDraft.excerpt}</p>{/if}
        <label for="bookmark-note">Note (optional)</label>
        <textarea id="bookmark-note" class="bookmark-note-input" rows="3" maxlength="2000" bind:value={bookmarkNote} disabled={bookmarkBusy}></textarea>
        {#if bookmarkDialogError}<p class="alert error" role="alert">{bookmarkDialogError}</p>{/if}
        <div class="modal-actions">
          <button class="button secondary" type="button" onclick={() => bookmarkDraft = null} disabled={bookmarkBusy}>Cancel</button>
          <button class="button primary" type="submit" disabled={bookmarkBusy}>{bookmarkBusy ? 'Saving…' : 'Add bookmark'}</button>
        </div>
      </form>
    </Modal>
  {/if}

  {#if ended && record}
    <EndOfBook book={record} onclose={() => navigate('/library')} onrestart={readAgain} onback={() => ended = false} />
  {/if}

  {#if remote && status === 'ready' && !ended}
    <section class="reader-sync-prompt" aria-live="polite" aria-label="Continue reading">
      <p>Continue from where you left off on {remote.deviceLabel} ({Math.floor(remote.percent)}%)?</p>
      <div class="reader-sync-actions">
        <button class="button secondary" type="button" onclick={() => remote = null}>Stay here</button>
        <button class="button primary" type="button" onclick={continueRemote}>Continue</button>
      </div>
    </section>
  {/if}

  {#if pageBookmark && status === 'ready'}<span class="reader-ribbon" aria-hidden="true"><Icon name="bookmark" size={20} filled /></span>{/if}

  {#if (toolbar || settingsOpen || contentsOpen) && status === 'ready'}
    <header class="reader-bar reader-top">
      <button class="icon-button" type="button" onclick={() => navigate('/library')} aria-label="Back to library" title="Back to library"><Icon name="back" /></button>
      <div class="reader-titles">
        <span class="reader-book-title">{record?.title}</span>
        <span class="reader-chapter-title">{#if chapterTitle && chapterTitle !== record?.title}{chapterTitle} · {/if}{chapterLeftLabel}</span>
      </div>
      <button class="icon-button" class:active={contentsOpen} type="button" onclick={openContents}
        aria-expanded={contentsOpen} aria-label="Contents and bookmarks" title="Contents and bookmarks"><Icon name="contents" /></button>
      <button class="icon-button" class:active={!!pageBookmark} type="button" onclick={toggleBookmark} aria-pressed={!!pageBookmark}
        aria-label={pageBookmark ? 'Remove bookmark' : 'Add bookmark'} title={pageBookmark ? 'Remove bookmark' : 'Add bookmark'}><Icon name="bookmark" filled={!!pageBookmark} /></button>
      <button class="icon-button reader-settings-button" class:active={settingsOpen} type="button" onclick={() => { contentsOpen = false; settingsOpen = !settingsOpen; }}
        aria-expanded={settingsOpen} aria-label="Reader settings" title="Reader settings"><span aria-hidden="true">Aa</span></button>
      {#if canFullscreen}
        <button class="icon-button reader-fullscreen" type="button" onclick={toggleFullscreen} aria-pressed={fullscreenActive}
          aria-label={fullscreenActive ? 'Exit full screen' : 'Full screen'} title={fullscreenActive ? 'Exit full screen' : 'Full screen'}>
          <Icon name={fullscreenActive ? 'collapse' : 'expand'} />
        </button>
      {/if}
    </header>
    {#if contentsOpen && book}
      <ReaderContents {book} {bookmarks} position={info?.position} bookPages={info?.bookPages || 1} bind:tab={contentsTab} error={bookmarksError}
        onjump={jumpFromContents} ondelete={removeBookmark} onclose={() => contentsOpen = false} />
    {:else if settingsOpen}
      <ReaderSettings {canFullscreen} {fullscreenActive} onfullscreen={toggleFullscreen} onclose={() => settingsOpen = false} />
    {:else}
      <footer class="reader-bar reader-bottom">
        <span class="reader-page-label">{pageLabel}</span>
        <label class="visually-hidden" for="reader-progress">Position in book</label>
        <input id="reader-progress" class="reader-slider" type="range" min="0" max="1000" step="1"
          bind:value={sliderValue} oninput={() => dragging = true} onchange={jumpToPercent} />
        <span class="reader-percent">{percentLabel}</span>
      </footer>
    {/if}
  {:else if info && status === 'ready'}
    <div class="reader-indicator" aria-hidden="true">{pageLabel} · {percentLabel}</div>
  {/if}
</main>
