import { imageHref } from './parser.js';

// Inline FB2 elements and the HTML elements that represent them.
const INLINE_TAGS = {
  emphasis: 'em',
  strong: 'strong',
  sup: 'sup',
  sub: 'sub',
  strikethrough: 's',
  code: 'code',
  style: 'span',
};

function element(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function renderImage(node, book, className) {
  const url = book.imageUrl(imageHref(node));
  if (!url) return null;
  const image = element('img', className);
  image.src = url;
  image.alt = node.getAttribute('alt') || '';
  image.decoding = 'async';
  return image;
}

// Translates XML inline content into DOM nodes. Text is always inserted as text, never as markup.
function renderInline(source, target, book) {
  for (const node of source.childNodes) {
    if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE) {
      target.append(node.data);
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const name = node.localName;
      if (name === 'image') {
        const image = renderImage(node, book, 'fb-inline-image');
        if (image) target.append(image);
        continue;
      }
      let output;
      if (name === 'a') {
        // Note links stay inert until footnotes arrive in Stage 5; the href is kept for that.
        const isNote = node.getAttribute('type') === 'note';
        output = element(isNote ? 'sup' : 'span', isNote ? 'fb-note' : 'fb-link');
        const href = imageHref(node);
        if (href) output.dataset.href = href;
      } else {
        output = element(INLINE_TAGS[name] || 'span');
      }
      renderInline(node, output, book);
      target.append(output);
    }
  }
}

function renderTable(source, book) {
  const table = element('table', 'fb-table');
  for (const row of source.children) {
    if (row.localName !== 'tr') continue;
    const tableRow = element('tr');
    for (const cell of row.children) {
      if (cell.localName !== 'td' && cell.localName !== 'th') continue;
      const output = element(cell.localName);
      for (const name of ['colspan', 'rowspan']) {
        const value = Number(cell.getAttribute(name));
        if (Number.isInteger(value) && value > 1 && value < 100) output.setAttribute(name, String(value));
      }
      renderInline(cell, output, book);
      tableRow.append(output);
    }
    table.append(tableRow);
  }
  return table;
}

function renderLeaf(item, book) {
  let output;
  if (item.kind === 'empty-line') {
    output = element('div', 'fb-empty-line');
  } else if (item.kind === 'image') {
    output = element('div', 'fb-image');
    const image = renderImage(item.node, book);
    if (image) output.append(image);
  } else if (item.kind === 'table') {
    output = element('div', 'fb-table-wrap');
    output.append(renderTable(item.node, book));
  } else {
    output = element('p', item.kind === 'p' ? '' : 'fb-' + item.kind);
    renderInline(item.node, output, book);
  }
  // The stable paragraph index used by positions, progress and bookmarks.
  output.dataset.p = String(item.index);
  return output;
}

function renderItem(item, book) {
  if (item.type === 'leaf') return renderLeaf(item, book);
  const box = element('div', 'fb-' + item.kind);
  if (item.kind === 'title') {
    box.classList.add('level-' + Math.min(item.level, 3));
    box.setAttribute('role', 'heading');
    box.setAttribute('aria-level', String(Math.min(item.level + 1, 6)));
  }
  for (const inner of item.items) box.append(renderItem(inner, book));
  return box;
}

export function renderChunk(book, section, chunk) {
  const fragment = document.createDocumentFragment();
  for (let index = chunk.start; index < chunk.end; index += 1) fragment.append(renderItem(section.items[index], book));
  return fragment;
}
