// DOCX songbook viewer helpers: rendering with docx-preview, sanitizing, search, fonts and song list.
import { openArchive, readEntry } from '../archives.js';
import { children, decodeXml, parseXml } from '../xml.js';

// Rendering options. Embedded HTML ("altChunks") is disabled because it would run inside an
// iframe; comments and tracked changes are not shown. Experimental mode enables real tab stops,
// which matter for chords aligned above lyrics.
const RENDER_OPTIONS = {
  className: 'docx',
  inWrapper: true,
  breakPages: true,
  ignoreWidth: false,
  ignoreHeight: false,
  ignoreFonts: false,
  // Use the page breaks Word saved in the file, so pages match Word instead of one long page.
  ignoreLastRenderedPageBreak: false,
  experimental: true,
  renderHeaders: true,
  renderFooters: true,
  renderFootnotes: true,
  renderEndnotes: true,
  renderComments: false,
  renderChanges: false,
  renderAltChunks: false,
  useBase64URL: false,
};

const SAFE_LINK = /^(https?:|mailto:)/i;
const BLOB_IN_CSS = /url\((['"]?)(blob:[^'")]+)\1\)/g;

// Uploaded documents are untrusted: remove active content and unsafe link targets.
function sanitize(root) {
  for (const element of root.querySelectorAll('script, iframe, object, embed, form, base, meta, link')) element.remove();
  for (const element of root.querySelectorAll('*')) {
    for (const attribute of Array.from(element.attributes)) {
      if (/^on/i.test(attribute.name)) element.removeAttribute(attribute.name);
    }
  }
  for (const link of root.querySelectorAll('a[href]')) {
    const href = link.getAttribute('href').trim();
    if (href.startsWith('#')) continue;
    if (SAFE_LINK.test(href)) {
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    } else {
      link.removeAttribute('href');
    }
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, ms) {
  return Promise.race([Promise.resolve(promise).catch(() => {}), delay(ms)]);
}

// Fonts named by the document's font table and theme, except fonts embedded in the file.
function modelFonts(doc) {
  const names = new Map();
  const add = (name) => {
    const clean = (name || '').trim();
    if (clean && !GENERIC.has(clean.toLowerCase())) names.set(clean.toLowerCase(), clean);
  };
  for (const font of doc.fontTablePart?.fonts || []) if (!font.embedFontRefs?.length) add(font.name);
  const scheme = doc.themePart?.theme?.fontScheme;
  add(scheme?.majorFont?.latinTypeface);
  add(scheme?.minorFont?.latinTypeface);
  return Array.from(names.values());
}

// docx-preview starts a new page only at explicit page breaks (or when the page size changes).
// Word also starts a new page at every section break that is not "continuous" (the default
// "next page" type), which is how many songbooks put each song on its own page. A section's
// own type says how it begins, so the break goes at the end of the section before it.
function addSectionPageBreaks(doc) {
  const body = doc.documentPart?.body;
  if (!body?.children) return;
  const sectionEnds = body.children.filter((element) => element.type === 'paragraph' && element.sectionProps);
  sectionEnds.forEach((paragraph, index) => {
    const next = index + 1 < sectionEnds.length ? sectionEnds[index + 1].sectionProps : body.props;
    const type = next?.type || 'nextPage';
    if (type === 'continuous' || type === 'nextColumn') return;
    // A run holding a page break; it renders as an empty span.
    paragraph.children = [...(paragraph.children || []), { type: 'run', children: [{ type: 'break', break: 'page' }] }];
  });
}

/**
 * Renders the document into `body` (pages) and `styles` (document CSS).
 * Missing fonts with a metric-compatible substitute are loaded before rendering, because
 * docx-preview measures tab stops (chord positions) 500 ms after rendering.
 * Returns { cleanup, fontIssues }: cleanup revokes blob URLs for images and embedded fonts.
 */
export async function renderDocx(bytes, body, styles) {
  const { parseAsync, renderDocument } = await import('../../vendor/docx-preview/docx-preview.mjs');
  let doc;
  try {
    doc = await parseAsync(bytes, RENDER_OPTIONS);
  } catch (error) {
    throw new Error('This document could not be opened. It may be damaged or not a Word document.', { cause: error });
  }

  styles.replaceChildren();
  body.replaceChildren();
  await withTimeout(document.fonts?.ready, 2000);
  const missing = modelFonts(doc).filter((name) => !fontAvailable(name));
  const substituted = new Map();
  await Promise.all(missing.map(async (name) => {
    const substitute = substituteFor(name);
    if (substitute && await aliasFont(name, substitute, styles)) substituted.set(name.toLowerCase(), substitute);
  }));
  if (substituted.size && document.fonts) {
    const loads = [];
    for (const name of missing) {
      if (!substituted.has(name.toLowerCase())) continue;
      for (const variant of ['', 'bold ', 'italic ']) loads.push(document.fonts.load(`${variant}16px "${name.replace(/"/g, '')}"`, 'AaАа'));
    }
    await withTimeout(Promise.all(loads), 4000);
  }

  addSectionPageBreaks(doc);
  let nodes;
  try {
    nodes = await renderDocument(doc, RENDER_OPTIONS);
  } catch (error) {
    throw new Error('This document could not be displayed. It may use unsupported features.', { cause: error });
  }
  for (const node of nodes) (node.nodeName === 'STYLE' ? styles : body).appendChild(node);
  sanitize(body);
  sanitize(styles);
  if (!body.querySelector('section.docx')) throw new Error('This document has no pages to display.');
  // Tab stops are measured from the live layout 500 ms after rendering; keep pages laid out until then.
  if (RENDER_OPTIONS.experimental) await delay(650);

  // Report only fonts the rendered text actually uses.
  const used = new Set(usedFonts(body, styles).map((name) => name.toLowerCase()));
  const fontIssues = missing
    .filter((name) => used.has(name.toLowerCase()))
    .map((name) => ({ name, substitute: substituted.get(name.toLowerCase()) || null }));

  const cleanup = () => {
    const urls = new Set();
    for (const image of body.querySelectorAll('img[src^="blob:"]')) urls.add(image.getAttribute('src'));
    for (const style of styles.querySelectorAll('style')) {
      for (const match of style.textContent.matchAll(BLOB_IN_CSS)) urls.add(match[2]);
    }
    for (const url of urls) URL.revokeObjectURL(url);
  };
  return { cleanup, fontIssues };
}

// --- Search ---------------------------------------------------------------

// Case-insensitive and ё = е, keeping a 1:1 character mapping so offsets stay valid.
function foldChar(character) {
  const lower = character.toLowerCase();
  const single = lower.length === 1 ? lower : character;
  return single === 'ё' ? 'е' : single;
}

export function fold(text) {
  let result = '';
  for (let index = 0; index < text.length; index += 1) result += foldChar(text[index]);
  return result;
}

function wrapPiece(node, from, to) {
  if (to < node.data.length) node.splitText(to);
  const target = from > 0 ? node.splitText(from) : node;
  const mark = document.createElement('mark');
  mark.className = 'doc-match';
  target.parentNode.insertBefore(mark, target);
  mark.append(target);
  return mark;
}

/**
 * Highlights all matches inside root. Word splits text into many runs, so matches may span
 * several text nodes; each match becomes one or more <mark> elements.
 */
export function createSearch(root) {
  let groups = [];

  function clear() {
    const parents = new Set();
    for (const group of groups) {
      for (const mark of group) {
        const parent = mark.parentNode;
        if (!parent) continue;
        mark.replaceWith(...mark.childNodes);
        parents.add(parent);
      }
    }
    for (const parent of parents) parent.normalize();
    groups = [];
  }

  function find(query) {
    clear();
    const needle = fold(query.trim());
    if (!needle) return groups;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let text = '';
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.data) continue;
      nodes.push({ node, start: text.length });
      text += fold(node.data);
    }
    const matches = [];
    for (let index = text.indexOf(needle); index !== -1; index = text.indexOf(needle, index + needle.length)) {
      matches.push([index, index + needle.length]);
    }
    groups = matches.map(() => []);
    // Wrap from the last match backwards so earlier node offsets stay valid while splitting.
    let nodeIndex = nodes.length - 1;
    for (let match = matches.length - 1; match >= 0; match -= 1) {
      const [start, end] = matches[match];
      while (nodeIndex > 0 && nodes[nodeIndex].start >= end) nodeIndex -= 1;
      for (let index = nodeIndex; index >= 0 && nodes[index].start + nodes[index].node.data.length > start; index -= 1) {
        const entry = nodes[index];
        if (entry.start >= end) continue;
        const from = Math.max(0, start - entry.start);
        const to = Math.min(entry.node.data.length, end - entry.start);
        if (to > from) groups[match].unshift(wrapPiece(entry.node, from, to));
      }
    }
    groups = groups.filter((group) => group.length);
    return groups;
  }

  return { find, clear };
}

// --- Fonts ----------------------------------------------------------------

const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'inherit', 'initial', 'unset', 'symbol', 'wingdings']);

// Metric-compatible substitutes available from Google Fonts.
const SUBSTITUTES = {
  calibri: 'Carlito',
  'calibri light': 'Carlito',
  cambria: 'Caladea',
  arial: 'Arimo',
  helvetica: 'Arimo',
  'times new roman': 'Tinos',
  'courier new': 'Cousine',
  courier: 'Cousine',
};

function firstFamily(value) {
  const name = (value || '').split(',')[0].trim().replace(/^['"]|['"]$/g, '').trim();
  if (!name || name.startsWith('var(') || GENERIC.has(name.toLowerCase())) return '';
  return name;
}

// Font families the document asks for, from inline styles, document styles and theme fonts.
export function usedFonts(body, styles) {
  const names = new Map();
  const add = (value) => {
    const name = firstFamily(value);
    if (name && !names.has(name.toLowerCase())) names.set(name.toLowerCase(), name);
  };
  for (const element of body.querySelectorAll('[style*="font-family"]')) add(element.style.fontFamily);
  for (const style of styles.querySelectorAll('style')) {
    const text = style.textContent;
    if (/@font-face/.test(text)) continue;
    for (const match of text.matchAll(/font-family:\s*([^;}]+)/g)) add(match[1]);
    for (const match of text.matchAll(/--docx-[\w-]+-font:\s*([^;}]+)/g)) add(match[1]);
  }
  return Array.from(names.values());
}

let canvas = null;

// A font is installed (or loaded) if text measures differently from every generic fallback.
export function fontAvailable(name) {
  canvas ||= document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return true;
  const sample = 'mmmmmmmmmlliiWWАБВЖщ0123';
  const quoted = '"' + name.replace(/"/g, '') + '"';
  return ['monospace', 'serif', 'sans-serif'].some((fallback) => {
    context.font = `72px ${fallback}`;
    const base = context.measureText(sample).width;
    context.font = `72px ${quoted}, ${fallback}`;
    return Math.abs(context.measureText(sample).width - base) > 0.5;
  });
}

export function substituteFor(name) {
  return SUBSTITUTES[name.toLowerCase()] || null;
}

// Loads the substitute from Google Fonts under the original family name, so the document's
// own font names render with metric-compatible glyphs. Returns false if it could not load.
export async function aliasFont(original, substitute, target) {
  const family = substitute.replace(/ /g, '+');
  try {
    const response = await fetch(`https://fonts.googleapis.com/css2?family=${family}:ital,wght@0,400;0,700;1,400;1,700&display=swap`);
    if (!response.ok) return false;
    const css = await response.text();
    if (!/@font-face/.test(css)) return false;
    const style = document.createElement('style');
    style.textContent = css.replace(/font-family:\s*'[^']*'/g, `font-family: '${original.replace(/['\\]/g, '')}'`);
    target.append(style);
    return true;
  } catch {
    return false;
  }
}

// --- Song list ------------------------------------------------------------

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const HEADING_NAME = /^(heading|заголовок)\s*\d$/i;

function wAttr(element, name) {
  return element?.getAttributeNS(W_NS, name) ?? element?.getAttribute('w:' + name) ?? null;
}

function cleanTitle(text) {
  return text.replace(/\s+/g, ' ').trim().slice(0, 140);
}

// docx-preview's class name for a paragraph style id (see escapeClassName in the vendored file).
function styleClass(id) {
  return 'docx_' + id.replace(/[ .]+/g, '-').replace(/[&]+/g, 'and').toLowerCase();
}

// Paragraph styles that are headings: built-in "Heading N" / "Заголовок N", or any style with
// an outline level, including styles based on one of those.
async function headingClasses(zip) {
  const entry = zip.file('word/styles.xml');
  if (!entry) return new Set();
  const root = parseXml(decodeXml(await readEntry(entry))).documentElement;
  const styles = new Map();
  for (const style of children(root, 'style')) {
    if (wAttr(style, 'type') !== 'paragraph') continue;
    const id = wAttr(style, 'styleId');
    if (!id) continue;
    const name = wAttr(children(style, 'name')[0], 'val') || '';
    const outline = wAttr(children(children(style, 'pPr')[0], 'outlineLvl')[0], 'val');
    styles.set(id, {
      basedOn: wAttr(children(style, 'basedOn')[0], 'val'),
      heading: HEADING_NAME.test(name.trim()) || (outline !== null && Number(outline) < 9),
    });
  }
  const isHeading = (id, depth = 0) => {
    const style = styles.get(id);
    if (!style || depth > 10) return false;
    return style.heading || (style.basedOn ? isHeading(style.basedOn, depth + 1) : false);
  };
  return new Set(Array.from(styles.keys()).filter((id) => isHeading(id)).map(styleClass));
}

// Texts of paragraphs that have a direct outline level (set on the paragraph, not its style).
async function directOutlineTitles(zip) {
  const entry = zip.file('word/document.xml');
  if (!entry) return new Set();
  const xml = decodeXml(await readEntry(entry));
  // Parsing the whole document is slow on old devices; skip it when no paragraph uses an outline level.
  if (!xml.includes('outlineLvl')) return new Set();
  const titles = new Set();
  for (const level of parseXml(xml).getElementsByTagNameNS(W_NS, 'outlineLvl')) {
    const paragraph = level.parentNode?.parentNode;
    if (paragraph?.localName !== 'p' || Number(wAttr(level, 'val')) >= 9) continue;
    const text = Array.from(paragraph.getElementsByTagNameNS(W_NS, 't'), (node) => node.textContent).join('');
    if (text.trim()) titles.add(fold(cleanTitle(text)));
  }
  return titles;
}

function fromHeadings(pages, classes, direct) {
  const songs = [];
  pages.forEach((page, index) => {
    for (const paragraph of page.querySelectorAll('article p')) {
      const title = cleanTitle(paragraph.textContent);
      if (!title) continue;
      const styled = Array.from(paragraph.classList).some((name) => classes.has(name));
      if (styled || direct.has(fold(title))) songs.push({ title, page: index });
    }
  });
  return songs;
}

// No headings: use the first non-empty paragraph of each page, but only when it is formatted
// like most other page starts (so a song continuing on the next page is not listed twice).
function fromPageStarts(pages) {
  const candidates = [];
  pages.forEach((page, index) => {
    const paragraph = Array.from(page.querySelectorAll('article p')).find((element) => element.textContent.trim());
    if (!paragraph) return;
    const sample = Array.from(paragraph.querySelectorAll('span')).find((span) => span.textContent.trim()) || paragraph;
    const style = getComputedStyle(sample);
    const size = Math.round(parseFloat(style.fontSize) * 2) / 2;
    const bold = (parseInt(style.fontWeight, 10) || 400) >= 600;
    candidates.push({ title: cleanTitle(paragraph.textContent), page: index, size, bold, key: `${paragraph.className}|${size}|${bold}` });
  });
  if (!candidates.length) return [];
  const counts = new Map();
  for (const candidate of candidates) counts.set(candidate.key, (counts.get(candidate.key) || 0) + 1);
  const [majorityKey] = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0];
  const majority = candidates.find((candidate) => candidate.key === majorityKey);
  return candidates
    .filter((candidate) => candidate.key === majorityKey || (candidate.bold === majority.bold && candidate.size >= majority.size))
    .map(({ title, page }) => ({ title, page }));
}

/**
 * Builds the song list: [{ title, page }] with zero-based page indexes.
 * Prefers Word headings; falls back to page starts when headings are absent or too few
 * to be a song list (for example only a book title and a few section headings).
 */
export async function buildSongList(bytes, pages) {
  let classes = new Set();
  let direct = new Set();
  try {
    const zip = await openArchive(bytes);
    [classes, direct] = await Promise.all([headingClasses(zip), directOutlineTitles(zip)]);
  } catch {
    // Unreadable styles: use the page-start fallback.
  }
  const headings = classes.size || direct.size ? fromHeadings(pages, classes, direct) : [];
  let songs = headings;
  if (headings.length < Math.max(3, pages.length * 0.25)) {
    const starts = fromPageStarts(pages);
    if (starts.length > headings.length) songs = starts;
  }
  // A title repeated at the top of the next page belongs to the same song.
  return songs.filter((song, index) => {
    const previous = songs[index - 1];
    return !previous || fold(previous.title) !== fold(song.title) || song.page - previous.page > 1;
  });
}
