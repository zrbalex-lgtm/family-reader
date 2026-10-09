import { renderChunk } from './render.js';
import { chunkIndexFor, clampPosition, percentAt } from './book.js';

// Column layout limits, in CSS pixels.
const DEFAULT_MARGIN = 20;
const SPREAD_MIN_WIDTH = 1000;
// Margins only grow beyond the reader setting when a column would be wider than this
// (very wide desktop windows). Tablets and phones always use the setting as is.
const MAX_COLUMN = 1000;
// Small tolerance for sub-pixel rounding when mapping rects to pages.
const EPSILON = 2;
// Page-turn animation: within a chunk, and each half of a chapter/chunk change.
const TURN_MS = 240;
const EDGE_MS = 160;
// Dragging past the first or last page moves the text only a little.
const EDGE_RESISTANCE = 0.35;

function reducedMotion() {
  return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
    // Remove only images that really failed; decode() can reject spuriously in some browsers.
    image.decode().catch(() => { if (!image.naturalWidth) image.remove(); }),
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
    // Zero-height marker after the chunk's text: its column gives the page count.
    this.endMarker = document.createElement('div');
    this.endMarker.className = 'fb-end';
    if (book.lang) this.flow.lang = book.lang;
    page.replaceChildren(this.flow);
    this.section = 0;
    this.chunk = 0;
    this.pageIndex = 0;
    this.pages = 1;
    this.width = 0;
    this.height = 0;
    this.leaves = [];
    this.margin = DEFAULT_MARGIN;
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
  // enterFrom: +1 slides the new page in from the right, -1 from the left, 0 shows it at once.
  async load(sectionIndex, chunkIndex, target, enterFrom = 0) {
    const token = ++this.token;
    this.busy = true;
    const section = this.book.sections[sectionIndex];
    this.flow.replaceChildren(renderChunk(this.book, section, section.chunks[chunkIndex]), this.endMarker);
    this.section = sectionIndex;
    this.chunk = chunkIndex;
    this.leaves = Array.from(this.flow.querySelectorAll('[data-p]'));
    await waitForImages(this.flow);
    if (token !== this.token) return false;
    this.measure();
    if (target === 'start') this.pageIndex = 0;
    else if (target === 'end') this.pageIndex = this.pages - 1;
    else this.pageIndex = this.pageFor(target);
    if (enterFrom && !reducedMotion()) {
      this.setOffset(this.pageX(this.pageIndex) + enterFrom * this.width);
      this.setOffset(this.pageX(this.pageIndex), EDGE_MS);
    } else {
      this.apply(false);
    }
    this.busy = false;
    this.emit();
    return true;
  }

  // The visible reading height. The fixed reader can extend under browser toolbars, so the
  // page box is limited to the visual viewport (except while typing, when the keyboard shrinks it).
  visibleHeight() {
    const rect = this.page.getBoundingClientRect();
    let bottom = rect.bottom;
    const viewport = window.visualViewport;
    const typing = document.activeElement?.matches?.('input, textarea, select');
    if (!typing) {
      const viewportBottom = viewport && viewport.scale < 1.01 ? viewport.offsetTop + viewport.height : window.innerHeight;
      // Keep the same bottom margin that the page box has inside its container.
      const containerBottom = this.page.parentElement?.getBoundingClientRect().bottom ?? rect.bottom;
      bottom = Math.min(bottom, viewportBottom - Math.max(0, containerBottom - rect.bottom));
    }
    return Math.max(1, Math.floor(bottom - rect.top));
  }

  // Sizes the column container to the visible page and counts the resulting pages.
  measure() {
    const width = Math.max(1, this.page.clientWidth);
    const height = this.visibleHeight();
    const spread = width >= SPREAD_MIN_WIDTH && width > height;
    const columns = spread ? 2 : 1;
    // The margin setting is the side padding of every column; the gap between columns is two margins.
    let margin = this.margin;
    if ((width - 2 * columns * margin) / columns > MAX_COLUMN) margin = Math.floor((width - columns * MAX_COLUMN) / (2 * columns));
    const inner = width - 2 * margin;
    const columnWidth = Math.max(1, Math.floor((inner - (columns - 1) * 2 * margin) / columns));
    // Column gap = 2 × margin, so one page stride equals exactly the page width.
    this.width = width;
    this.height = height;
    const style = this.flow.style;
    style.transition = 'none';
    style.transform = 'translate3d(0, 0, 0)';
    style.left = margin + 'px';
    style.width = inner + 'px';
    style.height = height + 'px';
    style.columnGap = 2 * margin + 'px';
    style.setProperty('--page-height', height + 'px');
    this.applyColumns(spread, columnWidth);

    const origin = this.flow.getBoundingClientRect().left;
    const end = this.endMarker.getBoundingClientRect();
    const byMarker = Math.floor((end.left - origin + EPSILON) / width) + 1;
    const byScroll = Math.ceil((this.flow.scrollWidth + 2 * margin - EPSILON) / width);
    this.pages = Math.max(1, byMarker, byScroll);
    this.checkLayout(end);
  }

  // Safari 16 (WebKit) does not create a multi-column layout for "column-count: 1" with an
  // automatic column width: the chunk becomes one tall column that is cut off at the bottom.
  // A non-auto column-width always creates columns. The plain variant is kept as a fallback.
  applyColumns(spread, columnWidth) {
    const style = this.flow.style;
    const variants = spread
      ? [['2', columnWidth + 'px']]
      : [['auto', columnWidth + 'px'], ['1', 'auto']];
    for (const [count, width] of variants) {
      style.columnCount = count;
      style.columnWidth = width;
      if (!this.overflowing()) return;
    }
    // Nothing fits: keep the preferred variant; checkLayout() reports the problem.
    style.columnCount = variants[0][0];
    style.columnWidth = variants[0][1];
  }

  overflowing() {
    return this.flow.scrollHeight > this.height + EPSILON;
  }

  // Development check: text must never extend below the page, or it would be skipped.
  checkLayout(end) {
    const top = this.flow.getBoundingClientRect().top;
    if (!this.overflowing() && end.bottom <= top + this.height + EPSILON) return;
    console.warn('[reader] Column overflow: text extends below the page and may be skipped.', {
      pageHeight: this.height,
      contentHeight: this.flow.scrollHeight,
      columnCount: this.flow.style.columnCount,
      columnWidth: this.flow.style.columnWidth,
      section: this.section,
      chunk: this.chunk,
    });
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

  pageX(index) {
    return -index * this.width;
  }

  // Moves the text horizontally; duration 0 jumps without animation. Returns the duration used.
  setOffset(x, duration = 0) {
    const style = this.flow.style;
    const ms = duration && !reducedMotion() ? duration : 0;
    if (ms) {
      // Commit any pending instant move first, so the animation starts from the current position.
      void getComputedStyle(this.flow).transform;
      style.transition = `transform ${ms}ms ease-out`;
    } else {
      style.transition = 'none';
    }
    style.transform = `translate3d(${x}px, 0, 0)`;
    return ms;
  }

  apply(animate) {
    this.setOffset(this.pageX(this.pageIndex), animate ? TURN_MS : 0);
  }

  // Follows the finger during a swipe (dx in CSS pixels, negative = towards the next page).
  drag(dx) {
    if (this.busy) return;
    const edge = (dx > 0 && this.atStart) || (dx < 0 && this.atEnd);
    this.setOffset(this.pageX(this.pageIndex) + (edge ? dx * EDGE_RESISTANCE : dx));
  }

  // Returns to the current page after a cancelled swipe.
  settle() {
    if (!this.busy) this.apply(true);
  }

  // Chapter or chunk change: slide the old page out, then the new one in.
  async cross(sectionIndex, chunkIndex, target, direction) {
    this.busy = true;
    const token = this.token;
    const ms = this.setOffset(this.pageX(this.pageIndex + direction), EDGE_MS);
    if (ms) await delay(ms);
    // A jump (contents, bookmark) started meanwhile wins.
    if (token === this.token) await this.load(sectionIndex, chunkIndex, target, direction);
    return true;
  }

  // Returns false only at the end of the book.
  async next() {
    if (this.busy) return true;
    if (this.pageIndex < this.pages - 1) {
      this.pageIndex += 1;
      this.apply(true);
      this.emit();
      return true;
    }
    if (this.chunk + 1 < this.currentSection.chunks.length) return this.cross(this.section, this.chunk + 1, 'start', 1);
    if (this.section + 1 < this.book.sections.length) return this.cross(this.section + 1, 0, 'start', 1);
    return false;
  }

  // Returns false only at the start of the book.
  async previous() {
    if (this.busy) return true;
    if (this.pageIndex > 0) {
      this.pageIndex -= 1;
      this.apply(true);
      this.emit();
      return true;
    }
    if (this.chunk > 0) return this.cross(this.section, this.chunk - 1, 'end', -1);
    if (this.section > 0) {
      const previous = this.book.sections[this.section - 1];
      return this.cross(this.section - 1, previous.chunks.length - 1, 'end', -1);
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

  // Reader setting: side margin in CSS pixels. Call relayout() afterwards.
  setMargin(pixels) {
    const value = Math.round(Number(pixels));
    this.margin = Number.isFinite(value) && value >= 0 ? value : DEFAULT_MARGIN;
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
    const area = this.width * this.height;
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
