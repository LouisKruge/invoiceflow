// app.js — router + state + event wiring for the InvoiceFlow SPA.
// Production frontend:
// - No mock invoice data
// - No mock AI data
// - Uses the real backend API
// - Automatically clears expired sessions
// - Provides a visible session reset option
// - Mobile-friendly authentication and invoice capture

const AppState = {
  user: null,
  health: null,
  invoiceFilters: { q: '', status: 'all' },
  selectedIds: new Set(),
  booting: false,
  sessionError: null,
};

const root = document.getElementById('app');

// -----------------------------------------------------------------------------
// Toasts
// -----------------------------------------------------------------------------

function toast(message, type = '') {
  const container = document.getElementById('toast-root');

  if (!container) {
    console[type === 'error' ? 'error' : 'log'](message);
    return;
  }

  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;

  container.appendChild(el);

  setTimeout(() => {
    if (el.parentNode) el.remove();
  }, 3800);
}

// -----------------------------------------------------------------------------
// Authentication / Session
// -----------------------------------------------------------------------------

function setLoggedIn(token, user) {
  if (!token) {
    throw new Error('Authentication token was not returned by the server.');
  }

  API.setToken(token);
  AppState.user = user || null;
  AppState.sessionError = null;
}

function logout(showMessage = false) {
  API.clearToken();

  AppState.user = null;
  AppState.health = null;
  AppState.selectedIds.clear();
  AppState.sessionError = null;

  if (showMessage) {
    toast('You have been signed out.', 'success');
  }

  if (location.hash !== '#/login') {
    location.hash = '#/login';
  } else {
    router();
  }
}

function handleSessionExpired(message = 'Your session has expired. Please sign in again.') {
  API.clearToken();

  AppState.user = null;
  AppState.health = null;
  AppState.selectedIds.clear();
  AppState.sessionError = message;

  if (location.hash !== '#/login') {
    location.hash = '#/login';
  } else {
    renderLoginPage(message);
  }
}

function isAuthError(error) {
  return error && (error.status === 401 || error.status === 403);
}

// -----------------------------------------------------------------------------
// Generic API error handling
// -----------------------------------------------------------------------------

function handleApiError(error, fallbackMessage = 'Something went wrong.') {
  console.error('[InvoiceFlow]', error);

  if (isAuthError(error)) {
    handleSessionExpired(
      error.message || 'Your session has expired. Please sign in again.'
    );
    return true;
  }

  toast(error?.message || fallbackMessage, 'error');
  return false;
}

// -----------------------------------------------------------------------------
// Router
// -----------------------------------------------------------------------------

const routes = {
  '#/login': renderLoginPage,
  '#/dashboard': renderDashboardPage,
  '#/capture': renderCapturePage,
  '#/invoices': () => renderInvoicesPage({}),
  '#/exceptions': () =>
    renderInvoicesPage({
      status: 'exception',
      title: 'Exceptions',
      forceExceptionView: true,
    }),
  '#/suppliers': renderSuppliersPage,
  '#/reports': renderReportsPage,
  '#/settings': renderSettingsPage,
};

let routerRunning = false;

async function router() {
  if (routerRunning) return;

  routerRunning = true;

  try {
    let hash = location.hash || '#/dashboard';

    const invoiceMatch = hash.match(/^#\/invoices\/(.+)$/);
    const reviewMatch = hash.match(/^#\/review\/(.+)$/);

    // No session.
    if (!API.token() && hash !== '#/login') {
      location.hash = '#/login';
      return;
    }

    // Already authenticated.
    if (API.token() && hash === '#/login') {
      location.hash = '#/dashboard';
      return;
    }

    // Load authenticated user.
    if (API.token() && !AppState.user) {
      try {
        const response = await API.me();

        if (!response || !response.user) {
          throw new Error('Authentication response did not contain a user.');
        }

        AppState.user = response.user;
        AppState.sessionError = null;
      } catch (error) {
        if (isAuthError(error)) {
          handleSessionExpired(
            'Your session is no longer valid. Please sign in again.'
          );
        } else {
          console.error('[Router] Failed to load authenticated user:', error);
          toast(
            error?.message || 'Unable to verify your session.',
            'error'
          );
        }

        return;
      }
    }

    // Load backend health once per session.
    if (API.token() && !AppState.health) {
      try {
        const response = await fetch('/api/health', {
          headers: {
            Authorization: `Bearer ${API.token()}`,
          },
        });

        if (response.ok) {
          AppState.health = await response.json();
        }
      } catch (error) {
        console.warn('[Router] Health check failed:', error);
      }
    }

    if (invoiceMatch) {
      await renderInvoiceDetailPage(invoiceMatch[1]);
      return;
    }

    if (reviewMatch) {
      await renderReviewPage(reviewMatch[1]);
      return;
    }

    const handler = routes[hash] || renderDashboardPage;

    await handler();
  } finally {
    routerRunning = false;
  }
}

window.addEventListener('hashchange', router);
window.addEventListener('DOMContentLoaded', router);

// -----------------------------------------------------------------------------
// Shell
// -----------------------------------------------------------------------------

async function mountShell(contentHtml, activeRoute) {
  let exceptionsCount = 0;

  try {
    const response = await API.listInvoices({
      status: 'exception',
    });

    exceptionsCount = Array.isArray(response?.invoices)
      ? response.invoices.length
      : 0;
  } catch (error) {
    if (isAuthError(error)) {
      handleSessionExpired(
        'Your session is no longer valid. Please sign in again.'
      );
      return false;
    }

    console.warn(
      '[Shell] Could not load exception count:',
      error
    );
  }

  if (!AppState.user) {
    location.hash = '#/login';
    return false;
  }

  root.innerHTML = renderShell(
    activeRoute,
    AppState.user,
    exceptionsCount,
    contentHtml
  );

  bindShellEvents();

  return true;
}

function bindShellEvents() {
  root.querySelectorAll('[data-route]').forEach((el) => {
    el.addEventListener('click', () => {
      const route = el.getAttribute('data-route');

      if (route) {
        location.hash = route;
      }
    });
  });

  const logoutBtn = document.getElementById('logout-btn');

  if (logoutBtn) {
    logoutBtn.onclick = () => {
      logout(true);
    };
  }

  const fab = document.getElementById('fab-capture');

  if (fab) {
    fab.onclick = () => {
      location.hash = '#/capture';
    };
  }

  const mobileNavBtn = document.getElementById('mobile-nav-btn');

  if (mobileNavBtn) {
    mobileNavBtn.onclick = () => openMobileNav();
  }
}

// -----------------------------------------------------------------------------
// Mobile navigation
// -----------------------------------------------------------------------------

function openMobileNav() {
  const existing = document.querySelector('.mobile-nav-backdrop');

  if (existing) {
    existing.remove();
  }

  const backdrop = document.createElement('div');

  backdrop.className = 'modal-backdrop mobile-nav-backdrop';

  backdrop.style.justifyContent = 'flex-start';
  backdrop.style.alignItems = 'stretch';
  backdrop.style.padding = '0';

  const items = [
    ['#/dashboard', 'Dashboard'],
    ['#/invoices', 'Invoices'],
    ['#/capture', 'Capture Invoice'],
    ['#/suppliers', 'Suppliers'],
    ['#/exceptions', 'Exceptions'],
    ['#/reports', 'Reports'],
    ['#/settings', 'Settings'],
  ];

  backdrop.innerHTML = `
    <div
      style="
        background:var(--ink-900);
        width:78%;
        max-width:280px;
        padding:20px 16px;
        color:#fff;
        min-height:100vh;
      "
    >
      <div
        style="
          display:flex;
          justify-content:space-between;
          align-items:center;
          margin-bottom:20px;
        "
      >
        <div style="font-weight:800;">
          InvoiceFlow
        </div>

        <button
          class="icon-btn"
          style="color:#fff"
          id="close-mobile-nav"
          type="button"
        >
          ${Icons.x}
        </button>
      </div>

      ${items
        .map(
          ([route, label]) => `
            <button
              class="nav-item"
              data-route="${route}"
              style="color:#fff"
              type="button"
            >
              ${label}
            </button>
          `
        )
        .join('')}

      <div class="nav-divider"></div>

      <button
        class="logout-btn"
        id="mobile-logout-btn"
        type="button"
      >
        Sign out
      </button>
    </div>
  `;

  document.body.appendChild(backdrop);

  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) {
      backdrop.remove();
    }
  });

  const closeBtn = backdrop.querySelector('#close-mobile-nav');

  if (closeBtn) {
    closeBtn.onclick = () => backdrop.remove();
  }

  const mobileLogoutBtn = backdrop.querySelector(
    '#mobile-logout-btn'
  );

  if (mobileLogoutBtn) {
    mobileLogoutBtn.onclick = () => {
      backdrop.remove();
      logout(true);
    };
  }

  backdrop.querySelectorAll('[data-route]').forEach((el) => {
    el.addEventListener('click', () => {
      const route = el.getAttribute('data-route');

      if (route) {
        location.hash = route;
      }

      backdrop.remove();
    });
  });
}

// -----------------------------------------------------------------------------
// Login page
// -----------------------------------------------------------------------------

function renderLoginPage(error) {
  const hasExistingToken = !!API.token();

  const sessionMessage =
    error ||
    AppState.sessionError ||
    null;

  root.innerHTML = renderLogin(sessionMessage);

  // If a stale token exists, show a clear-session option.
  if (hasExistingToken) {
    const authCard = root.querySelector('.auth-card');

    if (authCard) {
      const existingSession = document.createElement('div');

      existingSession.className = 'auth-error';

      existingSession.style.marginTop = '12px';

      existingSession.innerHTML = `
        <div style="margin-bottom:8px;">
          A saved session exists in this browser.
          If the app says your session is no longer valid,
          clear it and sign in again.
        </div>

        <button
          type="button"
          class="btn btn-ghost btn-block"
          id="clear-session-btn"
        >
          Clear saved session
        </button>
      `;

      authCard.appendChild(existingSession);

      const clearBtn =
        existingSession.querySelector('#clear-session-btn');

      if (clearBtn) {
        clearBtn.onclick = () => {
          API.clearToken();

          AppState.user = null;
          AppState.health = null;
          AppState.sessionError = null;

          toast('Saved session cleared.', 'success');

          renderLoginPage();
        };
      }
    }
  }

  // Demo chips.
  // These only fill the login form.
  // They do NOT create invoice mock data.
  document.querySelectorAll('.demo-chip').forEach((chip) => {
    chip.onclick = () => {
      const emailInput =
        document.querySelector('input[name="email"]');

      const passwordInput =
        document.querySelector('input[name="password"]');

      if (emailInput) {
        emailInput.value = chip.dataset.email || '';
      }

      if (passwordInput) {
        passwordInput.value = chip.dataset.pass || '';
      }
    };
  });

  const loginForm =
    document.getElementById('login-form');

  if (!loginForm) return;

  loginForm.onsubmit = async (event) => {
    event.preventDefault();

    const submitBtn =
      loginForm.querySelector('button[type="submit"]');

    const form = new FormData(loginForm);

    const email = String(
      form.get('email') || ''
    ).trim();

    const password = String(
      form.get('password') || ''
    );

    if (!email || !password) {
      renderLoginPage('Please enter your email and password.');
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Signing in…';
    }

    try {
      const response = await API.login(
        email,
        password
      );

      if (!response?.token) {
        throw new Error(
          'The server did not return an authentication token.'
        );
      }

      if (!response?.user) {
        throw new Error(
          'The server did not return your user profile.'
        );
      }

      setLoggedIn(
        response.token,
        response.user
      );

      AppState.sessionError = null;

      location.hash = '#/dashboard';
    } catch (error) {
      console.error('[Login] Login failed:', error);

      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Sign in';
      }

      renderLoginPage(
        error?.message || 'Unable to sign in.'
      );
    }
  };
}

// -----------------------------------------------------------------------------
// Dashboard
// -----------------------------------------------------------------------------

async function renderDashboardPage() {
  const mounted = await mountShell(
    `<div class="loading-inline">Loading dashboard…</div>`,
    '#/dashboard'
  );

  if (!mounted) return;

  try {
    const data = await API.dashboardSummary();

    const content =
      document.querySelector('.content');

    if (!content) return;

    content.innerHTML =
      renderDashboard(data);

    bindShellEvents();

    document
      .querySelectorAll(
        '#recent-table tbody tr[data-id]'
      )
      .forEach((tr) => {
        tr.onclick = () => {
          location.hash =
            `#/invoices/${tr.dataset.id}`;
        };
      });
  } catch (error) {
    if (handleApiError(
      error,
      'Unable to load dashboard.'
    )) return;
  }
}

// -----------------------------------------------------------------------------
// Capture
// -----------------------------------------------------------------------------

async function renderCapturePage() {
  const mounted = await mountShell(
    renderCapture(),
    '#/capture'
  );

  if (!mounted) return;

  const takePhotoBtn =
    document.getElementById(
      'btn-take-photo'
    );

  if (takePhotoBtn) {
    takePhotoBtn.onclick = () => {
      if (
        typeof Camera === 'undefined' ||
        !Camera.open
      ) {
        toast(
          'Camera is not available on this device.',
          'error'
        );
        return;
      }

      Camera.open({
        onCapture: (file) => {
          if (file) {
            runCapture(file);
          }
        },
        onCancel: () => {},
      });
    };
  }

  const uploadBtn =
    document.getElementById(
      'btn-upload-invoice'
    );

  if (uploadBtn) {
    uploadBtn.onclick = () => {
      if (
        typeof Camera === 'undefined' ||
        !Camera.openNativePicker
      ) {
        toast(
          'File picker is not available.',
          'error'
        );
        return;
      }

      Camera.openNativePicker({
        capture: false,

        onCapture: (file) => {
          if (file) {
            runCapture(file);
          }
        },

        onCancel: () => {},
      });
    };
  }
}

// -----------------------------------------------------------------------------
// Invoice processing
// -----------------------------------------------------------------------------

const PROCESSING_STAGES = [
  'Uploading invoice...',
  'Reading document...',
  'Extracting invoice information...',
  'Validating information...',
];

async function runCapture(file) {
  if (!file) {
    toast(
      'No invoice file was selected.',
      'error'
    );
    return;
  }

  let stageIndex = 0;

  root.innerHTML =
    renderProcessing(
      stageIndex,
      PROCESSING_STAGES,
      false
    );

  let stageTimer = setInterval(() => {
    if (
      stageIndex <
      PROCESSING_STAGES.length - 1
    ) {
      stageIndex++;

      root.innerHTML =
        renderProcessing(
          stageIndex,
          PROCESSING_STAGES,
          false
        );
    }
  }, 1200);

  try {
    console.log(
      '[Capture] Sending invoice to production backend:',
      {
        name: file.name,
        type: file.type,
        size: file.size,
      }
    );

    const result =
      await API.captureInvoice(file);

    clearInterval(stageTimer);
    stageTimer = null;

    if (
      !result ||
      !result.invoice ||
      !result.invoice.id
    ) {
      throw new Error(
        'The server processed the invoice but did not return an invoice ID.'
      );
    }

    root.innerHTML =
      renderProcessing(
        PROCESSING_STAGES.length - 1,
        PROCESSING_STAGES,
        false
      );

    setTimeout(() => {
      location.hash =
        `#/review/${result.invoice.id}`;
    }, 500);

    if (result.warning) {
      setTimeout(() => {
        toast(
          result.warning,
          'error'
        );
      }, 800);
    }
  } catch (error) {
    if (stageTimer) {
      clearInterval(stageTimer);
      stageTimer = null;
    }

    console.error(
      '[Capture] Invoice capture failed:',
      error
    );

    if (isAuthError(error)) {
      handleSessionExpired(
        'Your session expired while uploading the invoice. Please sign in again.'
      );
      return;
    }

    toast(
      `Upload failed: ${
        error?.message ||
        'Unknown error'
      }`,
      'error'
    );

    location.hash = '#/capture';
  }
}

// -----------------------------------------------------------------------------
// Review
// -----------------------------------------------------------------------------

async function renderReviewPage(
  id,
  warning
) {
  const mounted =
    await mountShell(
      `<div class="loading-inline">Loading invoice…</div>`,
      '#/invoices'
    );

  if (!mounted) return;

  try {
    const response =
      await API.getInvoice(id);

    if (
      !response ||
      !response.invoice
    ) {
      throw new Error(
        'Invoice was not returned by the server.'
      );
    }

    await paintReview(
      response.invoice,
      warning
    );
  } catch (error) {
    if (
      handleApiError(
        error,
        'Unable to load invoice.'
      )
    ) return;

    location.hash = '#/invoices';
  }
}

async function renderInvoiceDetailPage(id) {
  return renderReviewPage(id);
}

// -----------------------------------------------------------------------------
// Paint review
// -----------------------------------------------------------------------------

async function paintReview(
  invoice,
  warning
) {
  const content =
    document.querySelector('.content');

  if (!content) return;

  content.innerHTML =
    renderReview(
      invoice,
      { warning }
    );

  bindShellEvents();

  // ---------------------------------------------------------------------------
  // Document preview
  // ---------------------------------------------------------------------------

  const docImgWrap =
    document.getElementById(
      'review-doc-image'
    );

  if (docImgWrap) {
    try {
      const url =
        await API.fetchDocumentBlob(
          invoice.id
        );

      if (url) {
        const current =
          document.getElementById(
            'review-doc-image'
          );

        if (current) {
          current.outerHTML = `
            <img
              id="review-doc-image"
              src="${url}"
              alt="Original invoice document"
              style="max-width:100%;height:auto;"
            />
          `;
        }
      } else {
        const current =
          document.getElementById(
            'review-doc-image'
          );

        if (current) {
          current.textContent =
            'No document on file';
        }
      }
    } catch (error) {
      if (isAuthError(error)) {
        handleSessionExpired(
          'Your session expired while loading the invoice document.'
        );
        return;
      }

      console.warn(
        '[Review] Could not load invoice document:',
        error
      );

      const current =
        document.getElementById(
          'review-doc-image'
        );

      if (current) {
        current.textContent =
          'Could not load document';
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Editable fields
  // ---------------------------------------------------------------------------

  document
    .querySelectorAll(
      '[data-field-input]'
    )
    .forEach((input) => {
      let original = input.value;

      input.addEventListener(
        'blur',
        async () => {
          const value =
            input.value;

          if (value === original) {
            return;
          }

          const field =
            input.dataset.fieldInput;

          if (!field) return;

          input.disabled = true;

          try {
            const response =
              await API.updateInvoice(
                invoice.id,
                {
                  [field]: value,
                }
              );

            if (
              !response ||
              !response.invoice
            ) {
              throw new Error(
                'The server did not return the updated invoice.'
              );
            }

            original = value;

            toast(
              'Field updated',
              'success'
            );

            await paintReview(
              response.invoice,
              warning
            );
          } catch (error) {
            input.disabled = false;

            if (
              handleApiError(
                error,
                'Unable to update invoice field.'
              )
            ) {
              return;
            }
          }
        }
      );
    });

  // ---------------------------------------------------------------------------
  // Approve
  // ---------------------------------------------------------------------------

  const approveBtn =
    document.getElementById(
      'btn-approve'
    );

  if (approveBtn) {
    approveBtn.onclick = async () => {
      approveBtn.disabled = true;
      approveBtn.textContent =
        'Approving…';

      try {
        const response =
          await API.approveInvoice(
            invoice.id
          );

        if (
          !response ||
          !response.invoice
        ) {
          throw new Error(
            'The server did not return the approved invoice.'
          );
        }

        toast(
          'Invoice approved',
          'success'
        );

        await paintReview(
          response.invoice
        );
      } catch (error) {
        if (
          handleApiError(
            error,
            'Unable to approve invoice.'
          )
        ) {
          return;
        }

        approveBtn.disabled = false;
        approveBtn.textContent =
          'Approve Invoice';
      }
    };
  }

  // ---------------------------------------------------------------------------
  // Reject
  // ---------------------------------------------------------------------------

  const rejectBtn =
    document.getElementById(
      'btn-reject'
    );

  if (rejectBtn) {
    rejectBtn.onclick = () =>
      confirmReject(invoice.id);
  }

  // ---------------------------------------------------------------------------
  // Retake / retry
  // ---------------------------------------------------------------------------

  const retakeBtn =
    document.getElementById(
      'btn-retake'
    );

  if (retakeBtn) {
    retakeBtn.onclick = () => {
      if (
        typeof Camera === 'undefined' ||
        !Camera.open
      ) {
        toast(
          'Camera is not available.',
          'error'
        );
        return;
      }

      Camera.open({
        onCapture: async (file) => {
          if (!file) return;

          root.innerHTML =
            renderProcessing(
              1,
              PROCESSING_STAGES,
              false
            );

          try {
            const response =
              await API.retryInvoice(
                invoice.id,
                file
              );

            if (
              !response ||
              !response.invoice
            ) {
              throw new Error(
                'The server did not return the reprocessed invoice.'
              );
            }

            location.hash =
              `#/review/${response.invoice.id}`;
          } catch (error) {
            if (
              handleApiError(
                error,
                'Unable to reprocess invoice.'
              )
            ) {
              return;
            }

            toast(
              error?.message ||
                'Reprocessing failed.',
              'error'
            );

            location.hash =
              `#/review/${invoice.id}`;
          }
        },

        onCancel: () => {},
      });
    };
  }
}

// -----------------------------------------------------------------------------
// Reject modal
// -----------------------------------------------------------------------------

function confirmReject(id) {
  const backdrop =
    document.createElement('div');

  backdrop.className =
    'modal-backdrop';

  backdrop.innerHTML = `
    <div class="modal-card">
      <h3>Reject this invoice?</h3>

      <p>
        This marks the invoice as rejected
        and removes it from approval queues.
        This can be reviewed later in the archive.
      </p>

      <div class="modal-actions">
        <button
          class="btn btn-ghost"
          id="cancel-reject"
          type="button"
        >
          Cancel
        </button>

        <button
          class="btn btn-danger-ghost"
          id="confirm-reject"
          type="button"
          style="
            background:var(--bad-600);
            color:#fff;
          "
        >
          Reject Invoice
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(
    backdrop
  );

  const cancelBtn =
    backdrop.querySelector(
      '#cancel-reject'
    );

  if (cancelBtn) {
    cancelBtn.onclick = () =>
      backdrop.remove();
  }

  const confirmBtn =
    backdrop.querySelector(
      '#confirm-reject'
    );

  if (confirmBtn) {
    confirmBtn.onclick = async () => {
      confirmBtn.disabled = true;
      confirmBtn.textContent =
        'Rejecting…';

      try {
        const response =
          await API.rejectInvoice(id);

        if (
          !response ||
          !response.invoice
        ) {
          throw new Error(
            'The server did not return the rejected invoice.'
          );
        }

        backdrop.remove();

        toast(
          'Invoice rejected',
          'success'
        );

        await paintReview(
          response.invoice
        );
      } catch (error) {
        if (
          handleApiError(
            error,
            'Unable to reject invoice.'
          )
        ) {
          return;
        }

        confirmBtn.disabled = false;
        confirmBtn.textContent =
          'Reject Invoice';
      }
    };
  }
}

// -----------------------------------------------------------------------------
// Invoices list
// -----------------------------------------------------------------------------

async function renderInvoicesPage(
  opts
) {
  const activeRoute =
    opts.forceExceptionView
      ? '#/exceptions'
      : '#/invoices';

  const mounted =
    await mountShell(
      `<div class="loading-inline">Loading invoices…</div>`,
      activeRoute
    );

  if (!mounted) return;

  const filters =
    opts.status
      ? {
          ...AppState.invoiceFilters,
          status: opts.status,
        }
      : AppState.invoiceFilters;

  await loadAndPaintInvoices(
    filters,
    opts.title,
    opts.forceExceptionView
  );
}

async function loadAndPaintInvoices(
  filters,
  title,
  isExceptionView
) {
  try {
    const params = {
      q: filters.q,
      status:
        isExceptionView
          ? undefined
          : (
              filters.status === 'all'
                ? undefined
                : filters.status
            ),
    };

    const response =
      await API.listInvoices(
        params
      );

    const invoices =
      Array.isArray(response?.invoices)
        ? response.invoices
        : [];

    const finalList =
      isExceptionView
        ? invoices.filter(
            (invoice) =>
              [
                'exception',
                'duplicate',
              ].includes(
                invoice.status
              )
          )
        : invoices;

    const content =
      document.querySelector(
        '.content'
      );

    if (!content) return;

    content.innerHTML =
      renderInvoicesList(
        finalList,
        filters,
        title || 'Invoices'
      );

    bindShellEvents();

    bindInvoicesListEvents(
      filters,
      title,
      isExceptionView
    );
  } catch (error) {
    handleApiError(
      error,
      'Unable to load invoices.'
    );
  }
}

function bindInvoicesListEvents(
  filters,
  title,
  isExceptionView
) {
  document
    .querySelectorAll(
      'table.data-table tbody tr[data-id]'
    )
    .forEach((tr) => {
      tr.onclick = () => {
        location.hash =
          `#/invoices/${tr.dataset.id}`;
      };
    });

  const searchInput =
    document.getElementById(
      'invoice-search'
    );

  if (searchInput) {
    let timer;

    searchInput.oninput = () => {
      clearTimeout(timer);

      timer = setTimeout(() => {
        AppState.invoiceFilters.q =
          searchInput.value;

        loadAndPaintInvoices(
          AppState.invoiceFilters,
          title,
          isExceptionView
        );
      }, 300);
    };
  }

  document
    .querySelectorAll(
      '.chip[data-status]'
    )
    .forEach((chip) => {
      chip.onclick = () => {
        AppState.invoiceFilters.status =
          chip.dataset.status;

        loadAndPaintInvoices(
          AppState.invoiceFilters,
          title,
          isExceptionView
        );
      };
    });

  // ---------------------------------------------------------------------------
  // Export all
  // ---------------------------------------------------------------------------

  const exportAllBtn =
    document.getElementById(
      'btn-export-all'
    );

  if (exportAllBtn) {
    exportAllBtn.onclick = async () => {
      exportAllBtn.disabled = true;

      try {
        await downloadAuthenticated(
          API.exportAllUrl(),
          'invoiceflow-export.xlsx'
        );

        toast(
          'Export downloaded',
          'success'
        );
      } catch (error) {
        handleApiError(
          error,
          'Export failed.'
        );
      } finally {
        exportAllBtn.disabled = false;
      }
    };
  }

  // ---------------------------------------------------------------------------
  // Export selected
  // ---------------------------------------------------------------------------

  const exportSelectedBtn =
    document.getElementById(
      'btn-export-selected'
    );

  if (exportSelectedBtn) {
    exportSelectedBtn.onclick =
      async () => {
        const ids =
          Array.from(
            document.querySelectorAll(
              '.row-check:checked'
            )
          ).map(
            (checkbox) =>
              checkbox.dataset.id
          );

        if (!ids.length) {
          toast(
            'Select at least one invoice first.',
            'error'
          );
          return;
        }

        exportSelectedBtn.disabled = true;

        try {
          const response =
            await API.exportSelected(
              ids
            );

          // API.exportSelected() may return JSON
          // or a backend response depending on implementation.
          // If the API wrapper returns the actual response,
          // handle it accordingly.

          if (response instanceof Response) {
            if (!response.ok) {
              throw new Error(
                'Export failed.'
              );
            }

            const blob =
              await response.blob();

            triggerDownload(
              blob,
              `invoiceflow-selected-${new Date()
                .toISOString()
                .slice(0, 10)}.xlsx`
            );
          } else {
            // If backend/API returns a URL,
            // allow it to be downloaded.
            if (response?.url) {
              await downloadAuthenticated(
                response.url,
                `invoiceflow-selected-${new Date()
                  .toISOString()
                  .slice(0, 10)}.xlsx`
              );
            } else {
              throw new Error(
                'The export response was invalid.'
              );
            }
          }

          toast(
            'Selected invoices exported',
            'success'
          );
        } catch (error) {
          handleApiError(
            error,
            'Selected invoice export failed.'
          );
        } finally {
          exportSelectedBtn.disabled = false;
        }
      };
  }
}

// -----------------------------------------------------------------------------
// Suppliers
// -----------------------------------------------------------------------------

async function renderSuppliersPage() {
  const mounted =
    await mountShell(
      `<div class="loading-inline">Loading suppliers…</div>`,
      '#/suppliers'
    );

  if (!mounted) return;

  try {
    const response =
      await API.listSuppliers();

    const suppliers =
      Array.isArray(
        response?.suppliers
      )
        ? response.suppliers
        : [];

    const content =
      document.querySelector(
        '.content'
      );

    if (!content) return;

    content.innerHTML =
      renderSuppliers(
        suppliers
      );

    bindShellEvents();
  } catch (error) {
    handleApiError(
      error,
      'Unable to load suppliers.'
    );
  }
}

// -----------------------------------------------------------------------------
// Reports
// -----------------------------------------------------------------------------

async function renderReportsPage() {
  const mounted =
    await mountShell(
      `<div class="loading-inline">Loading reports…</div>`,
      '#/reports'
    );

  if (!mounted) return;

  try {
    const [
      supplierResponse,
      summary,
    ] = await Promise.all([
      API.listSuppliers(),
      API.dashboardSummary(),
    ]);

    const suppliers =
      Array.isArray(
        supplierResponse?.suppliers
      )
        ? supplierResponse.suppliers
        : [];

    const content =
      document.querySelector(
        '.content'
      );

    if (!content) return;

    content.innerHTML =
      renderReports(
        suppliers,
        summary
      );

    bindShellEvents();
  } catch (error) {
    handleApiError(
      error,
      'Unable to load reports.'
    );
  }
}

// -----------------------------------------------------------------------------
// Settings
// -----------------------------------------------------------------------------

async function renderSettingsPage() {
  const mounted =
    await mountShell(
      renderSettings(
        AppState.user,
        AppState.health
      ),
      '#/settings'
    );

  if (!mounted) return;

  bindShellEvents();
}

// -----------------------------------------------------------------------------
// Download helper
// -----------------------------------------------------------------------------

function triggerDownload(
  blob,
  filename
) {
  const url =
    URL.createObjectURL(
      blob
    );

  const a =
    document.createElement('a');

  a.href = url;
  a.download = filename;

  document.body.appendChild(a);

  a.click();

  a.remove();

  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

// -----------------------------------------------------------------------------
// Authenticated file download
// -----------------------------------------------------------------------------

async function downloadAuthenticated(
  url,
  filenameFallback
) {
  const token =
    API.token();

  if (!token) {
    handleSessionExpired(
      'Your session has expired. Please sign in again.'
    );

    throw new Error(
      'Authentication required.'
    );
  }

  const resp =
    await fetch(
      url,
      {
        headers: {
          Authorization:
            `Bearer ${token}`,
        },
      }
    );

  if (resp.status === 401 ||
      resp.status === 403) {
    handleSessionExpired(
      'Your session has expired. Please sign in again.'
    );

    throw new Error(
      'Session expired.'
    );
  }

  if (!resp.ok) {
    throw new Error(
      `Export failed (${resp.status}).`
    );
  }

  const blob =
    await resp.blob();

  const disposition =
    resp.headers.get(
      'content-disposition'
    ) || '';

  const match =
    disposition.match(
      /filename="?([^"]+)"?/i
    );

  const filename =
    match
      ? match[1]
      : filenameFallback;

  triggerDownload(
    blob,
    filename
  );
}

// -----------------------------------------------------------------------------
// Global unhandled rejection logging
// -----------------------------------------------------------------------------

window.addEventListener(
  'unhandledrejection',
  (event) => {
    console.error(
      '[InvoiceFlow] Unhandled promise rejection:',
      event.reason
    );

    if (
      isAuthError(
        event.reason
      )
    ) {
      event.preventDefault();

      handleSessionExpired(
        'Your session has expired. Please sign in again.'
      );
    }
  }
);
