export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const ACCEPTED_FILES = '.fb2,.fb2.zip,.docx';

export function fileType(name) {
  const lower = name.toLowerCase();
  if (lower.endsWith('.fb2.zip')) return { kind: 'fb2', extension: 'fb2.zip', zipped: true };
  if (lower.endsWith('.fb2')) return { kind: 'fb2', extension: 'fb2', zipped: false };
  if (lower.endsWith('.docx')) return { kind: 'docx', extension: 'docx', zipped: true };
  throw new Error('Choose an .fb2, .fb2.zip or .docx file.');
}

export function titleFromFilename(name) {
  return name.replace(/\.(fb2\.zip|fb2|docx)$/i, '').trim() || 'Untitled';
}

export function validateFile(file) {
  const type = fileType(file.name);
  if (!file.size) throw new Error('This file is empty.');
  if (file.size > MAX_FILE_BYTES) throw new Error('This file is larger than the 50 MB upload limit.');
  return type;
}

export async function sha256(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
