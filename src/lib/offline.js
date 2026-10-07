import { writable, get } from 'svelte/store';
import { idbDelete, idbEntries, idbGet, idbSet } from './idb.js';
import { downloadObject, findBookById } from './library-api.js';

// Downloaded book files for offline reading. Storage paths are immutable (a new upload gets a
// new path), so a cached copy never goes stale. The family library is shared, so files are not
// stored per user; personal data (progress, bookmarks, settings) always is.
export const OFFLINE_LIMIT = 400 * 1024 * 1024;
const LIBRARY_KEY = 'library:list';

// path -> { size, bookId, title, openedAt, savedAt }
export const offlineFiles = writable(new Map());

let persistAsked = false;

export async function refreshOfflineIndex() {
  try {
    offlineFiles.set(new Map(await idbEntries('fileMeta', '')));
  } catch {
    offlineFiles.set(new Map());
  }
}

export function offlineUsage(index = get(offlineFiles)) {
  let bytes = 0;
  for (const meta of index.values()) bytes += meta.size || 0;
  return { bytes, count: index.size };
}

// Asks the browser not to evict our storage under pressure (ignored where unsupported).
function askPersistence() {
  if (persistAsked) return;
  persistAsked = true;
  void navigator.storage?.persist?.().catch(() => {});
}

// Removes least recently opened files until the cache fits the limit.
async function prune(keepPath) {
  const entries = (await idbEntries('fileMeta', '')).sort((a, b) => (a[1].openedAt || 0) - (b[1].openedAt || 0));
  let total = entries.reduce((sum, [, meta]) => sum + (meta.size || 0), 0);
  for (const [path, meta] of entries) {
    if (total <= OFFLINE_LIMIT) break;
    if (path === keepPath) continue;
    await idbDelete('files', path);
    await idbDelete('fileMeta', path);
    total -= meta.size || 0;
  }
}

export async function saveOfflineFile(book, bytes) {
  const now = Date.now();
  try {
    await idbSet('files', book.file_path, bytes);
    await idbSet('fileMeta', book.file_path, { size: bytes.byteLength, bookId: book.id, title: book.title, openedAt: now, savedAt: now });
    askPersistence();
    await prune(book.file_path);
  } catch {
    // Storage full or unavailable: reading still works online.
  }
  await refreshOfflineIndex();
}

export async function removeOfflineFile(path) {
  try {
    await idbDelete('files', path);
    await idbDelete('fileMeta', path);
  } catch { /* Already gone. */ }
  await refreshOfflineIndex();
}

export async function clearOfflineFiles() {
  for (const [path] of await idbEntries('fileMeta', '').catch(() => [])) await removeOfflineFile(path);
  await refreshOfflineIndex();
}

/**
 * Returns the book's bytes: the downloaded copy if there is one (works offline), otherwise
 * downloads it and keeps a copy for offline reading.
 */
export async function openBookBytes(book) {
  try {
    const cached = await idbGet('files', book.file_path);
    if (cached) {
      const meta = await idbGet('fileMeta', book.file_path);
      if (meta) void idbSet('fileMeta', book.file_path, { ...meta, openedAt: Date.now() }).catch(() => {});
      return cached;
    }
  } catch { /* Fall back to the network. */ }
  if (!navigator.onLine) throw new Error('This book is not downloaded on this device. Connect to the internet to open it.');
  const bytes = await downloadObject(book.file_path);
  void saveOfflineFile(book, bytes);
  return bytes;
}

export async function downloadForOffline(book) {
  const bytes = await downloadObject(book.file_path);
  await saveOfflineFile(book, bytes);
}

// --- Library list (shared) ---

export async function cachedLibrary() {
  try { return (await idbGet('cache', LIBRARY_KEY)) || null; } catch { return null; }
}

// Saves the list and forgets downloaded files and covers of books that were deleted.
export async function rememberLibrary(books) {
  try {
    await idbSet('cache', LIBRARY_KEY, books);
    const paths = new Set(books.map((book) => book.file_path));
    for (const [path] of await idbEntries('fileMeta', '')) if (!paths.has(path)) await removeOfflineFile(path);
    const covers = new Set(books.map((book) => book.cover_path).filter(Boolean));
    for (const [key] of await idbEntries('cache', 'cover:')) if (!covers.has(key.slice(6))) await idbDelete('cache', key);
  } catch { /* Cache is best effort. */ }
}

// Book record from the server, or from the saved library list when offline.
export async function findBook(id) {
  try {
    return await findBookById(id);
  } catch (error) {
    const books = await cachedLibrary();
    const found = books?.find((book) => book.id === id);
    if (found) return found;
    throw error;
  }
}

// --- Covers (shared) ---

export async function cachedCover(path) {
  try { return (await idbGet('cache', 'cover:' + path)) || null; } catch { return null; }
}

export function rememberCover(path, blob) {
  void idbSet('cache', 'cover:' + path, blob).catch(() => {});
}
