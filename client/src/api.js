const TENANT = 'default';

async function parseJson(res) {
  const j = await res.json().catch(() => ({}));
  return j;
}

export async function apiGet(path) {
  const r = await fetch(path, { headers: { 'x-tenant-id': TENANT } });
  const j = await parseJson(r);
  if (!j.success) {
    throw new Error(j.error?.message || `HTTP ${r.status}`);
  }
  return j.data;
}

export async function apiJson(method, path, body) {
  const r = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-tenant-id': TENANT,
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
    headers: { 'x-tenant-id': TENANT },
    body: fd,
  }).then(async (r) => {
    const j = await parseJson(r);
    if (!j.success) throw new Error(j.error?.message || 'Upload failed');
    return j.data;
  });
}
