<script>
  import Icon from '../components/Icon.svelte';
  import { auth, saveDisplayName, signOut } from '../lib/auth.js';
  import { usernameFromUser } from '../lib/username.js';
  import { loadReaderSettings, resetReaderSettings, currentDeviceClass } from '../lib/reader-settings.js';
  import { offlineFiles, offlineUsage, refreshOfflineIndex, clearOfflineFiles, OFFLINE_LIMIT } from '../lib/offline.js';
  import { formatBytes } from '../lib/files.js';

  let name = $state('');
  let saving = $state(false);
  let signingOut = $state(false);
  let error = $state('');
  let saved = $state(false);
  let readerReset = $state(false);
  let clearing = $state(false);
  const usage = $derived(offlineUsage($offlineFiles));
  $effect(() => { void refreshOfflineIndex(); });

  async function clearDownloads() {
    clearing = true;
    try { await clearOfflineFiles(); } finally { clearing = false; }
  }
  $effect(() => { void loadReaderSettings($auth.session?.user.id); });
  $effect(() => { name = $auth.profile?.display_name || usernameFromUser($auth.session?.user); });

  async function save(event) {
    event.preventDefault();
    error = '';
    saved = false;
    saving = true;
    try { await saveDisplayName(name); saved = true; }
    catch (problem) { error = problem.message; }
    finally { saving = false; }
  }

  async function logout() {
    error = '';
    signingOut = true;
    try { await signOut(); }
    catch (problem) { error = problem.message; }
    finally { signingOut = false; }
  }
</script>

<main class="content settings-content" id="main" tabindex="-1">
  <a href="#/library" class="back-link"><Icon name="back" size={18} /> Library</a>
  <div class="page-heading"><span class="eyebrow">MAKE YOURSELF AT HOME</span><h1>Settings</h1></div>
  <section class="settings-card" aria-labelledby="account-title">
    <h2 id="account-title">Your account</h2>
    <div class="account-line"><span class="muted">Username</span><span>{usernameFromUser($auth.session?.user)}</span></div>
    <form onsubmit={save} aria-busy={saving}>
      <div class="field">
        <label for="display-name">Display name</label>
        <input id="display-name" name="display-name" bind:value={name} oninput={() => saved = false} autocomplete="nickname" required maxlength="80" disabled={saving || signingOut || $auth.profileLoading} />
        <p class="field-hint">The name you see in Family Reader.</p>
      </div>
      <div class="save-row"><button class="button primary" type="submit" disabled={saving || signingOut || $auth.profileLoading}>{saving ? 'Saving…' : 'Save name'}</button>
        {#if saved}<span class="success" role="status"><Icon name="check" size={17} /> Saved</span>{/if}
      </div>
    </form>
    {#if error}<p class="alert error" role="alert">{error}</p>{/if}
  </section>
  <section class="settings-card signout-card" aria-labelledby="offline-title">
    <div><h2 id="offline-title">Offline storage</h2><p class="muted">{usage.count} {usage.count === 1 ? 'file' : 'files'} downloaded on this device · {formatBytes(usage.bytes)} of {formatBytes(OFFLINE_LIMIT)}. Opened books and songbooks are kept automatically; the least recently opened are removed when the limit is reached. Reading progress and bookmarks are not affected.</p></div>
    <button class="button secondary" type="button" onclick={clearDownloads} disabled={clearing || !usage.count}>{clearing ? 'Clearing…' : 'Clear downloads'}</button>
  </section>
  <section class="settings-card signout-card" aria-labelledby="reader-title">
    <div><h2 id="reader-title">Reader</h2><p class="muted">Fonts, size, spacing and theme are changed inside a book with the Aa button. They are saved separately for each device type; this device is a {currentDeviceClass()}.</p></div>
    <button class="button secondary" type="button" onclick={() => { resetReaderSettings(); readerReset = true; }}>{readerReset ? 'Reset done' : 'Reset reader settings'}</button>
  </section>
  <section class="settings-card signout-card" aria-labelledby="signout-title">
    <div><h2 id="signout-title">Sign out</h2><p class="muted">Sign out on this device.</p></div>
    <button class="button secondary" onclick={logout} disabled={signingOut || saving}><Icon name="logout" size={18} /> {signingOut ? 'Signing out…' : 'Sign out'}</button>
  </section>
</main>
