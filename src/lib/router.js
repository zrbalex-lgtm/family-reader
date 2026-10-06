import { writable } from 'svelte/store';

function currentRoute() {
  const path = window.location.hash.slice(1).split('?')[0];
  return path || '/library';
}

export const route = writable(currentRoute());

export function startRouter() {
  const update = () => route.set(currentRoute());
  window.addEventListener('hashchange', update);
  update();
  return () => window.removeEventListener('hashchange', update);
}

export function navigate(path, { replace = false } = {}) {
  if (replace) {
    window.history.replaceState(null, '', `#${path}`);
    route.set(path);
  } else {
    window.location.hash = path;
  }
}
