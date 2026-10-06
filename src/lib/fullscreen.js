// Full-screen reading support. The preference is stored locally for now and moves into
// reader settings in Stage 4.
const PREFERENCE_KEY = 'family-reader:reader-fullscreen';

const root = () => document.documentElement;

// An installed home-screen app already runs without browser UI.
export function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
}

// iPhone Safari reports no element full screen support, so the option is hidden there.
export function fullscreenSupported() {
  if (isStandalone()) return false;
  return Boolean(document.fullscreenEnabled || document.webkitFullscreenEnabled);
}

export function isFullscreen() {
  return Boolean(document.fullscreenElement || document.webkitFullscreenElement);
}

export async function enterFullscreen() {
  if (!fullscreenSupported() || isFullscreen()) return;
  const element = root();
  try {
    if (element.requestFullscreen) await element.requestFullscreen({ navigationUI: 'hide' });
    else element.webkitRequestFullscreen?.();
  } catch {
    // The browser refused (for example without a user gesture); reading continues normally.
  }
}

export async function exitFullscreen() {
  if (!isFullscreen()) return;
  try {
    if (document.exitFullscreen) await document.exitFullscreen();
    else document.webkitExitFullscreen?.();
  } catch {
    // Ignore: the user may already have left full screen.
  }
}

export function onFullscreenChange(callback) {
  document.addEventListener('fullscreenchange', callback);
  document.addEventListener('webkitfullscreenchange', callback);
  return () => {
    document.removeEventListener('fullscreenchange', callback);
    document.removeEventListener('webkitfullscreenchange', callback);
  };
}

export function fullscreenPreference() {
  try { return localStorage.getItem(PREFERENCE_KEY) === 'on'; } catch { return false; }
}

export function setFullscreenPreference(value) {
  try { localStorage.setItem(PREFERENCE_KEY, value ? 'on' : 'off'); } catch { /* Storage unavailable: keep the session value only. */ }
}
