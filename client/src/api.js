/**
 * When the server has INBOXPILOT_API_SECRET set, the browser must send the same value.
 * Set VITE_INBOXPILOT_API_SECRET in client/.env.local (must match the server secret).
 */
export function getApiHeaders(extra = {}) {
  const headers = { ...extra };
  const key =
    typeof import.meta.env.VITE_INBOXPILOT_API_SECRET === 'string'
      ? import.meta.env.VITE_INBOXPILOT_API_SECRET.trim()
      : '';
  if (key) {
    headers['x-inboxpilot-key'] = key;
  }
  return headers;
}

async function parseJson(res) {
  const j = await res.json().catch(() => ({}));
  return j;
}

const fetchOpts = { credentials: 'include' };

export async function apiGet(path) {
  const r = await fetch(path, {
    ...fetchOpts,
    headers: getApiHeaders(),
  });
  const j = await parseJson(r);
  if (!j.success) {
    throw new Error(j.error?.message || `HTTP ${r.status}`);
  }
  return j.data;
}

export async function apiJson(method, path, body) {
  const r = await fetch(path, {
    method,
    credentials: 'include',
    headers: getApiHeaders({
      'Content-Type': 'application/json',
    }),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const j = await parseJson(r);
  if (!j.success) {
    throw new Error(j.error?.message || `HTTP ${r.status}`);
  }
  return j.data;
}

export function uploadKb(file) {
  const fd = new FormData();
  fd.append('file', file);
  return fetch('/api/knowledge/upload', {
    method: 'POST',
    credentials: 'include',
    headers: getApiHeaders(),
    body: fd,
  }).then(async (r) => {
    const j = await parseJson(r);
    if (!j.success) throw new Error(j.error?.message || 'Upload failed');
    return j.data;
  });
}
