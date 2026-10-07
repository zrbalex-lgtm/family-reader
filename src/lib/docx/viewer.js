// DOCX songbook viewer helpers: rendering with docx-preview, sanitizing, search and fonts.

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

/**
 * Renders the document into `body` (pages) and `styles` (document CSS).
 * Returns a cleanup function that revokes blob URLs created for images and embedded fonts.
 */
export async function renderDocx(bytes, body, styles) {
  const { renderAsync } = await import('../../vendor/docx-preview/docx-preview.mjs');
  try {
    await renderAsync(bytes, body, styles, RENDER_OPTIONS);
  } catch (error) {
    throw new Error('This document could not be displayed. It may be damaged or use unsupported features.', { cause: error });
  }
  sanitize(body);
  sanitize(styles);
  if (!body.querySelector('section.docx')) throw new Error('This document has no pages to display.');
  return () => {
    const urls = new Set();
    for (const image of body.querySelectorAll('img[src^="blob:"]')) urls.add(image.getAttribute('src'));
    for (const style of styles.querySelectorAll('style')) {
      for (const match of style.textContent.matchAll(BLOB_IN_CSS)) urls.add(match[2]);
    }
    for (const url of urls) URL.revokeObjectURL(url);
  };
}

// --- Search ---------------------------------------------------------------

// Case-insensitive and ё = е, keeping a 1:1 character mapping so offsets stay valid.
function foldChar(character) {
  const lower = character.toLowerCase();
  const single = lower.length === 1 ? lower : character;
  return single === 'ё' ? 'е' : single;
}

function fold(text) {
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
