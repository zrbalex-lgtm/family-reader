import JSZip from 'jszip';
import { MAX_FILE_BYTES } from './files.js';

export async function openArchive(bytes) {
  try {
    const zip = await JSZip.loadAsync(bytes);
    if (Object.keys(zip.files).length > 4096) throw new Error('too many entries');
    return zip;
  } catch {
    throw new Error('Could not open this ZIP document. It may be damaged, encrypted or too complex.');
  }
}

export function readEntry(entry, limit = MAX_FILE_BYTES) {
  if (!entry || entry.dir) return Promise.reject(new Error('A required file is missing from the document.'));
  // Bound actual inflated bytes rather than trusting ZIP size declarations.
  return new Promise((resolve, reject) => {
    const parts = [];
    let length = 0;
    let finished = false;
    const stream = entry.internalStream('uint8array');
    const fail = (message) => {
      if (finished) return;
      finished = true;
      stream.pause();
      parts.length = 0;
      reject(new Error(message));
    };
    stream.on('data', (part) => {
      length += part.length;
      if (length > limit) {
        fail('A file inside the archive is too large to process safely.');
        return;
      }
      if (!finished) parts.push(part);
    });
    stream.on('error', () => fail('Could not unpack this document. It may be damaged.'));
    stream.on('end', () => {
      if (finished) return;
      finished = true;
      const output = new Uint8Array(length);
      let offset = 0;
      for (const part of parts) { output.set(part, offset); offset += part.length; }
      resolve(output);
    });
    stream.resume();
  });
}

export async function readFb2Archive(bytes) {
  const zip = await openArchive(bytes);
  const candidates = Object.values(zip.files).filter((entry) =>
    !entry.dir && !entry.name.startsWith('__MACOSX/') && /\.fb2$/i.test(entry.name),
  );
  if (candidates.length !== 1) throw new Error('An .fb2.zip archive must contain exactly one FB2 book.');
  return readEntry(candidates[0]);
}
