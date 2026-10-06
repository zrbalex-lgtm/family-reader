<script>
  import { onMount } from 'svelte';
  import { auth, startAuth, displayName, refreshProfile } from './lib/auth.js';
  import { configurationError } from './lib/supabase.js';
  import { route, startRouter, navigate } from './lib/router.js';
  import Brand from './components/Brand.svelte';
  import Icon from './components/Icon.svelte';
  import Login from './routes/Login.svelte';
  import Library from './routes/Library.svelte';
  import Settings from './routes/Settings.svelte';
  import Reader from './routes/Reader.svelte';
  import { setLibraryUser, uploads } from './lib/library.js';

  let online = $state(navigator.onLine);
  const name = $derived(displayName($auth));
  const initials = $derived([...name][0]?.toUpperCase() || 'R');
  const readingId = $derived($route.startsWith('/read/') ? decodeURIComponent($route.slice('/read/'.length)) : '');
  const pageTitle = $derived(!$auth.session ? 'Sign in' : readingId ? 'Reading' : $route === '/settings' ? 'Settings' : 'Library');

  onMount(() => {
    const stopRouter = startRouter();
    const stopAuth = startAuth();
    const updateOnline = () => { online = navigator.onLine; };
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    return () => {
      stopRouter(); stopAuth();
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
    };
  });

  $effect(() => {
    if ($auth.loading || configurationError) return;
    if (!$auth.session && $route !== '/login') navigate('/login', { replace: true });
    if ($auth.session && $route === '/login') navigate('/library', { replace: true });
  });

  $effect(() => { setLibraryUser($auth.session?.user.id || null); });
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
{:else}
  <header class="app-header">
    <a class="brand-link" href="#/library" aria-label="Family Reader library"><Brand /></a>
    <nav aria-label="Main navigation"><a href="#/library" class:current={$route === '/library'} aria-current={$route === '/library' ? 'page' : undefined} class="library-link">Library</a><a class="account-link" class:current={$route === '/settings'} href="#/settings" aria-label={`Settings for ${name}`} aria-current={$route === '/settings' ? 'page' : undefined}><span class="avatar">{initials}</span><span class="account-name">{name}</span><Icon name="settings" size={19} /></a></nav>
  </header>
  {#if !online}<p class="connection-banner" role="status">You’re offline. Library and account changes need a connection.</p>{/if}
  {#if $auth.profileError}<div class="connection-banner error" role="alert"><span>{$auth.profileError}</span><button class="text-button" onclick={refreshProfile} disabled={$auth.profileLoading}>{$auth.profileLoading ? 'Retrying…' : 'Try again'}</button></div>{/if}
  {#if $route === '/library'}{#key $auth.session.user.id}<Library />{/key}
  {:else if $route === '/settings'}<Settings />
  {:else}<main class="content" id="main" tabindex="-1"><h1>Page not found</h1><a class="button secondary" href="#/library">Back to library</a></main>{/if}
{/if}
