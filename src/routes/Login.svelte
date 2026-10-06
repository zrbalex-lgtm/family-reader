<script>
  import Brand from '../components/Brand.svelte';
  import Icon from '../components/Icon.svelte';
  import { signIn, auth } from '../lib/auth.js';
  import { navigate } from '../lib/router.js';

  let username = $state('');
  let password = $state('');
  let showPassword = $state(false);
  let busy = $state(false);
  let error = $state('');

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    busy = true;
    error = '';
    try {
      await signIn(username, password);
      password = '';
      navigate('/library', { replace: true });
    } catch (problem) {
      error = problem.message || 'Could not sign in. Please try again.';
    } finally {
      busy = false;
    }
  }
</script>

<main class="auth-layout" id="main" tabindex="-1">
  <div class="auth-top"><Brand /></div>
  <section class="login-card" aria-labelledby="login-title">
    <span class="eyebrow">A LITTLE SPACE FOR YOUR STORIES</span>
    <h1 id="login-title">Welcome home.</h1>
    <p class="muted login-intro">Sign in to your family library.</p>
    <form onsubmit={submit} aria-busy={busy}>
      <div class="field">
        <label for="username">Username</label>
        <input id="username" name="username" bind:value={username} autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="Your username" required maxlength="32" disabled={busy} />
      </div>
      <div class="field">
        <label for="password">Password</label>
        <div class="password-input">
          <input id="password" name="password" type={showPassword ? 'text' : 'password'} bind:value={password} autocomplete="current-password" placeholder="Your password" required disabled={busy} />
          <button type="button" class="icon-button password-toggle" onclick={() => showPassword = !showPassword} aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} disabled={busy}>
            <Icon name={showPassword ? 'eyeOff' : 'eye'} size={20} />
          </button>
        </div>
      </div>
      {#if error || $auth.error}<p class="alert error" role="alert">{error || $auth.error}</p>{/if}
      <button class="button primary full-width" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
    </form>
    <p class="account-hint">Need an account or a new password?<br />Ask the person who manages your family library.</p>
  </section>
  <p class="auth-footer"><Icon name="lock" size={15} /> Just for your family</p>
</main>
