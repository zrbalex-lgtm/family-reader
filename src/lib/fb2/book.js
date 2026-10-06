import { child, children, decodeXml, parseXml, textOf } from '../xml.js';
import { readFb2Archive } from '../archives.js';
import { decodeBinaryImage } from './parser.js';

// Chunk limits keep the DOM small enough for phones when a chapter is very long.
const CHUNK_CHARS = 30000;
const CHUNK_ITEMS = 400;

// Leaf blocks get a stable paragraph index; boxes only group leaves.
const LEAVES = new Set(['p', 'subtitle', 'v', 'text-author', 'date', 'empty-line', 'image', 'table']);
const BOXES = new Set(['epigraph', 'cite', 'poem', 'stanza', 'annotation']);
const SKIPPED_BODIES = /^(notes|comments|footnotes)$/i;

function addLeaf(section, kind, node) {
  const index = section.leafStart.length - 1;
  const text = kind === 'image' || kind === 'empty-line' ? 0 : node.textContent.length;
  section.leafStart.push(section.leafStart[index] + Math.max(1, text));
  return { type: 'leaf', kind, node, index, firstLeaf: index, endLeaf: index + 1 };
}

function nextLeaf(section) {
  return section.leafStart.length - 1;
}

function walkTitle(title, section) {
  const items = [];
  for (const node of title.children) {
    if (node.localName === 'p') items.push(addLeaf(section, 'title-line', node));
    else if (node.localName === 'empty-line') items.push(addLeaf(section, 'empty-line', node));
  }
  return items;
}

// Flattens nested sections into one list of top-level items for the chapter.
function walk(nodes, level, section) {
  const items = [];
  for (const node of nodes) {
    const name = node.localName;
    if (name === 'section') {
      items.push(...walk(node.children, level + 1, section));
    } else if (name === 'title' || BOXES.has(name)) {
      const firstLeaf = nextLeaf(section);
      const inner = name === 'title' ? walkTitle(node, section) : walk(node.children, level, section);
      if (inner.length) items.push({ type: 'box', kind: name, level, items: inner, firstLeaf, endLeaf: nextLeaf(section) });
    } else if (LEAVES.has(name)) {
      items.push(addLeaf(section, name, node));
    } else if (node.children.length) {
      items.push(...walk(node.children, level, section));
    } else if (textOf(node)) {
      items.push(addLeaf(section, 'p', node));
    }
  }
  return items;
}

function makeChunks(section) {
  const { items, leafStart } = section;
  const chunks = [];
  let start = 0;
  for (let index = 0; index < items.length; index += 1) {
    const firstLeaf = items[start].firstLeaf;
    const endLeaf = items[index].endLeaf;
    const chars = leafStart[endLeaf] - leafStart[firstLeaf];
    const last = index === items.length - 1;
    // Never end a chunk on a heading: it belongs with the text that follows.
    const full = (chars >= CHUNK_CHARS || index - start + 1 >= CHUNK_ITEMS) && items[index].kind !== 'title';
    if (full || last) {
      chunks.push({ start, end: index + 1, firstLeaf, endLeaf, chars, charsBefore: leafStart[firstLeaf] });
      start = index + 1;
    }
  }
  return chunks;
}

function sectionTitle(node) {
  const title = child(node, 'title');
  if (!title) return '';
  return children(title, 'p').map(textOf).filter(Boolean).join(' · ');
}

function buildSection(nodes, level, title) {
  const section = { title, items: [], leafStart: [0], chunks: [], chars: 0, charsBefore: 0, leafCount: 0 };
  section.items = walk(nodes, level, section);
  section.leafCount = section.leafStart.length - 1;
  section.chars = section.leafStart[section.leafCount];
  section.chunks = makeChunks(section);
  return section;
}

// Top-level <section> elements become chapters; loose body content (title, epigraph, stray text) gets its own section.
function buildSections(body) {
  const sections = [];
  let loose = [];
  const flushLoose = () => {
    if (loose.length) sections.push(buildSection(loose, 0, sectionTitle(body)));
    loose = [];
  };
  for (const node of body.children) {
    if (node.localName === 'section') {
      flushLoose();
      sections.push(buildSection(node.children, 1, sectionTitle(node)));
    } else {
      loose.push(node);
    }
  }
  flushLoose();
  return sections.filter((section) => section.leafCount > 0);
}

export async function openFb2Book(bytes, zipped) {
  const xmlBytes = zipped ? await readFb2Archive(bytes) : new Uint8Array(bytes);
  const root = parseXml(decodeXml(xmlBytes)).documentElement;
  if (root.localName !== 'FictionBook') throw new Error('This file is not an FB2 book.');
  const body = children(root, 'body').find((node) => !SKIPPED_BODIES.test(node.getAttribute('name') || ''));
  if (!body) throw new Error('This book has no readable text.');
  const sections = buildSections(body);
  if (!sections.length) throw new Error('This book has no readable text.');

  let totalChars = 0;
  for (const section of sections) {
    section.charsBefore = totalChars;
    totalChars += section.chars;
  }

  const lang = textOf(child(child(child(root, 'description'), 'title-info'), 'lang')) || '';
  // Footnotes and comments live in separate bodies; index their sections by id.
  const notes = new Map();
  for (const notesBody of children(root, 'body').filter((node) => SKIPPED_BODIES.test(node.getAttribute('name') || ''))) {
    for (const section of notesBody.getElementsByTagNameNS('*', 'section')) {
      const id = section.getAttribute('id');
      if (id && !notes.has(id)) notes.set(id, section);
    }
  }
  const noteFor = (href) => (href?.startsWith('#') ? notes.get(href.slice(1)) || null : null);
  const binaries = new Map(children(root, 'binary').map((node) => [node.getAttribute('id'), node]));
  const urls = new Map();

  return {
    lang,
    sections,
    totalChars,
    toc: buildToc(sections),
    note: noteFor,
    // Blob URLs are created lazily on first render and revoked in dispose().
    imageUrl(href) {
      if (!href?.startsWith('#')) return null;
      const id = href.slice(1);
      if (!urls.has(id)) {
        const { blob } = decodeBinaryImage(binaries.get(id));
        urls.set(id, blob ? URL.createObjectURL(blob) : null);
      }
      return urls.get(id);
    },
    dispose() {
      for (const url of urls.values()) if (url) URL.revokeObjectURL(url);
      urls.clear();
    },
  };
}

// Table of contents from chapter and sub-chapter titles, each with a stable position.
function buildToc(sections) {
  const entries = [];
  sections.forEach((section, sectionIndex) => {
    let titled = false;
    const visit = (items) => {
      for (const item of items) {
        if (item.type !== 'box') continue;
        if (item.kind === 'title') {
          const label = item.items.filter((leaf) => leaf.kind === 'title-line').map((leaf) => textOf(leaf.node)).filter(Boolean).join(' · ');
          if (label) {
            entries.push({ label, level: Math.max(0, item.level - 1), position: { section: sectionIndex, paragraph: item.firstLeaf, charOffset: 0 } });
            titled = true;
          }
        } else if (item.kind !== 'poem' && item.kind !== 'stanza') {
          visit(item.items);
        }
      }
    };
    visit(section.items);
    if (!titled && sectionIndex > 0) {
      entries.push({ label: 'Section ' + (sectionIndex + 1), level: 0, position: { section: sectionIndex, paragraph: 0, charOffset: 0 } });
    }
  });
  return entries;
}

export function clampPosition(book, position) {
  const section = Math.min(Math.max(0, Math.trunc(position?.section) || 0), book.sections.length - 1);
  const { leafCount } = book.sections[section];
  const paragraph = Math.min(Math.max(0, Math.trunc(position?.paragraph) || 0), leafCount - 1);
  const charOffset = Math.max(0, Math.trunc(position?.charOffset) || 0);
  return { section, paragraph, charOffset };
}

export function chunkIndexFor(section, paragraph) {
  const index = section.chunks.findIndex((chunk) => paragraph < chunk.endLeaf);
  return index < 0 ? section.chunks.length - 1 : index;
}

export function percentAt(book, position) {
  const section = book.sections[position.section];
  const start = section.leafStart[position.paragraph];
  const length = section.leafStart[position.paragraph + 1] - start;
  const chars = section.charsBefore + start + Math.min(position.charOffset, length - 1);
  return book.totalChars ? (chars / book.totalChars) * 100 : 0;
}

export function positionAtPercent(book, percent) {
  const target = (Math.min(100, Math.max(0, percent)) / 100) * book.totalChars;
  let sectionIndex = book.sections.findIndex((section) => target < section.charsBefore + section.chars);
  if (sectionIndex < 0) sectionIndex = book.sections.length - 1;
  const section = book.sections[sectionIndex];
  const local = target - section.charsBefore;
  // Binary search for the last leaf that starts at or before the target character.
  let low = 0;
  let high = section.leafCount - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (section.leafStart[middle] <= local) low = middle;
    else high = middle - 1;
  }
  return { section: sectionIndex, paragraph: low, charOffset: 0 };
}
