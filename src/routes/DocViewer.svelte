<script>
  import { onMount, tick } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import { auth } from '../lib/auth.js';
  import { navigate } from '../lib/router.js';
  import { findBookById, downloadObject, friendlyLibraryError } from '../lib/library-api.js';
  import { localProgress, saveProgress, fetchServerProgress, flushProgress } from '../lib/sync.js';
  import { renderDocx, createSearch, usedFonts, fontAvailable, substituteFor, aliasFont } from '../lib/docx/viewer.js';

  let { bookId } = $props();

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const MIN_ZOOM = 0.2;
  const MAX_ZOOM = 4;
  const GUTTER = 8;
  const TAP_SLOP = 10;
  const SERVER_WAIT = 1500;
  const WAKE_KEY = 'family-reader:doc-wake-lock';

  let status = $state('loading');
  let errorMessage = $state('');
  let record = $state(null);
  let chrome = $state(true);
  let dark = $state(true);
  let zoom = $state(1);
  // 'width' or 'page' keeps that fit after rotation; null means a fixed zoom.
  let fit = $state('width');
  let page = $state(0);
  let pageCount = $state(0);
  let searchOpen = $state(false);
  let query = $state('');
  let matchCount = $state(0);
  let matchIndex = $state(-1);
  let fontIssues = $state([]);
  let fontNoticeOpen = $state(true);
  let wakeOn = $state(readWakePreference());
  const wakeSupported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;

  let scroller = $state();
  let sizer = $state();
  let content = $state();
  let pagesBox = $state();
  let stylesBox = $state();
  let searchInput = $state();

  // Natural (unscaled) geometry, measured after rendering and whenever the content resizes.
  let geometry = { width: 1, height: 1, pageWidth: 1, tops: [0], heights: [1] };
  let search = null;
  // Current search matches; each match is a list of <mark> elements.
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

  function clampZoom(value) {
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
  }

  function measure() {
    const pages = Array.from(pagesBox.querySelectorAll('section.docx'));
    geometry = {
      width: Math.max(1, content.offsetWidth),
      height: Math.max(1, content.offsetHeight),
      pageWidth: Math.max(1, ...pages.map((element) => element.offsetWidth)),
      tops: pages.map((element) => element.offsetTop),
      heights: pages.map((element) => Math.max(1, element.offsetHeight)),
    };
    pageCount = pages.length;
  }

  // Pages are scaled as an image; the sizer gives the scroller the scaled scroll geometry.
  function applyZoom(value) {
    zoom = clampZoom(value);
    sizer.style.width = geometry.width * zoom + 'px';
    sizer.style.height = geometry.height * zoom + 'px';
    content.style.transform = `scale(${zoom})`;
  }

  // Position in natural coordinates: page index and how far into that page the view top is.
  function locate(viewportFraction = 0) {
    const y = (scroller.scrollTop - sizer.offsetTop + scroller.clientHeight * viewportFraction) / zoom;
    const { tops, heights } = geometry;
    let index = 0;
    while (index + 1 < tops.length && tops[index + 1] <= y + 1) index += 1;
    return { page: index, scrollRatio: Math.min(1, Math.max(0, (y - tops[index]) / heights[index])) };
  }

  function restore({ page: index = 0, scrollRatio = 0 }) {
    const safe = Math.min(Math.max(0, Math.trunc(index) || 0), geometry.tops.length - 1);
    const ratio = Math.min(1, Math.max(0, Number(scrollRatio) || 0));
    scroller.scrollTop = sizer.offsetTop + (geometry.tops[safe] + ratio * geometry.heights[safe]) * zoom;
    updatePage();
  }

  function keepPosition(change) {
    const position = locate();
    change();
    restore(position);
  }

  function fitZoom(mode) {
    const width = (scroller.clientWidth - 2 * GUTTER) / geometry.pageWidth;
    if (mode === 'width') return width;
    const height = (scroller.clientHeight - 2 * GUTTER) / geometry.heights[locate(0.35).page];
    return Math.min(width, height);
  }

  function setFit(mode) {
    interacted = true;
    fit = mode;
    if (mode === 'page') {
      const target = locate(0.35).page;
      applyZoom(fitZoom('page'));
      scrollToPage(target);
    } else {
      keepPosition(() => applyZoom(mode === 'width' ? fitZoom('width') : 1));
    }
    if (mode === 'actual') fit = null;
    schedulePersist();
  }

  // Zooms while keeping the content point under (clientX, clientY) in place.
  function zoomAt(value, clientX, clientY) {
    const box = scroller.getBoundingClientRect();
    const viewX = clientX - box.left;
    const viewY = clientY - box.top;
    const contentX = (scroller.scrollLeft + viewX - sizer.offsetLeft) / zoom;
    const contentY = (scroller.scrollTop + viewY - sizer.offsetTop) / zoom;
    fit = null;
    applyZoom(value);
    scroller.scrollLeft = contentX * zoom + sizer.offsetLeft - viewX;
    scroller.scrollTop = contentY * zoom + sizer.offsetTop - viewY;
    updatePage();
    schedulePersist();
  }

  function zoomBy(factor) {
    interacted = true;
    const box = scroller.getBoundingClientRect();
    zoomAt(zoom * factor, box.left + box.width / 2, box.top + box.height / 2);
  }

  function scrollToPage(index) {
    const safe = Math.min(Math.max(0, index), geometry.tops.length - 1);
    scroller.scrollTop = sizer.offsetTop + geometry.tops[safe] * zoom - GUTTER;
    updatePage();
    schedulePersist();
  }

  function stepPage(direction) {
    interacted = true;
    const { page: index, scrollRatio } = locate();
    // A page whose top is already slightly scrolled past counts as the current one.
    if (direction > 0) scrollToPage(index + 1);
    else scrollToPage(scrollRatio * geometry.heights[index] * zoom > GUTTER * 2 ? index : index - 1);
  }

  function updatePage() {
    page = locate(0.35).page;
  }

  function schedulePersist() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(persist, 700);
  }

  function persist() {
    if (!interacted || status !== 'ready' || !userId) return;
    const { page: index, scrollRatio } = locate();
    const range = scroller.scrollHeight - scroller.clientHeight;
    const percent = range > 0 ? (scroller.scrollTop / range) * 100 : 0;
    const position = { page: index, scrollRatio: Math.round(scrollRatio * 10000) / 10000, zoom: Math.round(zoom * 1000) / 1000, dark };
    if (fit) position.fit = fit;
    void saveProgress(userId, bookId, position, percent);
  }

  function toggleDark() {
    interacted = true;
    dark = !dark;
    schedulePersist();
  }

  // --- Search ---

  function openSearch() {
    chrome = true;
    searchOpen = true;
    void tick().then(() => searchInput?.focus());
  }

  function closeSearch() {
    clearTimeout(searchTimer);
    search?.clear();
    groups = [];
    searchOpen = false;
    query = '';
    matchCount = 0;
    matchIndex = -1;
  }

  function runSearch() {
    if (!search) return;
    groups = search.find(query);
    matchCount = groups.length;
    matchIndex = -1;
    if (!groups.length) return;
    // Start with the first match at or after the current view.
    const top = scroller.getBoundingClientRect().top;
    const first = groups.findIndex((group) => group[0].getBoundingClientRect().top >= top);
    showMatch(first < 0 ? 0 : first);
  }

  function showMatch(index) {
    if (!groups.length) return;
    if (matchIndex >= 0) for (const mark of groups[matchIndex] || []) mark.classList.remove('current');
    matchIndex = (index + groups.length) % groups.length;
    const group = groups[matchIndex];
    for (const mark of group) mark.classList.add('current');
    const rect = group[0].getBoundingClientRect();
    const box = scroller.getBoundingClientRect();
    scroller.scrollTop += rect.top + rect.height / 2 - (box.top + box.height / 2);
    if (rect.left < box.left + 16 || rect.right > box.right - 16) scroller.scrollLeft += rect.left + rect.width / 2 - (box.left + box.width / 2);
    updatePage();
  }

  function searchInputChanged() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      if (query.trim().length >= 2) runSearch();
      else { search?.clear(); groups = []; matchCount = 0; matchIndex = -1; }
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

  // --- Fonts ---

  function withTimeout(promise, ms) {
    return Promise.race([Promise.resolve(promise).catch(() => {}), new Promise((resolve) => setTimeout(resolve, ms))]);
  }

  async function settleFonts() {
    await withTimeout(document.fonts?.ready, 3000);
    const missing = usedFonts(pagesBox, stylesBox).filter((name) => !fontAvailable(name));
    if (!missing.length) return;
    const issues = await Promise.all(missing.map(async (name) => {
      const substitute = substituteFor(name);
      const loaded = substitute ? await aliasFont(name, substitute, stylesBox) : false;
      return { name, substitute: loaded ? substitute : null };
    }));
    const aliased = issues.filter((issue) => issue.substitute);
    if (aliased.length && document.fonts) {
      await withTimeout(Promise.all(aliased.map((issue) => document.fonts.load(`16px "${issue.name}"`, 'AaАа'))), 4000);
    }
    fontIssues = issues;
  }

  function errorText(error) {
    if (error?.statusCode || error?.status || error?.code) return friendlyLibraryError(error, 'Could not download this document. Check your connection and try again.');
    return error?.message || 'Could not open this document.';
  }

  onMount(() => {
    let alive = true;
    let contentObserver = null;
    let scrollerObserver = null;
    let scrollFrame = 0;
    let pinch = null;
    let gestureBase = null;
    let tap = null;

    const distance = (touches) => Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
    const midpoint = (touches) => ({ x: (touches[0].clientX + touches[1].clientX) / 2, y: (touches[0].clientY + touches[1].clientY) / 2 });

    // Two-finger pinch is handled by the app (the browser's page zoom is blocked).
    const touchStart = (event) => {
      interacted = true;
      if (event.touches.length === 2 && status === 'ready') {
        event.preventDefault();
        pinch = { distance: distance(event.touches), zoom };
      }
    };
    const touchMove = (event) => {
      if (!pinch || event.touches.length !== 2) return;
      event.preventDefault();
      const scale = distance(event.touches) / pinch.distance;
      const point = midpoint(event.touches);
      cancelAnimationFrame(scrollFrame);
      scrollFrame = requestAnimationFrame(() => zoomAt(pinch ? pinch.zoom * scale : zoom, point.x, point.y));
    };
    const touchEnd = (event) => {
      if (event.touches.length < 2) pinch = null;
    };
    // Trackpad pinch: ctrl + wheel in Chrome/Edge/Firefox, gesture events in Safari on macOS.
    const wheel = (event) => {
      interacted = true;
      if (!event.ctrlKey || status !== 'ready') return;
      event.preventDefault();
      zoomAt(zoom * Math.exp(-event.deltaY * 0.01), event.clientX, event.clientY);
    };
    const gestureStart = (event) => {
      event.preventDefault();
      gestureBase = zoom;
    };
    const gestureChange = (event) => {
      event.preventDefault();
      // On iPhone/iPad the touch handlers already zoom; gesture events only block page zoom there.
      if (pinch || gestureBase === null || status !== 'ready') return;
      zoomAt(gestureBase * event.scale, event.clientX, event.clientY);
    };
    const gestureEnd = (event) => {
      event.preventDefault();
      gestureBase = null;
    };
    const onScroll = () => {
      cancelAnimationFrame(scrollFrame);
      scrollFrame = requestAnimationFrame(updatePage);
      schedulePersist();
    };
    // A tap without movement toggles the toolbars; scrolling cancels the pointer, so it never toggles.
    const pointerDown = (event) => {
      interacted = true;
      tap = event.isPrimary ? { x: event.clientX, y: event.clientY } : null;
    };
    const pointerUp = (event) => {
      if (!tap || !event.isPrimary) return;
      const moved = Math.hypot(event.clientX - tap.x, event.clientY - tap.y);
      tap = null;
      if (moved > TAP_SLOP || pinch) return;
      if (event.target instanceof Element && event.target.closest('a[href]')) return;
      chrome = !chrome;
    };
    const visibility = () => {
      if (document.visibilityState === 'visible') void acquireWake();
      else void flushProgress();
    };

    scroller.addEventListener('touchstart', touchStart, { passive: false });
    scroller.addEventListener('touchmove', touchMove, { passive: false });
    scroller.addEventListener('touchend', touchEnd);
    scroller.addEventListener('touchcancel', touchEnd);
    scroller.addEventListener('wheel', wheel, { passive: false });
    scroller.addEventListener('scroll', onScroll, { passive: true });
    scroller.addEventListener('pointerdown', pointerDown);
    scroller.addEventListener('pointerup', pointerUp);
    scroller.addEventListener('pointercancel', () => { tap = null; });
    document.addEventListener('gesturestart', gestureStart);
    document.addEventListener('gesturechange', gestureChange);
    document.addEventListener('gestureend', gestureEnd);
    document.addEventListener('visibilitychange', visibility);

    (async () => {
      try {
        if (!UUID.test(bookId)) throw new Error('This document could not be found.');
        const found = await findBookById(bookId);
        if (!found) throw new Error('This document is no longer in the library.');
        if (found.kind !== 'docx') { navigate('/read/' + bookId, { replace: true }); return; }
        if (!alive) return;
        record = found;
        const serverPromise = fetchServerProgress(userId, bookId).catch(() => null);
        const bytes = await downloadObject(found.file_path);
        if (!alive) return;
        revokeUrls = await renderDocx(bytes, pagesBox, stylesBox);
        if (!alive) return;
        search = createSearch(pagesBox);
        await settleFonts();
        if (!alive) return;
        measure();

        const local = await localProgress(userId, bookId);
        const server = await Promise.race([serverPromise, new Promise((resolve) => setTimeout(() => resolve(null), SERVER_WAIT))]);
        const saved = [local, server].filter(Boolean).sort((a, b) => b.updatedAt - a.updatedAt)[0]?.position || null;
        dark = typeof saved?.dark === 'boolean' ? saved.dark : true;
        fit = saved ? (saved.fit === 'width' || saved.fit === 'page' ? saved.fit : null) : 'width';
        status = 'ready';
        await tick();
        if (!alive) return;
        // Default: fit the page width, but not larger than 150% on wide screens.
        applyZoom(fit ? Math.min(fitZoom(fit), fit === 'width' && !saved ? 1.5 : MAX_ZOOM) : Number(saved?.zoom) || 1);
        restore(saved || { page: 0, scrollRatio: 0 });

        // Late fonts or images change the natural size; keep the same place in the document.
        contentObserver = new ResizeObserver(() => {
          const before = geometry.height;
          measure();
          if (before !== geometry.height) keepPosition(() => applyZoom(zoom));
        });
        contentObserver.observe(content);
        // Rotation or window resize: refit when a fit mode is active.
        scrollerObserver = new ResizeObserver(() => {
          if (fit) keepPosition(() => applyZoom(fitZoom(fit)));
          updatePage();
        });
        scrollerObserver.observe(scroller);
        void acquireWake();
      } catch (error) {
        if (!alive) return;
        errorMessage = errorText(error);
        status = 'error';
      }
    })();

    return () => {
      alive = false;
      persist();
      clearTimeout(persistTimer);
      clearTimeout(searchTimer);
      cancelAnimationFrame(scrollFrame);
      contentObserver?.disconnect();
      scrollerObserver?.disconnect();
      document.removeEventListener('gesturestart', gestureStart);
      document.removeEventListener('gesturechange', gestureChange);
      document.removeEventListener('gestureend', gestureEnd);
      document.removeEventListener('visibilitychange', visibility);
      releaseWake();
      revokeUrls?.();
      void flushProgress();
    };
  });

  function keydown(event) {
    if (status !== 'ready' || event.defaultPrevented || event.altKey) return;
    const command = event.ctrlKey || event.metaKey;
    const key = event.key;
    if (command && key.toLowerCase() === 'f') { event.preventDefault(); openSearch(); return; }
    if (command && (key === '=' || key === '+')) { event.preventDefault(); zoomBy(1.25); return; }
    if (command && key === '-') { event.preventDefault(); zoomBy(0.8); return; }
    if (command && key === '0') { event.preventDefault(); setFit('actual'); return; }
    if (command) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('input, select, textarea')) return;
    if ((key === ' ' || key === 'Enter') && target?.closest('button, a')) return;
    interacted = true;
    if (key === 'PageDown' || (key === ' ' && !event.shiftKey)) { event.preventDefault(); stepPage(1); }
    else if (key === 'PageUp' || (key === ' ' && event.shiftKey)) { event.preventDefault(); stepPage(-1); }
    else if (key === 'Home') { event.preventDefault(); scrollToPage(0); }
    else if (key === 'End') { event.preventDefault(); scrollToPage(pageCount - 1); }
    else if (key === 'ArrowDown') { event.preventDefault(); scroller.scrollTop += 60; }
    else if (key === 'ArrowUp') { event.preventDefault(); scroller.scrollTop -= 60; }
    else if (key === 'ArrowRight') { event.preventDefault(); scroller.scrollLeft += 60; }
    else if (key === 'ArrowLeft') { event.preventDefault(); scroller.scrollLeft -= 60; }
    else if (key === '+' || key === '=') zoomBy(1.25);
    else if (key === '-') zoomBy(0.8);
    else if (key === 'Escape' && searchOpen) closeSearch();
  }
</script>

<svelte:window onkeydown={keydown} />

<main class="doc-viewer" class:light={!dark} id="main" tabindex="-1">
  <div class="doc-styles" bind:this={stylesBox} hidden></div>
  <div class="doc-scroller" bind:this={scroller}>
    <div class="doc-sizer" bind:this={sizer}>
      <div class="doc-content" class:dark bind:this={content}>
        <div bind:this={pagesBox}></div>
      </div>
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

    {#if fontIssues.length && fontNoticeOpen}
      <div class="doc-font-notice" role="status">
        <span>Fonts missing on this device: {fontIssues.map((issue) => issue.substitute ? `${issue.name} (shown with ${issue.substitute})` : issue.name).join(', ')}. Alignment may differ slightly.</span>
        <button class="icon-button" type="button" aria-label="Dismiss font notice" onclick={() => fontNoticeOpen = false}><Icon name="close" size={18} /></button>
      </div>
    {/if}

    <footer class="doc-bar doc-bottom">
      <button class="icon-button" type="button" onclick={() => stepPage(-1)} disabled={page <= 0} aria-label="Previous page" title="Previous page (Page Up)"><Icon name="chevronUp" size={20} /></button>
      <button class="icon-button" type="button" onclick={() => stepPage(1)} disabled={page >= pageCount - 1} aria-label="Next page" title="Next page (Page Down)"><Icon name="chevronDown" size={20} /></button>
      <span class="doc-spacer"></span>
      <button class="icon-button doc-zoom-step" type="button" onclick={() => zoomBy(0.8)} aria-label="Zoom out">−</button>
      <span class="doc-zoom" aria-live="polite">{zoomLabel}</span>
      <button class="icon-button doc-zoom-step" type="button" onclick={() => zoomBy(1.25)} aria-label="Zoom in">+</button>
      <button class="doc-fit" class:active={fit === 'page'} type="button" onclick={() => setFit('page')}>Fit page</button>
      <button class="doc-fit" class:active={fit === 'width'} type="button" onclick={() => setFit('width')}>Fit width</button>
      <button class="doc-fit" class:active={!fit && Math.abs(zoom - 1) < 0.005} type="button" onclick={() => setFit('actual')}>100%</button>
    </footer>
  {:else if status === 'ready'}
    <div class="doc-indicator" aria-hidden="true">{page + 1} / {pageCount}</div>
  {/if}
</main>
