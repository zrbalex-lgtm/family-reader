<script>
  import { onMount, tick } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import SongList from '../components/SongList.svelte';
  import { auth } from '../lib/auth.js';
  import { navigate } from '../lib/router.js';
  import { friendlyLibraryError } from '../lib/library-api.js';
  import { findBook, openBookBytes } from '../lib/offline.js';
  import { localProgress, saveProgress, fetchServerProgress, flushProgress } from '../lib/sync.js';
  import { idbGet, idbSet } from '../lib/idb.js';
  import { renderDocx, createSearch, buildSongList } from '../lib/docx/viewer.js';
  import { DocPager } from '../lib/docx/pager.js';

  let { bookId } = $props();

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const TAP_SLOP = 10;
  const SERVER_WAIT = 1500;
  const WAKE_KEY = 'family-reader:doc-wake-lock';
  // Bump when the renderer or song detection changes, so cached song lists are rebuilt.
  // v2: section breaks start new pages, so page numbers differ from v1.
  const SONGS_CACHE = 'songs:v2:';
  const MODES = new Set(['page', 'width', 'custom']);

  let status = $state('loading');
  let errorMessage = $state('');
  let record = $state(null);
  let chrome = $state(true);
  let dark = $state(true);
  let page = $state(0);
  let pageCount = $state(0);
  let zoom = $state(1);
  let mode = $state('page');
  let searchOpen = $state(false);
  let query = $state('');
  let matchCount = $state(0);
  let matchIndex = $state(-1);
  let songsOpen = $state(false);
  let songs = $state.raw([]);
  let songsLoading = $state(true);
  let fontIssues = $state([]);
  let fontNoticeOpen = $state(true);
  let wakeOn = $state(readWakePreference());
  const wakeSupported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;

  let stage = $state();
  let content = $state();
  let pagesBox = $state();
  let stylesBox = $state();
  let searchInput = $state();

  // Imperative objects; not reactive on purpose.
  let pager = null;
  let pages = [];
  let search = null;
  let groups = [];
  let revokeUrls = null;
  let wakeSentinel = null;
  // Only real user actions save the position; opening and restoring do not.
  let interacted = false;
  let persistTimer = 0;
  let searchTimer = 0;

  const userId = $derived($auth.session?.user.id || '');
  const zoomLabel = $derived(Math.round(zoom * 100) + '%');
  const pageLabel = $derived(pageCount ? `Page ${page + 1} / ${pageCount}` : '');

  function readWakePreference() {
    try { return localStorage.getItem(WAKE_KEY) !== 'off'; } catch { return true; }
  }

  // --- Saving the position (from state only, never from the DOM, which may already be detached) ---

  function persistNow(flush = false) {
    clearTimeout(persistTimer);
    if (!interacted || !pager || !userId) return;
    const position = { page, pages: pageCount, zoom: Math.round(zoom * 1000) / 1000, mode, dark };
    const percent = pageCount > 1 ? (page / pageCount) * 100 : 0;
    const saving = saveProgress(userId, bookId, position, percent);
    if (flush) void saving.then(() => flushProgress());
  }

  function schedulePersist() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => persistNow(), 600);
  }

  function handleChange(state) {
    page = state.index;
    pageCount = state.count;
    zoom = state.zoom;
    mode = state.mode;
    if (interacted) schedulePersist();
  }

  // --- Navigation ---

  async function turn(direction) {
    if (!pager) return;
    interacted = true;
    await pager.turn(direction);
  }

  function goToPage(index) {
    if (!pager) return;
    interacted = true;
    pager.show(index);
  }

  function setMode(next) {
    if (!pager) return;
    interacted = true;
    pager.setMode(next);
  }

  function zoomBy(factor) {
    if (!pager) return;
    interacted = true;
    const box = stage.getBoundingClientRect();
    pager.zoomAt(pager.zoom * factor, box.left + box.width / 2, box.top + box.height / 2);
  }

  function toggleDark() {
    interacted = true;
    dark = !dark;
    schedulePersist();
  }

  function jumpFromSongs(index) {
    songsOpen = false;
    goToPage(index);
  }

  // --- Search ---

  function openSearch() {
    chrome = true;
    songsOpen = false;
    searchOpen = true;
    void tick().then(() => searchInput?.focus());
  }

  function clearMatches() {
    search?.clear();
    groups = [];
    matchCount = 0;
    matchIndex = -1;
  }

  function closeSearch() {
    clearTimeout(searchTimer);
    clearMatches();
    searchOpen = false;
    query = '';
  }

  function pageOf(group) {
    return pages.indexOf(group[0].closest('section.docx'));
  }

  function runSearch() {
    if (!search) return;
    groups = search.find(query);
    matchCount = groups.length;
    matchIndex = -1;
    if (!groups.length) return;
    // Start with the first match on or after the current page.
    const first = groups.findIndex((group) => pageOf(group) >= page);
    showMatch(first < 0 ? 0 : first);
  }

  function showMatch(index) {
    if (!groups.length || !pager) return;
    if (matchIndex >= 0) for (const mark of groups[matchIndex] || []) mark.classList.remove('current');
    matchIndex = (index + groups.length) % groups.length;
    const group = groups[matchIndex];
    for (const mark of group) mark.classList.add('current');
    const target = pageOf(group);
    interacted = true;
    if (target >= 0 && target !== pager.index) pager.show(target);
    requestAnimationFrame(() => pager?.reveal(group[0].getBoundingClientRect()));
  }

  function searchInputChanged() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      if (query.trim().length >= 2) runSearch();
      else clearMatches();
    }, 250);
  }

  function searchKey(event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (matchCount) showMatch(matchIndex + (event.shiftKey ? -1 : 1));
      else if (query.trim()) runSearch();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeSearch();
    }
  }

  // --- Screen wake lock ---

  async function acquireWake() {
    if (!wakeSupported || !wakeOn || wakeSentinel || document.visibilityState !== 'visible') return;
    try {
      wakeSentinel = await navigator.wakeLock.request('screen');
      wakeSentinel.addEventListener('release', () => { wakeSentinel = null; });
    } catch {
      wakeSentinel = null;
    }
  }

  function releaseWake() {
    wakeSentinel?.release().catch(() => {});
    wakeSentinel = null;
  }

  function toggleWake() {
    wakeOn = !wakeOn;
    try { localStorage.setItem(WAKE_KEY, wakeOn ? 'on' : 'off'); } catch { /* Keep the choice for this visit only. */ }
    if (wakeOn) void acquireWake();
    else releaseWake();
  }

  // --- Loading ---

  // Saved DOCX positions: { page, pages, zoom, mode, dark }. Stage 6 stored { page, zoom, fit, dark }.
  function readSaved(position) {
    if (!position || typeof position !== 'object') return null;
    let savedMode = MODES.has(position.mode) ? position.mode : null;
    if (!savedMode) savedMode = position.fit === 'width' || position.fit === 'page' ? position.fit : position.zoom ? 'custom' : 'page';
    return {
      page: Math.max(0, Math.trunc(Number(position.page)) || 0),
      zoom: Number(position.zoom) > 0 ? Number(position.zoom) : 1,
      mode: savedMode,
      dark: typeof position.dark === 'boolean' ? position.dark : true,
    };
  }

  async function loadSongs(bytes, fileHash) {
    const key = SONGS_CACHE + fileHash;
    try {
      const cached = await idbGet('cache', key);
      if (Array.isArray(cached?.songs)) { songs = cached.songs; return; }
    } catch { /* No cache: build it. */ }
    try {
      songs = await buildSongList(bytes, pages);
      void idbSet('cache', key, { songs, pages: pages.length }).catch(() => {});
    } catch {
      songs = [];
    }
  }

  function errorText(error) {
    if (error?.statusCode || error?.status || error?.code) return friendlyLibraryError(error, 'Could not download this document. Check your connection and try again.');
    return error?.message || 'Could not open this document.';
  }

  onMount(() => {
    let alive = true;
    let stageObserver = null;
    let frame = 0;
    const pointers = new Map();
    let single = null;
    let pinch = null;
    let gestureBase = null;
    let wheelExcess = 0;
    let wheelLockedUntil = 0;

    const two = () => {
      const [a, b] = Array.from(pointers.values());
      return { distance: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    };
    const capture = (id) => { try { stage.setPointerCapture(id); } catch { /* Moves still arrive while over the stage. */ } };

    const pointerDown = (event) => {
      if (!pager || (event.pointerType === 'mouse' && event.button > 0)) return;
      interacted = true;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 1) {
        single = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false, lock: null };
      } else if (pointers.size === 2) {
        // A second finger turns a drag into a pinch.
        if (single?.moved) pager.settle();
        single = null;
        const start = two();
        pinch = { distance: Math.max(1, start.distance) };
        for (const id of pointers.keys()) capture(id);
        pager.pinchStart(start.x, start.y);
      }
    };
    const pointerMove = (event) => {
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pinch && pointers.size >= 2) {
        const now = two();
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => pager?.pinchMove(now.distance / pinch.distance, now.x, now.y));
        return;
      }
      if (!single || event.pointerId !== single.id) return;
      const dx = event.clientX - single.x;
      const dy = event.clientY - single.y;
      if (!single.moved) {
        if (Math.hypot(dx, dy) <= TAP_SLOP) return;
        single.moved = true;
        // Zoomed in both directions: free panning; otherwise lock to the first direction.
        const overflow = pager.overflow();
        single.lock = overflow.x && overflow.y ? null : Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
        capture(event.pointerId);
        pager.dragStart();
      }
      pager.dragMove(dx, dy, single.lock);
    };
    const pointerUp = (event) => {
      if (!pointers.delete(event.pointerId)) return;
      if (pinch) {
        if (pointers.size < 2) {
          pinch = null;
          pager?.pinchEnd();
        }
        single = null;
        return;
      }
      if (!single || event.pointerId !== single.id) return;
      const tap = single;
      single = null;
      if (tap.moved) {
        const direction = pager.dragEnd();
        if (direction) void turn(direction);
        return;
      }
      if (event.target instanceof Element && event.target.closest('a[href]')) return;
      if (songsOpen) { songsOpen = false; return; }
      const box = stage.getBoundingClientRect();
      const x = (event.clientX - box.left) / box.width;
      if (x < 1 / 3) void turn(-1);
      else if (x > 2 / 3) void turn(1);
      else chrome = !chrome;
    };
    const pointerCancel = (event) => {
      pointers.delete(event.pointerId);
      if (pinch && pointers.size < 2) { pinch = null; pager?.pinchEnd(); }
      if (single?.moved) pager?.settle();
      single = null;
    };
    // Desktop: wheel pans inside the page; scrolling on past the edge turns it. Ctrl + wheel zooms.
    const wheel = (event) => {
      if (!pager) return;
      event.preventDefault();
      interacted = true;
      if (event.ctrlKey) {
        pager.zoomAt(pager.zoom * Math.exp(-event.deltaY * 0.01), event.clientX, event.clientY);
        return;
      }
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? stage.clientHeight : 1;
      const left = pager.pan(-event.deltaX * unit, -event.deltaY * unit);
      if (Math.abs(left.y) < 0.5) { wheelExcess = 0; return; }
      if (Date.now() < wheelLockedUntil) return;
      wheelExcess += left.y;
      if (Math.abs(wheelExcess) > 150) {
        const direction = wheelExcess < 0 ? 1 : -1;
        wheelExcess = 0;
        // Ignore trackpad momentum for a moment after a turn.
        wheelLockedUntil = Date.now() + 700;
        void turn(direction);
      }
    };
    // Safari: block the browser's page zoom; on macOS trackpads, gesture events zoom the page.
    const gestureStart = (event) => { event.preventDefault(); gestureBase = pager?.zoom ?? null; };
    const gestureChange = (event) => {
      event.preventDefault();
      if (pinch || pointers.size >= 2 || gestureBase === null || !pager) return;
      pager.zoomAt(gestureBase * event.scale, event.clientX, event.clientY);
    };
    const gestureEnd = (event) => { event.preventDefault(); gestureBase = null; pager?.pinchEnd(); };
    // Save when the app is hidden or closed; timers may not run again on iPhone/iPad.
    const visibility = () => {
      if (document.visibilityState === 'visible') void acquireWake();
      else persistNow(true);
    };
    const pageHide = () => persistNow(true);
    const fontsLoaded = () => pager?.refresh();

    stage.addEventListener('pointerdown', pointerDown);
    stage.addEventListener('pointermove', pointerMove);
    stage.addEventListener('pointerup', pointerUp);
    stage.addEventListener('pointercancel', pointerCancel);
    stage.addEventListener('wheel', wheel, { passive: false });
    document.addEventListener('gesturestart', gestureStart);
    document.addEventListener('gesturechange', gestureChange);
    document.addEventListener('gestureend', gestureEnd);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', pageHide);
    document.fonts?.addEventListener?.('loadingdone', fontsLoaded);

    (async () => {
      try {
        if (!UUID.test(bookId)) throw new Error('This document could not be found.');
        // Works offline from the saved library list.
        const found = await findBook(bookId);
        if (!found) throw new Error('This document is no longer in the library.');
        if (found.kind !== 'docx') { navigate('/read/' + bookId, { replace: true }); return; }
        if (!alive) return;
        record = found;
        const serverPromise = fetchServerProgress(userId, bookId).catch(() => null);
        // The downloaded copy is used when available, so opened books work offline.
        const bytes = await openBookBytes(found);
        if (!alive) return;
        const rendered = await renderDocx(bytes, pagesBox, stylesBox);
        revokeUrls = rendered.cleanup;
        if (!alive) return;
        fontIssues = rendered.fontIssues;
        pages = Array.from(pagesBox.querySelectorAll('section.docx'));
        search = createSearch(pagesBox);

        // Restore only after rendering, fonts and tab stops are final.
        const local = await localProgress(userId, bookId);
        const server = await Promise.race([serverPromise, new Promise((resolve) => setTimeout(() => resolve(null), SERVER_WAIT))]);
        const newest = [local, server].filter(Boolean).sort((a, b) => b.updatedAt - a.updatedAt)[0];
        const saved = readSaved(newest?.position);
        if (saved) dark = saved.dark;
        content.classList.add('doc-paged');
        pager = new DocPager(stage, content, pages, handleChange);
        pager.show(saved?.page ?? 0, { mode: saved?.mode ?? 'page', zoom: saved?.zoom ?? 1 });
        status = 'ready';
        // Rotation or window resize: refit and keep the page in view.
        stageObserver = new ResizeObserver(() => pager?.refresh());
        stageObserver.observe(stage);
        void acquireWake();
        await loadSongs(bytes, found.file_hash);
        songsLoading = false;
      } catch (error) {
        if (!alive) return;
        errorMessage = errorText(error);
        status = 'error';
      }
    })();

    return () => {
      alive = false;
      persistNow(true);
      clearTimeout(searchTimer);
      cancelAnimationFrame(frame);
      stageObserver?.disconnect();
      document.removeEventListener('gesturestart', gestureStart);
      document.removeEventListener('gesturechange', gestureChange);
      document.removeEventListener('gestureend', gestureEnd);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', pageHide);
      document.fonts?.removeEventListener?.('loadingdone', fontsLoaded);
      releaseWake();
      revokeUrls?.();
      pager = null;
    };
  });

  function keydown(event) {
    if (status !== 'ready' || event.defaultPrevented || event.altKey) return;
    const command = event.ctrlKey || event.metaKey;
    const key = event.key;
    if (command && key.toLowerCase() === 'f') { event.preventDefault(); openSearch(); return; }
    if (command && (key === '=' || key === '+')) { event.preventDefault(); zoomBy(1.25); return; }
    if (command && key === '-') { event.preventDefault(); zoomBy(0.8); return; }
    if (command && key === '0') { event.preventDefault(); setMode('actual'); return; }
    if (command) return;
    if (key === 'Escape') {
      if (searchOpen) closeSearch();
      else if (songsOpen) songsOpen = false;
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('input, select, textarea')) return;
    if ((key === ' ' || key === 'Enter') && target?.closest('button, a')) return;
    const next = ['ArrowRight', 'ArrowDown', 'PageDown'].includes(key) || (key === ' ' && !event.shiftKey);
    const previous = ['ArrowLeft', 'ArrowUp', 'PageUp'].includes(key) || (key === ' ' && event.shiftKey);
    if (next || previous) { event.preventDefault(); void turn(next ? 1 : -1); }
    else if (key === 'Home') { event.preventDefault(); goToPage(0); }
    else if (key === 'End') { event.preventDefault(); goToPage(pageCount - 1); }
    else if (key === '+' || key === '=') zoomBy(1.25);
    else if (key === '-') zoomBy(0.8);
  }
</script>

<svelte:window onkeydown={keydown} />

<main class="doc-viewer" class:light={!dark} id="main" tabindex="-1">
  <div class="doc-styles" bind:this={stylesBox}></div>
  <div class="doc-stage" bind:this={stage}>
    <div class="doc-content" class:dark bind:this={content}>
      <div bind:this={pagesBox}></div>
    </div>
  </div>

  {#if status === 'loading'}
    <div class="reader-status doc-status" role="status"><p>Opening document…</p></div>
  {:else if status === 'error'}
    <div class="reader-status doc-status" role="alert">
      <h1>Can’t open this document</h1>
      <p>{errorMessage}</p>
      <a class="button secondary" href="#/library"><Icon name="back" size={19} /> Back to library</a>
    </div>
  {/if}

  {#if status === 'ready' && chrome}
    <header class="doc-bar doc-top">
      <button class="icon-button" type="button" onclick={() => navigate('/library')} aria-label="Back to library" title="Back to library"><Icon name="back" /></button>
      <div class="doc-titles">
        <span class="doc-title">{record?.title}</span>
        <span class="doc-page">{pageLabel}</span>
      </div>
      <button class="icon-button" class:active={songsOpen} type="button" onclick={() => { searchOpen = false; songsOpen = !songsOpen; }} aria-expanded={songsOpen} aria-label="Song list" title="Song list"><Icon name="contents" /></button>
      <button class="icon-button" class:active={searchOpen} type="button" onclick={() => searchOpen ? closeSearch() : openSearch()} aria-label="Search" title="Search (Ctrl+F)"><Icon name="search" /></button>
      <button class="icon-button" type="button" onclick={toggleDark} aria-pressed={dark} aria-label={dark ? 'Show original light pages' : 'Dark pages'} title={dark ? 'Original light pages' : 'Dark pages'}><Icon name={dark ? 'sun' : 'moon'} /></button>
      {#if wakeSupported}
        <button class="icon-button" class:active={wakeOn} type="button" onclick={toggleWake} aria-pressed={wakeOn} aria-label="Keep screen on" title={wakeOn ? 'Screen stays on' : 'Screen may turn off'}><Icon name={wakeOn ? 'eye' : 'eyeOff'} /></button>
      {/if}
    </header>

    {#if searchOpen}
      <div class="doc-search" role="search">
        <label class="visually-hidden" for="doc-search-input">Search in document</label>
        <input id="doc-search-input" type="search" bind:this={searchInput} bind:value={query} oninput={searchInputChanged} onkeydown={searchKey}
          placeholder="Search" autocomplete="off" enterkeyhint="search" />
        <span class="doc-search-count" aria-live="polite">{matchCount ? `${matchIndex + 1} / ${matchCount}` : query.trim().length >= 2 ? 'No matches' : ''}</span>
        <button class="icon-button" type="button" onclick={() => showMatch(matchIndex - 1)} disabled={!matchCount} aria-label="Previous match"><Icon name="chevronUp" size={20} /></button>
        <button class="icon-button" type="button" onclick={() => showMatch(matchIndex + 1)} disabled={!matchCount} aria-label="Next match"><Icon name="chevronDown" size={20} /></button>
        <button class="icon-button" type="button" onclick={closeSearch} aria-label="Close search"><Icon name="close" size={20} /></button>
      </div>
    {/if}

    {#if fontIssues.length && fontNoticeOpen && !songsOpen}
      <div class="doc-font-notice" role="status">
        <span>Fonts missing on this device: {fontIssues.map((issue) => issue.substitute ? `${issue.name} (shown with ${issue.substitute})` : issue.name).join(', ')}. Alignment may differ slightly.</span>
        <button class="icon-button" type="button" aria-label="Dismiss font notice" onclick={() => fontNoticeOpen = false}><Icon name="close" size={18} /></button>
      </div>
    {/if}

    {#if songsOpen}
      <SongList {songs} {page} loading={songsLoading} onjump={jumpFromSongs} onclose={() => songsOpen = false} />
    {:else}
      <footer class="doc-bar doc-bottom">
        <button class="icon-button" type="button" onclick={() => turn(-1)} disabled={page <= 0} aria-label="Previous page" title="Previous page"><Icon name="chevronLeft" size={22} /></button>
        <button class="icon-button" type="button" onclick={() => turn(1)} disabled={page >= pageCount - 1} aria-label="Next page" title="Next page"><Icon name="chevronRight" size={22} /></button>
        <span class="doc-spacer"></span>
        <button class="icon-button doc-zoom-step" type="button" onclick={() => zoomBy(0.8)} aria-label="Zoom out">−</button>
        <span class="doc-zoom" aria-live="polite">{zoomLabel}</span>
        <button class="icon-button doc-zoom-step" type="button" onclick={() => zoomBy(1.25)} aria-label="Zoom in">+</button>
        <button class="doc-fit" class:active={mode === 'page'} type="button" onclick={() => setMode('page')}>Fit page</button>
        <button class="doc-fit" class:active={mode === 'width'} type="button" onclick={() => setMode('width')}>Fit width</button>
        <button class="doc-fit" class:active={mode === 'custom' && Math.abs(zoom - 1) < 0.005} type="button" onclick={() => setMode('actual')}>100%</button>
      </footer>
    {/if}
  {:else if status === 'ready'}
    <div class="doc-indicator" aria-hidden="true">{page + 1} / {pageCount}</div>
  {/if}
</main>
