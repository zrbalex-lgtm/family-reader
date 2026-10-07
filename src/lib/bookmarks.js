import { supabase } from './supabase.js';
import { idbDelete, idbEntries, idbGet, idbSet } from './idb.js';

// Private bookmarks (RLS limits every query to the signed-in user's rows).
// Offline, changes are queued per user in IndexedDB and sent when the connection returns;
// the last list seen from the server is kept per user and book for offline reading.
const FIELDS = 'id, book_id, position, excerpt, note, created_at';

function listKey(userId, bookId) {
  return `bookmarks:${userId}:${bookId}`;
}

function queueKey(userId, id) {
  return `${userId}:${id}`;
}

// Applies queued (unsent) changes on top of a server or cached list.
async function withPending(userId, bookId, rows) {
  let list = rows;
  try {
    for (const [, change] of await idbEntries('bookmarkQueue', userId + ':')) {
      if (change.type === 'add' && change.row.book_id === bookId && !list.some((row) => row.id === change.row.id)) list = [change.row, ...list];
      if (change.type === 'delete') list = list.filter((row) => row.id !== change.id);
    }
  } catch { /* No queue available. */ }
  return list.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

export async function listBookmarks(userId, bookId) {
  try {
    if (!navigator.onLine) throw new Error('offline');
    await flushBookmarks(userId);
    const { data, error } = await supabase.from('bookmarks').select(FIELDS).eq('book_id', bookId).order('created_at', { ascending: false });
    if (error) throw error;
    void idbSet('cache', listKey(userId, bookId), data).catch(() => {});
    return withPending(userId, bookId, data);
  } catch {
    const cached = await idbGet('cache', listKey(userId, bookId)).catch(() => null);
    return withPending(userId, bookId, cached || []);
  }
}

export async function addBookmark(userId, bookId, position, excerpt, note) {
  // The id is created here, so an offline bookmark keeps it after syncing.
  const row = {
    id: crypto.randomUUID(),
    book_id: bookId,
    position: { section: position.section, paragraph: position.paragraph, charOffset: position.charOffset },
    excerpt: excerpt.slice(0, 500) || null,
    note: note.trim().slice(0, 2000) || null,
    created_at: new Date().toISOString(),
  };
  await idbSet('bookmarkQueue', queueKey(userId, row.id), { type: 'add', row });
  void flushBookmarks(userId);
  return row;
}

export async function deleteBookmark(userId, id) {
  const pending = await idbGet('bookmarkQueue', queueKey(userId, id)).catch(() => null);
  // A bookmark that never reached the server is simply forgotten.
  if (pending?.type === 'add') await idbDelete('bookmarkQueue', queueKey(userId, id));
  else await idbSet('bookmarkQueue', queueKey(userId, id), { type: 'delete', id });
  void flushBookmarks(userId);
}

let flushing = null;

// Sends queued changes. Each bookmark has at most one queued change; failures stay queued.
export function flushBookmarks(userId) {
  if (flushing) return flushing;
  flushing = (async () => {
    if (!userId || !supabase || !navigator.onLine) return;
    const entries = await idbEntries('bookmarkQueue', userId + ':').catch(() => []);
    for (const [key, change] of entries) {
      try {
        if (change.type === 'add') {
          // Keeps the offline creation time; repeating the insert after a lost response is harmless.
          const { error } = await supabase.from('bookmarks').upsert(change.row, { onConflict: 'id', ignoreDuplicates: true });
          // A deleted book can never receive the bookmark; drop it.
          if (error && error.code !== '23503') continue;
        } else {
          const { error } = await supabase.from('bookmarks').delete().eq('id', change.id);
          if (error) continue;
        }
        await idbDelete('bookmarkQueue', key);
      } catch {
        // Network error: keep the change for later.
      }
    }
  })().finally(() => { flushing = null; });
  return flushing;
}
