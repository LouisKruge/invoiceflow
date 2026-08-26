// api.js — authenticated fetch wrapper for InvoiceFlow.
//
// Handles:
// - JWT authentication
// - automatic session cleanup
// - expired/invalid sessions
// - authenticated uploads
// - authenticated downloads
// - mobile-safe authentication behaviour

const API = (() => {
  const BASE = '/api';
  const TOKEN_KEY = 'if_token';

  // ------------------------------------------------------------
  // TOKEN
  // ------------------------------------------------------------

  function token() {
    return localStorage.getItem(TOKEN_KEY);
  }

  function setToken(t) {
    if (!t) {
      clearToken();
      return;
    }

    localStorage.setItem(TOKEN_KEY, t);
  }

  function clearToken() {
    localStorage.removeItem(TOKEN_KEY);
  }

  // ------------------------------------------------------------
  // SESSION INVALIDATION
  // ------------------------------------------------------------

  function invalidateSession() {
    clearToken();

    // Notify the application so it can render the login screen.
    window.dispatchEvent(
      new CustomEvent('invoiceflow:session-expired')
    );
  }

  // ------------------------------------------------------------
  // REQUEST
  // ------------------------------------------------------------

  async function request(path, opts = {}) {
    const headers = Object.assign({}, opts.headers || {});

    // Only add JSON content type when the request is NOT FormData.
    if (!(opts.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }

    const currentToken = token();

    if (currentToken) {
      headers['Authorization'] = `Bearer ${currentToken}`;
    }

    let resp;

    try {
      resp = await fetch(BASE + path, {
        ...opts,
        headers
      });
    } catch (error) {
      throw new Error(
        'Unable to connect to InvoiceFlow. Please check your internet connection.'
      );
    }

    const contentType =
      resp.headers.get('content-type') || '';

    const isJson =
      contentType.includes('application/json');

    // ----------------------------------------------------------
    // AUTH FAILURE
    // ----------------------------------------------------------

    if (resp.status === 401 || resp.status === 403) {
      invalidateSession();

      let message =
        'Your session has expired. Please sign in again.';

      if (isJson) {
        const body =
          await resp.json().catch(() => ({}));

        if (body.error) {
          message = body.error;
        }
      }

      const err = new Error(message);
      err.status = resp.status;
      err.sessionExpired = true;

      throw err;
    }

    // ----------------------------------------------------------
    // OTHER ERRORS
    // ----------------------------------------------------------

    if (!resp.ok) {
      let message =
        `Request failed (${resp.status})`;

      if (isJson) {
        const body =
          await resp.json().catch(() => ({}));

        if (body.error) {
          message = body.error;
        }
      } else {
        const text =
          await resp.text().catch(() => '');

        if (text) {
          message = text;
        }
      }

      const err = new Error(message);
      err.status = resp.status;

      throw err;
    }

    // ----------------------------------------------------------
    // SUCCESS
    // ----------------------------------------------------------

    if (isJson) {
      return resp.json();
    }

    return resp;
  }

  // ------------------------------------------------------------
  // AUTH
  // ------------------------------------------------------------

  async function login(email, password) {
    const data = await request(
      '/auth/login',
      {
        method: 'POST',
        body: JSON.stringify({
          email,
          password
        })
      }
    );

    if (!data || !data.token) {
      throw new Error(
        'Login succeeded but the server did not return a session token.'
      );
    }

    setToken(data.token);

    return data;
  }

  async function me() {
    return request('/auth/me');
  }

  // ------------------------------------------------------------
  // DASHBOARD
  // ------------------------------------------------------------

  async function dashboardSummary() {
    return request('/dashboard/summary');
  }

  // ------------------------------------------------------------
  // INVOICES
  // ------------------------------------------------------------

  async function listInvoices(params = {}) {
    const cleanParams = Object.fromEntries(
      Object.entries(params).filter(
        ([, value]) =>
          value !== undefined &&
          value !== null &&
          value !== ''
      )
    );

    const qs =
      new URLSearchParams(cleanParams);

    const query =
      qs.toString();

    return request(
      `/invoices${query ? `?${query}` : ''}`
    );
  }

  async function getInvoice(id) {
    return request(
      `/invoices/${encodeURIComponent(id)}`
    );
  }

  function documentUrl(id) {
    const t = token();

    if (!t) {
      return null;
    }

    return (
      `${BASE}/invoices/${encodeURIComponent(id)}` +
      `/document?t=${encodeURIComponent(t)}`
    );
  }

  async function fetchDocumentBlob(id) {
    const currentToken = token();

    if (!currentToken) {
      invalidateSession();
      return null;
    }

    const resp = await fetch(
      `${BASE}/invoices/${encodeURIComponent(id)}/document`,
      {
        headers: {
          Authorization:
            `Bearer ${currentToken}`
        }
      }
    );

    if (
      resp.status === 401 ||
      resp.status === 403
    ) {
      invalidateSession();
      return null;
    }

    if (!resp.ok) {
      return null;
    }

    const blob =
      await resp.blob();

    return URL.createObjectURL(blob);
  }

  // ------------------------------------------------------------
  // CAPTURE
  // ------------------------------------------------------------

  function captureInvoice(file, onProgress) {
    if (!token()) {
      invalidateSession();

      return Promise.reject(
        new Error(
          'Your session has expired. Please sign in again.'
        )
      );
    }

    const form =
      new FormData();

    form.append(
      'file',
      file
    );

    return xhrUpload(
      `${BASE}/invoices/capture`,
      form,
      onProgress
    );
  }

  // ------------------------------------------------------------
  // RETRY
  // ------------------------------------------------------------

  async function retryInvoice(id, file) {
    const form =
      new FormData();

    form.append(
      'file',
      file
    );

    return request(
      `/invoices/${encodeURIComponent(id)}/retry`,
      {
        method: 'POST',
        body: form
      }
    );
  }

  // ------------------------------------------------------------
  // UPDATE
  // ------------------------------------------------------------

  async function updateInvoice(id, fields) {
    return request(
      `/invoices/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(fields)
      }
    );
  }

  // ------------------------------------------------------------
  // APPROVE / REJECT
  // ------------------------------------------------------------

  async function approveInvoice(id) {
    return request(
      `/invoices/${encodeURIComponent(id)}/approve`,
      {
        method: 'POST'
      }
    );
  }

  async function rejectInvoice(id, reason) {
    return request(
      `/invoices/${encodeURIComponent(id)}/reject`,
      {
        method: 'POST',
        body: JSON.stringify({
          reason
        })
      }
    );
  }

  // ------------------------------------------------------------
  // SUPPLIERS
  // ------------------------------------------------------------

  async function listSuppliers() {
    return request('/suppliers');
  }

  // ------------------------------------------------------------
  // EXPORTS
  // ------------------------------------------------------------

  function exportAllUrl() {
    return `${BASE}/export/all`;
  }

  function exportRangeUrl(from, to) {
    return (
      `${BASE}/export/range` +
      `?from=${encodeURIComponent(from)}` +
      `&to=${encodeURIComponent(to)}`
    );
  }

  async function exportSelected(ids) {
    return request(
      '/export/selected',
      {
        method: 'POST',
        body: JSON.stringify({
          ids
        })
      }
    );
  }

  // ------------------------------------------------------------
  // XHR UPLOAD
  // ------------------------------------------------------------

  function xhrUpload(
    url,
    formData,
    onProgress
  ) {
    return new Promise(
      (resolve, reject) => {
        const currentToken =
          token();

        if (!currentToken) {
          invalidateSession();

          reject(
            new Error(
              'Your session has expired. Please sign in again.'
            )
          );

          return;
        }

        const xhr =
          new XMLHttpRequest();

        xhr.open(
          'POST',
          url
        );

        xhr.setRequestHeader(
          'Authorization',
          `Bearer ${currentToken}`
        );

        xhr.upload.onprogress =
          event => {
            if (
              onProgress &&
              event.lengthComputable
            ) {
              onProgress(
                event.loaded /
                event.total
              );
            }
          };

        xhr.onload =
          () => {
            const contentType =
              xhr.getResponseHeader(
                'content-type'
              ) || '';

            let data = {};

            try {
              if (
                contentType.includes(
                  'application/json'
                ) ||
                xhr.responseText
              ) {
                data =
                  JSON.parse(
                    xhr.responseText || '{}'
                  );
              }
            } catch {
              data = {};
            }

            // ----------------------------------------------
            // AUTH FAILURE
            // ----------------------------------------------

            if (
              xhr.status === 401 ||
              xhr.status === 403
            ) {
              invalidateSession();

              const error =
                new Error(
                  data.error ||
                  'Your session has expired. Please sign in again.'
                );

              error.status =
                xhr.status;

              error.sessionExpired =
                true;

              reject(error);
              return;
            }

            // ----------------------------------------------
            // OTHER FAILURE
            // ----------------------------------------------

            if (
              xhr.status < 200 ||
              xhr.status >= 300
            ) {
              const error =
                new Error(
                  data.error ||
                  `Upload failed (${xhr.status})`
                );

              error.status =
                xhr.status;

              reject(error);
              return;
            }

            // ----------------------------------------------
            // SUCCESS
            // ----------------------------------------------

            resolve(data);
          };

        xhr.onerror =
          () => {
            reject(
              new Error(
                'Network error during upload. Please check your connection and try again.'
              )
            );
          };

        xhr.ontimeout =
          () => {
            reject(
              new Error(
                'The upload timed out. Please try again.'
              )
            );
          };

        xhr.onabort =
          () => {
            reject(
              new Error(
                'The upload was cancelled.'
              )
            );
          };

        // Give large invoice images plenty of time.
        xhr.timeout =
          120000;

        xhr.send(
          formData
        );
      }
    );
  }

  // ------------------------------------------------------------
  // PUBLIC API
  // ------------------------------------------------------------

  return {
    login,
    me,

    dashboardSummary,

    listInvoices,
    getInvoice,

    documentUrl,
    fetchDocumentBlob,

    captureInvoice,
    retryInvoice,

    updateInvoice,

    approveInvoice,
    rejectInvoice,

    listSuppliers,

    exportAllUrl,
    exportRangeUrl,
    exportSelected,

    setToken,
    clearToken,
    token,

    invalidateSession
  };
})();

// ============================================================
// AUTHENTICATED DOWNLOAD
// ============================================================

async function downloadAuthenticated(
  url,
  filenameFallback
) {
  const currentToken =
    API.token();

  if (!currentToken) {
    API.invalidateSession();

    throw new Error(
      'Your session has expired. Please sign in again.'
    );
  }

  let resp;

  try {
    resp =
      await fetch(
        url,
        {
          headers: {
            Authorization:
              `Bearer ${currentToken}`
          }
        }
      );
  } catch {
    throw new Error(
      'Unable to download the file. Please check your connection.'
    );
  }

  // ----------------------------------------------------------
  // SESSION EXPIRED
  // ----------------------------------------------------------

  if (
    resp.status === 401 ||
    resp.status === 403
  ) {
    API.invalidateSession();

    const error =
      new Error(
        'Your session has expired. Please sign in again.'
      );

    error.status =
      resp.status;

    error.sessionExpired =
      true;

    throw error;
  }

  // ----------------------------------------------------------
  // DOWNLOAD ERROR
  // ----------------------------------------------------------

  if (!resp.ok) {
    throw new Error(
      `Export failed (${resp.status})`
    );
  }

  // ----------------------------------------------------------
  // DOWNLOAD
  // ----------------------------------------------------------

  const blob =
    await resp.blob();

  const disposition =
    resp.headers.get(
      'content-disposition'
    ) || '';

  const match =
    disposition.match(
      /filename\*?=(?:UTF-8'')?"?([^"]+)"?/i
    );

  let filename =
    filenameFallback ||
    'invoiceflow-export.xlsx';

  if (match && match[1]) {
    filename =
      decodeURIComponent(
        match[1]
      );
  }

  const blobUrl =
    URL.createObjectURL(
      blob
    );

  const a =
    document.createElement(
      'a'
    );

  a.href =
    blobUrl;

  a.download =
    filename;

  document.body.appendChild(
    a
  );

  a.click();

  a.remove();

  setTimeout(
    () => URL.revokeObjectURL(blobUrl),
    1000
  );
}
