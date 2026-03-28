async function parseJson(res) {
  const j = await res.json().catch(() => ({}));
  return j;
}

const fetchOpts = { credentials: 'include' };

export async function apiGet(path) {
  const r = await fetch(path, fetchOpts);
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
    headers: {
      'Content-Type': 'application/json',
    },
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
    body: fd,
  }).then(async (r) => {
    const j = await parseJson(r);
    if (!j.success) throw new Error(j.error?.message || 'Upload failed');
    return j.data;
  });
}
