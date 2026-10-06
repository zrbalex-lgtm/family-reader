import { child, children, decodeXml, parseXml, textOf } from '../xml.js';
import { titleFromFilename } from '../files.js';

function authorName(author) {
  const parts = ['first-name', 'middle-name', 'last-name'].map((name) => textOf(child(author, name))).filter(Boolean);
  return parts.join(' ') || textOf(child(author, 'nickname'));
}

function annotationText(annotation) {
  if (!annotation) return null;
  const blocks = Array.from(annotation.children).map(textOf).filter(Boolean);
  return (blocks.length ? blocks.join('\n\n') : textOf(annotation)).slice(0, 20000) || null;
}

const IMAGE_TYPES = /^image\/(jpeg|jpg|png|webp|gif|bmp)$/;

// Returns the internal "#id" reference of an FB2 <image>, whichever namespace prefix is used.
export function imageHref(image) {
  return image?.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || image?.getAttribute('href') || image?.getAttribute('l:href') || null;
}

// Decodes a base64 <binary> image. Returns { blob } or { problem: 'format' | 'size' | 'damaged' }.
export function decodeBinaryImage(binary, maxBase64Length = 16 * 1024 * 1024) {
  const mime = binary?.getAttribute('content-type')?.toLowerCase().trim();
  if (!binary || !IMAGE_TYPES.test(mime || '')) return { problem: 'format' };
  const base64 = (binary.textContent || '').replace(/\s/g, '');
  if (base64.length > maxBase64Length) return { problem: 'size' };
  try {
    const decoded = atob(base64);
    const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
    return { blob: new Blob([bytes], { type: mime === 'image/jpg' ? 'image/jpeg' : mime }) };
  } catch {
    return { problem: 'damaged' };
  }
}

function extractCover(root, titleInfo, warnings) {
  const image = child(child(titleInfo, 'coverpage'), 'image');
  if (!image) return null;
  const href = imageHref(image);
  if (!href?.startsWith('#')) {
    warnings.push('The cover is not embedded in this file.');
    return null;
  }
  const binary = children(root, 'binary').find((node) => node.getAttribute('id') === href.slice(1));
  const result = decodeBinaryImage(binary);
  if (result.problem === 'format') warnings.push('The embedded cover format is not supported.');
  if (result.problem === 'size') warnings.push('The embedded cover is too large; the book can still be uploaded.');
  if (result.problem === 'damaged') warnings.push('The embedded cover is damaged.');
  return result.blob || null;
}

export function parseFb2Metadata(bytes, filename) {
  const document = parseXml(decodeXml(bytes));
  const root = document.documentElement;
  if (root.localName !== 'FictionBook' || !child(root, 'body')) {
    throw new Error('This file is not an FB2 book.');
  }
  const info = child(child(root, 'description'), 'title-info');
  if (!info) throw new Error('The FB2 title-info metadata is missing.');
  const sequence = child(info, 'sequence');
  const number = sequence?.getAttribute('number');
  const index = number?.trim() ? Number(number) : NaN;
  const warnings = [];
  const metadata = {
    title: textOf(child(info, 'book-title')) || titleFromFilename(filename),
    author: children(info, 'author').map(authorName).filter(Boolean).join(', ') || null,
    series: sequence?.getAttribute('name')?.trim() || null,
    series_index: Number.isFinite(index) && index >= 0 ? index : null,
    lang: textOf(child(info, 'lang')) || null,
    annotation: annotationText(child(info, 'annotation')),
  };
  return { metadata, cover: extractCover(root, info, warnings), warnings };
}
