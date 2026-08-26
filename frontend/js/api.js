// =============================================================================
// InvoiceFlow — Frontend API Module
// =============================================================================
// Browser-side API client.
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
  // SESSION
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

    // -------------------------------------------------------------------------
    // Authentication failure
    // -------------------------------------------------------------------------

    if (
      response.status === 401 ||
      response.status === 403
    ) {
      let message =
        'Your session has expired. Please sign in again.';

      if (isJson) {
        const body =
          await response.json().catch(() => ({}));

        if (body && body.error) {
          message = body.error;
        }
      }

      invalidateSession();

      const error =
        new Error(message);

      error.status =
        response.status;

      error.sessionExpired =
        true;

      throw error;
    }

    // -------------------------------------------------------------------------
    // Other errors
    // -------------------------------------------------------------------------

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

    // -------------------------------------------------------------------------
    // Success
    // -------------------------------------------------------------------------

    if (isJson) {
      return response.json();
    }

    return response;
  }

  // ===========================================================================
  // AUTH — SETUP STATUS
  // ===========================================================================

  async function setupStatus() {
    return request('/auth/setup-status');
  }

  // ===========================================================================
  // AUTH — REGISTER
  // ===========================================================================

  async function register(
    name,
    email,
    password,
    companyName
  ) {
    const normalizedName =
      String(name || '').trim();

    const normalizedEmail =
      String(email || '')
        .trim()
        .toLowerCase();

    const normalizedPassword =
      String(password || '');

    const normalizedCompany =
      String(companyName || '').trim();

    if (!normalizedName) {
      throw new Error(
        'Please enter your name.'
      );
    }

    if (!normalizedEmail) {
      throw new Error(
        'Please enter your email address.'
      );
    }

    if (!normalizedPassword) {
      throw new Error(
        'Please enter a password.'
      );
    }

    if (!normalizedCompany) {
      throw new Error(
        'Please enter your company name.'
      );
    }

    if (normalizedPassword.length < 8) {
      throw new Error(
        'Password must be at least 8 characters.'
      );
    }

    const data =
      await request(
        '/auth/register',
        {
          method: 'POST',

          body:
            JSON.stringify({
              name:
                normalizedName,

              email:
                normalizedEmail,

              password:
                normalizedPassword,

              company_name:
                normalizedCompany
            })
        }
      );

    if (!data || !data.token) {
      throw new Error(
        'Account was created but the server did not return a login session.'
      );
    }

    if (!data.user) {
      throw new Error(
        'Account was created but the server did not return your user profile.'
      );
    }

    setToken(
      data.token
    );

    return data;
  }

  // ===========================================================================
  // AUTH — LOGIN
  // ===========================================================================

  async function login(
    email,
    password
  ) {
    const normalizedEmail =
      String(email || '')
        .trim()
        .toLowerCase();

    const normalizedPassword =
      String(password || '');

    if (!normalizedEmail) {
      throw new Error(
        'Please enter your email address.'
      );
    }

    if (!normalizedPassword) {
      throw new Error(
        'Please enter your password.'
      );
    }

    const data =
      await request(
        '/auth/login',
        {
          method: 'POST',

          body:
            JSON.stringify({
              email:
                normalizedEmail,

              password:
                normalizedPassword
            })
        }
      );

    if (!data || !data.token) {
      throw new Error(
        'Login succeeded but the server did not return a session token.'
      );
    }

    if (!data.user) {
      throw new Error(
        'Login succeeded but the server did not return your user profile.'
      );
    }

    setToken(
      data.token
    );

    return data;
  }

  // ===========================================================================
  // AUTH — CURRENT USER
  // ===========================================================================

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

  async function listInvoices(
    params = {}
  ) {
    const cleanParams =
      Object.fromEntries(
        Object.entries(params)
          .filter(
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
  // CAPTURE
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
  // RETRY
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
  // UPDATE HELPERS
  // ===========================================================================

  /*
   * Convert values coming from HTML inputs into sensible JSON values.
   *
   * IMPORTANT:
   * HTML input.value is ALWAYS a string.
   *
   * Examples:
   *
   *   "true"   -> true
   *   "false"  -> false
   *   "123"    -> 123
   *   "12.50"  -> 12.5
   *   "ABC"    -> "ABC"
   *
   * Empty strings remain empty strings because some invoice fields may
   * legitimately be optional text fields.
   */

  function normalizeUpdateValue(
    value
  ) {
    if (
      typeof value !== 'string'
    ) {
      return value;
    }

    const trimmed =
      value.trim();

    // -------------------------------------------------------------------------
    // Boolean strings
    // -------------------------------------------------------------------------

    if (
      trimmed.toLowerCase() ===
      'true'
    ) {
      return true;
    }

    if (
      trimmed.toLowerCase() ===
      'false'
    ) {
      return false;
    }

    // -------------------------------------------------------------------------
    // Integer strings
    //
    // Only convert strings that are clearly integers.
    // -------------------------------------------------------------------------

    if (
      /^-?\d+$/.test(trimmed)
    ) {
      const number =
        Number(trimmed);

      if (
        Number.isSafeInteger(
          number
        )
      ) {
        return number;
      }
    }

    // -------------------------------------------------------------------------
    // Decimal / numeric strings
    // -------------------------------------------------------------------------

    if (
      /^-?(?:\d+\.\d+|\d+\.)$/.test(
        trimmed
      )
    ) {
      const number =
        Number(trimmed);

      if (
        Number.isFinite(number)
      ) {
        return number;
      }
    }

    // -------------------------------------------------------------------------
    // Otherwise leave it as text.
    // -------------------------------------------------------------------------

    return value;
  }

  function normalizeUpdateFields(
    fields
  ) {
    if (
      !fields ||
      typeof fields !== 'object' ||
      Array.isArray(fields)
    ) {
      throw new Error(
        'Invoice update data is invalid.'
      );
    }

    const normalized = {};

    Object.entries(fields).forEach(
      ([key, value]) => {
        normalized[key] =
          normalizeUpdateValue(
            value
          );
      }
    );

    return normalized;
  }

  // ===========================================================================
  // UPDATE
  // ===========================================================================

  async function updateInvoice(
    id,
    fields
  ) {
    if (!id) {
      throw new Error(
        'Invoice ID is required.'
      );
    }

    const normalizedFields =
      normalizeUpdateFields(
        fields
      );

    if (
      !Object.keys(
        normalizedFields
      ).length
    ) {
      throw new Error(
        'No invoice fields were provided for update.'
      );
    }

    console.log(
      '[InvoiceFlow] Updating invoice:',
      {
        id,
        fields:
          normalizedFields
      }
    );

    return request(
      `/invoices/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',

        body:
          JSON.stringify(
            normalizedFields
          )
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

        body:
          JSON.stringify({
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
  // EXPORTS
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

  async function exportSelected(ids) {
    return request(
      '/export/selected',
      {
        method: 'POST',

        body:
          JSON.stringify({
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
    setupStatus,
    register,
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

    // Session
    setToken,
    clearToken,
    token,
    invalidateSession
  };

  window.API =
    API;

  console.log(
    '[InvoiceFlow] API module loaded successfully.'
  );

})();
