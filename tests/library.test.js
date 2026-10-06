import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import JSZip from 'jszip';
import { parseFb2Metadata } from '../src/lib/fb2/parser.js';
import { parseDocxMetadata } from '../src/lib/docx/metadata.js';
import { decodeXml, parseXml } from '../src/lib/xml.js';
import { readFb2Archive, readEntry, openArchive } from '../src/lib/archives.js';
import { sha256, validateFile, MAX_FILE_BYTES, fileType } from '../src/lib/files.js';
import { filterAndSortBooks, normalizeSearch } from '../src/lib/library-query.js';
import { createCleanupJournal, cleanupUnreferencedFiles } from '../src/lib/cleanup.js';

// These tests run in GitHub Actions. No live Supabase credentials are required.
const dom = new JSDOM('');
globalThis.DOMParser = dom.window.DOMParser;
after(() => dom.window.close());
const encode = (text) => new TextEncoder().encode(text);
const fb2 = (title, extra = '') => '<?xml version="1.0" encoding="utf-8"?>'
  + '<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">'
  + '<description><title-info><book-title>' + title + '</book-title>'
  + '<author><first-name>Лев</first-name><middle-name>Николаевич</middle-name><last-name>Толстой</last-name></author>'
  + '<author><nickname>Guest</nickname></author><sequence name="Истории" number="2.5"/>'
  + '<lang>ru</lang><annotation><p>First paragraph.</p><p>Second <emphasis>paragraph.</emphasis></p></annotation>'
  + extra + '</title-info></description><body><section><p>Text.</p></section></body>'
  + (extra ? '<binary id="cover" content-type="image/png">iVBORw0KGgo=</binary>' : '')
  + '</FictionBook>';

test('FB2 metadata respects namespaces, author order, series, language and annotation', () => {
  const result = parseFb2Metadata(encode(fb2('Ёлка &amp; лес')), 'original.fb2');
  assert.equal(result.metadata.title, 'Ёлка & лес');
  assert.equal(result.metadata.author, 'Лев Николаевич Толстой, Guest');
  assert.equal(result.metadata.series, 'Истории');
  assert.equal(result.metadata.series_index, 2.5);
  assert.equal(result.metadata.lang, 'ru');
  assert.equal(result.metadata.annotation, 'First paragraph.\n\nSecond paragraph.');
  assert.equal(result.cover, null);
  assert.equal(parseFb2Metadata(encode(fb2('')), 'Fallback.FB2.ZIP').metadata.title, 'Fallback');
});

test('Windows-1251 bytes are decoded before XML parsing', () => {
  const prefix = encode('<?xml version="1.0" encoding="windows-1251"?><FictionBook><description><title-info><book-title>');
  const title = new Uint8Array([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2, 0x20, 0xa8, 0xeb, 0xea, 0xe0]);
  const suffix = encode('</book-title></title-info></description><body/></FictionBook>');
  const bytes = new Uint8Array(prefix.length + title.length + suffix.length);
  bytes.set(prefix); bytes.set(title, prefix.length); bytes.set(suffix, prefix.length + title.length);
  assert.equal(parseFb2Metadata(bytes, 'legacy.fb2').metadata.title, 'Привет Ёлка');
});

test('UTF-16 BOM is honored and malformed XML/entities are rejected', () => {
  const xml = '<?xml version="1.0" encoding="utf-16"?><root>Привет</root>';
  const bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xml, 'utf16le')]);
  assert.equal(parseXml(decodeXml(bytes)).documentElement.textContent, 'Привет');
  assert.throws(() => parseXml('<root><broken></root>'), /damaged|incomplete/);
  assert.throws(() => parseXml('<!DOCTYPE root [<!ENTITY x "unsafe">]><root>&x;</root>'), /entities/);
  assert.throws(() => parseFb2Metadata(encode('<root/>'), 'fake.fb2'), /not an FB2/);
});

test('embedded cover bytes are extracted and external images are not requested', () => {
  const result = parseFb2Metadata(encode(fb2('Cover', '<coverpage><image l:href="#cover"/></coverpage>')), 'cover.fb2');
  assert.equal(result.cover.type, 'image/png');
  assert.equal(result.cover.size, 8);
  const external = parseFb2Metadata(encode(fb2('External', '<coverpage><image l:href="https://example.com/cover.jpg"/></coverpage>')), 'external.fb2');
  assert.equal(external.cover, null);
  assert.match(external.warnings[0], /not embedded/);
});

test('ZIP extraction preserves the FB2 digest and rejects ambiguous or oversized entries', async () => {
  const bytes = encode(fb2('Same book'));
  const zip = new JSZip();
  zip.file('folder/book.fb2', bytes);
  const packed = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  assert.equal(await sha256(await readFb2Archive(packed)), await sha256(bytes));
  zip.file('second.fb2', bytes);
  await assert.rejects(readFb2Archive(await zip.generateAsync({ type: 'uint8array' })), /exactly one/);
  const opened = await openArchive(packed);
  await assert.rejects(readEntry(opened.file('folder/book.fb2'), 8), /too large/);
  await assert.rejects(openArchive(encode('not a zip')), /Could not open/);
});

async function docx(title, { macro = false, includeCore = true } = {}) {
  const zip = new JSZip();
  const type = macro ? 'application/vnd.ms-word.document.macroEnabled.main+xml' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="' + type + '"/></Types>');
  zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>');
  if (includeCore) zip.file('docProps/core.xml', '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>' + title + '</dc:title></cp:coreProperties>');
  return zip.generateAsync({ type: 'uint8array' });
}

test('DOCX titles use core properties or the filename; macro formats are rejected', async () => {
  assert.equal((await parseDocxMetadata(await docx('Guitar &amp; songs'), 'file.docx')).metadata.title, 'Guitar & songs');
  assert.equal((await parseDocxMetadata(await docx(''), 'Songbook.docx')).metadata.title, 'Songbook');
  assert.equal((await parseDocxMetadata(await docx('', { includeCore: false }), 'No title.docx')).metadata.title, 'No title');
  await assert.rejects(parseDocxMetadata(await docx('Macros', { macro: true }), 'fake.docx'), /macro-enabled/);
});

test('search normalizes Cyrillic and sorting does not mutate the shared list', () => {
  const books = [
    { id: 'b', kind: 'fb2', title: 'Ёлка', author: 'Пётр', series: 'Лес', created_at: '2026-01-02' },
    { id: 'a', kind: 'fb2', title: 'Азбука', author: 'Анна', series: null, created_at: '2026-01-01' },
    { id: 'c', kind: 'docx', title: 'Songbook', author: null, series: null, created_at: '2026-01-03' },
  ];
  assert.equal(normalizeSearch('Е\u0308ЛКА'), 'елка');
  assert.deepEqual(filterAndSortBooks(books, 'fb2', 'петр елка лес', 'title').map((book) => book.id), ['b']);
  assert.deepEqual(filterAndSortBooks(books, 'fb2', '', 'title').map((book) => book.id), ['a', 'b']);
  assert.deepEqual(filterAndSortBooks(books, 'fb2', '', 'recent').map((book) => book.id), ['b', 'a']);
  assert.deepEqual(books.map((book) => book.id), ['b', 'a', 'c']);
});

test('file validation rejects unsupported or empty input and hashes SHA-256 bytes', async () => {
  assert.equal(fileType('BOOK.FB2.ZIP').extension, 'fb2.zip');
  assert.throws(() => validateFile({ name: 'file.pdf', size: 100 }));
  assert.throws(() => validateFile({ name: 'empty.fb2', size: 0 }));
  assert.throws(() => validateFile({ name: 'large.docx', size: MAX_FILE_BYTES + 1 }));
  assert.equal(await sha256(encode('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

const path = 'books/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/source.fb2';
function cleanupClient({ referenced = false, databaseError = null, storageError = null } = {}) {
  const removed = [];
  return {
    removed,
    from() {
      const query = { select() { return query; }, or() { return query; }, limit() { return query; },
        async abortSignal() { return { data: referenced ? [{ id: 'existing' }] : [], error: databaseError }; } };
      return query;
    },
    storage: { from() { return { async remove(paths) { removed.push(...paths); return { error: storageError }; } }; } },
  };
}

test('cleanup preserves referenced files and never deletes after a failed database lookup', async () => {
  const client = cleanupClient({ referenced: true });
  assert.equal(await cleanupUnreferencedFiles(client, { paths: [path] }), 'referenced');
  assert.deepEqual(client.removed, []);
  const broken = cleanupClient({ databaseError: new Error('offline') });
  await assert.rejects(cleanupUnreferencedFiles(broken, { paths: [path] }));
  assert.deepEqual(broken.removed, []);
  const unused = cleanupClient();
  assert.equal(await cleanupUnreferencedFiles(unused, { paths: [path] }), 'removed');
  assert.deepEqual(unused.removed, [path]);
  await assert.rejects(cleanupUnreferencedFiles(unused, { paths: ['unrelated/private.txt'] }));
});

test('cleanup journal isolates users and records independent operations per key', () => {
  const values = new Map();
  const storage = {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
  };
  const first = createCleanupJournal(storage, 'project:user-a');
  const second = createCleanupJournal(storage, 'project:user-b');
  first.add('upload', 'operation-1', [path]);
  first.add('delete', 'operation-2', [path]);
  assert.equal(first.read().length, 2);
  assert.equal(second.read().length, 0);
  assert.ok(first.read()[0].notBefore > Date.now());
  first.remove('operation-1');
  assert.equal(first.read().length, 1);
});
