// Device class decides which reader settings row is used; the label is shown in sync prompts.
function isIpad() {
  return /iPad/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}

export function deviceClass() {
  if (isIpad()) return 'tablet';
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  const shortSide = Math.min(window.screen?.width || 0, window.screen?.height || 0);
  if (coarse && shortSide && shortSide < 600) return 'phone';
  if (coarse || /Android/.test(navigator.userAgent)) return 'tablet';
  return 'desktop';
}

export function deviceLabel() {
  const agent = navigator.userAgent;
  if (isIpad()) return 'iPad';
  if (/iPhone/.test(agent)) return 'iPhone';
  if (/Android/.test(agent)) return deviceClass() === 'phone' ? 'Android phone' : 'Android tablet';
  if (/Macintosh/.test(agent)) return 'Mac';
  if (/Windows/.test(agent)) return 'Windows PC';
  if (/Linux/.test(agent)) return 'Linux PC';
  return 'another device';
}
