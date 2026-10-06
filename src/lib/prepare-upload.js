import { validateFile, sha256 } from './files.js';
import { readFb2Archive } from './archives.js';
import { parseFb2Metadata } from './fb2/parser.js';
import { parseDocxMetadata } from './docx/metadata.js';
import { createThumbnail } from './thumbnail.js';

export async function prepareUpload(file, onStage = () => {}) {
  const type = validateFile(file);
  onStage('Reading file…');
  const originalBytes = new Uint8Array(await file.arrayBuffer());
  onStage('Reading metadata…');
  const bookBytes = type.kind === 'fb2' && type.zipped ? await readFb2Archive(originalBytes) : originalBytes;
  const parsed = type.kind === 'fb2'
    ? parseFb2Metadata(bookBytes, file.name)
    : await parseDocxMetadata(originalBytes, file.name);
  let cover = null;
  if (parsed.cover) {
    onStage('Preparing cover…');
    try { cover = await createThumbnail(parsed.cover); }
    catch { parsed.warnings.push('The cover could not be resized; using a text cover.'); }
  }
  onStage('Checking fingerprint…');
  // Hash the uncompressed FB2 bytes so .fb2 and .fb2.zip copies deduplicate.
  const hash = await sha256(bookBytes);
  return { ...type, metadata: parsed.metadata, warnings: parsed.warnings, cover, hash };
}
