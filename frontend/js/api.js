// =============================================================================
// InvoiceFlow — Frontend API Module
// =============================================================================
// Browser-side API client.
// Supports single and bulk invoice capture, editing, approval, rejection,
// and deletion.
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
    if (!id) {
      throw new Error(
        'Invoice ID is required.'
      );
    }

    return request(
      `/invoices/${encodeURIComponent(id)}`
    );
  }

  // ===========================================================================
  // DELETE INVOICE
  // ===========================================================================

  async function deleteInvoice(id) {
    if (!id) {
      throw new Error(
        'Invoice ID is required.'
      );
    }

    console.log(
      '[InvoiceFlow] Deleting invoice:',
      id
    );

    const response =
      await request(
        `/invoices/${encodeURIComponent(id)}`,
        {
          method: 'DELETE'
        }
      );

    if (
      !response ||
      response.success === false
    ) {
      throw new Error(
        response?.error ||
        'The server did not confirm invoice deletion.'
      );
    }

    return response;
  }

  // ===========================================================================
  // BULK DELETE
  // ===========================================================================

  async function deleteInvoices(ids) {
    const list =
      Array.isArray(ids)
        ? ids.filter(Boolean)
        : [];

    if (!list.length) {
      throw new Error(
        'No invoices were selected for deletion.'
      );
    }

    console.log(
      '[InvoiceFlow] Deleting invoices:',
      list.length
    );

    const response =
      await request(
        '/invoices/bulk-delete',
        {
          method: 'POST',

          body:
            JSON.stringify({
              ids: list
            })
        }
      );

    if (
      !response ||
      response.success === false
    ) {
      throw new Error(
        response?.error ||
        'The server did not confirm the deletion.'
      );
    }

    return response;
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
  // FILE VALIDATION
  // ===========================================================================

  const ALLOWED_FILE_TYPES = [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif'
  ];

  // Must match the multer limit in backend/routes/invoices.js — a larger value
  // here just moves the rejection to after the upload has been sent.
  const MAX_FILE_SIZE =
    15 * 1024 * 1024;

  function validateInvoiceFile(file) {
    if (!file) {
      throw new Error(
        'No invoice file was provided.'
      );
    }

    if (!(file instanceof File)) {
      throw new Error(
        'Invalid invoice file.'
      );
    }

    if (
      file.type &&
      !ALLOWED_FILE_TYPES.includes(file.type)
    ) {
      throw new Error(
        'Unsupported invoice file type. Please upload a PDF, JPG, PNG, WEBP, HEIC or HEIF file.'
      );
    }

    if (
      file.size >
      MAX_FILE_SIZE
    ) {
      throw new Error(
        'Invoice file is too large. Maximum file size is 15 MB.'
      );
    }

    return true;
  }

  // ===========================================================================
  // CAPTURE — SINGLE INVOICE
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

    try {
      validateInvoiceFile(file);
    } catch (error) {
      return Promise.reject(error);
    }

    const form =
      new FormData();

    form.append(
      'file',
      file,
      file.name || 'invoice'
    );

    return xhrUpload(
      `${BASE}/invoices/capture`,
      form,
      onProgress
    );
  }

  // ===========================================================================
  // CAPTURE — BULK
  // ===========================================================================

  async function captureInvoices(
    files,
    onItemProgress,
    onItemComplete
  ) {
    if (!token()) {
      invalidateSession();

      throw new Error(
        'Your session has expired. Please sign in again.'
      );
    }

    if (!files) {
      throw new Error(
        'No invoice files were provided.'
      );
    }

    const fileArray =
      Array.from(files);

    if (!fileArray.length) {
      throw new Error(
        'No invoice files were provided.'
      );
    }

    const results = [];

    for (
      let index = 0;
      index < fileArray.length;
      index++
    ) {
      const file =
        fileArray[index];

      const result = {
        index,

        file,

        fileName:
          file?.name ||
          `Invoice ${index + 1}`,

        status:
          'processing',

        success:
          false,

        data:
          null,

        error:
          null
      };

      results.push(result);

      try {
        validateInvoiceFile(file);

        result.status =
          'uploading';

        const data =
          await captureInvoice(
            file,
            (progress) => {
              if (
                typeof onItemProgress ===
                'function'
              ) {
                onItemProgress({
                  index,

                  file,

                  fileName:
                    result.fileName,

                  progress,

                  status:
                    progress >= 1
                      ? 'processing'
                      : 'uploading'
                });
              }
            }
          );

        result.status =
          'completed';

        result.success =
          true;

        result.data =
          data;

        if (
          typeof onItemComplete ===
          'function'
        ) {
          onItemComplete(
            result
          );
        }
      } catch (error) {
        result.status =
          'failed';

        result.success =
          false;

        result.error =
          error instanceof Error
            ? error.message
            : String(error);

        if (
          typeof onItemComplete ===
          'function'
        ) {
          onItemComplete(
            result
          );
        }
      }
    }

    return {
      results,

      total:
        results.length,

      uploaded:
        results.filter(
          result =>
            result.success
        ).length,

      failed:
        results.filter(
          result =>
            !result.success
        ).length
    };
  }

  // ===========================================================================
  // RETRY
  // ===========================================================================

  async function retryInvoice(
    id,
    file
  ) {
    if (!id) {
      throw new Error(
        'Invoice ID is required.'
      );
    }

    if (!file) {
      throw new Error(
        'No invoice file was provided.'
      );
    }

    validateInvoiceFile(file);

    const form =
      new FormData();

    form.append(
      'file',
      file,
      file.name || 'invoice'
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

  async function approveInvoice(
    id
  ) {
    if (!id) {
      throw new Error(
        'Invoice ID is required.'
      );
    }

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
    if (!id) {
      throw new Error(
        'Invoice ID is required.'
      );
    }

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
  // INVOICE → STOCK
  // ===========================================================================

  /**
   * What posting this invoice would do to stock. Projections only.
   */
  async function invoiceStockPlan(id) {
    if (!id) throw new Error('Invoice ID is required.');

    return request(`/invoices/${encodeURIComponent(id)}/stock`);
  }

  async function evaluateInvoiceStock(id) {
    if (!id) throw new Error('Invoice ID is required.');

    return request(`/invoices/${encodeURIComponent(id)}/stock/evaluate`, {
      method: 'POST',
    });
  }

  /**
   * The decision about one line: match it to a product, or keep it off the
   * books. Reversible until the invoice is posted.
   */
  async function setInvoiceLineStock(invoiceId, lineId, body) {
    if (!invoiceId || !lineId) throw new Error('Invoice and line IDs are required.');

    return request(
      `/invoices/${encodeURIComponent(invoiceId)}/lines/${encodeURIComponent(lineId)}/stock`,
      { method: 'PATCH', body: JSON.stringify(body || {}) }
    );
  }

  /**
   * Adds an invoice line to the Product Master. Always an explicit act — the
   * server refuses it without confirm.
   */
  async function createProductFromLine(invoiceId, lineId, fields) {
    if (!invoiceId || !lineId) throw new Error('Invoice and line IDs are required.');

    return request(
      `/invoices/${encodeURIComponent(invoiceId)}/lines/${encodeURIComponent(lineId)}/product`,
      { method: 'POST', body: JSON.stringify({ ...(fields || {}), confirm: true }) }
    );
  }

  // ===========================================================================
  // STOCK
  // ===========================================================================

  function stockQuery(params = {}) {
    const clean =
      Object.fromEntries(
        Object.entries(params).filter(
          ([, value]) =>
            value !== undefined && value !== null && value !== ''
        )
      );

    const query = new URLSearchParams(clean).toString();

    return query ? `?${query}` : '';
  }

  async function stockOverview() {
    return request('/stock/overview');
  }

  async function listProducts(params = {}) {
    return request(`/stock/products${stockQuery(params)}`);
  }

  async function getProduct(id) {
    if (!id) throw new Error('Product ID is required.');

    return request(`/stock/products/${encodeURIComponent(id)}`);
  }

  async function createProduct(fields) {
    return request('/stock/products', {
      method: 'POST',
      body: JSON.stringify(fields || {}),
    });
  }

  async function updateProduct(id, fields) {
    if (!id) throw new Error('Product ID is required.');

    return request(`/stock/products/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(fields || {}),
    });
  }

  async function productHistory(id) {
    if (!id) throw new Error('Product ID is required.');

    return request(`/stock/products/${encodeURIComponent(id)}/history`);
  }

  async function listStockTransactions(params = {}) {
    return request(`/stock/transactions${stockQuery(params)}`);
  }

  async function getStockTransaction(id) {
    if (!id) throw new Error('Transaction ID is required.');

    return request(`/stock/transactions/${encodeURIComponent(id)}`);
  }

  async function createStockAdjustment(fields) {
    return request('/stock/adjustments', {
      method: 'POST',
      body: JSON.stringify(fields || {}),
    });
  }

  async function listStockLocations() {
    return request('/stock/locations');
  }

  async function listStockReview(status) {
    return request(`/stock/review${stockQuery({ status })}`);
  }

  async function resolveStockReview(id, body) {
    if (!id) throw new Error('Review item ID is required.');

    return request(`/stock/review/${encodeURIComponent(id)}/resolve`, {
      method: 'POST',
      body: JSON.stringify(body || {}),
    });
  }

  async function matchStockProduct(body) {
    return request('/stock/match', {
      method: 'POST',
      body: JSON.stringify(body || {}),
    });
  }

  /**
   * The bin sheet that ships with the app: what it holds, and how much of it
   * would land on the product master as it stands.
   */
  async function stockBinsAvailable() {
    return request('/stock/bins/available');
  }

  async function applyStockBins() {
    return request('/stock/bins/apply', { method: 'POST' });
  }

  async function reconcileStock() {
    return request('/stock/reconcile', { method: 'POST' });
  }

  async function listStockImports() {
    return request('/stock/imports');
  }

  /**
   * Uploads a stock spreadsheet and returns the detected columns plus a
   * suggested mapping. Nothing is written until commitStockImport is called.
   */
  async function uploadStockImport(file) {
    if (!token()) {
      invalidateSession();

      return Promise.reject(
        new Error('Your session has expired. Please sign in again.')
      );
    }

    const form = new FormData();

    form.append('file', file);

    const response =
      await fetch(`${BASE}/stock/imports`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token()}` },
        body: form,
      });

    if (response.status === 401 || response.status === 403) {
      // 403 here means the role is not allowed to import, not a dead session.
      if (response.status === 401) invalidateSession();

      const body = await response.json().catch(() => ({}));

      throw new Error(
        body.error ||
        (response.status === 403
          ? 'You do not have permission to import stock.'
          : 'Your session has expired. Please sign in again.')
      );
    }

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(body.error || 'Unable to read that spreadsheet.');
    }

    return body;
  }

  // ---------------------------------------------------------------------------
  // STOCK SIGN-OUT SHEETS
  // ---------------------------------------------------------------------------

  /**
   * Uploads a sign-out sheet. The server reads it in the background, so the
   * caller polls getStockSheet() until the status settles.
   */
  async function uploadStockSheet(file, fields = {}) {
    if (!token()) {
      invalidateSession();

      return Promise.reject(
        new Error('Your session has expired. Please sign in again.')
      );
    }

    const form = new FormData();

    form.append('file', file);

    Object.entries(fields).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        form.append(key, value);
      }
    });

    const response =
      await fetch(`${BASE}/stock/sheets`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token()}` },
        body: form,
      });

    if (response.status === 401) {
      invalidateSession();

      throw new Error('Your session has expired. Please sign in again.');
    }

    const body = await response.json().catch(() => ({}));

    if (response.status === 409) {
      // The same document has already been uploaded. The caller decides
      // whether to upload it again anyway.
      const duplicate = new Error(body.error || 'This sheet has already been processed.');

      duplicate.duplicate = true;
      duplicate.duplicateOf = body.duplicate_of || null;

      throw duplicate;
    }

    if (!response.ok) {
      throw new Error(
        body.error ||
        (response.status === 403
          ? 'You do not have permission to upload sign-out sheets.'
          : 'Unable to read that sign-out sheet.')
      );
    }

    return body;
  }

  async function listStockSheets(params = {}) {
    return request(`/stock/sheets${stockQuery(params)}`);
  }

  async function stockSheetMetrics() {
    return request('/stock/sheets/metrics');
  }

  async function getStockSheet(id) {
    if (!id) throw new Error('Sheet ID is required.');

    return request(`/stock/sheets/${encodeURIComponent(id)}`);
  }

  async function updateStockSheet(id, fields) {
    if (!id) throw new Error('Sheet ID is required.');

    return request(`/stock/sheets/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(fields || {}),
    });
  }

  async function updateStockSheetRow(sheetId, rowId, fields) {
    if (!sheetId || !rowId) throw new Error('Sheet and line IDs are required.');

    return request(
      `/stock/sheets/${encodeURIComponent(sheetId)}/rows/${encodeURIComponent(rowId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(fields || {}),
      }
    );
  }

  async function approveStockSheet(id) {
    if (!id) throw new Error('Sheet ID is required.');

    return request(`/stock/sheets/${encodeURIComponent(id)}/approve`, {
      method: 'POST',
    });
  }

  async function cancelStockSheet(id, reason) {
    if (!id) throw new Error('Sheet ID is required.');

    return request(`/stock/sheets/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason: reason || null }),
    });
  }

  async function retryStockSheet(id) {
    if (!id) throw new Error('Sheet ID is required.');

    return request(`/stock/sheets/${encodeURIComponent(id)}/retry`, {
      method: 'POST',
    });
  }

  /**
   * The sheet's own document, as a blob URL. The endpoint needs the bearer
   * token, so it cannot simply be pointed at from an <img> tag.
   */
  async function fetchStockSheetBlob(id) {
    const currentToken = token();

    if (!currentToken) {
      invalidateSession();

      return null;
    }

    let response;

    try {
      response =
        await fetch(
          `${BASE}/stock/sheets/${encodeURIComponent(id)}/document`,
          { headers: { Authorization: `Bearer ${currentToken}` } }
        );
    } catch (error) {
      throw new Error(
        'Unable to load the sign-out sheet. Please check your connection.'
      );
    }

    if (response.status === 401) {
      invalidateSession();

      throw new Error('Your session has expired. Please sign in again.');
    }

    if (!response.ok) {
      throw new Error(`Unable to load the document (${response.status}).`);
    }

    return URL.createObjectURL(await response.blob());
  }

  async function commitStockImport(importId, body) {
    if (!importId) throw new Error('Import ID is required.');

    return request(
      `/stock/imports/${encodeURIComponent(importId)}/commit`,
      {
        method: 'POST',
        body: JSON.stringify(body || {}),
      }
    );
  }

  // ===========================================================================
  // SUPPLIERS
  // ===========================================================================

  async function listSuppliers() {
    return request('/suppliers');
  }

  async function getSupplier(id) {
    if (!id) {
      throw new Error(
        'Supplier ID is required.'
      );
    }

    return request(
      `/suppliers/${encodeURIComponent(id)}`
    );
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

  async function exportSelected(
    ids
  ) {
    if (
      !Array.isArray(ids) ||
      !ids.length
    ) {
      throw new Error(
        'No invoices were selected for export.'
      );
    }

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
    deleteInvoice,
    deleteInvoices,

    // Documents
    documentUrl,
    fetchDocumentBlob,

    // Capture
    captureInvoice,
    captureInvoices,
    validateInvoiceFile,

    // Retry
    retryInvoice,

    // Editing
    updateInvoice,

    // Approval
    approveInvoice,
    rejectInvoice,

    // Suppliers
    listSuppliers,
    getSupplier,

    // Invoice → stock
    invoiceStockPlan,
    evaluateInvoiceStock,
    setInvoiceLineStock,
    createProductFromLine,

    // Stock
    stockOverview,
    listProducts,
    getProduct,
    createProduct,
    updateProduct,
    productHistory,
    listStockTransactions,
    getStockTransaction,
    createStockAdjustment,
    listStockLocations,
    listStockReview,
    resolveStockReview,
    matchStockProduct,
    reconcileStock,
    stockBinsAvailable,
    applyStockBins,
    listStockImports,
    uploadStockImport,
    commitStockImport,

    // Stock sign-out sheets
    uploadStockSheet,
    listStockSheets,
    stockSheetMetrics,
    getStockSheet,
    updateStockSheet,
    updateStockSheetRow,
    approveStockSheet,
    cancelStockSheet,
    retryStockSheet,
    fetchStockSheetBlob,

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
