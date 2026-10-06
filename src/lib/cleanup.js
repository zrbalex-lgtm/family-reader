const PATH_PATTERN = /^books\/[a-f0-9-]{36}\/(source\.(fb2(\.zip)?|docx)|cover\.jpg)$/;
const GRACE_MS = 10 * 60 * 1000;

function validTask(task) {
  return task && typeof task.id === 'string' && ['upload', 'delete'].includes(task.kind)
    && Number.isFinite(task.notBefore) && Array.isArray(task.paths) && task.paths.length > 0
    && task.paths.length <= 2 && task.paths.every((path) => PATH_PATTERN.test(path));
}

export function createCleanupJournal(storage, key) {
  function read() {
    const entries = [];
    try {
      for (let index = 0; index < storage.length; index += 1) {
        const name = storage.key(index);
        if (!name?.startsWith(key + ':')) continue;
        const task = JSON.parse(storage.getItem(name) || 'null');
        if (validTask(task)) entries.push(task);
      }
    }
    catch { throw new Error('Could not read pending file cleanup. Check that browser storage is available.'); }
    return entries;
  }
  function write(task) {
    // One key per operation prevents independent tabs overwriting each other.
    try { storage.setItem(key + ':' + task.id, JSON.stringify(task)); }
    catch { throw new Error('Browser storage is unavailable. Enable it before changing the library.'); }
  }
  return {
    read,
    add(kind, id, paths) {
      const task = { kind, id, paths, notBefore: Date.now() + GRACE_MS };
      if (!validTask(task)) throw new Error('The file path is not a managed library path.');
      write(task);
      return task;
    },
    remove(id) { storage.removeItem(key + ':' + id); },
  };
}

export async function cleanupUnreferencedFiles(client, task, signal) {
  // Always reconcile against the database first. A failed HTTP response does
  // not prove an INSERT/DELETE failed to commit on the server.
  for (const path of task.paths) {
    if (!PATH_PATTERN.test(path)) throw new Error('Unexpected cleanup path.');
    const { data, error } = await client.from('books').select('id')
      .or('file_path.eq.' + path + ',cover_path.eq.' + path)
      .limit(1).abortSignal(signal);
    if (error) throw error;
    if (data.length) return 'referenced';
  }
  if (signal?.aborted) throw new DOMException('Cleanup cancelled.', 'AbortError');
  const removal = client.storage.from('library').remove(task.paths);
  // Bound the wait even though the Storage remove API has no signal option.
  // A late completion is safe: the journal remains and removal is idempotent.
  const result = signal ? await new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('Cleanup cancelled.', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(removal).then(
      (value) => { signal.removeEventListener('abort', abort); resolve(value); },
      (error) => { signal.removeEventListener('abort', abort); reject(error); },
    );
    if (signal.aborted) abort();
  }) : await removal;
  const { error } = result;
  if (error) throw error;
  return 'removed';
}
