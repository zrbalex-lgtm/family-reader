import { renderChunk } from './render.js';
import { chunkIndexFor, clampPosition, percentAt } from './book.js';

// Column layout limits, in CSS pixels.
const MIN_MARGIN = 20;
const SPREAD_MIN_WIDTH = 1000;
const MAX_LINE = 680;
const MAX_SPREAD_LINE = 600;
// Small tolerance for sub-pixel rounding when mapping rects to pages.
const EPSILON = 2;

function textNodesOf(element) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let total = 0;
  while (walker.nextNode()) {
    nodes.push({ node: walker.currentNode, start: total });
    total += walker.currentNode.data.length;
  }
  return { nodes, total };
}

function charRect(texts, offset) {
  let low = 0;
  let high = texts.nodes.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (texts.nodes[middle].start <= offset) low = middle;
    else high = middle - 1;
  }
  const entry = texts.nodes[low];
  if (!entry) return null;
  const local = Math.min(offset - entry.start, entry.node.data.length - 1);
  if (local < 0) return null;
  const range = document.createRange();
  range.setStart(entry.node, local);
  range.setEnd(entry.node, local + 1);
  return range.getClientRects()[0] || null;
}

function waitForImages(root) {
  return Promise.all(Array.from(root.querySelectorAll('img'), (image) =>
    image.decode().catch(() => image.remove()),
  ));
}

/**
 * Paginates one chunk of one chapter at a time inside `page` using CSS columns.
 * Pages are turned with translateX. The reading position is always derived from
 * the first visible paragraph, so relayout never depends on page numbers.
 */
export class Paginator {
  constructor(page, book, onChange) {
    this.page = page;
    this.book = book;
    this.onChange = onChange;
    this.flow = document.createElement('div');
    this.flow.className = 'fb-flow';
    if (book.lang) this.flow.lang = book.lang;
    page.replaceChildren(this.flow);
    this.section = 0;
    this.chunk = 0;
    this.pageIndex = 0;
    this.pages = 1;
    this.width = 0;
    this.leaves = [];
    this.minMargin = MIN_MARGIN;
    this.charsPerPage = 0;
    this.densityArea = 0;
    this.token = 0;
    this.busy = false;
  }

  get currentSection() { return this.book.sections[this.section]; }
  get currentChunk() { return this.currentSection.chunks[this.chunk]; }
  get atStart() { return this.section === 0 && this.chunk === 0 && this.pageIndex === 0; }
  get atEnd() {
    const lastSection = this.section === this.book.sections.length - 1;
    return lastSection && this.chunk === this.currentSection.chunks.length - 1 && this.pageIndex === this.pages - 1;
  }

  open(position) {
    const target = clampPosition(this.book, position);
    const section = this.book.sections[target.section];
    return this.load(target.section, chunkIndexFor(section, target.paragraph), target);
  }

  // Opens the last page of the book (used for finished books).
  openAtEnd() {
    const last = this.book.sections.length - 1;
    return this.load(last, this.book.sections[last].chunks.length - 1, 'end');
  }

  // target: 'start' | 'end' | { paragraph, charOffset }
  async load(sectionIndex, chunkIndex, target) {
    const token = ++this.token;
    this.busy = true;
    const section = this.book.sections[sectionIndex];
    this.flow.replaceChildren(renderChunk(this.book, section, section.chunks[chunkIndex]));
    this.section = sectionIndex;
    this.chunk = chunkIndex;
    this.leaves = Array.from(this.flow.querySelectorAll('[data-p]'));
    await waitForImages(this.flow);
    if (token !== this.token) return false;
    this.measure();
    if (target === 'start') this.pageIndex = 0;
    else if (target === 'end') this.pageIndex = this.pages - 1;
    else this.pageIndex = this.pageFor(target);
    this.apply(false);
    this.busy = false;
    this.emit();
    return true;
  }

  // Sizes the column container to the page box and counts the resulting pages.
  measure() {
    // Guard against a hidden or not-yet-laid-out page box.
    const width = Math.max(1, this.page.clientWidth);
    const height = Math.max(1, this.page.clientHeight);
    const spread = width >= SPREAD_MIN_WIDTH && width > height;
    const margin = spread
      ? Math.max(this.minMargin * 2, Math.floor((width - 2 * MAX_SPREAD_LINE) / 4))
      : Math.max(this.minMargin, Math.floor((width - MAX_LINE) / 2));
    // Column gap = 2 × margin, so one page stride equals exactly the page width.
    this.width = width;
    const style = this.flow.style;
    style.transition = 'none';
    style.transform = 'translate3d(0, 0, 0)';
    style.left = margin + 'px';
    style.width = width - 2 * margin + 'px';
    style.height = height + 'px';
    style.columnCount = spread ? '2' : '1';
    style.columnGap = 2 * margin + 'px';
    style.setProperty('--page-height', height + 'px');

    const origin = this.flow.getBoundingClientRect().left;
    let pages = Math.ceil((this.flow.scrollWidth + 2 * margin - EPSILON) / width);
    const last = this.leaves.at(-1)?.getClientRects();
    if (last?.length) pages = Math.max(pages, Math.floor((last[last.length - 1].left - origin + EPSILON) / width) + 1);
    this.pages = Math.max(1, pages);
  }

  pageOfRect(rect) {
    const origin = this.flow.getBoundingClientRect().left;
    const page = Math.floor((rect.left - origin + EPSILON) / this.width);
    return Math.min(Math.max(page, 0), this.pages - 1);
  }

  leafElement(paragraph) {
    return this.leaves[paragraph - this.currentChunk.firstLeaf] || null;
  }

  pageFor({ paragraph, charOffset }) {
    const element = this.leafElement(paragraph);
    if (!element) return 0;
    let rect = null;
    if (charOffset > 0) rect = charRect(textNodesOf(element), charOffset);
    rect ||= element.getClientRects()[0];
    return rect ? this.pageOfRect(rect) : 0;
  }

  // The first paragraph visible on the current page, plus the first visible character inside it.
  position() {
    const fallback = { section: this.section, paragraph: this.currentChunk.firstLeaf, charOffset: 0 };
    if (!this.leaves.length) return fallback;
    let low = 0;
    let high = this.leaves.length - 1;
    let found = high;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const rects = this.leaves[middle].getClientRects();
      if (!rects.length || this.pageOfRect(rects[rects.length - 1]) >= this.pageIndex) {
        found = middle;
        high = middle - 1;
      } else {
        low = middle + 1;
      }
    }
    const element = this.leaves[found];
    const paragraph = Number(element.dataset.p);
    const first = element.getClientRects()[0];
    if (!first || this.pageOfRect(first) >= this.pageIndex) return { section: this.section, paragraph, charOffset: 0 };
    return { section: this.section, paragraph, charOffset: this.firstCharOnPage(element) };
  }

  // Paragraph text flows in column order, so the first character on the page can be binary searched.
  firstCharOnPage(element) {
    const texts = textNodesOf(element);
    let low = 0;
    let high = texts.total - 1;
    let found = 0;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const rect = charRect(texts, middle);
      if (rect && this.pageOfRect(rect) >= this.pageIndex) {
        found = middle;
        high = middle - 1;
      } else {
        low = middle + 1;
      }
    }
    return found;
  }

  apply(animate) {
    this.flow.style.transition = animate ? '' : 'none';
    this.flow.style.transform = `translate3d(${-this.pageIndex * this.width}px, 0, 0)`;
  }

  async next() {
    if (this.busy) return true;
    if (this.pageIndex < this.pages - 1) {
      this.pageIndex += 1;
      this.apply(true);
      this.emit();
      return true;
    }
    if (this.chunk + 1 < this.currentSection.chunks.length) return this.load(this.section, this.chunk + 1, 'start');
    if (this.section + 1 < this.book.sections.length) return this.load(this.section + 1, 0, 'start');
    return false;
  }

  async previous() {
    if (this.busy) return true;
    if (this.pageIndex > 0) {
      this.pageIndex -= 1;
      this.apply(true);
      this.emit();
      return true;
    }
    if (this.chunk > 0) return this.load(this.section, this.chunk - 1, 'end');
    if (this.section > 0) {
      const previous = this.book.sections[this.section - 1];
      return this.load(this.section - 1, previous.chunks.length - 1, 'end');
    }
    return false;
  }

  // Text of a paragraph from the given position, for bookmark excerpts.
  excerptAt(position, length = 160) {
    if (position.section !== this.section) return '';
    const element = this.leafElement(position.paragraph);
    const text = (element?.textContent || '').slice(position.charOffset).replace(/\s+/g, ' ').trim();
    return text.length > length ? text.slice(0, length).replace(/\s\S*$/, '') + '…' : text;
  }

  // True when a stored position falls on the page currently shown.
  isOnCurrentPage(position) {
    const chunk = this.currentChunk;
    if (!position || position.section !== this.section || position.paragraph < chunk.firstLeaf || position.paragraph >= chunk.endLeaf) return false;
    return this.pageFor(position) === this.pageIndex;
  }

  // Reader setting: the smallest side margin in CSS pixels. Call relayout() afterwards.
  setMinMargin(pixels) {
    this.minMargin = Math.max(0, Math.round(pixels) || MIN_MARGIN);
  }

  // Call after resize, rotation or reader setting changes.
  relayout() {
    if (this.busy) return;
    const position = this.position();
    this.measure();
    this.pageIndex = this.pageFor(position);
    this.apply(false);
    this.emit();
  }

  // Characters per page for the current layout, used to estimate whole-book page numbers
  // without laying out the whole book. Short chunks (title pages, tiny chapters) are too
  // sparse to be representative, so the last good estimate is kept and scaled by page area.
  updateDensity() {
    const chunk = this.currentChunk;
    const area = this.width * this.page.clientHeight;
    if (this.pages >= 3 && chunk.chars) {
      // The last page of a chunk is usually only partly filled.
      this.charsPerPage = chunk.chars / (this.pages - 0.5);
      this.densityArea = area;
    } else if (this.charsPerPage && this.densityArea && area !== this.densityArea) {
      this.charsPerPage *= area / this.densityArea;
      this.densityArea = area;
    } else if (!this.charsPerPage) {
      this.charsPerPage = Math.max(1, chunk.chars / this.pages);
      this.densityArea = area;
    }
  }

  emit() {
    const section = this.currentSection;
    const chunk = this.currentChunk;
    const position = this.position();
    this.updateDensity();
    const charsPerPage = this.charsPerPage;
    // Pages are counted consecutively inside the laid-out chunk; earlier text is estimated.
    const charsBefore = section.charsBefore + chunk.charsBefore;
    const atEnd = this.atEnd;
    const estimatedTotal = Math.max(1, Math.round(this.book.totalChars / charsPerPage));
    let bookPage = Math.round(charsBefore / charsPerPage) + this.pageIndex + 1;
    const bookPages = Math.max(bookPage, estimatedTotal);
    if (atEnd) bookPage = bookPages;
    // Pages left in this chapter: exact inside the current chunk, estimated for later chunks.
    const charsAfterChunk = section.chars - chunk.charsBefore - chunk.chars;
    const chapterPagesLeft = this.pages - this.pageIndex - 1 + Math.round(charsAfterChunk / charsPerPage);
    this.onChange({
      position,
      sectionIndex: this.section,
      title: section.title,
      bookPage,
      bookPages,
      chapterPagesLeft,
      // Position-based, so it stays below 100 until the reader confirms the end.
      percent: percentAt(this.book, position),
      atStart: this.atStart,
      atEnd,
    });
  }

  destroy() {
    this.token += 1;
    this.flow.remove();
  }
}
