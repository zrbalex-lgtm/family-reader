import { writable, get } from 'svelte/store';
import { supabase } from './supabase.js';
import { idbGet, idbSet } from './idb.js';
import { deviceClass } from './device.js';

// Fonts with Cyrillic coverage. Web fonts load on demand from Google Fonts.
export const FONTS = {
  literata: { label: 'Literata', stack: "'Literata', Georgia, serif", css: 'Literata:ital,opsz,wght@0,7..72,400;0,7..72,600;1,7..72,400' },
  'pt-serif': { label: 'PT Serif', stack: "'PT Serif', Georgia, serif", css: 'PT+Serif:ital,wght@0,400;0,700;1,400' },
  'pt-sans': { label: 'PT Sans', stack: "'PT Sans', -apple-system, 'Segoe UI', sans-serif", css: 'PT+Sans:ital,wght@0,400;0,700;1,400' },
  inter: { label: 'Inter', stack: "'Inter', -apple-system, 'Segoe UI', sans-serif", css: 'Inter:ital,wght@0,400;0,600;1,400' },
  serif: { label: 'System serif', stack: "Georgia, 'Times New Roman', serif", css: null },
  system: { label: 'System sans', stack: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", css: null },
};

export const THEMES = {
  light: { label: 'Light', bg: '#fbfaf7', text: '#1d1c1a', muted: '#6f6b64', accent: '#9a6b23' },
  sepia: { label: 'Sepia', bg: '#f3e9d6', text: '#3b2f22', muted: '#7d6b55', accent: '#93611f' },
  dark: { label: 'Dark', bg: '#14191d', text: '#e4e1d9', muted: '#8f989e', accent: '#d2ab70' },
  black: { label: 'Black', bg: '#000000', text: '#c9c7c2', muted: '#7a7a7a', accent: '#c39a5c' },
  custom: { label: 'Custom' },
};

export const LIMITS = {
  fontSize: { min: 13, max: 34, step: 1 },
  lineHeight: { min: 1.2, max: 2.1, step: 0.05 },
  margin: { min: 8, max: 72, step: 4 },
};

const COLOR = /^#[0-9a-f]{6}$/i;
const OLD_FULLSCREEN_KEY = 'family-reader:reader-fullscreen';

export function defaultSettings(kind = deviceClass()) {
  let fullscreen = false;
  // One-time carry-over of the Stage 3 browser preference.
  try { fullscreen = localStorage.getItem(OLD_FULLSCREEN_KEY) === 'on'; } catch { /* Storage unavailable. */ }
  return {
    font: 'literata',
    fontSize: kind === 'phone' ? 18 : 20,
    lineHeight: 1.55,
    margin: kind === 'phone' ? 20 : 32,
    justify: true,
    hyphens: true,
    theme: 'dark',
    customBg: '#1e1b16',
    customText: '#e8e0d0',
    fullscreen,
    updatedAt: 0,
  };
}

function clamp(value, { min, max }, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

// Settings come from the user's own row, but are still validated before use.
export function sanitizeSettings(input, kind = deviceClass()) {
  const base = defaultSettings(kind);
  const value = input && typeof input === 'object' ? input : {};
  return {
    font: Object.hasOwn(FONTS, value.font) ? value.font : base.font,
    fontSize: clamp(value.fontSize, LIMITS.fontSize, base.fontSize),
    lineHeight: Math.round(clamp(value.lineHeight, LIMITS.lineHeight, base.lineHeight) * 100) / 100,
    margin: clamp(value.margin, LIMITS.margin, base.margin),
    justify: typeof value.justify === 'boolean' ? value.justify : base.justify,
    hyphens: typeof value.hyphens === 'boolean' ? value.hyphens : base.hyphens,
    theme: Object.hasOwn(THEMES, value.theme) ? value.theme : base.theme,
    customBg: COLOR.test(value.customBg) ? value.customBg : base.customBg,
    customText: COLOR.test(value.customText) ? value.customText : base.customText,
    fullscreen: typeof value.fullscreen === 'boolean' ? value.fullscreen : base.fullscreen,
    updatedAt: Number.isFinite(Number(value.updatedAt)) ? Number(value.updatedAt) : 0,
  };
}

export const readerSettings = writable(defaultSettings());

let owner = null;
let kind = deviceClass();
let pushTimer = 0;
let loadToken = 0;

function storageKey(userId) { return userId + ':' + kind; }

export function currentDeviceClass() { return kind; }

// Local settings apply before this resolves; the server row for this device class is
// checked in the background and wins when it is newer.
export async function loadReaderSettings(userId) {
  if (!userId) return;
  const token = ++loadToken;
  if (owner !== userId) {
    owner = userId;
    kind = deviceClass();
    readerSettings.set(defaultSettings(kind));
  }
  let local = null;
  try { local = await idbGet('settings', storageKey(userId)); } catch { /* Local storage unavailable. */ }
  if (token !== loadToken) return;
  if (local) readerSettings.set(sanitizeSettings(local, kind));
  void syncRemoteSettings(userId, token);
}

async function syncRemoteSettings(userId, token) {
  if (!supabase) return;
  try {
    const { data, error } = await supabase.from('user_settings').select('settings')
      .eq('user_id', userId).eq('device_class', kind).maybeSingle();
    if (error || token !== loadToken || owner !== userId) return;
    const remote = data ? sanitizeSettings(data.settings, kind) : null;
    const current = get(readerSettings);
    if (remote && remote.updatedAt > current.updatedAt) {
      readerSettings.set(remote);
      void idbSet('settings', storageKey(userId), remote).catch(() => {});
    } else if (current.updatedAt > (remote?.updatedAt || 0)) {
      schedulePush();
    }
  } catch { /* Offline: keep local settings. */ }
}

export function updateReaderSettings(patch) {
  if (!owner) return;
  const next = sanitizeSettings({ ...get(readerSettings), ...patch, updatedAt: Date.now() }, kind);
  readerSettings.set(next);
  void idbSet('settings', storageKey(owner), next).catch(() => {});
  schedulePush();
}

export function resetReaderSettings() {
  const { fullscreen } = get(readerSettings);
  updateReaderSettings({ ...defaultSettings(kind), fullscreen });
}

function schedulePush() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushSettings, 800);
}

async function pushSettings() {
  const userId = owner;
  if (!userId || !supabase) return;
  const settings = get(readerSettings);
  try {
    await supabase.from('user_settings')
      .upsert({ user_id: userId, device_class: kind, settings }, { onConflict: 'user_id,device_class' });
  } catch { /* Retried on the next change or load. */ }
}

const loadedFonts = new Map();

// Injects the Google Fonts stylesheet once and waits (bounded) for the regular face.
export function ensureFont(name) {
  const font = FONTS[name];
  if (!font?.css) return Promise.resolve();
  if (!loadedFonts.has(name)) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${font.css}&display=swap`;
    document.head.append(link);
    const family = font.stack.split(',')[0];
    const ready = new Promise((resolve) => {
      link.onload = () => {
        Promise.all([document.fonts.load(`1em ${family}`, 'Аа'), document.fonts.load(`italic 1em ${family}`, 'Аа')])
          .catch(() => {}).then(() => resolve());
      };
      link.onerror = () => resolve();
    });
    loadedFonts.set(name, Promise.race([ready, new Promise((resolve) => setTimeout(resolve, 3000))]));
  }
  return loadedFonts.get(name);
}

// CSS variables consumed by reader.css.
export function readerStyle(settings) {
  const theme = settings.theme === 'custom'
    ? { bg: settings.customBg, text: settings.customText, muted: settings.customText + 'a6', accent: settings.customText }
    : THEMES[settings.theme];
  return [
    `--reader-bg: ${theme.bg}`,
    `--reader-text: ${theme.text}`,
    `--reader-muted: ${theme.muted}`,
    `--reader-accent: ${theme.accent}`,
    `--reader-font: ${FONTS[settings.font].stack}`,
    `--reader-font-size: ${settings.fontSize}px`,
    `--reader-line-height: ${settings.lineHeight}`,
    `--reader-align: ${settings.justify ? 'justify' : 'left'}`,
    `--reader-hyphens: ${settings.hyphens ? 'auto' : 'manual'}`,
  ].join('; ');
}

// Only these fields change the text layout; themes do not re-paginate.
export function layoutKey(settings) {
  return [settings.font, settings.fontSize, settings.lineHeight, settings.margin, settings.justify, settings.hyphens].join('|');
}
