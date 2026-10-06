const tracked = new Map();

export async function withUploadProgress(path, onProgress, signal, upload) {
  const key = '/storage/v1/object/library/' + path;
  tracked.set(key, { onProgress, signal });
  try { return await upload(); }
  finally { tracked.delete(key); }
}

export async function progressFetch(input, init = {}) {
  const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
  const tracking = tracked.get(new URL(url).pathname);
  if (!tracking) return fetch(input, init);
  const request = typeof Request !== 'undefined' && input instanceof Request ? input : null;
  const body = init.body ?? (request ? await request.clone().blob() : null);
  const signal = tracking.signal || init.signal || request?.signal;
  const headers = new Headers(init.headers || request?.headers);

  // Keep the official Storage API and its authentication; replace only the
  // transport for tracked uploads because fetch has no upload progress events.
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const cleanup = () => signal?.removeEventListener('abort', abort);
    const abort = () => xhr.abort();
    if (signal?.aborted) { reject(new DOMException('Upload cancelled.', 'AbortError')); return; }
    xhr.open(init.method || request?.method || 'POST', url);
    xhr.responseType = 'arraybuffer';
    xhr.timeout = 120000;
    xhr.withCredentials = init.credentials === 'include';
    for (const [name, value] of headers) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total) tracking.onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      cleanup();
      if (!xhr.status) { reject(new TypeError('Upload connection failed.')); return; }
      const responseHeaders = new Headers();
      for (const line of xhr.getAllResponseHeaders().trim().split(/[\r\n]+/)) {
        const colon = line.indexOf(':');
        if (colon > 0) responseHeaders.append(line.slice(0, colon), line.slice(colon + 1).trim());
      }
      resolve(new Response([204, 205, 304].includes(xhr.status) ? null : xhr.response, {
        status: xhr.status, statusText: xhr.statusText, headers: responseHeaders,
      }));
    };
    xhr.onerror = () => { cleanup(); reject(new TypeError('Upload connection failed.')); };
    xhr.ontimeout = () => { cleanup(); reject(new Error('The upload timed out. Please retry.')); };
    xhr.onabort = () => { cleanup(); reject(new DOMException('Upload cancelled.', 'AbortError')); };
    signal?.addEventListener('abort', abort, { once: true });
    xhr.send(body);
  });
}
