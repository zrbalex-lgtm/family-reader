export function repositoryBase(env) {
  const name = (env.GITHUB_REPOSITORY?.split('/')[1] || env.VITE_REPO_NAME || 'family-reader').trim();
  if (!/^[a-zA-Z0-9_.-]+$/.test(name)) throw new Error('Invalid repository name.');
  return name.endsWith('.github.io') ? '/' : `/${name}/`;
}

export function inspectConfig(env) {
  const url = env.VITE_SUPABASE_URL?.trim();
  const key = env.VITE_SUPABASE_ANON_KEY?.trim();
  if (!url || !key || /YOUR_|REPLACE_/i.test(`${url} ${key}`)) {
    return 'Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY before building or signing in.';
  }
  try {
    const parsed = new URL(url);
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash || !['', '/'].includes(parsed.pathname)) {
      return 'VITE_SUPABASE_URL must be your Supabase project URL.';
    }
    if (parsed.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) {
      return 'VITE_SUPABASE_URL must use HTTPS, except for local development.';
    }
  } catch {
    return 'VITE_SUPABASE_URL must be a valid project URL.';
  }
  // A browser key is public. Reject privileged keys before they enter a bundle.
  if (key.startsWith('sb_secret_')) return 'Use the anon key, never a secret or service_role key.';
  if (key.startsWith('sb_publishable_')) return null;
  try {
    const payload = key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(payload));
    if (claims.role !== 'anon') return 'Use the anon key, never a secret or service_role key.';
  } catch {
    return 'VITE_SUPABASE_ANON_KEY must be a valid Supabase anon key.';
  }
  return null;
}
