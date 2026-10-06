import { writable } from 'svelte/store';
import { supabase } from './supabase.js';
import { idbDelete, idbEntries, idbGet, idbSet } from './idb.js';
import { deviceLabel } from './device.js';

// Reading progress: every move is written to IndexedDB and a per-user queue first,
// then pushed to Supabase after a short pause or when the page is hidden.
const PUSH_DELAY = 3000;

// bookId -> { percent, position, updatedAt, deviceLabel } for the signed-in user.
export const progress = writable(new Map());

let userId = null;
let pushTimer = 0;
let flushing = null;

function key(owner, bookId) { return owner + ':' + bookId; }
function bookIdOf(entryKey) { return entryKey.slice(entryKey.indexOf(':') + 1); }

function mergeIntoStore(bookId, entry) {
  progress.update((map) => {
    const current = map.get(bookId);
    if (current && current.updatedAt >= entry.updatedAt) return map;
    const next = new Map(map);
    next.set(bookId, entry);
    return next;
  });
}

export function setSyncUser(nextUser) {
  if (userId === nextUser) return;
  clearTimeout(pushTimer);
  userId = nextUser;
  progress.set(new Map());
  // Auth subscriptions must not start Supabase calls while the Auth lock is held.
  if (nextUser) setTimeout(() => { if (userId === nextUser) void loadLocalProgress().then(() => flushProgress()); }, 0);
}

async function loadLocalProgress() {
  const owner = userId;
  try {
    const entries = await idbEntries('progress', owner + ':');
    if (owner !== userId) return;
    for (const [entryKey, entry] of entries) mergeIntoStore(bookIdOf(entryKey), entry);
  } catch { /* Local storage unavailable: server progress still loads. */ }
}

export async function localProgress(owner, bookId) {
  try { return (await idbGet('progress', key(owner, bookId))) || null; } catch { return null; }
}

// Called on every user-initiated move (page turn, jump). Never on open or relayout.
export async function saveProgress(owner, bookId, position, percent) {
  if (!owner || owner !== userId) return;
  const entry = {
    position: { section: position.section, paragraph: position.paragraph, charOffset: position.charOffset },
    percent: Math.round(Math.min(100, Math.max(0, percent)) * 100) / 100,
    updatedAt: Date.now(),
    deviceLabel: deviceLabel(),
  };
  mergeIntoStore(bookId, entry);
  try {
    // The queue is written before any network attempt, so a closed tab loses nothing.
    await idbSet('progress', key(owner, bookId), entry);
    await idbSet('queue', key(owner, bookId), entry);
  } catch { /* Keep going: the in-memory store still has the position. */ }
  schedulePush();
}

function schedulePush() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => void flushProgress(), PUSH_DELAY);
}

// Writes one entry without letting an older write replace a newer one from another device.
async function pushEntry(owner, bookId, entry) {
  const updatedAt = new Date(entry.updatedAt).toISOString();
  const fields = { position: entry.position, percent: entry.percent, device_label: entry.deviceLabel, updated_at: updatedAt };
  const { data, error } = await supabase.from('reading_progress').update(fields)
    .eq('user_id', owner).eq('book_id', bookId).lt('updated_at', updatedAt).select('book_id');
  if (error) throw error;
  if (data.length) return;
  // Nothing updated: either no row yet, or the server already has something newer.
  const { error: insertError } = await supabase.from('reading_progress')
    .upsert({ user_id: owner, book_id: bookId, ...fields }, { onConflict: 'user_id,book_id', ignoreDuplicates: true });
  if (insertError) throw insertError;
}

export function flushProgress() {
  if (flushing) return flushing;
  flushing = (async () => {
    clearTimeout(pushTimer);
    const owner = userId;
    if (!owner || !supabase || !navigator.onLine) return;
    let entries = [];
    try { entries = await idbEntries('queue', owner + ':'); } catch { return; }
    for (const [entryKey, entry] of entries) {
      if (owner !== userId) return;
      const bookId = bookIdOf(entryKey);
      try {
        await pushEntry(owner, bookId, entry);
      } catch (error) {
        // A deleted book can never be synced; drop it. Other failures stay queued for retry.
        if (error?.code !== '23503') continue;
      }
      // Remove the entry only if no newer move was queued meanwhile.
      const latest = await idbGet('queue', entryKey).catch(() => null);
      if (latest?.updatedAt === entry.updatedAt) await idbDelete('queue', entryKey).catch(() => {});
    }
  })().finally(() => { flushing = null; });
  return flushing;
}

export async function fetchServerProgress(owner, bookId) {
  if (!supabase) return null;
  const { data, error } = await supabase.from('reading_progress')
    .select('position, percent, device_label, updated_at').eq('user_id', owner).eq('book_id', bookId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    position: data.position,
    percent: Number(data.percent),
    deviceLabel: data.device_label || 'another device',
    updatedAt: Date.parse(data.updated_at),
  };
}

// Server progress for the library (Continue reading and badges), merged with newer local entries.
export async function refreshProgress() {
  const owner = userId;
  if (!owner || !supabase) return;
  await loadLocalProgress();
  try {
    const { data, error } = await supabase.from('reading_progress')
      .select('book_id, position, percent, device_label, updated_at').eq('user_id', owner)
      .order('updated_at', { ascending: false }).limit(1000);
    if (error || owner !== userId) return;
    for (const row of data) {
      mergeIntoStore(row.book_id, {
        position: row.position, percent: Number(row.percent),
        deviceLabel: row.device_label || 'another device', updatedAt: Date.parse(row.updated_at),
      });
    }
  } catch { /* Offline: local progress is shown. */ }
}

// Best-effort flush when the page is hidden, closed or comes back online.
export function startProgressSync() {
  const onVisibility = () => { if (document.visibilityState === 'hidden') void flushProgress(); };
  const onFlush = () => void flushProgress();
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onFlush);
  window.addEventListener('online', onFlush);
  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', onFlush);
    window.removeEventListener('online', onFlush);
  };
}
