// app.js — router + state + event wiring for the InvoiceFlow SPA.
// Production version: no mock invoice data or mock AI logic.

const AppState = {
  user: null,
  health: null,
  invoiceFilters: { q: '', status: 'all' },
  selectedIds: new Set(),
};

const root = document.getElementById('app');

// -----------------------------------------------------------------------------
// Toasts
// -----------------------------------------------------------------------------

function toast(message, type = '') {
  const toastRoot = document.getElementById('toast-root');

  if (!toastRoot) {
    console[type === 'error' ? 'error' : 'log'](message);
    return;
  }

  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;

  toastRoot.appendChild(el);

  setTimeout(() => {
    el.remove();
  }, 3800);
}

// -----------------------------------------------------------------------------
// Authentication
// -----------------------------------------------------------------------------

function setLoggedIn(token, user) {
  API.setToken(token);
  AppState.user = user;
}

function logout(showMessage = false) {
  API.clearToken();
  AppState.user = null;
  AppState.health = null;
  AppState.selectedIds.clear();
  AppState.invoiceFilters = { q: '', status: 'all' };

  if (showMessage) {
    toast('You have been signed out.');
  }

  if (location.hash !== '#/login') {
    location.hash = '#/login';
  } else {
    router();
  }
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

    // -------------------------------------------------------------------------
    // Authentication guard
    // -------------------------------------------------------------------------

    if (!API.token() && hash !== '#/login') {
      if (location.hash !== '#/login') {
        location.hash = '#/login';
      } else {
        await renderLoginPage();
      }
      return;
    }

    if (API.token() && hash === '#/login') {
      location.hash = '#/dashboard';
      return;
    }

    // -------------------------------------------------------------------------
    // Load authenticated user
    // -------------------------------------------------------------------------

    if (API.token() && !AppState.user) {
      try {
        const response = await API.me();

        if (!response || !response.user) {
          throw new Error('Session is no longer valid.');
        }

        AppState.user = response.user;
      } catch (error) {
        API.clearToken();
        AppState.user = null;
        AppState.health = null;

        if (location.hash !== '#/login') {
          location.hash = '#/login';
        }

        await renderLoginPage(
          'Your session has expired. Please sign in again.'
        );

        return;
      }
    }

    // -------------------------------------------------------------------------
    // Load backend health
    // -------------------------------------------------------------------------

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
        console.warn('[app] Could not load backend health:', error);
      }
    }

    // -------------------------------------------------------------------------
    // Detail routes
    // -------------------------------------------------------------------------

    if (invoiceMatch) {
      await renderInvoiceDetailPage(invoiceMatch[1]);
      return;
    }

    if (reviewMatch) {
      await renderReviewPage(reviewMatch[1]);
      return;
    }

    // -------------------------------------------------------------------------
    // Normal routes
    // -------------------------------------------------------------------------

    const handler = routes[hash] || renderDashboardPage;

    await handler();
  } finally {
    routerRunning = false;
  }
}

window.addEventListener('hashchange', router);

window.addEventListener('DOMContentLoaded', () => {
  router();
});

// -----------------------------------------------------------------------------
// Shell mount
// -----------------------------------------------------------------------------

async function mountShell(contentHtml, activeRoute) {
  let exceptionsCount = 0;

  try {
    const response = await API.listInvoices({
      status: 'exception',
    });

    exceptionsCount = Array.isArray(response.invoices)
      ? response.invoices.length
      : 0;
  } catch (error) {
    // Do not break the application if the exception counter fails.
    console.warn(
      '[app] Could not load exception count:',
      error.message
    );
  }

  root.innerHTML = renderShell(
    activeRoute,
    AppState.user,
    exceptionsCount,
    contentHtml
  );

  bindShellEvents();
}

// -----------------------------------------------------------------------------
// Shell events
// -----------------------------------------------------------------------------

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
      logout();
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
    mobileNavBtn.onclick = () => {
      openMobileNav();
    };
  }
}

// -----------------------------------------------------------------------------
// Mobile navigation
// -----------------------------------------------------------------------------

function openMobileNav() {
  const backdrop = document.createElement('div');

  backdrop.className = 'modal-backdrop';
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
        <div style="font-weight:800;">InvoiceFlow</div>

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
    closeBtn.onclick = () => {
      backdrop.remove();
    };
  }

  const mobileLogoutBtn = backdrop.querySelector(
    '#mobile-logout-btn'
  );

  if (mobileLogoutBtn) {
    mobileLogoutBtn.onclick = () => {
      backdrop.remove();
      logout();
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
  root.innerHTML = renderLogin(error);

  /*
   * Demo login accounts intentionally removed.
   * Production authentication uses the real backend.
   */

  const loginForm = document.getElementById('login-form');

  if (!loginForm) {
    return;
  }

  loginForm.onsubmit = async (event) => {
    event.preventDefault();

    const submitButton = loginForm.querySelector(
      'button[type="submit"]'
    );

    const form = new FormData(loginForm);

    const email = String(form.get('email') || '').trim();
    const password = String(form.get('password') || '');

    if (!email || !password) {
      renderLoginPage('Please enter your email and password.');
      return;
    }

    try {
      if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = 'Signing in…';
      }

      const response = await API.login(email, password);

      if (!response || !response.token || !response.user) {
        throw new Error('Invalid authentication response from server.');
      }

      setLoggedIn(response.token, response.user);

      AppState.health = null;

      location.hash = '#/dashboard';
    } catch (error) {
      console.error('[app] Login failed:', error);

      renderLoginPage(
        error?.message || 'Unable to sign in. Please try again.'
      );
    }
  };
}

// -----------------------------------------------------------------------------
// Dashboard page
// -----------------------------------------------------------------------------

async function renderDashboardPage() {
  await mountShell(
    `<div class="loading-inline">Loading dashboard…</div>`,
    '#/dashboard'
  );

  try {
    const data = await API.dashboardSummary();

    document.querySelector('.content').innerHTML =
      renderDashboard(data);

    bindShellEvents();

    document
      .querySelectorAll('#recent-table tbody tr[data-id]')
      .forEach((row) => {
        row.onclick = () => {
          location.hash = `#/invoices/${row.dataset.id}`;
        };
      });
  } catch (error) {
    console.error('[app] Dashboard failed:', error);

    toast(
      error?.message || 'Unable to load dashboard.',
      'error'
    );
  }
}

// -----------------------------------------------------------------------------
// Capture page
// -----------------------------------------------------------------------------

async function renderCapturePage() {
  await mountShell(
    renderCapture(),
    '#/capture'
  );

  const takePhotoButton =
    document.getElementById('btn-take-photo');

  if (takePhotoButton) {
    takePhotoButton.onclick = () => {
      Camera.open({
        onCapture: (file) => {
          runCapture(file);
        },
        onCancel: () => {},
      });
    };
  }

  const uploadButton =
    document.getElementById('btn-upload-invoice');

  if (uploadButton) {
    uploadButton.onclick = () => {
      Camera.openNativePicker({
        capture: false,
        onCapture: (file) => {
          runCapture(file);
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
    toast('No invoice file was selected.', 'error');
    return;
  }

  let stageIndex = 0;

  root.innerHTML = renderProcessing(
    stageIndex,
    PROCESSING_STAGES,
    false
  );

  const stageTimer = setInterval(() => {
    if (stageIndex < PROCESSING_STAGES.length - 1) {
      stageIndex++;

      root.innerHTML = renderProcessing(
        stageIndex,
        PROCESSING_STAGES,
        false
      );
    }
  }, 900);

  try {
    const result = await API.captureInvoice(file);

    clearInterval(stageTimer);

    root.innerHTML = renderProcessing(
      PROCESSING_STAGES.length - 1,
      PROCESSING_STAGES,
      false
    );

    if (!result || !result.invoice || !result.invoice.id) {
      throw new Error(
        'The server did not return a valid processed invoice.'
      );
    }

    setTimeout(() => {
      location.hash = `#/review/${result.invoice.id}`;

      if (result.warning) {
        toast(result.warning, 'error');
      }
    }, 500);
  } catch (error) {
    clearInterval(stageTimer);

    console.error(
      '[app] Invoice capture failed:',
      error
    );

    toast(
      `Invoice processing failed: ${
        error?.message || 'Unknown error'
      }`,
      'error'
    );

    setTimeout(() => {
      location.hash = '#/capture';
    }, 100);
  }
}

// -----------------------------------------------------------------------------
// Review page
// -----------------------------------------------------------------------------

async function renderReviewPage(id, warning) {
  await mountShell(
    `<div class="loading-inline">Loading invoice…</div>`,
    '#/invoices'
  );

  try {
    const response = await API.getInvoice(id);

    if (!response || !response.invoice) {
      throw new Error('Invoice could not be loaded.');
    }

    await paintReview(
      response.invoice,
      warning
    );
  } catch (error) {
    console.error(
      '[app] Invoice review failed:',
      error
    );

    toast(
      error?.message || 'Unable to load invoice.',
      'error'
    );

    location.hash = '#/invoices';
  }
}

async function renderInvoiceDetailPage(id) {
  return renderReviewPage(id);
}

// -----------------------------------------------------------------------------
// Paint review
// -----------------------------------------------------------------------------

async function paintReview(invoice, warning) {
  document.querySelector('.content').innerHTML =
    renderReview(invoice, { warning });

  bindShellEvents();

  const docImgWrap =
    document.getElementById('review-doc-image');

  if (docImgWrap) {
    API.fetchDocumentBlob(invoice.id)
      .then((url) => {
        if (!docImgWrap.isConnected) return;

        if (url) {
          docImgWrap.outerHTML = `
            <img
              id="review-doc-image"
              src="${url}"
              alt="Original invoice document"
            />
          `;
        } else {
          docImgWrap.textContent =
            'No document on file';
        }
      })
      .catch(() => {
        if (docImgWrap.isConnected) {
          docImgWrap.textContent =
            'Could not load document';
        }
      });
  }

  // ---------------------------------------------------------------------------
  // Editable invoice fields
  // ---------------------------------------------------------------------------

  document
    .querySelectorAll('[data-field-input]')
    .forEach((input) => {
      const original = input.value;

      input.addEventListener('blur', async () => {
        if (input.value === original) {
          return;
        }

        const field = input.dataset.fieldInput;

        try {
          input.disabled = true;

          const response = await API.updateInvoice(
            invoice.id,
            {
              [field]: input.value,
            }
          );

          if (!response || !response.invoice) {
            throw new Error(
              'Server did not return updated invoice.'
            );
          }

          toast('Field updated');

          await paintReview(
            response.invoice,
            warning
          );
        } catch (error) {
          console.error(
            '[app] Invoice update failed:',
            error
          );

          input.disabled = false;

          toast(
            error?.message ||
              'Unable to update invoice.',
            'error'
          );
        }
      });
    });

  // ---------------------------------------------------------------------------
  // Approve
  // ---------------------------------------------------------------------------

  const approveBtn =
    document.getElementById('btn-approve');

  if (approveBtn) {
    approveBtn.onclick = async () => {
      try {
        approveBtn.disabled = true;
        approveBtn.textContent = 'Approving…';

        const response =
          await API.approveInvoice(invoice.id);

        if (!response || !response.invoice) {
          throw new Error(
            'Server did not return the approved invoice.'
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
        console.error(
          '[app] Invoice approval failed:',
          error
        );

        approveBtn.disabled = false;
        approveBtn.textContent =
          'Approve Invoice';

        toast(
          error?.message ||
            'Unable to approve invoice.',
          'error'
        );
      }
    };
  }

  // ---------------------------------------------------------------------------
  // Reject
  // ---------------------------------------------------------------------------

  const rejectBtn =
    document.getElementById('btn-reject');

  if (rejectBtn) {
    rejectBtn.onclick = () => {
      confirmReject(invoice.id);
    };
  }

  // ---------------------------------------------------------------------------
  // Retake / retry
  // ---------------------------------------------------------------------------

  const retakeBtn =
    document.getElementById('btn-retake');

  if (retakeBtn) {
    retakeBtn.onclick = () => {
      Camera.open({
        onCapture: async (file) => {
          root.innerHTML = renderProcessing(
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

            if (!response || !response.invoice) {
              throw new Error(
                'Server did not return the reprocessed invoice.'
              );
            }

            location.hash =
              `#/review/${response.invoice.id}`;
          } catch (error) {
            console.error(
              '[app] Invoice retry failed:',
              error
            );

            toast(
              error?.message ||
                'Unable to reprocess invoice.',
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
// Reject confirmation
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
        This marks the invoice as rejected and removes it
        from approval queues. This can be reviewed later
        in the archive.
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

  document.body.appendChild(backdrop);

  const cancelBtn =
    backdrop.querySelector(
      '#cancel-reject'
    );

  if (cancelBtn) {
    cancelBtn.onclick = () => {
      backdrop.remove();
    };
  }

  const confirmBtn =
    backdrop.querySelector(
      '#confirm-reject'
    );

  if (confirmBtn) {
    confirmBtn.onclick = async () => {
      try {
        confirmBtn.disabled = true;
        confirmBtn.textContent =
          'Rejecting…';

        const response =
          await API.rejectInvoice(id);

        if (!response || !response.invoice) {
          throw new Error(
            'Server did not return the rejected invoice.'
          );
        }

        backdrop.remove();

        toast(
          'Invoice rejected'
        );

        await paintReview(
          response.invoice
        );
      } catch (error) {
        console.error(
          '[app] Invoice rejection failed:',
          error
        );

        confirmBtn.disabled = false;
        confirmBtn.textContent =
          'Reject Invoice';

        toast(
          error?.message ||
            'Unable to reject invoice.',
          'error'
        );
      }
    };
  }
}

// -----------------------------------------------------------------------------
// Invoices list page
// -----------------------------------------------------------------------------

async function renderInvoicesPage(opts) {
  await mountShell(
    `<div class="loading-inline">Loading invoices…</div>`,
    opts.forceExceptionView
      ? '#/exceptions'
      : '#/invoices'
  );

  const filters = opts.status
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
      status: isExceptionView
        ? undefined
        : filters.status === 'all'
        ? undefined
        : filters.status,
    };

    const response =
      await API.listInvoices(params);

    const invoices =
      Array.isArray(response.invoices)
        ? response.invoices
        : [];

    const finalList = isExceptionView
      ? invoices.filter((invoice) =>
          [
            'exception',
            'duplicate',
          ].includes(invoice.status)
        )
      : invoices;

    document.querySelector('.content').innerHTML =
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
    console.error(
      '[app] Invoice list failed:',
      error
    );

    toast(
      error?.message ||
        'Unable to load invoices.',
      'error'
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
    .forEach((row) => {
      row.onclick = () => {
        location.hash =
          `#/invoices/${row.dataset.id}`;
      };
    });

  // ---------------------------------------------------------------------------
  // Search
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Status filters
  // ---------------------------------------------------------------------------

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
    exportAllBtn.onclick = () => {
      downloadAuthenticated(
        API.exportAllUrl(),
        'invoiceflow-export.xlsx'
      ).catch((error) => {
        toast(
          error?.message ||
            'Export failed.',
          'error'
        );
      });
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
        const ids = Array.from(
          document.querySelectorAll(
            '.row-check:checked'
          )
        ).map(
          (checkbox) =>
            checkbox.dataset.id
        );

        if (!ids.length) {
          toast(
            'Select at least one invoice first',
            'error'
          );
          return;
        }

        try {
          exportSelectedBtn.disabled =
            true;

          const response =
            await API.exportSelected(ids);

          // If the API wrapper returns a normal response,
          // handle it here.
          if (response instanceof Response) {
            const blob =
              await response.blob();

            const url =
              URL.createObjectURL(blob);

            const anchor =
              document.createElement('a');

            anchor.href = url;

            anchor.download =
              `invoiceflow-selected-${new Date()
                .toISOString()
                .slice(0, 10)}.xlsx`;

            document.body.appendChild(
              anchor
            );

            anchor.click();

            anchor.remove();

            URL.revokeObjectURL(url);
          }
        } catch (error) {
          console.error(
            '[app] Selected export failed:',
            error
          );

          toast(
            error?.message ||
              'Export failed.',
            'error'
          );
        } finally {
          exportSelectedBtn.disabled =
            false;
        }
      };
  }
}

// -----------------------------------------------------------------------------
// Suppliers page
// -----------------------------------------------------------------------------

async function renderSuppliersPage() {
  await mountShell(
    `<div class="loading-inline">Loading suppliers…</div>`,
    '#/suppliers'
  );

  try {
    const response =
      await API.listSuppliers();

    const suppliers =
      Array.isArray(response.suppliers)
        ? response.suppliers
        : [];

    document.querySelector('.content').innerHTML =
      renderSuppliers(suppliers);

    bindShellEvents();
  } catch (error) {
    console.error(
      '[app] Suppliers failed:',
      error
    );

    toast(
      error?.message ||
        'Unable to load suppliers.',
      'error'
    );
  }
}

// -----------------------------------------------------------------------------
// Reports page
// -----------------------------------------------------------------------------

async function renderReportsPage() {
  await mountShell(
    `<div class="loading-inline">Loading reports…</div>`,
    '#/reports'
  );

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
        supplierResponse.suppliers
      )
        ? supplierResponse.suppliers
        : [];

    document.querySelector('.content').innerHTML =
      renderReports(
        suppliers,
        summary
      );

    bindShellEvents();
  } catch (error) {
    console.error(
      '[app] Reports failed:',
      error
    );

    toast(
      error?.message ||
        'Unable to load reports.',
      'error'
    );
  }
}

// -----------------------------------------------------------------------------
// Settings page
// -----------------------------------------------------------------------------

async function renderSettingsPage() {
  await mountShell(
    renderSettings(
      AppState.user,
      AppState.health
    ),
    '#/settings'
  );
}
