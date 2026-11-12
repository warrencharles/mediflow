export async function api(path, { method = 'GET', body, headers = {} } = {}) {
  const isForm = body instanceof FormData;
  const res = await fetch(path.startsWith('/api') ? path : `/api${path}`, {
    method,
    credentials: 'include',
    headers: isForm
      ? headers
      : {
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });

  if (res.status === 204) return null;
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.details = data?.details;
    throw err;
  }
  return data;
}

export const fmtTSh = (n) => `TSh ${Number(n || 0).toLocaleString('en-US')}`;

export const fmtDate = (d) => {
  if (!d) return '—';
  return new Date(d).toISOString().slice(0, 10);
};

export const fmtDateTime = (d) => {
  if (!d) return '—';
  const dt = new Date(d);
  return dt.toLocaleString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const calcAge = (dob) => {
  if (!dob) return '—';
  const years = Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 86400000));
  return `${years} yrs`;
};

export const todayStr = () => new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);

