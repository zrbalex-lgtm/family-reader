import { openArchive, readEntry } from '../archives.js';
import { decodeXml, parseXml, textOf } from '../xml.js';
import { titleFromFilename } from '../files.js';

export async function parseDocxMetadata(bytes, filename) {
  const zip = await openArchive(bytes);
  if (!zip.file('word/document.xml') || !zip.file('[Content_Types].xml')) {
    throw new Error('This file is not a DOCX document.');
  }
  const types = parseXml(decodeXml(await readEntry(zip.file('[Content_Types].xml'), 1024 * 1024)));
  const mainPart = Array.from(types.getElementsByTagNameNS('*', 'Override')).find(
    (node) => node.getAttribute('PartName') === '/word/document.xml',
  );
  if (mainPart?.getAttribute('ContentType') !== 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml') {
    throw new Error('Choose a DOCX document, not a macro-enabled document or template.');
  }
  let title = titleFromFilename(filename);
  const warnings = [];
  const core = zip.file('docProps/core.xml');
  if (core) {
    try {
      const document = parseXml(decodeXml(await readEntry(core, 1024 * 1024)));
      title = textOf(document.getElementsByTagNameNS('http://purl.org/dc/elements/1.1/', 'title')[0]) || title;
    } catch {
      warnings.push('The document title could not be read; using the filename.');
    }
  }
  return {
    metadata: { title, author: null, series: null, series_index: null, lang: null, annotation: null },
    cover: null,
    warnings,
  };
}
