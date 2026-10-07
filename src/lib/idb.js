// Minimal key-value storage on IndexedDB, scoped to this Supabase project and base path.
// Falls back to memory when IndexedDB is unavailable (some private modes), so reading still works.
// progress/queue/settings: personal, keyed "<userId>:<id>".
// cache: derived or shared data (song lists, library list, covers, personal bookmark copies keyed by user).
// files/fileMeta: downloaded book files (shared family library) and their sizes/last use.
// bookmarkQueue: bookmark changes made offline, keyed "<userId>:<bookmarkId>".
const STORES = ['progress', 'queue', 'settings', 'cache', 'files', 'fileMeta', 'bookmarkQueue'];
const VERSION = 3;

let databasePromise = null;
const memory = new Map(STORES.map((name) => [name, new Map()]));

function databaseName() {
  const host = import.meta.env.VITE_SUPABASE_URL ? new URL(import.meta.env.VITE_SUPABASE_URL).host : 'local';
  return `family-reader:${host}:${import.meta.env.BASE_URL}`;
}

function openDatabase() {
  databasePromise ||= new Promise((resolve) => {
    if (!('indexedDB' in window)) { resolve(null); return; }
    let request;
    try { request = indexedDB.open(databaseName(), VERSION); } catch { resolve(null); return; }
    request.onupgradeneeded = () => {
      for (const name of STORES) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return databasePromise;
}

function run(storeName, mode, action) {
  return openDatabase().then((database) => {
    if (!database) return action(null, memory.get(storeName));
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, mode);
      const request = action(transaction.objectStore(storeName), null);
      transaction.oncomplete = () => resolve(request?.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  });
}

export function idbGet(store, key) {
  return run(store, 'readonly', (objectStore, fallback) => objectStore ? objectStore.get(key) : fallback.get(key));
}

export function idbSet(store, key, value) {
  return run(store, 'readwrite', (objectStore, fallback) => objectStore ? objectStore.put(value, key) : void fallback.set(key, value));
}

export function idbDelete(store, key) {
  return run(store, 'readwrite', (objectStore, fallback) => objectStore ? objectStore.delete(key) : void fallback.delete(key));
}

// All [key, value] pairs whose key starts with prefix (keys are "<userId>:<id>").
export async function idbEntries(store, prefix) {
  const database = await openDatabase();
  if (!database) return Array.from(memory.get(store)).filter(([key]) => key.startsWith(prefix));
  return new Promise((resolve, reject) => {
    const entries = [];
    const range = IDBKeyRange.bound(prefix, prefix + '￿');
    const request = database.transaction(store, 'readonly').objectStore(store).openCursor(range);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) { resolve(entries); return; }
      entries.push([cursor.key, cursor.value]);
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
}
