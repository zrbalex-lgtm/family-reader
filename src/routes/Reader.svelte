<script>
  import { onMount, tick } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import { auth } from '../lib/auth.js';
  import { navigate } from '../lib/router.js';
  import { findBookById, downloadObject, friendlyLibraryError } from '../lib/library-api.js';
  import { openFb2Book, positionAtPercent } from '../lib/fb2/book.js';
  import { Paginator } from '../lib/fb2/paginator.js';
  import { rememberPosition, recallPosition } from '../lib/reading-position.js';
  import {
    fullscreenSupported, isFullscreen, enterFullscreen, exitFullscreen, onFullscreenChange,
    fullscreenPreference, setFullscreenPreference,
  } from '../lib/fullscreen.js';

  let { bookId } = $props();

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const SWIPE_DISTANCE = 40;
  const TAP_SLOP = 12;

  let status = $state('loading');
  let errorMessage = $state('');
  let record = $state(null);
  let info = $state(null);
  let toolbar = $state(false);
  let surface = $state();
  let pageBox = $state();
  let sliderValue = $state(0);
  let dragging = $state(false);
  let fullscreenWanted = $state(fullscreenPreference());
  let fullscreenActive = $state(isFullscreen());
  const canFullscreen = fullscreenSupported();

  // Imperative reader objects; not reactive on purpose.
  let paginator = null;
  let book = null;
  // Set when the reader leaves full screen itself (e.g. Esc), so it is not re-entered on the next tap.
  let fullscreenDismissed = false;
  let enteredFullscreen = false;

  const userId = $derived($auth.session?.user.id || '');
  const chapterTitle = $derived(info?.title || record?.title || '');
  const percentLabel = $derived(Math.floor(dragging ? sliderValue / 10 : info?.percent || 0) + '%');
  const pageLabel = $derived(info ? `${info.bookPage} / ~${info.bookPages}` : '');
  const chapterLeftLabel = $derived(!info ? '' : info.chapterPagesLeft <= 0 ? 'Last page in chapter'
    : `${info.chapterPagesLeft} ${info.chapterPagesLeft === 1 ? 'page' : 'pages'} left in chapter`);

  function handleChange(next) {
    info = next;
    if (!dragging) sliderValue = Math.round(next.percent * 10);
    if (userId) rememberPosition(userId, bookId, next.position);
  }

  async function turn(forward) {
    if (!paginator) return;
    const moved = forward ? await paginator.next() : await paginator.previous();
    // Show the toolbar at the very start or end so the reader knows why nothing moved.
    if (!moved) toolbar = true;
  }

  // Full screen needs a user gesture, so a saved preference is applied on the first tap or key press.
  function applyFullscreenPreference() {
    if (!canFullscreen || !fullscreenWanted || fullscreenDismissed || isFullscreen()) return;
    enteredFullscreen = true;
    void enterFullscreen();
  }

  // The button follows the real state: it leaves full screen when active, otherwise enters it.
  function toggleFullscreen() {
    fullscreenWanted = !fullscreenActive;
    setFullscreenPreference(fullscreenWanted);
    fullscreenDismissed = false;
    if (fullscreenWanted) applyFullscreenPreference();
    else void exitFullscreen();
  }

  function jumpToPercent() {
    dragging = false;
    if (!paginator || !book) return;
    void paginator.open(positionAtPercent(book, sliderValue / 10));
  }

  function errorText(error) {
    if (error?.statusCode || error?.status || error?.code) return friendlyLibraryError(error, 'Could not download this book. Check your connection and try again.');
    return error?.message || 'Could not open this book.';
  }

  onMount(() => {
    let alive = true;
    let resizeObserver = null;
    let resizeTimer = 0;
    let start = null;

    const pointerDown = (event) => {
      if (!event.isPrimary || event.button > 0) return;
      start = { x: event.clientX, y: event.clientY };
    };
    const pointerUp = (event) => {
      if (!start || !event.isPrimary) return;
      applyFullscreenPreference();
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      start = null;
      if (Math.abs(dx) > SWIPE_DISTANCE && Math.abs(dx) > Math.abs(dy) * 1.2) {
        void turn(dx < 0);
        return;
      }
      if (Math.hypot(dx, dy) > TAP_SLOP) return;
      // While the toolbar is open, any tap on the page simply closes it.
      if (toolbar) { toolbar = false; return; }
      const rect = surface.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width;
      if (x < 1 / 3) void turn(false);
      else if (x > 2 / 3) void turn(true);
      else toolbar = true;
    };
    const pointerCancel = () => { start = null; };
    surface.addEventListener('pointerdown', pointerDown);
    surface.addEventListener('pointerup', pointerUp);
    surface.addEventListener('pointercancel', pointerCancel);
    const stopFullscreenWatch = onFullscreenChange(() => {
      fullscreenActive = isFullscreen();
      if (!fullscreenActive && fullscreenWanted) fullscreenDismissed = true;
    });

    (async () => {
      try {
        if (!UUID.test(bookId)) throw new Error('This book could not be found.');
        const found = await findBookById(bookId);
        if (!found) throw new Error('This book is no longer in the library.');
        if (found.kind !== 'fb2') throw new Error('Documents open in a later stage.');
        if (!alive) return;
        record = found;
        const bytes = await downloadObject(found.file_path);
        if (!alive) return;
        const opened = await openFb2Book(bytes, found.file_path.endsWith('.fb2.zip'));
        if (!alive) { opened.dispose(); return; }
        book = opened;
        status = 'ready';
        await tick();
        await document.fonts?.ready;
        if (!alive) return;
        paginator = new Paginator(pageBox, book, handleChange);
        await paginator.open(recallPosition(userId, bookId) || { section: 0, paragraph: 0, charOffset: 0 });
        // Re-paginate after resize or rotation, keeping the first visible paragraph.
        resizeObserver = new ResizeObserver(() => {
          clearTimeout(resizeTimer);
          resizeTimer = setTimeout(() => paginator?.relayout(), 150);
        });
        resizeObserver.observe(pageBox);
      } catch (error) {
        if (!alive) return;
        errorMessage = errorText(error);
        status = 'error';
      }
    })();

    return () => {
      alive = false;
      surface.removeEventListener('pointerdown', pointerDown);
      surface.removeEventListener('pointerup', pointerUp);
      surface.removeEventListener('pointercancel', pointerCancel);
      stopFullscreenWatch();
      // Leave full screen with the reader, but only if the reader entered it.
      if (enteredFullscreen) void exitFullscreen();
      resizeObserver?.disconnect();
      clearTimeout(resizeTimer);
      paginator?.destroy();
      book?.dispose();
      paginator = null;
      book = null;
    };
  });

  function keydown(event) {
    if (status !== 'ready' || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('input, select, textarea')) return;
    if ((event.key === ' ' || event.key === 'Enter') && target?.closest('button, a')) return;
    const forward = ['ArrowRight', 'ArrowDown', 'PageDown'].includes(event.key) || (event.key === ' ' && !event.shiftKey);
    const backward = ['ArrowLeft', 'ArrowUp', 'PageUp'].includes(event.key) || (event.key === ' ' && event.shiftKey);
    if (forward || backward) {
      event.preventDefault();
      applyFullscreenPreference();
      void turn(forward);
    } else if (event.key === 'Escape' && toolbar) {
      toolbar = false;
    }
  }
</script>

<svelte:window onkeydown={keydown} />

<main class="reader" id="main" tabindex="-1" class:chrome-visible={toolbar}>
  <div class="reader-surface" bind:this={surface}>
    <div class="reader-page" bind:this={pageBox} aria-live="off"></div>
  </div>

  {#if status === 'loading'}
    <div class="reader-status" role="status"><p class="muted">Opening book…</p></div>
  {:else if status === 'error'}
    <div class="reader-status" role="alert">
      <h1>Can’t open this book</h1>
      <p class="muted">{errorMessage}</p>
      <a class="button secondary" href="#/library"><Icon name="back" size={19} /> Back to library</a>
    </div>
  {/if}

  {#if toolbar && status === 'ready'}
    <header class="reader-bar reader-top">
      <button class="icon-button" type="button" onclick={() => navigate('/library')} aria-label="Back to library" title="Back to library"><Icon name="back" /></button>
      <div class="reader-titles">
        <span class="reader-book-title">{record?.title}</span>
        <span class="reader-chapter-title">{#if chapterTitle && chapterTitle !== record?.title}{chapterTitle} · {/if}{chapterLeftLabel}</span>
      </div>
      {#if canFullscreen}
        <button class="icon-button reader-fullscreen" type="button" onclick={toggleFullscreen} aria-pressed={fullscreenActive}
          aria-label={fullscreenActive ? 'Exit full screen' : 'Full screen'} title={fullscreenActive ? 'Exit full screen' : 'Full screen'}>
          <Icon name={fullscreenActive ? 'collapse' : 'expand'} />
        </button>
      {/if}
    </header>
    <footer class="reader-bar reader-bottom">
      <span class="reader-page-label">{pageLabel}</span>
      <label class="visually-hidden" for="reader-progress">Position in book</label>
      <input id="reader-progress" class="reader-slider" type="range" min="0" max="1000" step="1"
        bind:value={sliderValue} oninput={() => dragging = true} onchange={jumpToPercent} />
      <span class="reader-percent">{percentLabel}</span>
    </footer>
  {:else if info && status === 'ready'}
    <div class="reader-indicator" aria-hidden="true">{pageLabel} · {percentLabel}</div>
  {/if}
</main>
