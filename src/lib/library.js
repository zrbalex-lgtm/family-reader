import { get, writable } from 'svelte/store';
import { supabase } from './supabase.js';
import { validateFile } from './files.js';
import { createCleanupJournal, cleanupUnreferencedFiles } from './cleanup.js';
import { listBooks, findBookByHash, findBookById, insertBook, deleteBookRow, uploadObject, friendlyLibraryError } from './library-api.js';

export const library = writable({ books: [], loading: false, error: '', cleanupPending: 0, cleanupMessage: '', cleaning: false });
export const uploads = writable([]);
let userId = null;
let generation = 0;
let fetchController;
let uploadController;
let deleteController;
let cleanupController;
let journal = null;
let workerGeneration = -1;
let cleanupTimer;
let cleaningGeneration = -1;
const activeOperations = new Set();

function updateRow(id, changes) {
  uploads.update((rows) => rows.map((row) => row.id === id ? { ...row, ...changes } : row));
}

function assertCurrent(owner, version, signal) {
  if (userId !== owner || generation !== version || signal?.aborted) throw new DOMException('Operation cancelled.', 'AbortError');
}

export function setLibraryUser(nextUser) {
  if (userId === nextUser) return;
  generation += 1;
  fetchController?.abort();
  uploadController?.abort();
  deleteController?.abort();
  cleanupController?.abort();
  clearTimeout(cleanupTimer);
  activeOperations.clear();
  userId = nextUser;
  journal = null;
  uploads.set([]);
  library.set({ books: [], loading: !!nextUser, error: '', cleanupPending: 0, cleanupMessage: '', cleaning: false });
  if (!nextUser || !supabase) return;
  const version = generation;
  // Auth subscriptions must not start Supabase calls while the Auth lock is held.
  setTimeout(() => {
    if (version !== generation) return;
    try {
      const scope = new URL(import.meta.env.VITE_SUPABASE_URL).host + ':' + import.meta.env.BASE_URL + ':' + nextUser;
      journal = createCleanupJournal(localStorage, 'family-reader:cleanup:' + scope);
      journal.read();
    } catch (error) {
      library.update((state) => ({ ...state, cleanupMessage: error.message }));
    }
    void refreshLibrary();
    void retryCleanup();
  }, 0);
}

export async function refreshLibrary() {
  if (!userId) return;
  const version = generation;
  fetchController?.abort();
  const controller = new AbortController();
  fetchController = controller;
  const timeout = setTimeout(() => controller.abort(), 30000);
  library.update((state) => ({ ...state, loading: true, error: '' }));
  try {
    const books = await listBooks(controller.signal);
    if (version === generation && fetchController === controller) {
      library.update((state) => ({ ...state, books, loading: false }));
    }
  } catch (error) {
    if (version === generation && fetchController === controller) {
      library.update((state) => ({ ...state, loading: false, error: friendlyLibraryError(error, 'Could not load the library. Check your connection and try again.') }));
    }
  } finally { clearTimeout(timeout); }
}

function cleanupState() {
  if (!journal) return [];
  const tasks = journal.read().filter((task) => !activeOperations.has(task.id));
  library.update((state) => ({ ...state, cleanupPending: tasks.length }));
  return tasks;
}

function scheduleCleanup(tasks) {
  clearTimeout(cleanupTimer);
  if (!tasks.length || !userId) return;
  const earliest = Math.min(...tasks.map((task) => task.notBefore));
  cleanupTimer = setTimeout(() => void retryCleanup(), Math.max(30000, earliest - Date.now()));
}

export async function retryCleanup() {
  if (!userId || !journal || cleaningGeneration === generation) return;
  const version = generation;
  const owner = userId;
  const currentJournal = journal;
  cleaningGeneration = version;
  const controller = new AbortController();
  cleanupController = controller;
  const timeout = setTimeout(() => controller.abort(), 30000);
  library.update((state) => ({ ...state, cleaning: true, cleanupMessage: '' }));
  try {
    const tasks = cleanupState();
    if (!navigator.onLine) return;
    for (const task of tasks) {
      if (task.notBefore > Date.now()) continue;
      assertCurrent(owner, version, controller.signal);
      await cleanupUnreferencedFiles(supabase, task, controller.signal);
      assertCurrent(owner, version, controller.signal);
      currentJournal.remove(task.id);
    }
  } catch {
    if (version === generation) library.update((state) => ({ ...state, cleanupMessage: 'Some files are waiting to be cleaned up. We’ll retry when the connection is available.' }));
  } finally {
    clearTimeout(timeout);
    if (version === generation) {
      cleaningGeneration = -1;
      library.update((state) => ({ ...state, cleaning: false }));
      try { scheduleCleanup(cleanupState()); } catch { /* Keep the existing recovery message. */ }
    }
  }
}

export function enqueueFiles(files) {
  if (!userId) return;
  const rows = Array.from(files).map((file) => {
    let error = '';
    try { validateFile(file); } catch (problem) { error = problem.message; }
    return { id: crypto.randomUUID(), file: error ? null : file, name: file.name, status: error ? 'failed' : 'queued', message: error || 'Waiting…', percent: null, warnings: [] };
  });
  uploads.update((existing) => [...existing, ...rows]);
  void runQueue();
}

export function retryUpload(id) {
  const row = get(uploads).find((entry) => entry.id === id);
  if (!row?.file || row.status !== 'failed') return;
  updateRow(id, { status: 'queued', message: 'Waiting…', percent: null, warnings: [] });
  void runQueue();
}

export function dismissUpload(id) {
  uploads.update((rows) => rows.filter((row) => row.id !== id || ['queued', 'processing'].includes(row.status)));
}

export function clearFinishedUploads() {
  uploads.update((rows) => rows.filter((row) => ['queued', 'processing', 'failed'].includes(row.status)));
}

function addBook(book) {
  library.update((state) => ({ ...state, books: [book, ...state.books.filter((entry) => entry.id !== book.id)] }));
}

async function runQueue() {
  if (!userId || workerGeneration === generation) return;
  const version = generation;
  const owner = userId;
  workerGeneration = version;
  try {
    while (version === generation && userId) {
      const row = get(uploads).find((entry) => entry.status === 'queued');
      if (!row) break;
      const controller = new AbortController();
      uploadController = controller;
      // Bound each operation before the cross-tab cleanup grace period expires.
      const timeout = setTimeout(() => controller.abort(), 180000);
      const bookId = crypto.randomUUID();
      const currentJournal = journal;
      updateRow(row.id, { status: 'processing', message: 'Reading file…', percent: null });
      try {
        if (!currentJournal) throw new Error('Browser storage is unavailable. Enable it and reload before uploading.');
        const { prepareUpload } = await import('./prepare-upload.js');
        const prepared = await prepareUpload(row.file, (message) => {
          if (version === generation) updateRow(row.id, { message });
        });
        assertCurrent(owner, version, controller.signal);
        const existing = await findBookByHash(prepared.hash, controller.signal);
        assertCurrent(owner, version, controller.signal);
        if (existing) {
          addBook(existing);
          updateRow(row.id, { status: 'duplicate', message: 'Already in library', title: existing.title, file: null, percent: 100 });
          continue;
        }
        const filePath = 'books/' + bookId + '/source.' + prepared.extension;
        const coverPath = prepared.cover ? 'books/' + bookId + '/cover.jpg' : null;
        const paths = [filePath, coverPath].filter(Boolean);
        currentJournal.add('upload', bookId, paths);
        activeOperations.add(bookId);
        const total = row.file.size + (prepared.cover?.size || 0);
        updateRow(row.id, { title: prepared.metadata.title, warnings: prepared.warnings, message: 'Uploading file…', percent: 0 });
        await uploadObject(filePath, row.file, (ratio) => {
          if (version === generation) updateRow(row.id, { percent: Math.min(100, Math.round(ratio * row.file.size / total * 100)) });
        }, controller.signal);
        assertCurrent(owner, version, controller.signal);
        if (coverPath) {
          updateRow(row.id, { message: 'Uploading cover…' });
          await uploadObject(coverPath, prepared.cover, (ratio) => {
            if (version === generation) updateRow(row.id, { percent: Math.min(100, Math.round((row.file.size + ratio * prepared.cover.size) / total * 100)) });
          }, controller.signal);
          assertCurrent(owner, version, controller.signal);
        }
        updateRow(row.id, { message: 'Adding to library…', percent: 100 });
        let book;
        try {
          book = await insertBook({
            ...prepared.metadata, id: bookId, kind: prepared.kind, file_path: filePath,
            cover_path: coverPath, file_hash: prepared.hash, size_bytes: row.file.size, uploaded_by: owner,
          }, controller.signal);
        } catch (error) {
          assertCurrent(owner, version, controller.signal);
          if (error.code === '23505') {
            const duplicate = await findBookByHash(prepared.hash, controller.signal);
            assertCurrent(owner, version, controller.signal);
            if (duplicate) {
              addBook(duplicate);
              updateRow(row.id, { status: 'duplicate', message: 'Already in library', file: null, percent: 100 });
              // Both uploads have completed and the database rejected our row.
              try {
                await cleanupUnreferencedFiles(supabase, { paths }, controller.signal);
                currentJournal.remove(bookId);
              } catch { /* The durable journal will retry cleanup. */ }
              continue;
            }
          }
          // A response may have been lost after a successful commit.
          book = await findBookById(bookId, controller.signal);
          if (!book) throw error;
        }
        assertCurrent(owner, version, controller.signal);
        addBook(book);
        try { currentJournal.remove(bookId); } catch { /* Reconciliation will preserve referenced files. */ }
        updateRow(row.id, { status: 'done', message: 'Added to library', file: null, percent: 100 });
        void refreshLibrary();
      } catch (error) {
        if (version === generation) {
          const message = error.name === 'AbortError'
            ? 'The upload timed out. Refresh the library before retrying.'
            : friendlyLibraryError(error, error instanceof Error ? error.message : 'Could not complete the upload. Check your connection and retry.');
          updateRow(row.id, { status: 'failed', message, percent: null });
        }
      } finally {
        clearTimeout(timeout);
        activeOperations.delete(bookId);
        if (version === generation) void retryCleanup();
      }
    }
  } finally {
    if (version === generation) workerGeneration = -1;
  }
}

export async function deleteBook(book) {
  if (!userId || !journal) throw new Error('Browser storage is unavailable. Reload before deleting.');
  const owner = userId;
  const version = generation;
  const currentJournal = journal;
  const controller = new AbortController();
  deleteController = controller;
  const task = currentJournal.add('delete', crypto.randomUUID(), [book.file_path, book.cover_path].filter(Boolean));
  const timeout = setTimeout(() => controller.abort(), 30000);
  activeOperations.add(task.id);
  try {
    await deleteBookRow(book.id, controller.signal);
    assertCurrent(owner, version, controller.signal);
    library.update((state) => ({ ...state, books: state.books.filter((entry) => entry.id !== book.id) }));
    let pending = false;
    try {
      await cleanupUnreferencedFiles(supabase, task, controller.signal);
      assertCurrent(owner, version, controller.signal);
      currentJournal.remove(task.id);
    } catch { pending = true; }
    void refreshLibrary();
    return { pending };
  } catch (error) {
    void refreshLibrary();
    throw new Error(friendlyLibraryError(error, 'Could not confirm the deletion. Refresh the library and try again.'));
  } finally {
    clearTimeout(timeout);
    activeOperations.delete(task.id);
    if (version === generation) void retryCleanup();
  }
}
