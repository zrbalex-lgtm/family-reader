<script>
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { auth, startAuth, displayName, refreshProfile, reconnectAuth } from './lib/auth.js';
  import { configurationError } from './lib/supabase.js';
  import { route, startRouter, navigate } from './lib/router.js';
  import Brand from './components/Brand.svelte';
  import Icon from './components/Icon.svelte';
  import Login from './routes/Login.svelte';
  import Library from './routes/Library.svelte';
  import Settings from './routes/Settings.svelte';
  import Reader from './routes/Reader.svelte';
  import DocViewer from './routes/DocViewer.svelte';
  import { setLibraryUser, uploads } from './lib/library.js';
  import { setSyncUser, startProgressSync } from './lib/sync.js';
  import { flushBookmarks } from './lib/bookmarks.js';
  import { updateReady, applyUpdate } from './lib/pwa.js';

  // The Home Screen app always starts at the library (manifest start_url), and iOS does not
  // restore the page that was open. The open book is remembered per user and reopened on launch.
  const RESUME_KEY = 'family-reader:resume:';
  // The page the app was launched with, before any redirect.
  const launchPath = window.location.hash.slice(1).split('?')[0] || '/library';
  let launchChecked = false;

  let online = $state(navigator.onLine);
  const name = $derived(displayName($auth));
  const initials = $derived([...name][0]?.toUpperCase() || 'R');
  const readingId = $derived($route.startsWith('/read/') ? decodeURIComponent($route.slice('/read/'.length)) : '');
  const viewingId = $derived($route.startsWith('/view/') ? decodeURIComponent($route.slice('/view/'.length)) : '');
  const pageTitle = $derived(!$auth.session ? 'Sign in' : readingId ? 'Reading' : viewingId ? 'Document' : $route === '/settings' ? 'Settings' : 'Library');

  onMount(() => {
    const stopRouter = startRouter();
    const stopAuth = startAuth();
    const stopSync = startProgressSync();
    const updateOnline = () => {
      online = navigator.onLine;
      // Send bookmark changes made offline.
      if (online) {
        reconnectAuth();
        void flushBookmarks(get(auth).session?.user.id);
        if (!get(auth).profile) void refreshProfile();
      }
    };
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    return () => {
      stopRouter(); stopAuth(); stopSync();
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
    };
  });

  $effect(() => {
    if ($auth.loading || configurationError) return;
    if (!$auth.session && $route !== '/login') navigate('/login', { replace: true });
    if ($auth.session && $route === '/login') navigate('/library', { replace: true });
  });

  // Reopen the book that was open when the app was closed; forget it once the user leaves the book.
  $effect(() => {
    if ($auth.loading || !$auth.session) return;
    const key = RESUME_KEY + $auth.session.user.id;
    const reading = readingId || viewingId;
    const path = $route;
    if (!launchChecked) {
      launchChecked = true;
      let saved = null;
      try { saved = localStorage.getItem(key); } catch { /* Storage unavailable: start at the library. */ }
      if (launchPath === '/library' && !reading && saved && /^\/(read|view)\/[0-9a-f-]{36}$/i.test(saved)) {
        navigate(saved, { replace: true });
        return;
      }
    }
    try {
      if (reading) localStorage.setItem(key, path);
      else if (path !== '/login') localStorage.removeItem(key);
    } catch { /* Storage unavailable. */ }
  });

  $effect(() => {
    setLibraryUser($auth.session?.user.id || null);
    setSyncUser($auth.session?.user.id || null);
    if ($auth.session) setTimeout(() => void flushBookmarks($auth.session?.user.id), 0);
  });
</script>

<svelte:window onbeforeunload={(event) => {
  if ($uploads.some((row) => ['queued', 'processing'].includes(row.status))) {
    event.preventDefault();
    event.returnValue = '';
  }
}} />

<svelte:head><title>{pageTitle} · Family Reader</title></svelte:head>

<a class="skip-link" href="#main" onclick={(event) => { event.preventDefault(); document.getElementById('main')?.focus(); }}>Skip to content</a>
{#if configurationError}
  <main class="setup-screen" id="main" tabindex="-1">
    <Brand />
    <section class="settings-card"><span class="eyebrow">ONE-TIME SETUP</span><h1>Connect your library.</h1><p class="muted">The app needs your Supabase project details before anyone can sign in.</p><p class="alert">{configurationError}</p><p class="muted">Follow the README setup guide, then restart the development server or rebuild the app.</p></section>
  </main>
{:else if $auth.loading}
  <main class="loading-screen" id="main" tabindex="-1"><Brand /><p class="muted" role="status">Opening your library…</p></main>
{:else if !$auth.session}
  <Login />
{:else if readingId}
  {#key readingId + ':' + $auth.session.user.id}<Reader bookId={readingId} />{/key}
{:else if viewingId}
  {#key viewingId + ':' + $auth.session.user.id}<DocViewer bookId={viewingId} />{/key}
{:else}
  <!-- The library has its own compact header. -->
  {#if $route !== '/library'}<header class="app-header">
    <a class="brand-link" href="#/library" aria-label="Family Reader library"><Brand /></a>
    <nav aria-label="Main navigation"><a href="#/library" class:current={$route === '/library'} aria-current={$route === '/library' ? 'page' : undefined} class="library-link">Library</a><a class="account-link" class:current={$route === '/settings'} href="#/settings" aria-label={`Settings for ${name}`} aria-current={$route === '/settings' ? 'page' : undefined}><span class="avatar">{initials}</span><span class="account-name">{name}</span><Icon name="settings" size={19} /></a></nav>
  </header>{/if}
  {#if !online}<p class="connection-banner" role="status">You’re offline. Library and account changes need a connection.</p>{/if}
  {#if $auth.profileError}<div class="connection-banner error" role="alert"><span>{$auth.profileError}</span><button class="text-button" onclick={refreshProfile} disabled={$auth.profileLoading}>{$auth.profileLoading ? 'Retrying…' : 'Try again'}</button></div>{/if}
  {#if $route === '/library'}{#key $auth.session.user.id}<Library />{/key}
  {:else if $route === '/settings'}<Settings />
  {:else}<main class="content" id="main" tabindex="-1"><h1>Page not found</h1><a class="button secondary" href="#/library">Back to library</a></main>{/if}
{/if}

<!-- A new version was downloaded; it is applied only when the user chooses (never mid-reading). -->
{#if $updateReady && !readingId && !viewingId}
  <div class="update-toast" role="status"><span>A new version is available.</span><button class="button primary" type="button" onclick={applyUpdate}>Reload</button></div>
{/if}
