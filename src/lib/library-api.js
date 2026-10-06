import { supabase } from './supabase.js';
import { withUploadProgress } from './upload-transport.js';

export const BOOK_FIELDS = 'id,kind,title,author,series,series_index,lang,annotation,file_path,cover_path,file_hash,size_bytes,uploaded_by,created_at';

export async function listBooks(signal) {
  const books = [];
  let after = null;
  // Keyset paging avoids silently truncating the library at the API row limit.
  while (true) {
    let query = supabase.from('books').select(BOOK_FIELDS).order('id').limit(500).abortSignal(signal);
    if (after) query = query.gt('id', after);
    const { data, error } = await query;
    if (error) throw error;
    books.push(...data);
    if (data.length < 500) return books;
    after = data.at(-1).id;
  }
}

export async function findBookByHash(hash, signal) {
  const { data, error } = await supabase.from('books').select(BOOK_FIELDS).eq('file_hash', hash).maybeSingle().abortSignal(signal);
  if (error) throw error;
  return data;
}

export async function findBookById(id, signal) {
  const { data, error } = await supabase.from('books').select(BOOK_FIELDS).eq('id', id).maybeSingle().abortSignal(signal);
  if (error) throw error;
  return data;
}

export async function insertBook(book, signal) {
  const { data, error } = await supabase.from('books').insert(book).select(BOOK_FIELDS).single().abortSignal(signal);
  if (error) throw error;
  return data;
}

export async function deleteBookRow(id, signal) {
  const { error } = await supabase.from('books').delete().eq('id', id).abortSignal(signal);
  if (error) throw error;
}

export async function uploadObject(path, blob, onProgress, signal) {
  const { error } = await withUploadProgress(path, onProgress, signal, () =>
    supabase.storage.from('library').upload(path, blob, {
      upsert: false,
      contentType: path.endsWith('.jpg') ? 'image/jpeg' : 'application/octet-stream',
      cacheControl: '3600',
    }),
  );
  if (error) throw error;
}

export async function downloadObject(path) {
  const { data, error } = await supabase.storage.from('library').download(path);
  if (error) throw error;
  return data.arrayBuffer();
}

export function friendlyLibraryError(error, fallback) {
  if (error?.code === '42501' || ['401', '403'].includes(String(error?.statusCode || error?.status))) {
    return 'Your account could not access the library. Try signing in again.';
  }
  if (String(error?.statusCode || error?.status) === '413') return 'The file is larger than the library storage limit.';
  return fallback;
}
