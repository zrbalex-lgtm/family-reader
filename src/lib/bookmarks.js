import { supabase } from './supabase.js';

// Private bookmarks (RLS limits every query to the signed-in user's rows).
// They need a connection; offline queuing arrives with the PWA stage.
const FIELDS = 'id, book_id, position, excerpt, note, created_at';

function friendly(error) {
  return new Error(navigator.onLine ? 'Bookmarks could not be saved or loaded. Try again.' : 'Bookmarks need an internet connection.', { cause: error });
}

export async function listBookmarks(bookId) {
  const { data, error } = await supabase.from('bookmarks').select(FIELDS).eq('book_id', bookId).order('created_at', { ascending: false });
  if (error) throw friendly(error);
  return data;
}

export async function addBookmark(bookId, position, excerpt, note) {
  const row = {
    book_id: bookId,
    position: { section: position.section, paragraph: position.paragraph, charOffset: position.charOffset },
    excerpt: excerpt.slice(0, 500) || null,
    note: note.trim().slice(0, 2000) || null,
  };
  const { data, error } = await supabase.from('bookmarks').insert(row).select(FIELDS).single();
  if (error) throw friendly(error);
  return data;
}

export async function deleteBookmark(id) {
  const { error } = await supabase.from('bookmarks').delete().eq('id', id);
  if (error) throw friendly(error);
}
