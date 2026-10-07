// One-page-at-a-time layout for rendered DOCX pages.
// Only the current page and its neighbours are displayed; the "camera" (content transform)
// pans and zooms the current page and slides between pages.

const GAP = 24;
const GUTTER = 8;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 5;
const TURN_MS = 260;
// Dragging past the first or last page moves the page only a little.
const EDGE_RESISTANCE = 0.35;
// A drag beyond the page edge longer than this turns the page.
const TURN_DISTANCE = 60;

function reducedMotion() {
  return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export class DocPager {
  /**
   * stage: the visible area (overflow hidden); content: element moved by the camera;
   * pages: rendered section elements; onChange({ index, count, zoom, mode }) after every change.
   */
  constructor(stage, content, pages, onChange) {
    this.stage = stage;
    this.content = content;
    this.pages = pages;
    this.onChange = onChange;
    this.index = 0;
    this.zoom = 1;
    // 'page' | 'width' keep their fit after rotation; 'custom' keeps the zoom value.
    this.mode = 'page';
    this.x = 0;
    this.y = 0;
    this.excess = 0;
    this.busy = false;
    this.visible = new Set();
    this.dragOrigin = null;
  }

  get count() { return this.pages.length; }

  // --- Layout ---

  size(index) {
    const page = this.pages[index];
    return { width: Math.max(1, page.offsetWidth), height: Math.max(1, page.offsetHeight) };
  }

  // Shows the current page and its neighbours side by side in natural (unscaled) units.
  layout() {
    const wanted = new Set([this.index - 1, this.index, this.index + 1].filter((index) => index >= 0 && index < this.count));
    for (const index of this.visible) if (!wanted.has(index)) this.pages[index].classList.remove('doc-visible');
    for (const index of wanted) this.pages[index].classList.add('doc-visible');
    this.visible = wanted;
    this.pages[this.index].style.transform = 'translate3d(0, 0, 0)';
    if (wanted.has(this.index + 1)) this.pages[this.index + 1].style.transform = `translate3d(${this.size(this.index).width + GAP}px, 0, 0)`;
    if (wanted.has(this.index - 1)) this.pages[this.index - 1].style.transform = `translate3d(${-(this.size(this.index - 1).width + GAP)}px, 0, 0)`;
  }

  viewport() {
    return { width: Math.max(1, this.stage.clientWidth), height: Math.max(1, this.stage.clientHeight) };
  }

  fitZoom(mode, index = this.index) {
    const { width, height } = this.size(index);
    const view = this.viewport();
    const byWidth = (view.width - 2 * GUTTER) / width;
    return clamp(mode === 'width' ? byWidth : Math.min(byWidth, (view.height - 2 * GUTTER) / height), MIN_ZOOM, MAX_ZOOM);
  }

  // Allowed camera positions for a page: centred when it fits, otherwise its edges stay inside.
  bounds(index = this.index, zoom = this.zoom) {
    const { width, height } = this.size(index);
    const view = this.viewport();
    const axis = (page, room) => (page + 2 * GUTTER <= room
      ? { min: (room - page) / 2, max: (room - page) / 2 }
      : { min: room - GUTTER - page, max: GUTTER });
    const x = axis(width * zoom, view.width);
    const y = axis(height * zoom, view.height);
    return { minX: x.min, maxX: x.max, minY: y.min, maxY: y.max };
  }

  overflow() {
    const b = this.bounds();
    return { x: b.minX < b.maxX, y: b.minY < b.maxY };
  }

  clampCamera() {
    const b = this.bounds();
    this.x = clamp(this.x, b.minX, b.maxX);
    this.y = clamp(this.y, b.minY, b.maxY);
  }

  // Moves the content; returns the animation duration used (0 = instant).
  apply(duration = 0) {
    const style = this.content.style;
    const ms = duration && !reducedMotion() ? duration : 0;
    if (ms) {
      // Commit pending instant changes first, so the animation starts from the current position.
      void getComputedStyle(this.content).transform;
      style.transition = `transform ${ms}ms ease-out`;
    } else {
      style.transition = 'none';
    }
    style.transform = `translate3d(${this.x + this.excess}px, ${this.y}px, 0) scale(${this.zoom})`;
    return ms;
  }

  emit() {
    this.onChange({ index: this.index, count: this.count, zoom: this.zoom, mode: this.mode });
  }

  // --- Navigation ---

  // Opens a page instantly at its top (used on open, from the song list and search).
  show(index, { zoom = null, mode = null } = {}) {
    this.index = clamp(Math.trunc(index) || 0, 0, this.count - 1);
    if (mode) this.mode = mode;
    this.layout();
    this.zoom = this.mode === 'custom' ? clamp(zoom ?? this.zoom, MIN_ZOOM, MAX_ZOOM) : this.fitZoom(this.mode);
    const b = this.bounds();
    this.x = b.maxX;
    this.y = b.maxY;
    this.excess = 0;
    this.apply();
    this.emit();
  }

  // Slides to the next (+1) or previous (-1) page. Returns false at the first/last page.
  async turn(direction) {
    if (this.busy) return true;
    const target = this.index + direction;
    if (target < 0 || target >= this.count) {
      this.settle();
      return false;
    }
    this.busy = true;
    const zoom = this.mode === 'custom' ? this.zoom : this.fitZoom(this.mode, target);
    const targetBounds = this.bounds(target, zoom);
    // Where the target page sits in content units relative to the current page.
    const offset = direction > 0 ? this.size(this.index).width + GAP : -(this.size(target).width + GAP);
    this.x = targetBounds.maxX - offset * zoom;
    this.y = targetBounds.maxY;
    this.excess = 0;
    this.zoom = zoom;
    const ms = this.apply(TURN_MS);
    if (ms) await new Promise((resolve) => setTimeout(resolve, ms));
    // Re-base on the new page; visually nothing moves.
    this.index = target;
    this.layout();
    this.x = targetBounds.maxX;
    this.apply();
    this.busy = false;
    this.emit();
    return true;
  }

  settle() {
    this.excess = 0;
    this.clampCamera();
    this.apply(TURN_MS);
  }

  // --- Zoom and pan ---

  // mode: 'page' | 'width' | 'actual' (100 %, stored as a custom zoom).
  setMode(mode) {
    if (this.busy) return;
    const actual = mode === 'actual';
    this.mode = actual ? 'custom' : mode;
    const previous = this.zoom;
    this.zoom = actual ? 1 : this.fitZoom(mode);
    // Keep the top of the visible part of the page in place when the zoom changes.
    const b = this.bounds();
    this.x = this.zoom === previous ? this.x : b.maxX;
    this.y = this.zoom === previous ? this.y : clamp(this.y, b.minY, b.maxY);
    this.clampCamera();
    this.apply(TURN_MS);
    this.emit();
  }

  // Zooms around a point of the stage (client coordinates).
  zoomAt(value, clientX, clientY) {
    if (this.busy) return;
    const box = this.stage.getBoundingClientRect();
    const fx = clientX - box.left;
    const fy = clientY - box.top;
    const zoom = clamp(value, MIN_ZOOM, MAX_ZOOM);
    const cx = (fx - this.x) / this.zoom;
    const cy = (fy - this.y) / this.zoom;
    this.zoom = zoom;
    this.mode = 'custom';
    this.x = fx - cx * zoom;
    this.y = fy - cy * zoom;
    this.clampCamera();
    this.apply();
    this.emit();
  }

  // Pinch: zoom relative to the start and follow the midpoint (client coordinates).
  pinchStart(midX, midY) {
    const box = this.stage.getBoundingClientRect();
    this.pinchOrigin = { zoom: this.zoom, cx: (midX - box.left - this.x) / this.zoom, cy: (midY - box.top - this.y) / this.zoom };
    this.excess = 0;
  }

  pinchMove(scale, midX, midY) {
    if (!this.pinchOrigin || this.busy) return;
    const box = this.stage.getBoundingClientRect();
    this.zoom = clamp(this.pinchOrigin.zoom * scale, MIN_ZOOM, MAX_ZOOM);
    this.mode = 'custom';
    this.x = midX - box.left - this.pinchOrigin.cx * this.zoom;
    this.y = midY - box.top - this.pinchOrigin.cy * this.zoom;
    this.clampCamera();
    this.apply();
  }

  pinchEnd() {
    this.pinchOrigin = null;
    this.emit();
  }

  dragStart() {
    this.dragOrigin = { x: this.x, y: this.y };
    this.excess = 0;
  }

  /**
   * One-finger drag. Movement inside the page pans; movement beyond the page's left/right
   * edge becomes a page-turn drag that follows the finger. lock: 'x', 'y' or null.
   */
  dragMove(dx, dy, lock) {
    if (!this.dragOrigin || this.busy) return;
    const b = this.bounds();
    const wantX = lock === 'y' ? this.dragOrigin.x : this.dragOrigin.x + dx;
    const wantY = lock === 'x' ? this.dragOrigin.y : this.dragOrigin.y + dy;
    this.x = clamp(wantX, b.minX, b.maxX);
    this.y = clamp(wantY, b.minY, b.maxY);
    let excess = wantX - this.x;
    if ((excess > 0 && this.index === 0) || (excess < 0 && this.index === this.count - 1)) excess *= EDGE_RESISTANCE;
    this.excess = excess;
    this.apply();
  }

  // Returns +1 / -1 when the drag should turn the page, otherwise snaps back and returns 0.
  dragEnd() {
    this.dragOrigin = null;
    if (this.excess < -TURN_DISTANCE && this.index < this.count - 1) return 1;
    if (this.excess > TURN_DISTANCE && this.index > 0) return -1;
    if (this.excess) this.settle();
    return 0;
  }

  // Wheel / keyboard panning inside the page. Returns how much movement was left over.
  pan(dx, dy) {
    if (this.busy) return { x: dx, y: dy };
    const before = { x: this.x, y: this.y };
    this.x += dx;
    this.y += dy;
    this.clampCamera();
    this.apply();
    return { x: dx - (this.x - before.x), y: dy - (this.y - before.y) };
  }

  // Brings a rectangle (client coordinates) of the current page into view.
  reveal(rect) {
    const box = this.stage.getBoundingClientRect();
    const view = this.viewport();
    if (rect.left < box.left + GUTTER || rect.right > box.right - GUTTER) this.x += view.width / 2 - (rect.left + rect.width / 2 - box.left);
    if (rect.top < box.top + GUTTER || rect.bottom > box.bottom - GUTTER) this.y += view.height / 2 - (rect.top + rect.height / 2 - box.top);
    this.clampCamera();
    this.apply(TURN_MS);
  }

  // After rotation, resize or late font loading: refit and keep the camera inside the page.
  refresh() {
    if (this.busy) return;
    this.layout();
    if (this.mode !== 'custom') {
      const previous = this.zoom;
      this.zoom = this.fitZoom(this.mode);
      if (this.zoom !== previous) this.x = this.bounds().maxX;
    }
    this.clampCamera();
    this.apply();
    this.emit();
  }
}
