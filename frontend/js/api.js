// =============================================================================
// InvoiceFlow — Frontend API Module
// =============================================================================
// Browser-side API client.
// IMPORTANT:
// - This file runs in the browser.
// - Do NOT use require(), dotenv, express, pg, fs, path, or other Node modules.
// - Exposes the API client as window.API for app.js.
// =============================================================================

(() => {
  'use strict';

  const BASE = '/api';
  const TOKEN_KEY = 'if_token';

  // ===========================================================================
  // TOKEN
  // ===========================================================================

  function token() {
    return localStorage.getItem(TOKEN_KEY);
  }

  function setToken(value) {
    if (!value) {
      clearToken();
      return;
    }

    localStorage.setItem(TOKEN_KEY, value);
  }

  function clearToken() {
    localStorage.removeItem(TOKEN_KEY);
  }

  // ===========================================================================
  // SESSION INVALIDATION
  // ===========================================================================

  function invalidateSession() {
    clearToken();

    window.dispatchEvent(
      new CustomEvent('invoiceflow:session-expired')
    );
  }

  // ===========================================================================
  // GENERIC REQUEST
  // ===========================================================================

  async function request(path, opts = {}) {
    const headers = Object.assign(
      {},
      opts.headers || {}
    );

    // Do not set JSON content type for FormData.
    if (!(opts.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }

    const currentToken = token();

    if (currentToken) {
      headers['Authorization'] =
        `Bearer ${currentToken}`;
    }

    let response;

    try {
      response = await fetch(
        BASE + path,
        {
          ...opts,
          headers
        }
      );
    } catch (error) {
      throw new Error(
        'Unable to connect to InvoiceFlow. Please check your internet connection.'
      );
    }

    const contentType =
      response.headers.get('content-type') || '';

    const isJson =
      contentType.includes('application/json');

    // ========================================================================
    // AUTH FAILURE
    // ========================================================================

    if (
      response.status === 401 ||
      response.status === 403
    ) {
      invalidateSession();

      let message =
        'Your session has expired. Please sign in again.';

      if (isJson) {
        const body =
          await response.json().catch(() => ({}));

        if (body && body.error) {
          message = body.error;
        }
      }

      const error =
        new Error(message);

      error.status =
        response.status;

      error.sessionExpired =
        true;

      throw error;
    }

    // ========================================================================
    // OTHER ERRORS
    // ========================================================================

    if (!response.ok) {
      let message =
        `Request failed (${response.status})`;

      if (isJson) {
        const body =
          await response.json().catch(() => ({}));

        if (body && body.error) {
          message = body.error;
        }
      } else {
        const text =
          await response.text().catch(() => '');

        if (text) {
          message = text;
        }
      }

      const error =
        new Error(message);

      error.status =
        response.status;

      throw error;
    }

    // ========================================================================
    // SUCCESS
    // ========================================================================

    if (isJson) {
      return response.json();
    }

    return response;
  }

  // ===========================================================================
  // AUTH
  // ===========================================================================

  async function login(email, password) {
    const data =
      await request(
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

  // ===========================================================================
  // HEALTH
  // ===========================================================================

  async function health() {
    return request('/health');
  }

  // ===========================================================================
  // DASHBOARD
  // ===========================================================================

  async function dashboardSummary() {
    return request('/dashboard/summary');
  }

  // ===========================================================================
  // INVOICES
  // ===========================================================================

  async function listInvoices(params = {}) {
    const cleanParams =
      Object.fromEntries(
        Object.entries(params).filter(
          ([, value]) =>
            value !== undefined &&
            value !== null &&
            value !== ''
        )
      );

    const queryString =
      new URLSearchParams(
        cleanParams
      ).toString();

    return request(
      `/invoices${
        queryString
          ? `?${queryString}`
          : ''
      }`
    );
  }

  async function getInvoice(id) {
    return request(
      `/invoices/${encodeURIComponent(id)}`
    );
  }

  // ===========================================================================
  // INVOICE DOCUMENT
  // ===========================================================================

  function documentUrl(id) {
    const currentToken =
      token();

    if (!currentToken) {
      return null;
    }

    return (
      `${BASE}/invoices/${encodeURIComponent(id)}` +
      `/document?t=${encodeURIComponent(currentToken)}`
    );
  }

  async function fetchDocumentBlob(id) {
    const currentToken =
      token();

    if (!currentToken) {
      invalidateSession();
      return null;
    }

    let response;

    try {
      response =
        await fetch(
          `${BASE}/invoices/${encodeURIComponent(id)}/document`,
          {
            headers: {
              Authorization:
                `Bearer ${currentToken}`
            }
          }
        );
    } catch (error) {
      throw new Error(
        'Unable to load the invoice document. Please check your connection.'
      );
    }

    if (
      response.status === 401 ||
      response.status === 403
    ) {
      invalidateSession();

      const error =
        new Error(
          'Your session has expired. Please sign in again.'
        );

      error.status =
        response.status;

      error.sessionExpired =
        true;

      throw error;
    }

    if (!response.ok) {
      throw new Error(
        `Unable to load document (${response.status}).`
      );
    }

    const blob =
      await response.blob();

    return URL.createObjectURL(blob);
  }

  // ===========================================================================
  // CAPTURE INVOICE
  // ===========================================================================

  function captureInvoice(
    file,
    onProgress
  ) {
    if (!token()) {
      invalidateSession();

      return Promise.reject(
        new Error(
          'Your session has expired. Please sign in again.'
        )
      );
    }

    if (!file) {
      return Promise.reject(
        new Error(
          'No invoice file was provided.'
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

  // ===========================================================================
  // RETRY INVOICE
  // ===========================================================================

  async function retryInvoice(
    id,
    file
  ) {
    if (!file) {
      throw new Error(
        'No invoice file was provided.'
      );
    }

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

  // ===========================================================================
  // UPDATE INVOICE
  // ===========================================================================

  async function updateInvoice(
    id,
    fields
  ) {
    return request(
      `/invoices/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(fields)
      }
    );
  }

  // ===========================================================================
  // APPROVE
  // ===========================================================================

  async function approveInvoice(id) {
    return request(
      `/invoices/${encodeURIComponent(id)}/approve`,
      {
        method: 'POST'
      }
    );
  }

  // ===========================================================================
  // REJECT
  // ===========================================================================

  async function rejectInvoice(
    id,
    reason = ''
  ) {
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

  // ===========================================================================
  // SUPPLIERS
  // ===========================================================================

  async function listSuppliers() {
    return request('/suppliers');
  }

  // ===========================================================================
  // EXPORT URLS
  // ===========================================================================

  function exportAllUrl() {
    return `${BASE}/export/all`;
  }

  function exportRangeUrl(
    from,
    to
  ) {
    return (
      `${BASE}/export/range` +
      `?from=${encodeURIComponent(from)}` +
      `&to=${encodeURIComponent(to)}`
    );
  }

  // ===========================================================================
  // EXPORT SELECTED
  // ===========================================================================

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

  // ===========================================================================
  // XHR UPLOAD
  // ===========================================================================

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
          (event) => {
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
                    xhr.responseText ||
                    '{}'
                  );
              }
            } catch (error) {
              console.warn(
                '[InvoiceFlow] Could not parse upload response:',
                error
              );

              data = {};
            }

            // ================================================================
            // AUTH FAILURE
            // ================================================================

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

            // ================================================================
            // OTHER FAILURE
            // ================================================================

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

            // ================================================================
            // SUCCESS
            // ================================================================

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

        xhr.timeout =
          120000;

        xhr.send(
          formData
        );
      }
    );
  }

  // ===========================================================================
  // PUBLIC API
  // ===========================================================================

  const API = {
    // Auth
    login,
    me,

    // Health
    health,

    // Dashboard
    dashboardSummary,

    // Invoices
    listInvoices,
    getInvoice,

    // Documents
    documentUrl,
    fetchDocumentBlob,

    // Capture
    captureInvoice,
    retryInvoice,

    // Editing
    updateInvoice,

    // Approval
    approveInvoice,
    rejectInvoice,

    // Suppliers
    listSuppliers,

    // Exports
    exportAllUrl,
    exportRangeUrl,
    exportSelected,

    // Token/session
    setToken,
    clearToken,
    token,
    invalidateSession
  };

  // ===========================================================================
  // IMPORTANT:
  // Expose API globally so app.js can access window.API.
  // ===========================================================================

  window.API = API;

  console.log(
    '[InvoiceFlow] API module loaded successfully.'
  );

})();
