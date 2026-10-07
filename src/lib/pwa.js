import { writable } from 'svelte/store';

// True when a new version has been downloaded and waits for the user to reload.
export const updateReady = writable(false);

let waiting = null;
let reloadRequested = false;

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  const base = import.meta.env.BASE_URL;
  const offer = (worker) => {
    waiting = worker;
    updateReady.set(true);
  };
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register(`${base}sw.js`, { scope: base });
      // A new version that finished installing while an older one controls the page.
      if (registration.waiting && navigator.serviceWorker.controller) offer(registration.waiting);
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) offer(worker);
        });
      });
      // Check for a new version whenever the app returns to the foreground.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') registration.update().catch(() => {});
      });
    } catch {
      // No offline support in this browser session; the app still works online.
    }
  });
  // Reload only when the user asked for the update, never on the first installation.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadRequested) window.location.reload();
  });
}

export function applyUpdate() {
  if (!waiting) return;
  reloadRequested = true;
  waiting.postMessage('skipWaiting');
}
