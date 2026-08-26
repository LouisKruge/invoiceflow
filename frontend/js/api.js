// api.js — thin fetch wrapper around the InvoiceFlow backend.
const API = (() => {
  const BASE = '/api';

  function token() { return localStorage.getItem('if_token'); }

  async function request(path, opts = {}) {
    const headers = Object.assign({}, opts.headers || {});
    if (!(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';
    if (token()) headers['Authorization'] = `Bearer ${token()}`;

    const resp = await fetch(BASE + path, { ...opts, headers });
    const isJson = (resp.headers.get('content-type') || '').includes('application/json');

    if (!resp.ok) {
      const body = isJson ? await resp.json().catch(() => ({})) : {};
      const err = new Error(body.error || `Request failed (${resp.status})`);
      err.status = resp.status;
      throw err;
    }
    return isJson ? resp.json() : resp;
  }

  return {
    login: (email, password) => request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
    me: () => request('/auth/me'),

    dashboardSummary: () => request('/dashboard/summary'),

    listInvoices: (params = {}) => {
      const qs = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v)));
      return request(`/invoices?${qs.toString()}`);
    },
    getInvoice: (id) => request(`/invoices/${id}`),
    documentUrl: (id) => `${BASE}/invoices/${id}/document?t=${token()}`, // token appended for <img> tags (fallback fetch used instead, see loadDocument)
    fetchDocumentBlob: async (id) => {
      const resp = await fetch(`${BASE}/invoices/${id}/document`, { headers: { Authorization: `Bearer ${token()}` } });
      if (!resp.ok) return null;
      return URL.createObjectURL(await resp.blob());
    },
    captureInvoice: (file, onProgress) => {
      const form = new FormData();
      form.append('file', file);
      return xhrUpload(`${BASE}/invoices/capture`, form, onProgress);
    },
    retryInvoice: (id, file) => {
      const form = new FormData();
      form.append('file', file);
      return request(`/invoices/${id}/retry`, { method: 'POST', body: form });
    },
    updateInvoice: (id, fields) => request(`/invoices/${id}`, { method: 'PATCH', body: JSON.stringify(fields) }),
    approveInvoice: (id) => request(`/invoices/${id}/approve`, { method: 'POST' }),
    rejectInvoice: (id, reason) => request(`/invoices/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }),

    listSuppliers: () => request('/suppliers'),

    exportAllUrl: () => `${BASE}/export/all`,
    exportRangeUrl: (from, to) => `${BASE}/export/range?from=${from}&to=${to}`,
    exportSelected: (ids) => request('/export/selected', { method: 'POST', body: JSON.stringify({ ids }) }),

    setToken: (t) => localStorage.setItem('if_token', t),
    clearToken: () => localStorage.removeItem('if_token'),
    token,
  };

  function xhrUpload(url, formData, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      xhr.setRequestHeader('Authorization', `Bearer ${token()}`);
      xhr.upload.onprogress = (e) => { if (onProgress && e.lengthComputable) onProgress(e.loaded / e.total); };
      xhr.onload = () => {
        try {
          const data = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300) resolve(data);
          else reject(new Error(data.error || 'Upload failed'));
        } catch (e) { reject(e); }
      };
      xhr.onerror = () => reject(new Error('Network error during upload'));
      xhr.send(formData);
    });
  }
})();

// Helper for triggering an authenticated file download (Excel export) since
// <a download> can't send an Authorization header.
async function downloadAuthenticated(url, filenameFallback) {
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${API.token()}` } });
  if (!resp.ok) throw new Error('Export failed');
  const blob = await resp.blob();
  const disposition = resp.headers.get('content-disposition') || '';
  const match = disposition.match(/filename="?([^"]+)"?/);
  const filename = match ? match[1] : filenameFallback;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
