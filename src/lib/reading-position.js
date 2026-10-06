// Reading positions kept in memory for the current page session only.
// Stage 4 replaces this module's storage with IndexedDB and server sync; callers stay the same.
const positions = new Map();

function key(userId, bookId) {
  return userId + ':' + bookId;
}

export function rememberPosition(userId, bookId, position) {
  positions.set(key(userId, bookId), { ...position });
}

export function recallPosition(userId, bookId) {
  return positions.get(key(userId, bookId)) || null;
}
