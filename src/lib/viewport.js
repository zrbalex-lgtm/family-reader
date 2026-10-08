// iPhone/iPad Home Screen apps with a translucent status bar report a window that is shorter
// than the screen by the status-bar inset, so fixed full-screen views ended above the bottom
// edge. There, --app-height is set to the real screen height; elsewhere it stays unset.
function update() {
  const root = document.documentElement;
  if (navigator.standalone !== true || !window.screen) {
    root.style.removeProperty('--app-height');
    return;
  }
  const long = Math.max(screen.width, screen.height);
  const short = Math.min(screen.width, screen.height);
  const portrait = window.innerHeight >= window.innerWidth;
  const height = portrait ? long : short;
  const width = portrait ? short : long;
  // Only for a full-screen window (not Split View or Slide Over on iPad) that is too short.
  if (Math.abs(window.innerWidth - width) <= 2 && height > window.innerHeight) root.style.setProperty('--app-height', height + 'px');
  else root.style.removeProperty('--app-height');
}

export function startFullHeight() {
  update();
  window.addEventListener('resize', update);
  window.addEventListener('orientationchange', () => setTimeout(update, 300));
}

// The corrected height in CSS pixels, or 0 when the browser's own height is right.
export function appHeight() {
  return parseFloat(document.documentElement.style.getPropertyValue('--app-height')) || 0;
}
