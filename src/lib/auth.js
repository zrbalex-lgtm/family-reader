import { writable, get } from 'svelte/store';
import { supabase, authStorageKey } from './supabase.js';
import { usernameToEmail, usernameFromUser } from './username.js';

export const auth = writable({
  session: null, profile: null, loading: true, profileLoading: false, error: '', profileError: '',
});

let generation = 0;
let retryTimer;

export async function refreshProfile() {
  if (!supabase) return;
  const userId = get(auth).session?.user.id;
  if (!userId) return;
  const version = ++generation;
  auth.update((state) => ({ ...state, profileLoading: true, profileError: '' }));
  try {
    const { data, error } = await supabase.from('profiles').select('user_id, display_name').eq('user_id', userId).maybeSingle();
    if (error || !data) throw error || new Error('Missing profile');
    if (version !== generation) return;
    auth.update((state) => ({ ...state, profile: data, profileLoading: false }));
  } catch {
    if (version !== generation) return;
    // Offline the username is shown instead; the profile loads again when the connection returns.
    const message = navigator.onLine ? 'Your account details could not be loaded. Check your connection and try again.' : '';
    auth.update((state) => ({ ...state, profileLoading: false, profileError: message }));
  }
}

// Offline after the access token expired, supabase-js cannot refresh it and reports no session,
// although the stored session still identifies the user. Reading and local saving keep working
// with it; supabase-js replaces it with a real session once the connection returns.
function offlineSession() {
  if (navigator.onLine || !authStorageKey) return null;
  try {
    const stored = JSON.parse(localStorage.getItem(authStorageKey) || 'null');
    return stored?.user?.id && stored.refresh_token ? { ...stored, offline: true } : null;
  } catch {
    return null;
  }
}

// Called when the connection returns: lets supabase-js refresh the token and report the session.
export function reconnectAuth() {
  if (!supabase || !get(auth).session?.offline) return;
  supabase.auth.getSession().then(({ data }) => { if (data.session) acceptSession(data.session); }).catch(() => {});
}

function acceptSession(session) {
  session ||= offlineSession();
  const previousId = get(auth).session?.user.id;
  const nextId = session?.user.id;
  const changedUser = previousId !== nextId;
  if (changedUser || !session) generation += 1;
  auth.update((state) => ({
    ...state, session, loading: false, error: '',
    profile: changedUser || !session ? null : state.profile,
    profileError: changedUser || !session ? '' : state.profileError,
    profileLoading: !!session && (changedUser || state.profileLoading),
  }));
  if (session && (changedUser || !get(auth).profile)) {
    // Keep Supabase calls outside the auth callback's internal lock.
    clearTimeout(retryTimer);
    retryTimer = setTimeout(refreshProfile, 0);
  }
}

export function startAuth() {
  if (!supabase) {
    auth.update((state) => ({ ...state, loading: false }));
    return () => {};
  }
  let active = true;
  let receivedEvent = false;
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    if (!active) return;
    receivedEvent = true;
    acceptSession(session);
  });
  supabase.auth.getSession().then(({ data: result, error }) => {
    if (!active || receivedEvent) return;
    if (error && !offlineSession()) {
      auth.update((state) => ({ ...state, loading: false, error: 'Could not restore your session. Please sign in again.' }));
    } else acceptSession(result?.session || null);
  }).catch(() => {
    if (!active || receivedEvent) return;
    if (offlineSession()) acceptSession(null);
    else auth.update((state) => ({ ...state, loading: false, error: 'Could not restore your session. Please sign in again.' }));
  });
  return () => {
    active = false;
    generation += 1;
    clearTimeout(retryTimer);
    data.subscription.unsubscribe();
  };
}

export async function signIn(username, password) {
  if (!supabase) throw new Error('Family Reader has not been connected yet.');
  const email = usernameToEmail(username);
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (!error) return;
  if (error.status === 400 || error.status === 401 || error.status === 422) {
    throw new Error('Incorrect username or password. Please try again.');
  }
  if (error.status === 429) throw new Error('Too many attempts. Please wait a moment and try again.');
  throw new Error('Could not sign in. Check your connection and try again.');
}

export async function signOut() {
  // Log out this browser without ending the family's other device sessions.
  const { error } = await supabase.auth.signOut({ scope: 'local' });
  if (error) throw new Error('Could not sign out. Check your connection and try again.');
}

export async function saveDisplayName(displayName) {
  const name = displayName.trim();
  const userId = get(auth).session?.user.id;
  if (!name || name.length > 80) throw new Error('Enter a display name between 1 and 80 characters.');
  if (!userId) throw new Error('Please sign in again.');
  const { data, error } = await supabase.from('profiles')
    .upsert({ user_id: userId, display_name: name }, { onConflict: 'user_id' })
    .select('user_id, display_name').single();
  if (error) throw new Error('Could not save your name. Check your connection and try again.');
  if (get(auth).session?.user.id === userId) auth.update((state) => ({ ...state, profile: data, profileError: '' }));
}

export function displayName(state) {
  return state.profile?.display_name || usernameFromUser(state.session?.user);
}
