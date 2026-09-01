// =============================================================================
// InvoiceFlow — Frontend Application
// =============================================================================
// Browser-side SPA router, state management and event wiring.
// =============================================================================

(() => {
  'use strict';

  // ===========================================================================
  // APP STATE
  // ===========================================================================

  const AppState = {
    user: null,

    health: null,

    setupRequired: false,

    setupChecked: false,

    invoiceFilters: {
      q: '',
      status: 'all',
    },

    selectedIds:
      new Set(),

    booting: false,

    sessionError: null,
  };

  const root =
    document.getElementById('app');

  if (!root) {
    console.error(
      '[InvoiceFlow] Fatal: #app element was not found in index.html.'
    );

    return;
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  function hasAPI() {
    return (
      typeof window.API !== 'undefined' &&
      window.API !== null
    );
  }

  function hasFunction(
    object,
    name
  ) {
    return (
      object &&
      typeof object[name] === 'function'
    );
  }

  // ===========================================================================
  // TOAST
  // ===========================================================================

  function toast(
    message,
    type = ''
  ) {
    const container =
      document.getElementById(
        'toast-root'
      );

    if (!container) {
      console[
        type === 'error'
          ? 'error'
          : 'log'
      ](
        '[InvoiceFlow]',
        message
      );

      return;
    }

    const el =
      document.createElement(
        'div'
      );

    el.className =
      `toast ${type}`;

    el.textContent =
      String(message || '');

    container.appendChild(
      el
    );

    setTimeout(
      () => {
        if (el.parentNode) {
          el.remove();
        }
      },
      3800
    );
  }

  // ===========================================================================
  // AUTH STATE
  // ===========================================================================

  function setLoggedIn(
    token,
    user
  ) {
    if (!token) {
      throw new Error(
        'Authentication token was not returned by the server.'
      );
    }

    if (
      !hasAPI() ||
      !hasFunction(
        API,
        'setToken'
      )
    ) {
      throw new Error(
        'Authentication system is not available.'
      );
    }

    API.setToken(
      token
    );

    AppState.user =
      user || null;

    AppState.sessionError =
      null;
  }

  function logout(
    showMessage = false
  ) {
    if (
      hasAPI() &&
      hasFunction(
        API,
        'clearToken'
      )
    ) {
      API.clearToken();
    }

    AppState.user =
      null;

    AppState.health =
      null;

    AppState.selectedIds.clear();

    AppState.sessionError =
      null;

    if (showMessage) {
      toast(
        'You have been signed out.',
        'success'
      );
    }

    if (
      location.hash !== '#/login'
    ) {
      location.hash =
        '#/login';
    } else {
      router();
    }
  }

  function handleSessionExpired(
    message =
      'Your session has expired. Please sign in again.'
  ) {
    if (
      hasAPI() &&
      hasFunction(
        API,
        'clearToken'
      )
    ) {
      API.clearToken();
    }

    AppState.user =
      null;

    AppState.health =
      null;

    AppState.selectedIds.clear();

    AppState.sessionError =
      message;

    if (
      location.hash !== '#/login'
    ) {
      location.hash =
        '#/login';
    } else {
      renderLoginPage(
        message
      );
    }
  }

  function isAuthError(
    error
  ) {
    return (
      error &&
      (
        error.status === 401 ||
        error.status === 403
      )
    );
  }

  function handleApiError(
    error,
    fallbackMessage =
      'Something went wrong.'
  ) {
    console.error(
      '[InvoiceFlow]',
      error
    );

    if (
      isAuthError(error)
    ) {
      handleSessionExpired(
        error.message ||
        'Your session has expired. Please sign in again.'
      );

      return true;
    }

    toast(
      error?.message ||
      fallbackMessage,
      'error'
    );

    return false;
  }

  // ===========================================================================
  // ROUTES
  // ===========================================================================

  const routes = {
    '#/login':
      renderLoginPage,

    '#/signup':
      renderSignupPage,

    '#/dashboard':
      renderDashboardPage,

    '#/capture':
      renderCapturePage,

    '#/invoices':
      () =>
        renderInvoicesPage({}),

    '#/exceptions':
      () =>
        renderInvoicesPage({
          status: 'exception',
          title: 'Exceptions',
          forceExceptionView: true,
        }),

    '#/suppliers':
      renderSuppliersPage,

    '#/approvals':
      renderApprovalsPage,

    '#/reports':
      renderReportsPage,

    '#/settings':
      renderSettingsPage,

    '#/stock':
      renderStockOverviewPage,

    '#/stock/products':
      () => renderProductsPage(),

    '#/stock/transactions':
      () => renderStockTransactionsPage(),

    '#/stock/adjustments':
      renderStockAdjustmentsPage,

    '#/stock/import':
      renderStockImportPage,

    '#/stock/review':
      renderStockReviewPage,

    '#/stock/signout':
      renderStockSignOutPage,

    '#/jobs':
      renderJobsPageView,

    '#/jobs/approvals':
      renderJobApprovalsPage,
  };

  let routerRunning =
    false;

  // ===========================================================================
  // SETUP STATUS
  // ===========================================================================

  async function checkSetupStatus() {
    if (
      !hasAPI() ||
      !hasFunction(
        API,
        'setupStatus'
      )
    ) {
      return;
    }

    try {
      const response =
        await API.setupStatus();

      AppState.setupRequired =
        response?.setup_required === true;

      AppState.setupChecked =
        true;

      console.log(
        '[InvoiceFlow] Setup status:',
        response
      );

    } catch (error) {
      console.warn(
        '[InvoiceFlow] Could not check setup status:',
        error
      );

      AppState.setupRequired =
        false;

      AppState.setupChecked =
        true;
    }
  }

  // ===========================================================================
  // ROUTER
  // ===========================================================================

 async function router() {
  if (routerRunning) {
    console.warn('[Router] Already running — skipping duplicate call.');
    return;
  }

  routerRunning = true;

  console.log('[Router] START');
  console.log('[Router] Current hash:', location.hash);
  console.log('[Router] API available:', hasAPI());

  try {

    // -----------------------------------------------------------------------
    // API CHECK
    // -----------------------------------------------------------------------

    if (!hasAPI()) {
      console.error('[Router] API module is not available.');

      root.innerHTML = `
        <div style="
          min-height:100vh;
          display:flex;
          align-items:center;
          justify-content:center;
          padding:24px;
          font-family:system-ui,sans-serif;
        ">
          <div style="
            max-width:520px;
            text-align:center;
          ">
            <h2>InvoiceFlow could not start</h2>
            <p>
              The frontend API module could not be loaded.
            </p>
          </div>
        </div>
      `;

      return;
    }

    console.log('[Router] API check passed.');

    // -----------------------------------------------------------------------
    // SETUP CHECK
    // -----------------------------------------------------------------------

    if (!AppState.setupChecked) {
      console.log('[Router] Checking setup status...');

      await checkSetupStatus();

      console.log(
        '[Router] Setup check complete:',
        {
          setupRequired: AppState.setupRequired,
          setupChecked: AppState.setupChecked
        }
      );
    }

    // -----------------------------------------------------------------------
    // HASH
    // -----------------------------------------------------------------------

    let hash = location.hash || '';

    console.log('[Router] Hash after setup check:', hash);

    if (!hash) {
      hash =
        AppState.setupRequired
          ? '#/signup'
          : '#/login';

      console.log(
        '[Router] No hash. Redirecting to:',
        hash
      );

      location.hash = hash;

      return;
    }

    // -----------------------------------------------------------------------
    // ROUTE MATCHES
    // -----------------------------------------------------------------------

    const invoiceMatch =
      hash.match(
        /^#\/invoices\/(.+)$/
      );

    const reviewMatch =
      hash.match(
        /^#\/review\/(.+)$/
      );

    const supplierMatch =
      hash.match(
        /^#\/suppliers\/(.+)$/
      );

    const productMatch =
      hash.match(
        /^#\/stock\/products\/(.+)$/
      );

    const stockTxMatch =
      hash.match(
        /^#\/stock\/transactions\/(.+)$/
      );

    const stockSheetMatch =
      hash.match(
        /^#\/stock\/signout\/(.+)$/
      );

    const jobMatch =
      hash.match(
        /^#\/jobs\/(.+)$/
      );

    // -----------------------------------------------------------------------
    // TOKEN
    // -----------------------------------------------------------------------

    const token =
      hasFunction(
        API,
        'token'
      )
        ? API.token()
        : null;

    console.log(
      '[Router] Authentication state:',
      {
        hasToken: !!token,
        setupRequired: AppState.setupRequired,
        userLoaded: !!AppState.user
      }
    );

    // -----------------------------------------------------------------------
    // FIRST BOOT
    // -----------------------------------------------------------------------

    if (
      AppState.setupRequired &&
      !token &&
      hash !== '#/signup'
    ) {
      console.log(
        '[Router] Setup required. Redirecting to signup.'
      );

      location.hash = '#/signup';

      return;
    }

    // -----------------------------------------------------------------------
    // NO SESSION
    // -----------------------------------------------------------------------

    if (
      !token &&
      hash !== '#/login' &&
      hash !== '#/signup'
    ) {
      const target =
        AppState.setupRequired
          ? '#/signup'
          : '#/login';

      console.log(
        '[Router] No session. Redirecting to:',
        target
      );

      location.hash = target;

      return;
    }

    // -----------------------------------------------------------------------
    // ALREADY AUTHENTICATED
    // -----------------------------------------------------------------------

    if (
      token &&
      (
        hash === '#/login' ||
        hash === '#/signup'
      )
    ) {
      console.log(
        '[Router] Already authenticated. Redirecting to dashboard.'
      );

      location.hash = '#/dashboard';

      return;
    }

    // -----------------------------------------------------------------------
    // LOAD USER
    // -----------------------------------------------------------------------

    if (
      token &&
      !AppState.user
    ) {
      console.log('[Router] Loading authenticated user...');

      try {

        if (
          !hasFunction(
            API,
            'me'
          )
        ) {
          throw new Error(
            'Authentication API is unavailable.'
          );
        }

        const response =
          await API.me();

        console.log(
          '[Router] API.me() response received.'
        );

        if (
          !response ||
          !response.user
        ) {
          throw new Error(
            'Authentication response did not contain a user.'
          );
        }

        AppState.user =
          response.user;

        AppState.sessionError =
          null;

        console.log(
          '[Router] User loaded:',
          AppState.user
        );

      } catch (error) {

        console.error(
          '[Router] Failed to load authenticated user:',
          error
        );

        if (
          isAuthError(error)
        ) {
          handleSessionExpired(
            'Your session is no longer valid. Please sign in again.'
          );
        } else {
          toast(
            error?.message ||
            'Unable to verify your session.',
            'error'
          );
        }

        return;
      }
    }

    // -----------------------------------------------------------------------
    // HEALTH
    // -----------------------------------------------------------------------

    if (
      token &&
      !AppState.health
    ) {
      console.log('[Router] Checking API health...');

      try {

        const response =
          await fetch(
            '/api/health',
            {
              headers: {
                Authorization:
                  `Bearer ${token}`,
              },
            }
          );

        if (response.ok) {
          AppState.health =
            await response.json();

          console.log(
            '[Router] Health check passed.'
          );
        } else {
          console.warn(
            '[Router] Health check returned:',
            response.status
          );
        }

      } catch (error) {

        console.warn(
          '[Router] Health check failed:',
          error
        );

      }
    }

    // -----------------------------------------------------------------------
    // FIND ROUTE
    // -----------------------------------------------------------------------

    let routeHandler =
      routes[hash];

    if (!routeHandler) {

      if (invoiceMatch) {

        routeHandler =
          () =>
            renderInvoiceDetailPage(
              invoiceMatch[1]
            );

      } else if (reviewMatch) {

        routeHandler =
          () =>
            renderInvoiceDetailPage(
              reviewMatch[1]
            );

      } else if (supplierMatch) {

        routeHandler =
          () =>
            renderSupplierDetailPage(
              supplierMatch[1]
            );

      } else if (productMatch) {

        routeHandler =
          () =>
            renderProductDetailPage(
              productMatch[1]
            );

      } else if (stockTxMatch) {

        routeHandler =
          () =>
            renderStockTransactionDetailPage(
              stockTxMatch[1]
            );

      } else if (stockSheetMatch) {

        routeHandler =
          () =>
            renderStockSheetPage(
              stockSheetMatch[1]
            );

      } else if (jobMatch) {

        routeHandler =
          () =>
            renderJobDetailPage(
              jobMatch[1]
            );
      }
    }

    console.log(
      '[Router] Route resolution:',
      {
        hash,
        routeFound: !!routeHandler
      }
    );

    // -----------------------------------------------------------------------
    // UNKNOWN ROUTE
    // -----------------------------------------------------------------------

    if (!routeHandler) {

      console.warn(
        '[Router] No route found. Redirecting to dashboard.'
      );

      location.hash =
        '#/dashboard';

      return;
    }

    // -----------------------------------------------------------------------
    // RENDER
    // -----------------------------------------------------------------------

    console.log(
      '[Router] Rendering route:',
      hash
    );

    await routeHandler();

    console.log(
      '[Router] Route rendered successfully:',
      hash
    );

  } catch (error) {

    console.error(
      '[Router] UNHANDLED ERROR:',
      error
    );

    try {

      handleApiError(
        error,
        'Unable to load this page.'
      );

    } catch (handlerError) {

      console.error(
        '[Router] Error inside handleApiError:',
        handlerError
      );

      if (root) {
        root.innerHTML = `
          <div style="
            min-height:100vh;
            display:flex;
            align-items:center;
            justify-content:center;
            padding:24px;
            font-family:system-ui,sans-serif;
          ">
            <div style="
              max-width:600px;
              text-align:center;
            ">
              <h2>InvoiceFlow could not load</h2>
              <p>
                An unexpected error prevented the application from loading.
              </p>

              <button
                onclick="location.reload()"
                style="
                  margin-top:16px;
                  padding:10px 18px;
                  border:0;
                  border-radius:8px;
                  background:#111827;
                  color:#fff;
                  font-weight:700;
                  cursor:pointer;
                "
              >
                Reload application
              </button>
            </div>
          </div>
        `;
      }
    }

  } finally {

    routerRunning = false;

    console.log(
      '[Router] FINISHED'
    );
  }
}
// ===========================================================================
// IMPORTANT: INVOICE ROW / BUTTON EVENTS
// ===========================================================================

function bindInvoiceListEvents(container) {

  if (!container) return;

  container
    .querySelectorAll('.invoice-view-btn')
    .forEach((button) => {

      button.addEventListener('click', (event) => {

        event.stopPropagation();

        const id =
          button.dataset.id;

        if (!id) return;

        renderInvoiceDetailPage(id);

      });

    });


  container
    .querySelectorAll('.invoice-row')
    .forEach((row) => {

      row.addEventListener('click', (event) => {

        if (
          event.target.closest('button')
        ) {
          return;
        }

        const id =
          row.dataset.id;

        if (!id) return;

        renderInvoiceDetailPage(id);

      });

    });


  container
    .querySelectorAll('.invoice-approve-btn')
    .forEach((button) => {

      button.addEventListener('click', async (event) => {

        event.stopPropagation();

        const id =
          button.dataset.id;

        if (!id) return;

        button.disabled = true;
        button.textContent = 'Approving...';

        try {

          const response =
            await fetch(
              `/api/invoices/${encodeURIComponent(id)}/approve`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                },
                credentials: 'include'
              }
            );

          const data =
            await response.json();

          if (!response.ok) {
            throw new Error(
              data.error ||
              'Unable to approve invoice'
            );
          }

          if (
            typeof loadInvoices === 'function'
          ) {
            await loadInvoices();
          }

        } catch (error) {

          console.error(
            '[invoice approve]',
            error
          );

          alert(
            error.message ||
            'Unable to approve invoice'
          );

          button.disabled = false;
          button.textContent = 'Approve';

        }

      });

    });


  container
    .querySelectorAll('.invoice-reject-btn')
    .forEach((button) => {

      button.addEventListener('click', async (event) => {

        event.stopPropagation();

        const id =
          button.dataset.id;

        if (!id) return;

        const reason =
          window.prompt(
            'Reason for rejecting this invoice:'
          );

        if (
          reason === null
        ) {
          return;
        }

        button.disabled = true;
        button.textContent = 'Rejecting...';

        try {

          const response =
            await fetch(
              `/api/invoices/${encodeURIComponent(id)}/reject`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify({
                  reason
                })
              }
            );

          const data =
            await response.json();

          if (!response.ok) {
            throw new Error(
              data.error ||
              'Unable to reject invoice'
            );
          }

          if (
            typeof loadInvoices === 'function'
          ) {
            await loadInvoices();
          }

        } catch (error) {

          console.error(
            '[invoice reject]',
            error
          );

          alert(
            error.message ||
            'Unable to reject invoice'
          );

          button.disabled = false;
          button.textContent = 'Reject';

        }

      });

    });


  container
    .querySelectorAll('.invoice-retry-btn')
    .forEach((button) => {

      button.addEventListener('click', async (event) => {

        event.stopPropagation();

        const id =
          button.dataset.id;

        if (!id) return;

        const input =
          document.createElement('input');

        input.type = 'file';

        input.accept =
          'image/jpeg,image/png,image/webp,application/pdf';

        input.style.display = 'none';

        document.body.appendChild(input);

        input.addEventListener(
          'change',
          async () => {

            const file =
              input.files?.[0];

            if (!file) {

              input.remove();

              return;
            }

            button.disabled = true;
            button.textContent = 'Retrying...';

            try {

              const formData =
                new FormData();

              formData.append(
                'file',
                file
              );

              const response =
                await fetch(
                  `/api/invoices/${encodeURIComponent(id)}/retry`,
                  {
                    method: 'POST',
                    credentials: 'include',
                    body: formData
                  }
                );

              const data =
                await response.json();

              if (!response.ok) {
                throw new Error(
                  data.error ||
                  'Retry failed'
                );
              }

              if (
                typeof loadInvoices === 'function'
              ) {
                await loadInvoices();
              }

            } catch (error) {

              console.error(
                '[invoice retry]',
                error
              );

              alert(
                error.message ||
                'Retry failed'
              );

              button.disabled = false;
              button.textContent = 'Retry';

            } finally {

              input.remove();

            }

          }
        );

        input.click();

      });

    });


  container
    .querySelectorAll('.invoice-delete-btn')
    .forEach((button) => {

      button.addEventListener('click', async (event) => {

        event.stopPropagation();

        const id =
          button.dataset.id;

        if (!id) return;

        const confirmed =
          window.confirm(
            'Delete this invoice? This action cannot be undone.'
          );

        if (!confirmed) {
          return;
        }

        button.disabled = true;
        button.textContent = 'Deleting...';

        try {

          const response =
            await fetch(
              `/api/invoices/${encodeURIComponent(id)}`,
              {
                method: 'DELETE',
                credentials: 'include'
              }
            );

          const data =
            await response.json();

          if (!response.ok) {
            throw new Error(
              data.error ||
              'Unable to delete invoice'
            );
          }

          if (
            typeof loadInvoices === 'function'
          ) {
            await loadInvoices();
          }

        } catch (error) {

          console.error(
            '[invoice delete]',
            error
          );

          alert(
            error.message ||
            'Unable to delete invoice'
          );

          button.disabled = false;
          button.textContent = 'Delete';

        }

      });

    });


  const uploadButton =
    container.querySelector(
      '#btn-upload-invoice'
    );

  if (uploadButton) {

    uploadButton.addEventListener(
      'click',
      () => {

        if (
          typeof openInvoiceUpload === 'function'
        ) {
          openInvoiceUpload();
          return;
        }

        const input =
          document.createElement('input');

        input.type = 'file';

        input.accept =
          'image/jpeg,image/png,image/webp,application/pdf';

        input.style.display = 'none';

        document.body.appendChild(input);

        input.addEventListener(
          'change',
          async () => {

            const file =
              input.files?.[0];

            if (!file) {
              input.remove();
              return;
            }

            try {

              const formData =
                new FormData();

              formData.append(
                'file',
                file
              );

              const response =
                await fetch(
                  '/api/invoices/capture',
                  {
                    method: 'POST',
                    credentials: 'include',
                    body: formData
                  }
                );

              const data =
                await response.json();

              if (!response.ok) {
                throw new Error(
                  data.error ||
                  'Invoice upload failed'
                );
              }

              if (
                typeof loadInvoices === 'function'
              ) {
                await loadInvoices();
              }

            } catch (error) {

              console.error(
                '[invoice upload]',
                error
              );

              alert(
                error.message ||
                'Invoice upload failed'
              );

            } finally {

              input.remove();

            }

          }
        );

        input.click();

      }
    );

  }

}




  // ===========================================================================
  // SHELL
  // ===========================================================================

  async function mountShell(
    contentHtml,
    activeRoute
  ) {
    let exceptionsCount =
      0;

    let approvalsCount =
      0;

    let stockReviewCount =
      0;

    let stockSheetCount =
      0;

    try {
      if (
        !hasFunction(
          API,
          'listInvoices'
        )
      ) {
        throw new Error(
          'Invoice API is unavailable.'
        );
      }

      // Exceptions and duplicates both land in the exceptions queue, and
      // review_required is what the approvals queue is counting.
      const [
        exceptionResponse,
        duplicateResponse,
        approvalResponse,
        stockReviewResponse,
        stockSheetResponse,
      ] = await Promise.all([
        API.listInvoices({ status: 'exception' }),
        API.listInvoices({ status: 'duplicate' }),
        API.listInvoices({ status: 'review_required' }),
        // The stock module may not be reachable on an older backend, so its
        // count must never stop the shell from rendering.
        hasFunction(API, 'listStockReview')
          ? API.listStockReview('pending').catch(() => ({ items: [] }))
          : Promise.resolve({ items: [] }),
        hasFunction(API, 'stockSheetMetrics')
          ? API.stockSheetMetrics().catch(() => ({ totals: {} }))
          : Promise.resolve({ totals: {} }),
      ]);

      // Sheets waiting on a person are the ones worth a badge; a failed
      // document is equally stuck, so it counts too.
      stockSheetCount =
        Number(stockSheetResponse?.totals?.review || 0) +
        Number(stockSheetResponse?.totals?.failed || 0);

      stockReviewCount =
        Array.isArray(stockReviewResponse?.items)
          ? stockReviewResponse.items.length
          : 0;

      exceptionsCount =
        (
          Array.isArray(exceptionResponse?.invoices)
            ? exceptionResponse.invoices.length
            : 0
        ) +
        (
          Array.isArray(duplicateResponse?.invoices)
            ? duplicateResponse.invoices.length
            : 0
        );

      approvalsCount =
        Array.isArray(approvalResponse?.invoices)
          ? approvalResponse.invoices.length
          : 0;

    } catch (error) {
      if (
        isAuthError(error)
      ) {
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
      location.hash =
        AppState.setupRequired
          ? '#/signup'
          : '#/login';

      return false;
    }

    if (
      typeof window.renderShell !==
      'function'
    ) {
      console.error(
        '[InvoiceFlow] renderShell() is missing.'
      );

      root.innerHTML = `
        <div class="loading-inline">
          InvoiceFlow interface failed to load.
        </div>
      `;

      return false;
    }

    // Views decide what to offer (delete, approve) from the signed-in user.
    if (typeof window.setViewUser === 'function') {
      setViewUser(AppState.user);
    }

    AppState.navCounts = {
      exceptions: exceptionsCount,
      approvals: approvalsCount,
      stockReview: stockReviewCount,
      stockSheets: stockSheetCount,
    };

    root.innerHTML =
      renderShell(
        activeRoute,
        AppState.user,
        exceptionsCount,
        contentHtml,
        {
          approvals: approvalsCount,
          stockReview: stockReviewCount,
          stockSheets: stockSheetCount,
        }
      );

    applyTheme(currentTheme());

    bindShellEvents();

    return true;
  }

  // ===========================================================================
  // THEME
  //
  // Light and dark are both first-class; the choice is remembered per device.
  // ===========================================================================

  const THEME_KEY = 'invoiceflow.theme';

  function currentTheme() {
    try {
      const stored =
        localStorage.getItem(THEME_KEY);

      if (stored === 'light' || stored === 'dark') {
        return stored;
      }
    } catch (error) {
      // Storage can be unavailable (private mode); fall through to the default.
    }

    return window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute(
      'data-theme',
      theme
    );

    const toggle =
      document.getElementById('theme-toggle');

    if (toggle && typeof Icons !== 'undefined') {
      toggle.innerHTML =
        theme === 'dark'
          ? Icons.sun
          : Icons.moon;
    }
  }

  function toggleTheme() {
    const next =
      currentTheme() === 'dark'
        ? 'light'
        : 'dark';

    try {
      localStorage.setItem(THEME_KEY, next);
    } catch (error) {
      // Not being able to persist the choice should not block applying it.
    }

    applyTheme(next);
  }

  function bindShellEvents() {
    root
      .querySelectorAll(
        '[data-route]'
      )
      .forEach(
        (el) => {
          el.addEventListener(
            'click',
            () => {
              const route =
                el.getAttribute(
                  'data-route'
                );

              if (route) {
                location.hash =
                  route;
              }
            }
          );
        }
      );

    const logoutBtn =
      document.getElementById(
        'logout-btn'
      );

    if (logoutBtn) {
      logoutBtn.onclick =
        () => {
          logout(true);
        };
    }

    const themeToggle =
      document.getElementById(
        'theme-toggle'
      );

    if (themeToggle) {
      themeToggle.onclick =
        () => toggleTheme();
    }

    const searchTrigger =
      document.getElementById(
        'search-trigger'
      );

    if (searchTrigger) {
      searchTrigger.onclick =
        () => openPalette();
    }

    const settingsThemeToggle =
      document.getElementById(
        'settings-theme-toggle'
      );

    if (settingsThemeToggle) {
      settingsThemeToggle.onclick =
        () => toggleTheme();
    }

    const mobileNavBtn =
      document.getElementById(
        'mobile-nav-btn'
      );

    if (mobileNavBtn) {
      mobileNavBtn.onclick =
        () => openMobileNav();
    }
  }

  // ===========================================================================
  // EXPORT
  // ===========================================================================

  function exportFilename(prefix) {
    return `invoiceflow-${prefix}-${new Date()
      .toISOString()
      .slice(0, 10)}.xlsx`;
  }

  async function exportAllInvoices(button) {
    if (button) button.disabled = true;

    try {

      await downloadAuthenticated(
        API.exportAllUrl(),
        exportFilename('export')
      );

      toast('Export downloaded', 'success');

    } catch (error) {

      handleApiError(error, 'Export failed.');

    } finally {

      if (button) button.disabled = false;
    }
  }

  async function exportSelectedInvoices(ids, button) {
    if (!ids.length) {
      toast('Select at least one invoice first.', 'error');
      return;
    }

    if (button) button.disabled = true;

    try {

      const response =
        await API.exportSelected(ids);

      if (response instanceof Response) {

        if (!response.ok) {
          throw new Error('Export failed.');
        }

        triggerDownload(
          await response.blob(),
          exportFilename('selected')
        );

      } else if (response?.url) {

        await downloadAuthenticated(
          response.url,
          exportFilename('selected')
        );

      } else {

        throw new Error('The export response was invalid.');
      }

      toast('Selected invoices exported', 'success');

    } catch (error) {

      handleApiError(
        error,
        'Selected invoice export failed.'
      );

    } finally {

      if (button) button.disabled = false;
    }
  }

  // ===========================================================================
  // COMMAND PALETTE
  //
  // Ctrl/Cmd+K searches invoices and jumps to any screen. Invoice results come
  // from the same search endpoint the invoices table uses.
  // ===========================================================================

  const PALETTE_ACTIONS = [
    { title: 'Go to Overview',    route: '#/dashboard',  icon: 'overview' },
    { title: 'Go to Invoices',    route: '#/invoices',   icon: 'invoices' },
    { title: 'Go to Exceptions',  route: '#/exceptions', icon: 'exceptions' },
    { title: 'Go to Approvals',   route: '#/approvals',  icon: 'approvals' },
    { title: 'Go to Suppliers',   route: '#/suppliers',  icon: 'suppliers' },
    { title: 'Go to Reports',     route: '#/reports',    icon: 'reports' },
    { title: 'Go to Settings',    route: '#/settings',   icon: 'settings' },
    { title: 'Upload invoice',    route: '#/capture',    icon: 'upload' },
    { title: 'Go to Stock Overview',  route: '#/stock',              icon: 'stock' },
    { title: 'Go to Products',        route: '#/stock/products',     icon: 'products' },
    { title: 'Go to Stock Transactions', route: '#/stock/transactions', icon: 'ledger' },
    { title: 'Adjust stock',          route: '#/stock/adjustments',  icon: 'adjust' },
    { title: 'Import stock',          route: '#/stock/import',       icon: 'importFile' },
    { title: 'Go to Stock Review',    route: '#/stock/review',       icon: 'review' },
    { title: 'Go to Stock Sign-Out',  route: '#/stock/signout',      icon: 'signoutSheet' },
    { title: 'Upload a sign-out sheet', route: '#/stock/signout',    icon: 'upload' },
    { title: 'Export invoices to Excel', action: 'export', icon: 'download' },
    { title: 'Toggle theme',      action: 'theme',       icon: 'moon' },
  ];

  const Palette = {
    open: false,
    query: '',
    results: [],
    activeIndex: 0,
    searchToken: 0,
  };

  function paletteActions(query) {
    const q = query.trim().toLowerCase();

    return PALETTE_ACTIONS
      .filter(
        (action) =>
          !q ||
          action.title.toLowerCase().includes(q)
      )
      .map(
        (action) => ({
          ...action,
          type: 'action',
        })
      );
  }

  function paintPalette() {
    const existing =
      document.getElementById('palette-backdrop');

    const html =
      renderPalette(
        Palette.query,
        Palette.results,
        Palette.activeIndex
      );

    if (existing) {
      // Re-render only the results so the input keeps focus and caret.
      const host =
        document.createElement('div');

      host.innerHTML = html;

      existing.querySelector('#palette-results').innerHTML =
        host.querySelector('#palette-results').innerHTML;

      bindPaletteResults();

      return;
    }

    const host =
      document.createElement('div');

    host.innerHTML = html;

    document.body.appendChild(host.firstElementChild);

    const input =
      document.getElementById('palette-input');

    input.focus();

    input.addEventListener('input', () => {
      Palette.query = input.value;
      Palette.activeIndex = 0;

      refreshPaletteResults();
    });

    document
      .getElementById('palette-backdrop')
      .addEventListener('click', (event) => {
        if (event.target.id === 'palette-backdrop') {
          closePalette();
        }
      });

    bindPaletteResults();
  }

  function bindPaletteResults() {
    document
      .querySelectorAll('.palette-item')
      .forEach((item) => {
        item.onclick =
          () =>
            runPaletteItem(
              Palette.results[Number(item.dataset.index)]
            );
      });
  }

  async function refreshPaletteResults() {
    const query = Palette.query;

    // Actions resolve instantly; invoices need a round trip.
    Palette.results = paletteActions(query);

    paintPalette();

    if (query.trim().length < 2) {
      return;
    }

    const token = ++Palette.searchToken;

    try {

      const response =
        await API.listInvoices({ q: query.trim() });

      // A slower earlier request must not overwrite a newer result set.
      if (token !== Palette.searchToken || !Palette.open) {
        return;
      }

      const invoices =
        (Array.isArray(response?.invoices) ? response.invoices : [])
          .slice(0, 6)
          .map(
            (invoice) => ({
              type: 'invoice',
              icon: 'invoices',
              id: invoice.id,
              title:
                invoice.invoice_number || 'Unnumbered invoice',
              subtitle:
                [
                  invoice.supplier_name,
                  invoice.account_code
                ]
                  .filter(Boolean)
                  .join(' · '),
              amount:
                fmtMoney(
                  invoice.total_amount,
                  invoice.currency
                ),
            })
          );

      Palette.results =
        invoices.concat(paletteActions(query));

      Palette.activeIndex =
        Math.min(
          Palette.activeIndex,
          Math.max(0, Palette.results.length - 1)
        );

      paintPalette();

    } catch (error) {
      console.warn(
        '[Palette] Invoice search failed:',
        error
      );
    }
  }

  function runPaletteItem(item) {
    if (!item) return;

    closePalette();

    if (item.type === 'invoice') {
      location.hash = `#/invoices/${item.id}`;
      return;
    }

    if (item.action === 'theme') {
      toggleTheme();
      return;
    }

    if (item.action === 'export') {
      exportAllInvoices();
      return;
    }

    if (item.route) {
      location.hash = item.route;
    }
  }

  function openPalette() {
    if (Palette.open) return;

    Palette.open = true;
    Palette.query = '';
    Palette.activeIndex = 0;
    Palette.results = paletteActions('');

    paintPalette();
  }

  function closePalette() {
    Palette.open = false;
    Palette.searchToken += 1;

    const backdrop =
      document.getElementById('palette-backdrop');

    if (backdrop) {
      backdrop.remove();
    }
  }

  document.addEventListener('keydown', (event) => {
    const key =
      (event.key || '').toLowerCase();

    if (key === 'k' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();

      if (!AppState.user) return;

      if (Palette.open) {
        closePalette();
      } else {
        openPalette();
      }

      return;
    }

    if (!Palette.open) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      closePalette();
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();

      if (!Palette.results.length) return;

      Palette.activeIndex =
        (
          Palette.activeIndex +
          (event.key === 'ArrowDown' ? 1 : -1) +
          Palette.results.length
        ) % Palette.results.length;

      paintPalette();

      const active =
        document.querySelector('.palette-item.active');

      if (active && active.scrollIntoView) {
        active.scrollIntoView({ block: 'nearest' });
      }

      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();

      runPaletteItem(
        Palette.results[Palette.activeIndex]
      );
    }
  });

  // ===========================================================================
  // CONFIRM DIALOG
  //
  // Resolves true/false rather than taking callbacks, so destructive flows read
  // top to bottom.
  // ===========================================================================

  function confirmDialog(options) {
    return new Promise((resolve) => {

      const host =
        document.createElement('div');

      host.innerHTML =
        renderConfirm(options);

      const backdrop =
        host.firstElementChild;

      document.body.appendChild(backdrop);

      const finish = (result) => {
        document.removeEventListener('keydown', onKey);
        backdrop.remove();
        resolve(result);
      };

      const onKey = (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          finish(false);
        }
      };

      document.addEventListener('keydown', onKey);

      backdrop.addEventListener('click', (event) => {
        if (event.target === backdrop) {
          finish(false);
        }
      });

      backdrop
        .querySelector('#confirm-cancel')
        .addEventListener('click', () => finish(false));

      const okButton =
        backdrop.querySelector('#confirm-ok');

      okButton.addEventListener('click', () => finish(true));

      okButton.focus();

    });
  }

  // ===========================================================================
  // DELETE
  // ===========================================================================

  /**
   * Confirms and deletes one invoice.
   * @returns {Promise<boolean>} whether the invoice was deleted
   */
  async function deleteInvoice(id, label) {
    if (!id) return false;

    const confirmed =
      await confirmDialog({
        title: 'Delete invoice',
        body:
          `${label || 'This invoice'} and its document, extracted fields ` +
          'and processing history will be permanently deleted. This cannot ' +
          'be undone.',
        confirmLabel: 'Delete',
        danger: true,
      });

    if (!confirmed) return false;

    try {

      await API.deleteInvoice(id);

      toast('Invoice deleted', 'success');

      return true;

    } catch (error) {

      handleApiError(
        error,
        'Unable to delete invoice.'
      );

      return false;
    }
  }

  /**
   * Confirms and deletes a multi-select in a single request.
   * @returns {Promise<boolean>} whether anything was deleted
   */
  async function deleteInvoices(ids) {
    if (!ids || !ids.length) return false;

    const confirmed =
      await confirmDialog({
        title:
          `Delete ${ids.length} invoice${ids.length === 1 ? '' : 's'}`,
        body:
          `${ids.length} invoice${ids.length === 1 ? '' : 's'}, along with ` +
          'their documents, extracted fields and processing history, will be ' +
          'permanently deleted. This cannot be undone.',
        confirmLabel: `Delete ${ids.length}`,
        danger: true,
      });

    if (!confirmed) return false;

    try {

      const response =
        await API.deleteInvoices(ids);

      const deleted =
        Number(response?.deleted_count ?? ids.length);

      const failed =
        Array.isArray(response?.failed)
          ? response.failed.length
          : 0;

      if (failed) {
        toast(
          `${deleted} deleted, ${failed} could not be deleted.`,
          'error'
        );
      } else {
        toast(
          `${deleted} invoice${deleted === 1 ? '' : 's'} deleted`,
          'success'
        );
      }

      return deleted > 0;

    } catch (error) {

      handleApiError(
        error,
        'Unable to delete the selected invoices.'
      );

      return false;
    }
  }

  /**
   * Wires every [data-delete] button inside a container.
   * @param {Element} container
   * @param {Function} onDeleted - called after a successful delete
   */
  function bindDeleteButtons(container, onDeleted) {
    if (!container) return;

    container
      .querySelectorAll('[data-delete]')
      .forEach((button) => {

        button.onclick =
          async (event) => {
            // These sit inside clickable rows.
            event.stopPropagation();
            event.preventDefault();

            button.disabled = true;

            const deleted =
              await deleteInvoice(
                button.dataset.delete,
                button.dataset.label
              );

            button.disabled = false;

            if (deleted && typeof onDeleted === 'function') {
              await onDeleted();
            }
          };
      });
  }

  // ===========================================================================
  // MOBILE NAV
  // ===========================================================================

  function openMobileNav() {
    const existing =
      document.querySelector(
        '.mobile-nav-backdrop'
      );

    if (existing) {
      existing.remove();
    }

    const backdrop =
      document.createElement(
        'div'
      );

    backdrop.className =
      'mobile-nav-backdrop';

    const counts =
      AppState.navCounts ||
      { exceptions: 0, approvals: 0 };

    // The mobile drawer mirrors the sidebar rather than keeping its own list,
    // so the two can never drift apart.
    backdrop.innerHTML = `
      <div class="mobile-nav-panel">

        <div
          style="
            display:flex;
            align-items:flex-start;
            justify-content:space-between;
            padding:20px 20px 16px;
          "
        >
          <div>
            <div
              style="
                font-size:13.5px;
                font-weight:700;
                letter-spacing:.14em;
                text-transform:uppercase;
              "
            >InvoiceFlow</div>
            <div
              style="font-size:11px;color:var(--ink-faint);margin-top:2px;"
            >Finance Intelligence</div>
          </div>

          <button class="icon-btn" id="close-mobile-nav" type="button">
            ${Icons.x}
          </button>
        </div>

        <div class="sidebar-rule"></div>

        <nav class="sidebar-nav">
          ${navMarkup(
            location.hash || '#/dashboard',
            counts
          )}
        </nav>

        <div class="sidebar-foot">
          <button
            class="btn btn-secondary btn-block"
            id="mobile-logout-btn"
            type="button"
          >Sign out</button>
        </div>

      </div>
    `;

    document.body.appendChild(
      backdrop
    );

    backdrop.addEventListener(
      'click',
      (event) => {
        if (
          event.target === backdrop
        ) {
          backdrop.remove();
        }
      }
    );

    const closeBtn =
      backdrop.querySelector(
        '#close-mobile-nav'
      );

    if (closeBtn) {
      closeBtn.onclick =
        () => backdrop.remove();
    }

    const mobileLogoutBtn =
      backdrop.querySelector(
        '#mobile-logout-btn'
      );

    if (mobileLogoutBtn) {
      mobileLogoutBtn.onclick =
        () => {
          backdrop.remove();
          logout(true);
        };
    }

    backdrop
      .querySelectorAll(
        '[data-route]'
      )
      .forEach(
        (el) => {
          el.addEventListener(
            'click',
            () => {
              const route =
                el.getAttribute(
                  'data-route'
                );

              if (route) {
                location.hash =
                  route;
              }

              backdrop.remove();
            }
          );
        }
      );
  }

  // ===========================================================================
  // LOGIN
  // ===========================================================================

  function renderLoginPage(
    error
  ) {
    if (
      typeof window.renderLogin !==
      'function'
    ) {
      root.innerHTML = `
        <div style="
          min-height:100vh;
          display:flex;
          align-items:center;
          justify-content:center;
        ">
          <p>Login interface failed to load.</p>
        </div>
      `;

      return;
    }

    root.innerHTML =
      renderLogin(
        error ||
        AppState.sessionError ||
        null
      );

    const signupLinks =
      root.querySelectorAll(
        '[data-route="#/signup"], #signup-link'
      );

    signupLinks.forEach(
      (el) => {
        el.onclick =
          (event) => {
            event.preventDefault();

            location.hash =
              '#/signup';
          };
      }
    );

    const loginForm =
      document.getElementById(
        'login-form'
      );

    if (!loginForm) {
      return;
    }

    loginForm.onsubmit =
      async (event) => {
        event.preventDefault();

        const submitBtn =
          loginForm.querySelector(
            'button[type="submit"]'
          );

        const form =
          new FormData(
            loginForm
          );

        const email =
          String(
            form.get('email') ||
            ''
          ).trim();

        const password =
          String(
            form.get('password') ||
            ''
          );

        if (!email) {
          renderLoginPage(
            'Please enter your email address.'
          );

          return;
        }

        if (!password) {
          renderLoginPage(
            'Please enter your password.'
          );

          return;
        }

        if (submitBtn) {
          submitBtn.disabled =
            true;

          submitBtn.textContent =
            'Signing in…';
        }

        try {
          const response =
            await API.login(
              email,
              password
            );

          setLoggedIn(
            response.token,
            response.user
          );

          AppState.setupRequired =
            false;

          toast(
            'Welcome back.',
            'success'
          );

          location.hash =
            '#/dashboard';

        } catch (error) {
          console.error(
            '[Login] Login failed:',
            error
          );

          if (submitBtn) {
            submitBtn.disabled =
              false;

            submitBtn.textContent =
              'Sign in';
          }

          renderLoginPage(
            error?.message ||
            'Unable to sign in.'
          );
        }
      };
  }

  // ===========================================================================
  // SIGNUP
  // ===========================================================================

  function renderSignupPage(
    error
  ) {
    if (
      typeof window.renderSignup ===
      'function'
    ) {
      root.innerHTML =
        renderSignup(
          error || null
        );
    } else {
      root.innerHTML = `
        <div style="
          min-height:100vh;
          display:flex;
          align-items:center;
          justify-content:center;
          padding:24px;
          background:#f5f7fa;
          font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
        ">
          <div style="
            width:100%;
            max-width:480px;
            background:#fff;
            border-radius:18px;
            padding:36px;
            box-shadow:0 18px 60px rgba(0,0,0,.10);
          ">
            <div style="
              margin-bottom:28px;
            ">
              <div style="
                font-size:13px;
                font-weight:800;
                letter-spacing:.12em;
                text-transform:uppercase;
                opacity:.55;
                margin-bottom:8px;
              ">
                InvoiceFlow
              </div>

              <h1 style="
                margin:0 0 8px;
                font-size:30px;
              ">
                Create your account
              </h1>

              <p style="
                margin:0;
                color:#667085;
              ">
                Set up your administrator account to get started.
              </p>
            </div>

            ${
              error
                ? `
                  <div
                    class="auth-error"
                    style="
                      margin-bottom:18px;
                      padding:12px 14px;
                      border-radius:10px;
                    "
                  >
                    ${escapeHtml(error)}
                  </div>
                `
                : ''
            }

            <form id="signup-form">

              <div style="margin-bottom:16px;">
                <label
                  for="signup-name"
                  style="
                    display:block;
                    font-weight:600;
                    margin-bottom:7px;
                  "
                >
                  Full name
                </label>

                <input
                  id="signup-name"
                  name="name"
                  type="text"
                  autocomplete="name"
                  required
                  placeholder="Your full name"
                  style="
                    width:100%;
                    box-sizing:border-box;
                    padding:12px 14px;
                    border:1px solid #d0d5dd;
                    border-radius:10px;
                    font:inherit;
                  "
                />
              </div>

              <div style="margin-bottom:16px;">
                <label
                  for="signup-email"
                  style="
                    display:block;
                    font-weight:600;
                    margin-bottom:7px;
                  "
                >
                  Email address
                </label>

                <input
                  id="signup-email"
                  name="email"
                  type="email"
                  autocomplete="email"
                  required
                  placeholder="you@company.com"
                  style="
                    width:100%;
                    box-sizing:border-box;
                    padding:12px 14px;
                    border:1px solid #d0d5dd;
                    border-radius:10px;
                    font:inherit;
                  "
                />
              </div>

              <div style="margin-bottom:16px;">
                <label
                  for="signup-company"
                  style="
                    display:block;
                    font-weight:600;
                    margin-bottom:7px;
                  "
                >
                  Company name
                </label>

                <input
                  id="signup-company"
                  name="company_name"
                  type="text"
                  autocomplete="organization"
                  required
                  placeholder="Your company"
                  style="
                    width:100%;
                    box-sizing:border-box;
                    padding:12px 14px;
                    border:1px solid #d0d5dd;
                    border-radius:10px;
                    font:inherit;
                  "
                />
              </div>

              <div style="margin-bottom:16px;">
                <label
                  for="signup-password"
                  style="
                    display:block;
                    font-weight:600;
                    margin-bottom:7px;
                  "
                >
                  Password
                </label>

                <input
                  id="signup-password"
                  name="password"
                  type="password"
                  autocomplete="new-password"
                  required
                  minlength="8"
                  placeholder="At least 8 characters"
                  style="
                    width:100%;
                    box-sizing:border-box;
                    padding:12px 14px;
                    border:1px solid #d0d5dd;
                    border-radius:10px;
                    font:inherit;
                  "
                />
              </div>

              <div style="margin-bottom:22px;">
                <label
                  for="signup-confirm-password"
                  style="
                    display:block;
                    font-weight:600;
                    margin-bottom:7px;
                  "
                >
                  Confirm password
                </label>

                <input
                  id="signup-confirm-password"
                  name="confirm_password"
                  type="password"
                  autocomplete="new-password"
                  required
                  minlength="8"
                  placeholder="Enter the password again"
                  style="
                    width:100%;
                    box-sizing:border-box;
                    padding:12px 14px;
                    border:1px solid #d0d5dd;
                    border-radius:10px;
                    font:inherit;
                  "
                />
              </div>

              <button
                type="submit"
                style="
                  width:100%;
                  border:0;
                  border-radius:10px;
                  padding:13px 16px;
                  background:#111827;
                  color:#fff;
                  font:inherit;
                  font-weight:700;
                  cursor:pointer;
                "
              >
                Create account
              </button>

              <div style="
                text-align:center;
                margin-top:18px;
                color:#667085;
                font-size:14px;
              ">
                Already have an account?

                <a
                  href="#/login"
                  id="login-link"
                  style="
                    font-weight:700;
                    color:inherit;
                  "
                >
                  Sign in
                </a>
              </div>

            </form>
          </div>
        </div>
      `;
    }

    const loginLink =
      root.querySelector(
        '#login-link'
      );

    if (loginLink) {
      loginLink.onclick =
        (event) => {
          event.preventDefault();

          location.hash =
            '#/login';
        };
    }

    const signupForm =
      document.getElementById(
        'signup-form'
      );

    if (!signupForm) {
      console.error(
        '[Signup] signup-form was not found.'
      );

      return;
    }

    signupForm.onsubmit =
      handleSignupSubmit;
  }

  async function handleSignupSubmit(
    event
  ) {
    event.preventDefault();

    const form =
      event.currentTarget;

    const formData =
      new FormData(form);

    const name =
      String(
        formData.get('name') ||
        ''
      ).trim();

    const email =
      String(
        formData.get('email') ||
        ''
      ).trim()
      .toLowerCase();

    const password =
      String(
        formData.get('password') ||
        ''
      );

    const confirmPassword =
      String(
        formData.get(
          'confirm_password'
        ) ||
        ''
      );

    const companyName =
      String(
        formData.get(
          'company_name'
        ) ||
        ''
      ).trim();

    console.log(
      '[Signup] Creating first administrator account:',
      {
        name,
        email,
        companyName,
        passwordProvided:
          password.length > 0
      }
    );

    if (!name) {
      renderSignupPage(
        'Please enter your name.'
      );

      return;
    }

    if (!email) {
      renderSignupPage(
        'Please enter your email address.'
      );

      return;
    }

    if (!companyName) {
      renderSignupPage(
        'Please enter your company name.'
      );

      return;
    }

    if (!password) {
      renderSignupPage(
        'Please enter a password.'
      );

      return;
    }

    if (password.length < 8) {
      renderSignupPage(
        'Password must be at least 8 characters.'
      );

      return;
    }

    if (
      password !==
      confirmPassword
    ) {
      renderSignupPage(
        'The passwords do not match.'
      );

      return;
    }

    const submitBtn =
      form.querySelector(
        'button[type="submit"]'
      );

    if (submitBtn) {
      submitBtn.disabled =
        true;

      submitBtn.textContent =
        'Creating account…';
    }

    try {
      const response =
        await API.register(
          name,
          email,
          password,
          companyName
        );

      if (
        !response ||
        !response.token
      ) {
        throw new Error(
          'Account was created but no authentication token was returned.'
        );
      }

      if (
        !response.user
      ) {
        throw new Error(
          'Account was created but no user profile was returned.'
        );
      }

      setLoggedIn(
        response.token,
        response.user
      );

      AppState.setupRequired =
        false;

      AppState.setupChecked =
        true;

      AppState.sessionError =
        null;

      console.log(
        '[Signup] Administrator account created successfully:',
        {
          id:
            response.user.id,

          email:
            response.user.email,

          company_name:
            response.user.company_name
        }
      );

      toast(
        'Account created successfully.',
        'success'
      );

      location.hash =
        '#/dashboard';

    } catch (error) {
      console.error(
        '[Signup] Registration failed:',
        error
      );

      if (submitBtn) {
        submitBtn.disabled =
          false;

        submitBtn.textContent =
          'Create account';
      }

      renderSignupPage(
        error?.message ||
        'Unable to create account.'
      );
    }
  }

  // ===========================================================================
  // DASHBOARD
  // ===========================================================================

  async function renderDashboardPage() {
    const mounted =
      await mountShell(
        `
          <div class="loading-inline">
            Loading dashboard…
          </div>
        `,
        '#/dashboard'
      );

    if (!mounted) {
      return;
    }

    try {
      const data =
        await API.dashboardSummary();

      const content =
        document.querySelector(
          '.content'
        );

      if (!content) {
        return;
      }

      content.innerHTML =
        renderDashboard(
          data,
          AppState.user
        );

      bindShellEvents();

      // Recent activity rows and the needs-attention list both open the
      // invoice they name.
      content
        .querySelectorAll(
          '#recent-table tbody tr[data-id], .attention-row[data-id]'
        )
        .forEach(
          (row) => {
            row.onclick =
              () => {
                location.hash =
                  `#/invoices/${row.dataset.id}`;
              };
          }
        );

      bindDeleteButtons(
        content,
        () => renderDashboardPage()
      );

    } catch (error) {
      handleApiError(
        error,
        'Unable to load dashboard.'
      );
    }
  }

  // ===========================================================================
  // CAPTURE
  // ===========================================================================

  // Files staged on the upload screen, before processing starts.
  let stagedFiles = [];

  async function renderCapturePage() {
    const mounted =
      await mountShell(
        renderCapture(),
        '#/capture'
      );

    if (!mounted) {
      return;
    }

    stagedFiles = [];

    const dropzone =
      document.getElementById('dropzone');

    // -------------------------------------------------------------------------
    // Hidden file input
    // -------------------------------------------------------------------------

    const fileInput =
      document.createElement('input');

    fileInput.type = 'file';
    fileInput.multiple = true;
    fileInput.className = 'file-input-hidden';

    fileInput.accept =
      'application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif';

    document.body.appendChild(fileInput);

    // -------------------------------------------------------------------------
    // Staging
    //
    // Files are validated as they arrive so an unsupported file is reported
    // immediately rather than after a failed upload.
    // -------------------------------------------------------------------------

    function addFiles(list) {
      const incoming =
        Array.from(list || []);

      if (!incoming.length) return;

      const accepted = [];
      const rejected = [];

      incoming.forEach((file) => {
        try {
          API.validateInvoiceFile(file);

          const duplicate =
            stagedFiles.some(
              (staged) =>
                staged.name === file.name &&
                staged.size === file.size
            );

          if (!duplicate) {
            accepted.push(file);
          }

        } catch (error) {
          rejected.push(`${file.name} — ${error.message}`);
        }
      });

      if (rejected.length) {
        toast(
          rejected.length === 1
            ? rejected[0]
            : `${rejected.length} files skipped.`,
          'error'
        );
      }

      if (!accepted.length) return;

      stagedFiles = stagedFiles.concat(accepted);

      paintStagedFiles();
    }

    function paintStagedFiles() {
      const slot =
        document.getElementById('selected-files');

      if (!slot) return;

      slot.innerHTML =
        renderSelectedFiles(stagedFiles);

      slot
        .querySelectorAll('[data-remove-index]')
        .forEach((button) => {
          button.onclick =
            () => {
              stagedFiles.splice(
                Number(button.dataset.removeIndex),
                1
              );

              paintStagedFiles();
            };
        });

      const clearBtn =
        document.getElementById('btn-clear-files');

      if (clearBtn) {
        clearBtn.onclick =
          () => {
            stagedFiles = [];
            paintStagedFiles();
          };
      }

      const processBtn =
        document.getElementById('btn-process-files');

      if (processBtn) {
        processBtn.onclick =
          async () => {
            const files = stagedFiles.slice();

            stagedFiles = [];

            if (files.length === 1) {
              await runCapture(files[0]);
            } else {
              await runBulkCapture(files);
            }
          };
      }
    }

    // -------------------------------------------------------------------------
    // Drag and drop
    // -------------------------------------------------------------------------

    if (dropzone) {

      ['dragenter', 'dragover'].forEach((type) => {
        dropzone.addEventListener(type, (event) => {
          event.preventDefault();
          event.stopPropagation();

          dropzone.classList.add('dragover');
        });
      });

      ['dragleave', 'drop'].forEach((type) => {
        dropzone.addEventListener(type, (event) => {
          event.preventDefault();
          event.stopPropagation();

          // dragleave fires when moving between child elements too, so only
          // clear the state when the cursor has actually left the zone.
          if (
            type === 'drop' ||
            !dropzone.contains(event.relatedTarget)
          ) {
            dropzone.classList.remove('dragover');
          }
        });
      });

      dropzone.addEventListener('drop', (event) => {
        addFiles(event.dataTransfer?.files);
      });
    }

    // Dropping anywhere else on the page should not navigate away from the app.
    const blockDrop = (event) => event.preventDefault();

    window.addEventListener('dragover', blockDrop);
    window.addEventListener('drop', blockDrop);

    fileInput.addEventListener('change', (event) => {
      addFiles(event.target.files);

      // Allows the same file to be picked again after being removed.
      fileInput.value = '';
    });

    // -------------------------------------------------------------------------
    // Buttons
    // -------------------------------------------------------------------------

    const uploadBtn =
      document.getElementById('btn-upload-invoice');

    if (uploadBtn) {
      uploadBtn.onclick =
        (event) => {
          event.preventDefault();

          try {
            fileInput.click();

          } catch (error) {
            console.error(
              '[Capture] Could not open file picker:',
              error
            );

            toast(
              'Unable to open the file picker.',
              'error'
            );
          }
        };
    }

    const takePhotoBtn =
      document.getElementById('btn-take-photo');

    if (takePhotoBtn) {
      takePhotoBtn.onclick =
        () => {
          if (
            typeof window.Camera === 'undefined' ||
            typeof window.Camera.open !== 'function'
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
  }

  // ===========================================================================
  // BULK INVOICE PROCESSING
  // ===========================================================================

  

// /**
//  * Process multiple invoices one at a time.
//  *
//   * This deliberately uses the existing API.captureInvoice(file) method
//   * instead of requiring a new backend endpoint.
 //  *
 //  * That means the backend does not have to understand a multipart array.
  // * The frontend simply sends each invoice through the same proven pipeline.
 //  */
  // File list for the batch currently being processed.
  let bulkFiles = [];

  async function runBulkCapture(
    files
  ) {
    if (
      !Array.isArray(files) ||
      !files.length
    ) {
      toast(
        'No invoice files were selected.',
        'error'
      );

      return;
    }

    // -------------------------------------------------------------------------
    // Make a safe copy so the original FileList is never mutated.
    // -------------------------------------------------------------------------

    const invoiceFiles =
      Array.from(
        files
      );

    // The progress screen needs the names of files it has not reached yet.
    bulkFiles = invoiceFiles;

    const total =
      invoiceFiles.length;

    const results = [];

    let successful =
      0;

    let failed =
      0;

    // -------------------------------------------------------------------------
    // Initial processing screen.
    // -------------------------------------------------------------------------

    renderBulkProcessing(
      0,
      total,
      invoiceFiles[0],
      successful,
      failed,
      results,
      'Preparing invoices...'
    );

    // -------------------------------------------------------------------------
    // Process sequentially.
    //
    // Sequential processing is safer for OCR / AI workloads because it:
    //
    // 1. avoids flooding the backend,
    // 2. avoids browser memory spikes,
    // 3. reduces simultaneous API requests,
    // 4. works with the existing single-file endpoint.
    // -------------------------------------------------------------------------

    for (
      let index = 0;
      index < invoiceFiles.length;
      index++
    ) {
      const file =
        invoiceFiles[index];

      const currentNumber =
        index + 1;

      renderBulkProcessing(
        currentNumber - 1,
        total,
        file,
        successful,
        failed,
        results,
        `Processing invoice ${currentNumber} of ${total}...`
      );

      try {
        console.log(
          '[Bulk Capture] Processing invoice:',
          {
            index:
              currentNumber,

            total,

            name:
              file.name,

            type:
              file.type,

            size:
              file.size,
          }
        );

        // ---------------------------------------------------------------------
        // Use the existing production invoice capture API.
        // ---------------------------------------------------------------------

        const response =
          await API.captureInvoice(
            file
          );

        if (
          !response ||
          !response.invoice ||
          !response.invoice.id
        ) {
          throw new Error(
            'The server processed the invoice but did not return an invoice ID.'
          );
        }

        successful++;

        results.push({
          success: true,

          fileName:
            file.name,

          invoiceId:
            response.invoice.id,

          invoice:
            response.invoice,

          warning:
            response.warning ||
            null,
        });

        console.log(
          '[Bulk Capture] Invoice processed successfully:',
          {
            file:
              file.name,

            invoiceId:
              response.invoice.id,
          }
        );

      } catch (error) {
        console.error(
          '[Bulk Capture] Invoice processing failed:',
          {
            file:
              file.name,

            error,
          }
        );

        // ---------------------------------------------------------------------
        // Authentication failure:
        //
        // There is no point continuing if the entire session has expired.
        // ---------------------------------------------------------------------

        if (
          isAuthError(error)
        ) {
          handleSessionExpired(
            'Your session expired while processing the invoices. Please sign in again.'
          );

          return;
        }

        failed++;

        results.push({
          success: false,

          fileName:
            file.name,

          error:
            error?.message ||
            'Unknown processing error.',
        });
      }

      // -----------------------------------------------------------------------
      // Update progress after each completed invoice.
      // -----------------------------------------------------------------------

      renderBulkProcessing(
        currentNumber,
        total,
        invoiceFiles[
          Math.min(
            currentNumber,
            total - 1
          )
        ],
        successful,
        failed,
        results,
        currentNumber === total
          ? 'Finishing batch...'
          : `Completed ${currentNumber} of ${total} invoices...`
      );
    }

    // =========================================================================
    // FINAL RESULT
    // =========================================================================

    renderBulkProcessing(
      total,
      total,
      null,
      successful,
      failed,
      results,
      'Batch processing complete.'
    );

    // -------------------------------------------------------------------------
    // Show a useful completion message.
    // -------------------------------------------------------------------------

    if (
      successful &&
      !failed
    ) {
      toast(
        `${successful} invoice${
          successful === 1
            ? ''
            : 's'
        } processed successfully.`,
        'success'
      );

    } else if (
      successful &&
      failed
    ) {
      toast(
        `${successful} processed successfully. ${failed} failed.`,
        'error'
      );

    } else {
      toast(
        'None of the selected invoices could be processed.',
        'error'
      );
    }

    // -------------------------------------------------------------------------
    // Give the user a moment to see the completed result before returning
    // to the invoice list.
    // -------------------------------------------------------------------------

    setTimeout(
      () => {
        location.hash =
          '#/invoices';
      },
      1200
    );
  }

  // ===========================================================================
  // BULK PROCESSING UI
  // ===========================================================================

  /**
   * Paints the batch progress screen.
   *
   * Signature is kept as-is for runBulkCapture; the file names for the
   * not-yet-started rows come from bulkFiles, which runBulkCapture sets.
   */
  function renderBulkProcessing(
    completed,
    total,
    currentFile,
    successful,
    failed,
    results,
    statusMessage
  ) {
    const safeTotal =
      Math.max(Number(total) || 0, 1);

    const finished =
      Array.isArray(results)
        ? results
        : [];

    const items = [];

    // Everything already attempted, in the order it was processed.
    finished.forEach((result) => {
      items.push({
        name: result.fileName,

        invoice_number:
          result.invoice?.invoice_number ||
          result.fileName,

        state:
          result.success
            ? 'done'
            : 'failed',

        message:
          result.success
            ? 'Extracted · Validated'
            : result.error,
      });
    });

    // The one in flight.
    if (finished.length < safeTotal) {
      items.push({
        name:
          currentFile?.name ||
          bulkFiles[finished.length]?.name ||
          `Invoice ${finished.length + 1}`,

        state: 'active',

        message:
          statusMessage ||
          'Extracting invoice data…',
      });
    }

    // Everything still queued.
    for (
      let index = items.length;
      index < safeTotal;
      index++
    ) {
      items.push({
        name:
          bulkFiles[index]?.name ||
          `Invoice ${index + 1}`,

        state: 'pending',
      });
    }

    root.innerHTML =
      renderBatchProgress(items);
  }

  // ===========================================================================
  // SINGLE INVOICE PROCESSING
  // ===========================================================================

  // The stages the capture screen walks through. These mirror what the backend
  // actually does with the upload: store it, read it, check it, save it.
  const PROCESSING_STAGES = [
    'Uploading invoice',
    'Reading the document',
    'Extracting invoice data',
    'Validating totals and duplicates',
    'Saving invoice',
  ];

  async function runCapture(
    file
  ) {
    if (!file) {
      toast(
        'No invoice file was selected.',
        'error'
      );

      return;
    }

    let stageIndex =
      0;

    root.innerHTML =
      renderProcessing(
        stageIndex,
        PROCESSING_STAGES,
        false
      );

    let stageTimer =
      setInterval(
        () => {
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
        },
        1200
      );

    try {
      console.log(
        '[Capture] Sending invoice to production backend:',
        {
          name:
            file.name,

          type:
            file.type,

          size:
            file.size,
        }
      );

      const result =
        await API.captureInvoice(
          file
        );

      clearInterval(
        stageTimer
      );

      stageTimer =
        null;

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

      setTimeout(
        () => {
          location.hash =
            `#/review/${result.invoice.id}`;
        },
        500
      );

      if (result.warning) {
        setTimeout(
          () => {
            toast(
              result.warning,
              'error'
            );
          },
          800
        );
      }

    } catch (error) {
      if (stageTimer) {
        clearInterval(
          stageTimer
        );

        stageTimer =
          null;
      }

      console.error(
        '[Capture] Invoice capture failed:',
        error
      );

      if (
        isAuthError(error)
      ) {
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

      location.hash =
        '#/capture';
    }
  }
  // ===========================================================================
  // REVIEW
  // ===========================================================================

  async function renderReviewPage(
    id,
    warning
  ) {
    // Opening a different invoice starts from that invoice's own reading,
    // never the last one's.
    if (ReviewState.invoiceId !== id) {
      ReviewState.invoiceId = id;
      ReviewState.stockPlan = null;
      ReviewState.openLine = null;
    }

    const mounted =
      await mountShell(
        `
          <div class="loading-inline">
            Loading invoice…
          </div>
        `,
        '#/invoices'
      );

    if (!mounted) {
      return;
    }

    try {
      const response =
        await API.getInvoice(
          id
        );

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
      ) {
        return;
      }

      location.hash =
        '#/invoices';
    }
  }

  async function renderInvoiceDetailPage(
    id
  ) {
    return renderReviewPage(
      id
    );
  }

  // ===========================================================================
  // REVIEW PAINT
  // ===========================================================================

  // ===========================================================================
  // DOCUMENT VIEWER
  //
  // The scanned invoice sits beside the extracted fields, with zoom and rotate
  // so a faint line on a photographed page can actually be checked.
  // ===========================================================================

  async function mountDocumentViewer(invoice) {
    const stage =
      document.getElementById('doc-stage');

    if (!stage) return;

    let url;

    try {

      url =
        await API.fetchDocumentBlob(invoice.id);

    } catch (error) {

      if (isAuthError(error)) {
        handleSessionExpired(
          'Your session expired while loading the invoice document.'
        );

        return;
      }

      console.warn(
        '[Detail] Could not load invoice document:',
        error
      );

      stage.innerHTML =
        '<div class="doc-empty">Could not load document</div>';

      return;
    }

    if (!url) {
      stage.innerHTML =
        '<div class="doc-empty">No document on file</div>';

      return;
    }

    const isPdf =
      stage.dataset.pdf === '1';

    if (isPdf) {
      // PDFs render in the browser's own viewer, which brings its own controls.
      stage.style.padding = '0';

      stage.innerHTML =
        `<iframe src="${url}" title="Invoice document"></iframe>`;

    } else {

      stage.innerHTML =
        `<img id="doc-image" src="${url}" alt="Invoice document" />`;
    }

    const image =
      document.getElementById('doc-image');

    const zoomLabel =
      document.getElementById('doc-zoom-label');

    let zoom = 1;
    let rotation = 0;

    function applyTransform() {
      if (!image) return;

      image.style.width = `${zoom * 100}%`;

      image.style.transform =
        `rotate(${rotation}deg)`;

      if (zoomLabel) {
        zoomLabel.textContent =
          `${Math.round(zoom * 100)}%`;
      }
    }

    if (image) {
      image.style.width = '100%';
      applyTransform();
    }

    const zoomIn =
      document.getElementById('doc-zoom-in');

    const zoomOut =
      document.getElementById('doc-zoom-out');

    const rotate =
      document.getElementById('doc-rotate');

    const download =
      document.getElementById('doc-download');

    // Zoom and rotate act on the image; with a PDF the embedded viewer owns them.
    [zoomIn, zoomOut, rotate].forEach((button) => {
      if (button) button.disabled = !image;
    });

    if (zoomIn) {
      zoomIn.onclick =
        () => {
          zoom = Math.min(4, zoom + 0.25);
          applyTransform();
        };
    }

    if (zoomOut) {
      zoomOut.onclick =
        () => {
          zoom = Math.max(0.5, zoom - 0.25);
          applyTransform();
        };
    }

    if (rotate) {
      rotate.onclick =
        () => {
          rotation = (rotation + 90) % 360;
          applyTransform();
        };
    }

    if (download) {
      download.onclick =
        () => {
          const link =
            document.createElement('a');

          link.href = url;

          link.download =
            `${invoice.invoice_number || 'invoice'}-document`;

          document.body.appendChild(link);
          link.click();
          link.remove();
        };
    }
  }

  // What the stock panel is currently showing, so a repaint does not lose the
  // open line or re-fetch a plan the server just handed back.
  const ReviewState = {
    invoiceId: null,
    stockPlan: null,
    openLine: null,
  };

  /**
   * The three decisions a person can make about an invoice line.
   */
  function bindInvoiceStockDecisions(invoice) {
    const content = document.querySelector('.content');

    if (!content) return;

    const repaint = async (plan) => {
      ReviewState.stockPlan = plan || null;

      await paintReview(invoice);
    };

    // Every line still waiting, answered in one go. An invoice of consumables
    // that none of them belong in stock is ordinary, and answering it line by
    // line is a lot of clicks for a single decision. Each line is still
    // recorded separately, with the reason given, and any one of them can be
    // reopened and changed afterwards.
    const noneToStock = content.querySelector('#btn-none-to-stock');

    if (noneToStock) {
      noneToStock.onclick =
        async () => {
          const lines =
            (ReviewState.stockPlan?.lines || [])
              .filter((line) => line.stock_decision === 'UNMATCHED');

          if (!lines.length) return;

          const reason =
            document.getElementById('bulk-off-stock-reason')?.value || 'NON_INVENTORY';

          const confirmed =
            await confirmDialog({
              title: `Keep ${lines.length} lines off stock?`,
              body:
                `They stay on the invoice and are captured as normal. ` +
                `No quantity moves for any of them. You can change any line ` +
                `afterwards.`,
              confirmLabel: `Keep all ${lines.length} off stock`,
            });

          if (!confirmed) return;

          noneToStock.disabled = true;

          let plan = null;
          let failed = 0;

          for (const line of lines) {
            try {

              const result =
                await API.setInvoiceLineStock(invoice.id, line.id, {
                  decision: 'DO_NOT_STOCK',
                  reason,
                });

              plan = result.plan;

            } catch (error) {
              failed += 1;
            }
          }

          ReviewState.openLine = null;

          toast(
            failed
              ? `${lines.length - failed} of ${lines.length} kept off stock; ${failed} could not be recorded.`
              : `${lines.length} lines kept off stock.`,
            failed ? 'error' : 'success'
          );

          await repaint(plan);
        };
    }

    content
      .querySelectorAll('[data-line-decide]')
      .forEach((button) => {
        button.onclick =
          async () => {
            const lineId = button.dataset.lineDecide;

            ReviewState.openLine =
              ReviewState.openLine === lineId ? null : lineId;

            await paintReview(invoice);
          };
      });

    const openLine = ReviewState.openLine;

    if (!openLine) return;

    // Searching the product master, for the "match an existing product" answer.
    const search = document.getElementById(`line-search-${openLine}`);
    const results = document.getElementById(`line-results-${openLine}`);

    if (search && results) {
      let timer = null;

      search.oninput =
        () => {
          clearTimeout(timer);

          const term = search.value.trim();

          if (term.length < 2) return;

          timer =
            setTimeout(
              async () => {
                try {
                  const found = await API.listProducts({ q: term, limit: 8 });

                  results.innerHTML =
                    (found.products || []).length
                      ? found.products.map((p) => `
                          <label class="intel-row" style="cursor:pointer;align-items:center;">
                            <input
                              type="radio"
                              name="line-${esc(openLine)}"
                              value="${esc(p.id)}"
                              style="width:14px;height:14px;margin-right:2px;"
                            />
                            <div style="flex:1;min-width:0;">
                              <div class="title">${esc(p.description)}</div>
                              <div class="detail">
                                ${esc(p.sku || 'No SKU')}
                                ${p.inventory_type === 'NON_STOCK' ? ' · not inventory' : ''}
                                · ${fmtQty(p.current_quantity)} in stock
                              </div>
                            </div>
                          </label>
                        `).join('')
                      : '<div class="cell-muted" style="font-size:13px;">No products match that search.</div>';

                } catch (error) {
                  console.warn('[Review] Product search failed:', error);
                }
              },
              250
            );
        };
    }

    const match = content.querySelector(`[data-line-match="${openLine}"]`);

    if (match) {
      match.onclick =
        async () => {
          const chosen =
            content.querySelector(`input[name="line-${openLine}"]:checked`);

          if (!chosen) {
            toast('Choose the product this line refers to.', 'error');

            return;
          }

          match.disabled = true;

          try {
            const result =
              await API.setInvoiceLineStock(invoice.id, openLine, {
                decision: 'STOCK_MATCHED',
                product_id: chosen.value,
              });

            ReviewState.openLine = null;

            toast(
              result.decision === 'NON_STOCK'
                ? 'Matched — that product is not tracked as stock'
                : 'Matched to stock',
              'success'
            );

            await repaint(result.plan);

          } catch (error) {
            match.disabled = false;
            handleApiError(error, 'Unable to match that line.');
          }
        };
    }

    const skip = content.querySelector(`[data-line-skip="${openLine}"]`);

    if (skip) {
      skip.onclick =
        async () => {
          skip.disabled = true;

          try {
            const result =
              await API.setInvoiceLineStock(invoice.id, openLine, {
                decision: 'DO_NOT_STOCK',
                reason: document.getElementById(`line-reason-${openLine}`)?.value,
              });

            ReviewState.openLine = null;

            toast('Kept off stock — the line stays on the invoice', 'success');

            await repaint(result.plan);

          } catch (error) {
            skip.disabled = false;
            handleApiError(error, 'Unable to record that decision.');
          }
        };
    }

    const create = content.querySelector(`[data-line-create="${openLine}"]`);

    if (create) {
      create.onclick =
        async () => {
          const description =
            document.getElementById(`line-desc-${openLine}`)?.value.trim();

          if (!description) {
            toast('A product description is required.', 'error');

            return;
          }

          const confirmed =
            await confirmDialog({
              title: 'Create this product?',
              body:
                `${description} will be added to the product master, and the ` +
                'invoice quantity will be added to its stock when this invoice ' +
                'is approved.',
              confirmLabel: 'Create and add to stock',
            });

          if (!confirmed) return;

          create.disabled = true;

          try {
            const result =
              await API.createProductFromLine(invoice.id, openLine, {
                description,
                sku: document.getElementById(`line-sku-${openLine}`)?.value.trim() || null,
                bin_location: document.getElementById(`line-bin-${openLine}`)?.value.trim() || null,
                stock_group: document.getElementById(`line-group-${openLine}`)?.value.trim() || null,
              });

            ReviewState.openLine = null;

            toast(`${result.product.description} added to the product master`, 'success');

            await repaint(result.plan);

          } catch (error) {
            create.disabled = false;
            handleApiError(error, 'Unable to create that product.');
          }
        };
    }
  }

  async function paintReview(
    invoice,
    warning
  ) {
    const content =
      document.querySelector(
        '.content'
      );

    if (!content) {
      return;
    }

    let stockPlan = ReviewState.stockPlan;

    if (!stockPlan && hasFunction(API, 'invoiceStockPlan')) {
      try {
        stockPlan = await API.invoiceStockPlan(invoice.id);
      } catch (error) {
        // The stock panel is an addition to this screen, not the point of it.
        console.warn('[Review] Could not load the stock impact:', error);
      }
    }

    ReviewState.stockPlan = stockPlan;

    content.innerHTML =
      renderInvoiceDetail(
        invoice,
        {
          warning,
          stockPlan,
          openLine: ReviewState.openLine,
        }
      );

    bindShellEvents();

    await mountDocumentViewer(invoice);

    bindInvoiceStockDecisions(invoice);

    // -------------------------------------------------------------------------
    // Delete
    // -------------------------------------------------------------------------

    const deleteBtn =
      document.getElementById(
        'btn-delete-invoice'
      );

    if (deleteBtn) {
      deleteBtn.onclick =
        async () => {
          deleteBtn.disabled = true;

          const deleted =
            await deleteInvoice(
              deleteBtn.dataset.id,
              deleteBtn.dataset.label
            );

          deleteBtn.disabled = false;

          if (deleted) {
            location.hash = '#/invoices';
          }
        };
    }

    // -------------------------------------------------------------------------
    // Editable fields
    // -------------------------------------------------------------------------

    document
      .querySelectorAll(
        '[data-field-input]'
      )
      .forEach(
        (input) => {
          let original =
            input.value;

          input.addEventListener(
            'blur',
            async () => {
              const value =
                input.value;

              if (
                value === original
              ) {
                return;
              }

              const field =
                input.dataset.fieldInput;

              if (!field) {
                return;
              }

              input.disabled =
                true;

              try {
                const response =
                  await API.updateInvoice(
                    invoice.id,
                    {
                      [field]:
                        value,
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

                original =
                  value;

                toast(
                  'Field updated',
                  'success'
                );

                await paintReview(
                  response.invoice,
                  warning
                );

              } catch (error) {
                input.disabled =
                  false;

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
        }
      );

    // -------------------------------------------------------------------------
    // Approve
    // -------------------------------------------------------------------------

    const approveBtn =
      document.getElementById(
        'btn-approve'
      );

    if (approveBtn) {
      approveBtn.onclick =
        async () => {
          approveBtn.disabled =
            true;

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

            approveBtn.disabled =
              false;

            approveBtn.textContent =
              'Approve Invoice';
          }
        };
    }

    // -------------------------------------------------------------------------
    // Reject
    // -------------------------------------------------------------------------

    const rejectBtn =
      document.getElementById(
        'btn-reject'
      );

    if (rejectBtn) {
      rejectBtn.onclick =
        () =>
          confirmReject(
            invoice.id
          );
    }

    // -------------------------------------------------------------------------
    // Retake
    // -------------------------------------------------------------------------

    const retakeBtn =
      document.getElementById(
        'btn-retake'
      );

    if (retakeBtn) {
      retakeBtn.onclick =
        () => {
          if (
            typeof window.Camera ===
              'undefined' ||
            typeof Camera.open !==
              'function'
          ) {
            toast(
              'Camera is not available.',
              'error'
            );

            return;
          }

          Camera.open({
            onCapture:
              async (
                file
              ) => {
                if (!file) {
                  return;
                }

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

  // ===========================================================================
  // REJECT MODAL
  // ===========================================================================

  async function confirmReject(id) {
    const confirmed =
      await confirmDialog({
        title: 'Reject this invoice?',
        body:
          'This marks the invoice as rejected and removes it from the ' +
          'approval queue. The record and its history are kept.',
        confirmLabel: 'Reject invoice',
        danger: true,
      });

    if (!confirmed) return;

    try {

      const response =
        await API.rejectInvoice(id);

      if (!response || !response.invoice) {
        throw new Error(
          'The server did not return the rejected invoice.'
        );
      }

      toast('Invoice rejected', 'success');

      await paintReview(response.invoice);

    } catch (error) {

      handleApiError(
        error,
        'Unable to reject invoice.'
      );
    }
  }

  // ===========================================================================
  // INVOICES
  // ===========================================================================

  async function renderInvoicesPage(
    opts = {}
  ) {
    const activeRoute =
      opts.forceExceptionView
        ? '#/exceptions'
        : '#/invoices';

    const mounted =
      await mountShell(
        `
          <div class="loading-inline">
            Loading invoices…
          </div>
        `,
        activeRoute
      );

    if (!mounted) {
      return;
    }

    const filters =
      opts.status
        ? {
            ...AppState.invoiceFilters,
            status:
              opts.status,
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
        // The exceptions screen has no search box, so it must not inherit a
        // query left behind on the invoices table — that would show an empty
        // list with nothing on screen explaining why.
        q:
          isExceptionView
            ? undefined
            : filters.q,

        status:
          isExceptionView
            ? undefined
            : (
                filters.status === 'all'
                  ? undefined
                  : filters.status
              ),

        // Ask the server for each row's top failing rule so the exceptions
        // screen can group by, and name, the actual problem.
        withIssues:
          isExceptionView
            ? '1'
            : undefined,
      };

      const response =
        await API.listInvoices(params);

      const invoices =
        Array.isArray(response?.invoices)
          ? response.invoices
          : [];

      const finalList =
        isExceptionView
          ? invoices.filter(
              (invoice) =>
                ['exception', 'duplicate'].includes(invoice.status)
            )
          : invoices;

      const content =
        document.querySelector('.content');

      if (!content) {
        return;
      }

      // The exceptions screen is its own view: grouped by what a person has
      // to do about each invoice rather than a flat table.
      if (isExceptionView) {

        content.innerHTML =
          renderExceptions(finalList);

        bindShellEvents();

        content
          .querySelectorAll('.attention-row[data-id]')
          .forEach((row) => {
            row.onclick =
              () => {
                location.hash =
                  `#/invoices/${row.dataset.id}`;
              };
          });

        bindDeleteButtons(
          content,
          () =>
            loadAndPaintInvoices(
              filters,
              title,
              isExceptionView
            )
        );

        return;
      }

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

      console.error(
        '[InvoiceFlow] Failed to load invoices:',
        error
      );

      toast(
        error.message ||
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
    const content =
      document.querySelector('.content');

    if (!content) return;

    const reload =
      () =>
        loadAndPaintInvoices(
          filters,
          title,
          isExceptionView
        );

    // -------------------------------------------------------------------------
    // Row navigation
    //
    // Only the data cells open the invoice — the checkbox and the delete
    // button live in the same row and must not navigate.
    // -------------------------------------------------------------------------

    content
      .querySelectorAll('tbody tr[data-id]')
      .forEach((tr) => {
        tr
          .querySelectorAll('.clickable-cell')
          .forEach((cell) => {
            cell.onclick =
              () => {
                location.hash =
                  `#/invoices/${tr.dataset.id}`;
              };
          });
      });

    // -------------------------------------------------------------------------
    // Selection + bulk actions
    // -------------------------------------------------------------------------

    const checkAll =
      document.getElementById('check-all');

    const rowChecks =
      Array.from(
        content.querySelectorAll('.row-check')
      );

    const selectedIds =
      () =>
        rowChecks
          .filter((checkbox) => checkbox.checked)
          .map((checkbox) => checkbox.dataset.id);

    function paintBulkBar() {
      const ids = selectedIds();

      const slot =
        document.getElementById('bulk-bar-slot');

      if (!slot) return;

      slot.innerHTML =
        renderBulkBar(ids.length);

      rowChecks.forEach((checkbox) => {
        checkbox
          .closest('tr')
          .classList
          .toggle('selected', checkbox.checked);
      });

      if (checkAll) {
        checkAll.checked =
          ids.length > 0 &&
          ids.length === rowChecks.length;

        checkAll.indeterminate =
          ids.length > 0 &&
          ids.length < rowChecks.length;
      }

      const exportSelectedBtn =
        document.getElementById('btn-export-selected');

      if (exportSelectedBtn) {
        exportSelectedBtn.onclick =
          () =>
            exportSelectedInvoices(
              selectedIds(),
              exportSelectedBtn
            );
      }

      const deleteSelectedBtn =
        document.getElementById('btn-delete-selected');

      if (deleteSelectedBtn) {
        deleteSelectedBtn.onclick =
          async () => {
            deleteSelectedBtn.disabled = true;

            const deleted =
              await deleteInvoices(selectedIds());

            deleteSelectedBtn.disabled = false;

            if (deleted) {
              await reload();
            }
          };
      }
    }

    rowChecks.forEach((checkbox) => {
      checkbox.onclick =
        (event) => event.stopPropagation();

      checkbox.onchange =
        () => paintBulkBar();
    });

    if (checkAll) {
      checkAll.onclick =
        (event) => event.stopPropagation();

      checkAll.onchange =
        () => {
          rowChecks.forEach((checkbox) => {
            checkbox.checked = checkAll.checked;
          });

          paintBulkBar();
        };
    }

    paintBulkBar();

    // -------------------------------------------------------------------------
    // Per-row delete
    // -------------------------------------------------------------------------

    bindDeleteButtons(content, reload);

    // -------------------------------------------------------------------------
    // Search
    // -------------------------------------------------------------------------

    const searchInput =
      document.getElementById('invoice-search');

    if (searchInput) {
      let timer;

      searchInput.oninput =
        () => {
          clearTimeout(timer);

          timer =
            setTimeout(
              () => {
                AppState.invoiceFilters.q =
                  searchInput.value;

                loadAndPaintInvoices(
                  AppState.invoiceFilters,
                  title,
                  isExceptionView
                ).then(() => {
                  // Keep typing where it left off after the re-render.
                  const next =
                    document.getElementById('invoice-search');

                  if (next) {
                    next.focus();

                    next.setSelectionRange(
                      next.value.length,
                      next.value.length
                    );
                  }
                });
              },
              300
            );
        };
    }

    // -------------------------------------------------------------------------
    // Status filters
    // -------------------------------------------------------------------------

    content
      .querySelectorAll('.filter-chip[data-status]')
      .forEach((chip) => {
        chip.onclick =
          () => {
            AppState.invoiceFilters.status =
              chip.dataset.status;

            loadAndPaintInvoices(
              AppState.invoiceFilters,
              title,
              isExceptionView
            );
          };
      });

    // -------------------------------------------------------------------------
    // Export all
    // -------------------------------------------------------------------------

    const exportAllBtn =
      document.getElementById('btn-export-all');

    if (exportAllBtn) {
      exportAllBtn.onclick =
        () => exportAllInvoices(exportAllBtn);
    }
  }

  // ===========================================================================
  // APPROVALS
  // ===========================================================================

  async function renderApprovalsPage() {
    const mounted =
      await mountShell(
        '<div class="loading-inline">Loading approvals…</div>',
        '#/approvals'
      );

    if (!mounted) {
      return;
    }

    try {

      const response =
        await API.listInvoices({
          status: 'review_required',
        });

      const invoices =
        Array.isArray(response?.invoices)
          ? response.invoices
          : [];

      const content =
        document.querySelector('.content');

      if (!content) return;

      content.innerHTML =
        renderApprovals(invoices);

      bindShellEvents();

      content
        .querySelectorAll('tbody tr[data-id]')
        .forEach((tr) => {
          tr.onclick =
            () => {
              location.hash =
                `#/invoices/${tr.dataset.id}`;
            };
        });

    } catch (error) {
      handleApiError(
        error,
        'Unable to load approvals.'
      );
    }
  }

  // ===========================================================================
  // SUPPLIERS
  // ===========================================================================

  async function renderSuppliersPage() {
    const mounted =
      await mountShell(
        `
          <div class="loading-inline">
            Loading suppliers…
          </div>
        `,
        '#/suppliers'
      );

    if (!mounted) {
      return;
    }

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

      if (!content) {
        return;
      }

      content.innerHTML =
        renderSuppliers(
          suppliers
        );

      bindShellEvents();

      content
        .querySelectorAll('tr[data-supplier-id]')
        .forEach((tr) => {
          tr.onclick =
            () => {
              location.hash =
                `#/suppliers/${tr.dataset.supplierId}`;
            };
        });

    } catch (error) {
      handleApiError(
        error,
        'Unable to load suppliers.'
      );
    }
  }

  // ===========================================================================
  // SUPPLIER DETAIL
  // ===========================================================================

  async function renderSupplierDetailPage(id) {
    const mounted =
      await mountShell(
        '<div class="loading-inline">Loading supplier…</div>',
        '#/suppliers'
      );

    if (!mounted) {
      return;
    }

    try {

      const data =
        await API.getSupplier(id);

      if (!data || !data.supplier) {
        throw new Error('Supplier not found.');
      }

      const content =
        document.querySelector('.content');

      if (!content) return;

      content.innerHTML =
        renderSupplierDetail(data);

      bindShellEvents();

      content
        .querySelectorAll('tbody tr[data-id]')
        .forEach((tr) => {
          tr.onclick =
            () => {
              location.hash =
                `#/invoices/${tr.dataset.id}`;
            };
        });

    } catch (error) {

      if (handleApiError(error, 'Unable to load supplier.')) {
        return;
      }

      location.hash = '#/suppliers';
    }
  }

  // ===========================================================================
  // REPORTS
  // ===========================================================================

  async function renderReportsPage() {
    const mounted =
      await mountShell(
        `
          <div class="loading-inline">
            Loading reports…
          </div>
        `,
        '#/reports'
      );

    if (!mounted) {
      return;
    }

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

      if (!content) {
        return;
      }

      content.innerHTML =
        renderReports(
          suppliers,
          summary
        );

      bindShellEvents();

      const exportAllBtn =
        document.getElementById('btn-export-all');

      if (exportAllBtn) {
        exportAllBtn.onclick =
          () => exportAllInvoices(exportAllBtn);
      }

    } catch (error) {
      handleApiError(
        error,
        'Unable to load reports.'
      );
    }
  }

  // ===========================================================================
  // SETTINGS
  // ===========================================================================

  async function renderSettingsPage() {
    const mounted =
      await mountShell(
        renderSettings(
          AppState.user,
          AppState.health
        ),
        '#/settings'
      );

    if (!mounted) {
      return;
    }

    bindShellEvents();
  }

  // ===========================================================================
  // STOCK
  //
  // These pages use the same mountShell / render / bind pattern as the invoice
  // screens, and the same toasts, dialogs and error handling.
  // ===========================================================================

  const StockState = {
    productFilters: { q: '', status: '', category: '', group: '', sort: '', order: '', page: 1 },
    txFilters: { q: '', type: '', page: 1 },
    sheetFilters: { status: '' },
  };

  async function renderStockOverviewPage() {
    const mounted =
      await mountShell(
        '<div class="loading-inline">Loading stock…</div>',
        '#/stock'
      );

    if (!mounted) return;

    try {

      const data = await API.stockOverview();

      const content = document.querySelector('.content');

      if (!content) return;

      content.innerHTML = renderStockOverview(data);

      bindShellEvents();

      content
        .querySelectorAll('[data-transaction-id]')
        .forEach((row) => {
          row.onclick =
            () => {
              location.hash = `#/stock/transactions/${row.dataset.transactionId}`;
            };
        });

    } catch (error) {
      handleApiError(error, 'Unable to load the stock overview.');
    }
  }

  // -------------------------------------------------------------------------
  // Products
  // -------------------------------------------------------------------------

  async function renderProductsPage() {
    const mounted =
      await mountShell(
        '<div class="loading-inline">Loading products…</div>',
        '#/stock/products'
      );

    if (!mounted) return;

    await loadProducts();
  }

  async function loadProducts() {
    try {

      const data = await API.listProducts(StockState.productFilters);

      // If the app ships a bin sheet and the master is still missing bins it
      // would fill in, say so on the screen where the empty column is — rather
      // than leaving a person to work out that a six-step import was needed.
      let binOffer = null;

      if (hasFunction(API, 'stockBinsAvailable')) {
        try {
          const offer = await API.stockBinsAvailable();

          // Only while there is something left to fill in — an offer that
          // stays up after it has been taken reads as a failure.
          if (offer && offer.available && offer.pending > 0) {
            binOffer = offer;
          }
        } catch (error) {
          console.warn('[Stock] Could not check the bundled bin sheet:', error);
        }
      }

      data.bin_offer = binOffer;

      const content = document.querySelector('.content');

      if (!content) return;

      content.innerHTML = renderProducts(data, StockState.productFilters);

      bindShellEvents();

      content
        .querySelectorAll('[data-product-id]')
        .forEach((row) => {
          row.onclick =
            () => {
              location.hash = `#/stock/products/${row.dataset.productId}`;
            };
        });

      const search = document.getElementById('product-search');

      if (search) {
        let timer;

        search.oninput =
          () => {
            clearTimeout(timer);

            timer =
              setTimeout(
                () => {
                  StockState.productFilters.q = search.value;
                  StockState.productFilters.page = 1;

                  loadProducts().then(() => {
                    const next = document.getElementById('product-search');

                    if (next) {
                      next.focus();
                      next.setSelectionRange(next.value.length, next.value.length);
                    }
                  });
                },
                300
              );
          };
      }

      const category = document.getElementById('product-category');

      if (category) {
        category.onchange =
          () => {
            StockState.productFilters.category = category.value;
            StockState.productFilters.page = 1;
            loadProducts();
          };
      }

      content
        .querySelectorAll('[data-stock-group]')
        .forEach((chip) => {
          chip.onclick =
            () => {
              StockState.productFilters.group = chip.dataset.stockGroup;
              StockState.productFilters.page = 1;
              loadProducts();
            };
        });

      content
        .querySelectorAll('[data-stock-status]')
        .forEach((chip) => {
          chip.onclick =
            () => {
              StockState.productFilters.status = chip.dataset.stockStatus;
              StockState.productFilters.page = 1;
              loadProducts();
            };
        });

      // Clicking a sortable header toggles direction on the second click.
      content
        .querySelectorAll('th[data-sort]')
        .forEach((th) => {
          th.style.cursor = 'pointer';

          th.onclick =
            () => {
              const key = th.dataset.sort;

              StockState.productFilters.order =
                StockState.productFilters.sort === key &&
                StockState.productFilters.order !== 'desc'
                  ? 'desc'
                  : 'asc';

              StockState.productFilters.sort = key;

              loadProducts();
            };
        });

      bindPager(() => loadProducts(), StockState.productFilters);

      const newProduct = document.getElementById('btn-new-product');

      if (newProduct) {
        newProduct.onclick = () => openNewProductDialog();
      }

      const applyBins = document.getElementById('btn-apply-bins');

      if (applyBins) {
        applyBins.onclick =
          async () => {
            const offer = data.bin_offer || {};

            const confirmed =
              await confirmDialog({
                title: 'Fill in bins and stock groups?',
                body:
                  `${offer.pending_bins} bin${offer.pending_bins === 1 ? '' : 's'} and ` +
                  `${offer.pending_groups} group${offer.pending_groups === 1 ? '' : 's'} ` +
                  'will be filled in from ' +
                  `${offer.source || 'the bundled stock sheet'}. ` +
                  'No product is created, no quantity changes and nothing is ' +
                  'posted to the ledger.',
                confirmLabel: 'Fill them in',
              });

            if (!confirmed) return;

            applyBins.disabled = true;
            applyBins.textContent = 'Filling in…';

            try {

              const result = await API.applyStockBins();

              toast(
                `${result.bins_recorded} bin${result.bins_recorded === 1 ? '' : 's'} and ` +
                `${result.grouped} group${result.grouped === 1 ? '' : 's'} filled in`,
                'success'
              );

              await loadProducts();

            } catch (error) {
              applyBins.disabled = false;
              applyBins.textContent = 'Fill in bins & groups';
              handleApiError(error, 'Unable to fill in the bins.');
            }
          };
      }

    } catch (error) {
      handleApiError(error, 'Unable to load products.');
    }
  }

  function bindPager(reload, filters) {
    const prev = document.getElementById('page-prev');
    const next = document.getElementById('page-next');

    if (prev) {
      prev.onclick =
        () => {
          filters.page = Math.max(1, (filters.page || 1) - 1);
          reload();
        };
    }

    if (next) {
      next.onclick =
        () => {
          filters.page = (filters.page || 1) + 1;
          reload();
        };
    }
  }

  async function openNewProductDialog() {
    const host = document.createElement('div');

    host.innerHTML = `
      <div class="modal-backdrop" id="product-backdrop">
        <div class="modal-card">
          <h3>New product</h3>
          <div class="field">
            <label>Description</label>
            <input id="np-description" placeholder="e.g. SKF 6205-2RS Bearing" />
          </div>
          <div style="display:flex;gap:12px;">
            <div class="field" style="flex:1;">
              <label>SKU / product code</label>
              <input id="np-sku" placeholder="Optional" />
            </div>
            <div class="field" style="flex:1;">
              <label>Bin number</label>
              <input id="np-bin" placeholder="e.g. A12" />
            </div>
          </div>
          <div class="field">
            <label>Stock group</label>
            <input id="np-group" placeholder="e.g. Consumable Stock" />
          </div>
          <div style="display:flex;gap:12px;">
            <div class="field" style="flex:1;">
              <label>Opening quantity</label>
              <input id="np-qty" type="number" min="0" step="0.01" placeholder="0" />
            </div>
            <div class="field" style="flex:1;">
              <label>Unit cost</label>
              <input id="np-cost" type="number" min="0" step="0.01" placeholder="0.00" />
            </div>
          </div>
          <div style="display:flex;gap:12px;">
            <div class="field" style="flex:1;">
              <label>Category</label>
              <input id="np-category" placeholder="Optional" />
            </div>
            <div class="field" style="flex:1;">
              <label>Reorder level</label>
              <input id="np-reorder" type="number" min="0" step="1" placeholder="0" />
            </div>
          </div>
          <div class="field">
            <label>Is this inventory?</label>
            <select id="np-inventory-type">
              <option value="STOCK">Stock — counted, and invoices receipt into it</option>
              <option value="NON_STOCK">Not stock — recorded on invoices, never counted</option>
            </select>
            <div class="field-hint">
              Services, hire, delivery and consumed-on-site items belong here.
              An invoice line matching a non-stock product is captured without
              moving any quantity.
            </div>
          </div>
          <div class="modal-actions">
            <button class="btn btn-secondary" id="np-cancel">Cancel</button>
            <button class="btn btn-primary" id="np-save">Create product</button>
          </div>
        </div>
      </div>
    `;

    const backdrop = host.firstElementChild;

    document.body.appendChild(backdrop);

    const close = () => backdrop.remove();

    backdrop.querySelector('#np-cancel').onclick = close;

    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) close();
    });

    backdrop.querySelector('#np-save').onclick =
      async () => {
        const description = backdrop.querySelector('#np-description').value.trim();

        if (!description) {
          toast('A product description is required.', 'error');
          return;
        }

        try {

          await API.createProduct({
            description,
            sku: backdrop.querySelector('#np-sku').value.trim() || null,
            bin_location: backdrop.querySelector('#np-bin').value.trim() || null,
            stock_group: backdrop.querySelector('#np-group').value.trim() || null,
            opening_quantity: backdrop.querySelector('#np-qty').value || 0,
            unit_cost: backdrop.querySelector('#np-cost').value || 0,
            category: backdrop.querySelector('#np-category').value.trim() || null,
            reorder_level: backdrop.querySelector('#np-reorder').value || 0,
            inventory_type: backdrop.querySelector('#np-inventory-type').value,
            track_inventory:
              backdrop.querySelector('#np-inventory-type').value !== 'NON_STOCK',
          });

          close();

          toast('Product created', 'success');

          await loadProducts();

        } catch (error) {
          handleApiError(error, 'Unable to create the product.');
        }
      };

    backdrop.querySelector('#np-description').focus();
  }

  /**
   * Where a product lives. Worth its own dialog because in a store that signs
   * stock out by bin, this one field is what makes a sign-out sheet readable.
   */
  function openBinDialog(productId, currentBin, description) {
    const host = document.createElement('div');

    host.innerHTML = `
      <div class="modal-backdrop" id="bin-backdrop">
        <div class="modal-card">
          <h3>Bin number</h3>
          <p>Where ${esc(description || 'this product')} is stored.</p>
          <div class="field">
            <label>Bin</label>
            <input id="bin-value" placeholder="e.g. A12" value="${esc(currentBin || '')}" />
          </div>
          <p style="font-size:12.5px;color:var(--ink-muted);">
            A sign-out sheet that writes only this bin will resolve to this
            product — as long as no other product shares the bin.
          </p>
          <div class="modal-actions">
            <button class="btn btn-secondary" id="bin-cancel">Cancel</button>
            <button class="btn btn-primary" id="bin-save">Save bin</button>
          </div>
        </div>
      </div>
    `;

    const backdrop = host.firstElementChild;

    document.body.appendChild(backdrop);

    const close = () => backdrop.remove();

    backdrop.querySelector('#bin-cancel').onclick = close;

    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) close();
    });

    backdrop.querySelector('#bin-save').onclick =
      async () => {
        const value = backdrop.querySelector('#bin-value').value.trim();

        try {

          await API.updateProduct(productId, { bin_location: value || null });

          close();

          toast(value ? `Bin set to ${value}` : 'Bin cleared', 'success');

          await renderProductDetailPage(productId);

        } catch (error) {
          handleApiError(error, 'Unable to save the bin.');
        }
      };

    backdrop.querySelector('#bin-value').focus();
  }

  // -------------------------------------------------------------------------
  // Product detail
  // -------------------------------------------------------------------------

  async function renderProductDetailPage(id) {
    const mounted =
      await mountShell(
        '<div class="loading-inline">Loading product…</div>',
        '#/stock/products'
      );

    if (!mounted) return;

    try {

      const [detail, history] =
        await Promise.all([
          API.getProduct(id),
          API.productHistory(id),
        ]);

      const content = document.querySelector('.content');

      if (!content) return;

      content.innerHTML = renderProductDetail(detail, history);

      bindShellEvents();

      content
        .querySelectorAll('[data-transaction-id]')
        .forEach((row) => {
          row.onclick =
            () => {
              location.hash = `#/stock/transactions/${row.dataset.transactionId}`;
            };
        });

      // Drill straight through to the document that caused a movement.
      content
        .querySelectorAll('[data-invoice-id]')
        .forEach((link) => {
          link.onclick =
            (event) => {
              event.stopPropagation();
              location.hash = `#/invoices/${link.dataset.invoiceId}`;
            };
        });

      content
        .querySelectorAll('[data-sheet-link]')
        .forEach((link) => {
          link.onclick =
            (event) => {
              event.stopPropagation();
              location.hash = `#/stock/signout/${link.dataset.sheetLink}`;
            };
        });

      const editBin = document.getElementById('btn-edit-bin');

      if (editBin) {
        editBin.onclick =
          () =>
            openBinDialog(
              editBin.dataset.productId,
              editBin.dataset.bin,
              detail.product.description
            );
      }

      const inventoryType = document.getElementById('btn-inventory-type');

      if (inventoryType) {
        inventoryType.onclick =
          async () => {
            const wasNonStock =
              inventoryType.dataset.inventoryType === 'NON_STOCK';

            const next = wasNonStock ? 'STOCK' : 'NON_STOCK';

            // A product that is not inventory is not counted either — the two
            // flags move together so nothing is left half-tracked.
            try {

              await API.updateProduct(inventoryType.dataset.productId, {
                inventory_type: next,
                track_inventory: next === 'STOCK',
              });

              toast(
                next === 'NON_STOCK'
                  ? 'Marked as non-stock. Invoices will capture it without moving quantity.'
                  : 'Back on stock. Invoices will receipt into it again.',
                'success'
              );

              await renderProductDetailPage(inventoryType.dataset.productId);

            } catch (error) {
              handleApiError(error, 'Unable to change the inventory type.');
            }
          };
      }

      const adjust = document.getElementById('btn-adjust-product');

      if (adjust) {
        adjust.onclick =
          () => {
            StockState.adjustProductId = adjust.dataset.productId;
            StockState.adjustProductLabel = detail.product.description;
            location.hash = '#/stock/adjustments';
          };
      }

    } catch (error) {

      if (handleApiError(error, 'Unable to load the product.')) return;

      location.hash = '#/stock/products';
    }
  }

  // -------------------------------------------------------------------------
  // Transactions
  // -------------------------------------------------------------------------

  async function renderStockTransactionsPage() {
    const mounted =
      await mountShell(
        '<div class="loading-inline">Loading stock transactions…</div>',
        '#/stock/transactions'
      );

    if (!mounted) return;

    await loadStockTransactions();
  }

  async function loadStockTransactions() {
    try {

      const data = await API.listStockTransactions(StockState.txFilters);

      const content = document.querySelector('.content');

      if (!content) return;

      content.innerHTML = renderStockTransactions(data, StockState.txFilters);

      bindShellEvents();

      content
        .querySelectorAll('[data-transaction-id]')
        .forEach((row) => {
          row.onclick =
            () => {
              location.hash = `#/stock/transactions/${row.dataset.transactionId}`;
            };
        });

      content
        .querySelectorAll('[data-tx-type]')
        .forEach((chip) => {
          chip.onclick =
            () => {
              StockState.txFilters.type = chip.dataset.txType;
              StockState.txFilters.page = 1;
              loadStockTransactions();
            };
        });

      const search = document.getElementById('tx-search');

      if (search) {
        let timer;

        search.oninput =
          () => {
            clearTimeout(timer);

            timer =
              setTimeout(
                () => {
                  StockState.txFilters.q = search.value;
                  StockState.txFilters.page = 1;

                  loadStockTransactions().then(() => {
                    const next = document.getElementById('tx-search');

                    if (next) {
                      next.focus();
                      next.setSelectionRange(next.value.length, next.value.length);
                    }
                  });
                },
                300
              );
          };
      }

      bindPager(() => loadStockTransactions(), StockState.txFilters);

    } catch (error) {
      handleApiError(error, 'Unable to load stock transactions.');
    }
  }

  async function renderStockTransactionDetailPage(id) {
    const mounted =
      await mountShell(
        '<div class="loading-inline">Loading transaction…</div>',
        '#/stock/transactions'
      );

    if (!mounted) return;

    try {

      const data = await API.getStockTransaction(id);

      const content = document.querySelector('.content');

      if (!content) return;

      content.innerHTML = renderStockTransactionDetail(data);

      bindShellEvents();

      content
        .querySelectorAll('[data-invoice-id]')
        .forEach((link) => {
          link.onclick =
            () => {
              location.hash = `#/invoices/${link.dataset.invoiceId}`;
            };
        });

      content
        .querySelectorAll('[data-sheet-link]')
        .forEach((link) => {
          link.onclick =
            () => {
              location.hash = `#/stock/signout/${link.dataset.sheetLink}`;
            };
        });

    } catch (error) {

      if (handleApiError(error, 'Unable to load the transaction.')) return;

      location.hash = '#/stock/transactions';
    }
  }

  // -------------------------------------------------------------------------
  // Adjustments
  // -------------------------------------------------------------------------

  async function renderStockAdjustmentsPage() {
    const mounted =
      await mountShell(
        '<div class="loading-inline">Loading adjustments…</div>',
        '#/stock/adjustments'
      );

    if (!mounted) return;

    try {

      const recent =
        await API.listStockTransactions({
          type: 'STOCK_ADJUSTMENT',
          limit: 20,
        });

      const content = document.querySelector('.content');

      if (!content) return;

      content.innerHTML =
        renderStockAdjustments([], recent.transactions || []);

      bindShellEvents();

      content
        .querySelectorAll('[data-transaction-id]')
        .forEach((row) => {
          row.onclick =
            () => {
              location.hash = `#/stock/transactions/${row.dataset.transactionId}`;
            };
        });

      bindAdjustmentForm();

    } catch (error) {
      handleApiError(error, 'Unable to load stock adjustments.');
    }
  }

  function bindAdjustmentForm() {
    const search = document.getElementById('adj-product-search');
    const results = document.getElementById('adj-product-results');
    const hidden = document.getElementById('adj-product-id');

    if (!search || !results || !hidden) return;

    // Arriving from a product page pre-selects that product.
    if (StockState.adjustProductId) {
      hidden.value = StockState.adjustProductId;
      search.value = StockState.adjustProductLabel || '';

      StockState.adjustProductId = null;
      StockState.adjustProductLabel = null;
    }

    let timer;

    search.oninput =
      () => {
        hidden.value = '';

        clearTimeout(timer);

        timer =
          setTimeout(
            async () => {
              const term = search.value.trim();

              if (term.length < 2) {
                results.innerHTML = '';
                return;
              }

              try {

                const data =
                  await API.listProducts({ q: term, limit: 6 });

                results.innerHTML =
                  (data.products || [])
                    .map((p) => `
                      <button
                        class="palette-item"
                        data-pick="${escapeHtml(p.id)}"
                        style="width:100%;"
                      >
                        <span class="pi-text">
                          <span class="t">${escapeHtml(p.description)}</span>
                          <span class="s">
                            ${escapeHtml(p.sku || 'No SKU')} · ${p.current_quantity} on hand
                          </span>
                        </span>
                      </button>
                    `)
                    .join('') ||
                  '<div class="cell-muted" style="font-size:12.5px;padding:8px 2px;">No products match.</div>';

                results
                  .querySelectorAll('[data-pick]')
                  .forEach((button) => {
                    button.onclick =
                      () => {
                        hidden.value = button.dataset.pick;
                        search.value =
                          button.querySelector('.t').textContent.trim();
                        results.innerHTML = '';
                      };
                  });

              } catch (error) {
                console.warn('[Stock] Product lookup failed:', error);
              }
            },
            250
          );
      };

    const post = document.getElementById('btn-post-adjustment');

    if (!post) return;

    post.onclick =
      async () => {
        const productId = hidden.value;
        const quantity = Number(document.getElementById('adj-quantity').value);
        const reason = document.getElementById('adj-reason').value;

        if (!productId) {
          toast('Choose a product first.', 'error');
          return;
        }

        if (!quantity || quantity <= 0) {
          toast('Enter a quantity greater than zero.', 'error');
          return;
        }

        if (!reason) {
          toast('Choose a reason for the adjustment.', 'error');
          return;
        }

        const direction = document.getElementById('adj-direction').value;

        const confirmed =
          await confirmDialog({
            title: 'Post this adjustment?',
            body:
              `This will ${direction === '-1' ? 'decrease' : 'increase'} stock by ` +
              `${quantity} and record it permanently in the ledger as "${reason}".`,
            confirmLabel: 'Post adjustment',
            danger: direction === '-1',
          });

        if (!confirmed) return;

        post.disabled = true;

        try {

          await API.createStockAdjustment({
            product_id: productId,
            quantity,
            direction: Number(direction),
            reason,
            notes: document.getElementById('adj-notes').value.trim() || null,
          });

          toast('Adjustment posted', 'success');

          await renderStockAdjustmentsPage();

        } catch (error) {
          handleApiError(error, 'Unable to post the adjustment.');
        } finally {
          post.disabled = false;
        }
      };
  }

  // -------------------------------------------------------------------------
  // Import
  // -------------------------------------------------------------------------

  async function renderStockImportPage() {
    const mounted =
      await mountShell(
        renderStockImport(),
        '#/stock/import'
      );

    if (!mounted) return;

    const dropzone = document.getElementById('stock-dropzone');
    const stage = document.getElementById('import-stage');

    const fileInput = document.createElement('input');

    fileInput.type = 'file';
    fileInput.className = 'file-input-hidden';
    fileInput.accept = '.xlsx,.xls,.csv,.tsv';

    document.body.appendChild(fileInput);

    async function handleFile(file) {
      if (!file) return;

      stage.innerHTML =
        '<div class="loading-inline">Reading the spreadsheet…</div>';

      try {

        const inspection = await API.uploadStockImport(file);

        stage.innerHTML = renderImportMapping(inspection);

        bindShellEvents();

        document.getElementById('btn-cancel-import').onclick =
          () => {
            stage.innerHTML = '';
          };

        document.getElementById('btn-commit-import').onclick =
          async () => {
            // The mapping sent is whatever the dropdowns currently say, not
            // the original guess.
            const mapping = {};

            document
              .querySelectorAll('.map-select')
              .forEach((select) => {
                mapping[select.dataset.column] = select.value || null;
              });

            const chosen = Object.values(mapping).filter(Boolean);

            if (!chosen.includes('description') && !chosen.includes('sku')) {
              toast(
                'Map at least a description or SKU column before importing.',
                'error'
              );
              return;
            }

            // Everything the person set is read here, while the mapping
            // screen is still on the page. Reading it after the stage is
            // replaced with the progress message finds nothing, and the import
            // silently runs with none of their choices.
            const updateOnly =
              document.getElementById('import-update-only')?.checked === true;

            const stockGroup =
              document.getElementById('import-stock-group')?.value.trim() || null;

            if (!chosen.includes('quantity') && !updateOnly) {
              const proceed =
                await confirmDialog({
                  title: 'No quantity column mapped',
                  body:
                    'Products will be created but no opening balances will be ' +
                    'recorded, so every product will start at zero. Continue?',
                  confirmLabel: 'Import without quantities',
                });

              if (!proceed) return;
            }

            stage.innerHTML =
              '<div class="loading-inline">Importing stock…</div>';

            try {

              const result =
                await API.commitStockImport(inspection.import_id, {
                  mapping,
                  update_only: updateOnly,
                  stock_group: stockGroup,
                });

              // Someone who has just imported stock wants to see all of it,
              // not whatever the products list was last filtered to.
              StockState.productFilters = {
                q: '', status: '', category: '', group: '', sort: '', order: '', page: 1,
              };

              stage.innerHTML = renderImportResult(result);

              bindShellEvents();

              toast(
                `${result.imported} product${result.imported === 1 ? '' : 's'} imported`,
                'success'
              );

            } catch (error) {
              stage.innerHTML = '';
              handleApiError(error, 'Unable to import the stock sheet.');
            }
          };

      } catch (error) {
        stage.innerHTML = '';
        handleApiError(error, 'Unable to read that spreadsheet.');
      }
    }

    if (dropzone) {
      ['dragenter', 'dragover'].forEach((type) => {
        dropzone.addEventListener(type, (event) => {
          event.preventDefault();
          event.stopPropagation();
          dropzone.classList.add('dragover');
        });
      });

      ['dragleave', 'drop'].forEach((type) => {
        dropzone.addEventListener(type, (event) => {
          event.preventDefault();
          event.stopPropagation();

          if (type === 'drop' || !dropzone.contains(event.relatedTarget)) {
            dropzone.classList.remove('dragover');
          }
        });
      });

      dropzone.addEventListener('drop', (event) => {
        handleFile(event.dataTransfer?.files?.[0]);
      });
    }

    fileInput.addEventListener('change', (event) => {
      handleFile(event.target.files?.[0]);
      fileInput.value = '';
    });

    const select = document.getElementById('btn-select-sheet');

    if (select) {
      select.onclick =
        (event) => {
          event.preventDefault();
          fileInput.click();
        };
    }
  }

  // -------------------------------------------------------------------------
  // Review queue
  // -------------------------------------------------------------------------

  async function renderStockReviewPage() {
    const mounted =
      await mountShell(
        '<div class="loading-inline">Loading stock review…</div>',
        '#/stock/review'
      );

    if (!mounted) return;

    try {

      const data = await API.listStockReview('pending');

      const content = document.querySelector('.content');

      if (!content) return;

      content.innerHTML = renderStockReview(data.items || []);

      bindShellEvents();

      content
        .querySelectorAll('[data-resolve]')
        .forEach((button) => {
          button.onclick =
            async () => {
              const id = button.dataset.resolve;

              const chosen =
                content.querySelector(`input[name="review-${id}"]:checked`);

              if (!chosen) {
                toast('Choose which product this line refers to.', 'error');
                return;
              }

              button.disabled = true;

              try {

                await API.resolveStockReview(id, { product_id: chosen.value });

                toast('Matched — stock updated and remembered', 'success');

                await renderStockReviewPage();

              } catch (error) {
                button.disabled = false;
                handleApiError(error, 'Unable to resolve that line.');
              }
            };
        });

      content
        .querySelectorAll('[data-dismiss]')
        .forEach((button) => {
          button.onclick =
            async () => {
              const confirmed =
                await confirmDialog({
                  title: 'Not a stock item?',
                  body:
                    'This line will be dismissed and no stock movement will be ' +
                    'recorded for it.',
                  confirmLabel: 'Dismiss line',
                });

              if (!confirmed) return;

              try {

                await API.resolveStockReview(button.dataset.dismiss, { dismiss: true });

                toast('Line dismissed', 'success');

                await renderStockReviewPage();

              } catch (error) {
                handleApiError(error, 'Unable to dismiss that line.');
              }
            };
        });

    } catch (error) {
      handleApiError(error, 'Unable to load the stock review queue.');
    }
  }


  // -------------------------------------------------------------------------
  // Stock sign-out sheets
  //
  // Upload → the server reads the document in the background → the browser
  // polls until it settles → a person resolves anything unclear → approving
  // posts the stock issue. Nothing here deducts stock on its own.
  // -------------------------------------------------------------------------

  const SETTLED_SHEET_STATUSES = [
    'READY',
    'REVIEW_REQUIRED',
    'EXTRACTED',
    'POSTED',
    'FAILED',
    'CANCELLED',
  ];

  async function renderStockSignOutPage() {
    const mounted =
      await mountShell(
        '<div class="loading-inline">Loading sign-out sheets…</div>',
        '#/stock/signout'
      );

    if (!mounted) return;

    try {

      const [metrics, list] =
        await Promise.all([
          API.stockSheetMetrics().catch(() => ({})),
          API.listStockSheets({ status: StockState.sheetFilters.status || '' }),
        ]);

      const content = document.querySelector('.content');

      if (!content) return;

      content.innerHTML =
        renderStockSignOut({
          metrics,
          sheets: list.sheets || [],
          filters: StockState.sheetFilters,
        });

      bindShellEvents();

      content
        .querySelectorAll('[data-sheet-status]')
        .forEach((chip) => {
          chip.onclick =
            () => {
              StockState.sheetFilters.status = chip.dataset.sheetStatus;
              renderStockSignOutPage();
            };
        });

      content
        .querySelectorAll('[data-sheet-id]')
        .forEach((row) => {
          row.onclick =
            () => {
              location.hash = `#/stock/signout/${row.dataset.sheetId}`;
            };
        });

      bindSheetUpload();

    } catch (error) {
      handleApiError(error, 'Unable to load the sign-out sheets.');
    }
  }

  /**
   * The upload zone. The file goes up, then the sheet's status is polled — the
   * page never blocks while the document is being read.
   */
  function bindSheetUpload() {
    const dropzone = document.getElementById('sheet-dropzone');
    const stage = document.getElementById('sheet-stage');

    if (!dropzone || !stage) return;

    const fileInput = document.createElement('input');

    fileInput.type = 'file';
    fileInput.className = 'file-input-hidden';
    fileInput.accept = '.pdf,.jpg,.jpeg,.png,.webp,.heic,.xlsx,.xls,.csv,.tsv';

    document.body.appendChild(fileInput);

    async function waitForSheet(sheetId) {
      // The stages are indicative — the server reports only its status, so the
      // bar advances while the document is being read and stops when it is.
      let stageIndex = 1;

      for (let attempt = 0; attempt < 90; attempt++) {

        const { sheet } = await API.getStockSheet(sheetId);

        if (SETTLED_SHEET_STATUSES.includes(sheet.status)) {
          return sheet;
        }

        stageIndex = Math.min(stageIndex + 1, SHEET_STAGES.length - 1);

        stage.innerHTML = renderSheetProcessing(stageIndex);

        await new Promise((resolve) => setTimeout(resolve, 1200));
      }

      return null;
    }

    async function upload(file, allowDuplicate) {
      if (!file) return;

      stage.innerHTML = renderSheetProcessing(0);

      let created;

      try {

        created =
          await API.uploadStockSheet(
            file,
            allowDuplicate ? { allow_duplicate: 'true' } : {}
          );

      } catch (error) {

        if (error.duplicate) {
          stage.innerHTML = '';

          const original = error.duplicateOf || {};

          const again =
            await confirmDialog({
              title: 'This stock sheet has already been processed',
              body:
                `The same document was uploaded as ${original.sheet_number || 'an earlier sheet'}` +
                `${original.status ? ` (${original.status.toLowerCase().replace(/_/g, ' ')})` : ''}. ` +
                'Uploading it again creates a second sheet, which would deduct ' +
                'the same stock twice. Open the original instead?',
              confirmLabel: 'Open the original',
            });

          if (again && original.id) {
            location.hash = `#/stock/signout/${original.id}`;
          }

          return;
        }

        stage.innerHTML = '';
        handleApiError(error, 'Unable to upload that sign-out sheet.');

        return;
      }

      try {

        const sheet = await waitForSheet(created.sheet.id);

        if (!sheet) {
          stage.innerHTML =
            renderSheetProcessing(
              0,
              'This is taking longer than expected. The sheet is still being ' +
              'read — open it from the list below in a moment.'
            );

          return;
        }

        if (sheet.status === 'FAILED') {
          stage.innerHTML = renderSheetProcessing(0, sheet.error_message);

          await refreshSheetList();

          return;
        }

        location.hash = `#/stock/signout/${sheet.id}`;

      } catch (error) {
        stage.innerHTML = '';
        handleApiError(error, 'Unable to read that sign-out sheet.');
      }
    }

    async function refreshSheetList() {
      try {
        const list =
          await API.listStockSheets({ status: StockState.sheetFilters.status || '' });

        const tbody = document.querySelector('.data-table tbody');

        if (tbody && list.sheets) {
          await renderStockSignOutPage();
        }
      } catch (error) {
        // The list is a convenience here; a failure to refresh it is not worth
        // interrupting the person who has just uploaded a sheet.
        console.warn('[SignOut] Could not refresh the sheet list:', error);
      }
    }

    ['dragenter', 'dragover'].forEach((type) => {
      dropzone.addEventListener(type, (event) => {
        event.preventDefault();
        event.stopPropagation();
        dropzone.classList.add('dragover');
      });
    });

    ['dragleave', 'drop'].forEach((type) => {
      dropzone.addEventListener(type, (event) => {
        event.preventDefault();
        event.stopPropagation();

        if (type === 'drop' || !dropzone.contains(event.relatedTarget)) {
          dropzone.classList.remove('dragover');
        }
      });
    });

    dropzone.addEventListener('drop', (event) => {
      upload(event.dataTransfer?.files?.[0], false);
    });

    fileInput.addEventListener('change', (event) => {
      upload(event.target.files?.[0], false);
      fileInput.value = '';
    });

    const select = document.getElementById('btn-select-sheet-doc');

    if (select) {
      select.onclick =
        (event) => {
          event.preventDefault();
          fileInput.click();
        };
    }
  }

  // The line whose correction panel is open, kept out of the DOM so a repaint
  // does not close it.
  let openSheetRow = null;

  async function renderStockSheetPage(id, opts = {}) {
    const mounted =
      await mountShell(
        '<div class="loading-inline">Loading sign-out sheet…</div>',
        '#/stock/signout'
      );

    if (!mounted) return;

    let sheet;

    try {
      const response = await API.getStockSheet(id);

      sheet = response.sheet;

    } catch (error) {
      handleApiError(error, 'Unable to load that sign-out sheet.');

      return;
    }

    await paintSheet(sheet, opts);

    // A sheet uploaded from another tab, or re-read after a retry, is still
    // being processed — keep looking until it settles.
    if (sheet.status === 'UPLOADED' || sheet.status === 'PROCESSING') {
      for (let attempt = 0; attempt < 90; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 1500));

        if (!location.hash.includes(id)) return;

        const { sheet: latest } = await API.getStockSheet(id);

        if (SETTLED_SHEET_STATUSES.includes(latest.status)) {
          await paintSheet(latest, opts);

          return;
        }
      }
    }
  }

  async function paintSheet(sheet, opts = {}) {
    const content = document.querySelector('.content');

    if (!content) return;

    content.innerHTML =
      renderStockSheetDetail(sheet, {
        ...opts,
        expandedRow: openSheetRow,
      });

    bindShellEvents();

    await mountSheetDocumentViewer(sheet);

    bindSheetHeader(sheet);
    bindSheetRows(sheet);
    bindSheetDecisions(sheet);
  }

  async function mountSheetDocumentViewer(sheet) {
    const stage = document.getElementById('doc-stage');

    if (!stage) return;

    let url;

    try {
      url = await API.fetchStockSheetBlob(sheet.id);
    } catch (error) {
      stage.innerHTML = '<div class="doc-empty">Could not load the document</div>';

      return;
    }

    if (!url) {
      stage.innerHTML = '<div class="doc-empty">No document on file</div>';

      return;
    }

    const isImage = stage.dataset.image === '1';

    if (isImage) {
      stage.innerHTML = `<img id="doc-image" src="${url}" alt="Sign-out sheet" />`;
    } else if (stage.dataset.pdf === '1') {
      stage.style.padding = '0';
      stage.innerHTML = `<iframe src="${url}" title="Sign-out sheet"></iframe>`;
    } else {
      // A spreadsheet has nothing to show, but it can still be downloaded — and
      // an empty 620px panel beside the fields helps nobody.
      stage.style.height = '180px';

      stage.innerHTML =
        `<div class="doc-empty">
           ${esc(sheet.filename || 'Spreadsheet')} — download it to open the original
         </div>`;
    }

    const image = document.getElementById('doc-image');
    const zoomLabel = document.getElementById('doc-zoom-label');

    let zoom = 1;
    let rotation = 0;

    function applyTransform() {
      if (!image) return;

      image.style.width = `${zoom * 100}%`;
      image.style.transform = `rotate(${rotation}deg)`;

      if (zoomLabel) zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
    }

    if (image) {
      image.style.width = '100%';
      applyTransform();
    }

    const zoomIn = document.getElementById('doc-zoom-in');
    const zoomOut = document.getElementById('doc-zoom-out');
    const rotate = document.getElementById('doc-rotate');
    const download = document.getElementById('doc-download');

    [zoomIn, zoomOut, rotate].forEach((button) => {
      if (button) button.disabled = !image;
    });

    if (zoomIn) {
      zoomIn.onclick = () => { zoom = Math.min(4, zoom + 0.25); applyTransform(); };
    }

    if (zoomOut) {
      zoomOut.onclick = () => { zoom = Math.max(0.5, zoom - 0.25); applyTransform(); };
    }

    if (rotate) {
      rotate.onclick = () => { rotation = (rotation + 90) % 360; applyTransform(); };
    }

    if (download) {
      download.onclick =
        () => {
          const link = document.createElement('a');

          link.href = url;
          link.download = sheet.filename || `${sheet.sheet_number}-document`;

          document.body.appendChild(link);
          link.click();
          link.remove();
        };
    }
  }

  function bindSheetHeader(sheet) {
    const save = document.getElementById('btn-save-sheet-header');

    if (!save) return;

    save.onclick =
      async () => {
        const fields = {};

        document
          .querySelectorAll('.sheet-header-field')
          .forEach((input) => {
            fields[input.dataset.field] = input.value.trim();
          });

        save.disabled = true;

        try {

          const response = await API.updateStockSheet(sheet.id, fields);

          toast('Sheet details saved', 'success');

          await paintSheet(response.sheet);

        } catch (error) {
          save.disabled = false;
          handleApiError(error, 'Unable to save the sheet details.');
        }
      };
  }

  function bindSheetRows(sheet) {
    const content = document.querySelector('.content');

    if (!content) return;

    content
      .querySelectorAll('[data-fix-row]')
      .forEach((button) => {
        button.onclick =
          async () => {
            const rowId = button.dataset.fixRow;

            openSheetRow = openSheetRow === rowId ? null : rowId;

            await paintSheet(sheet);
          };
      });

    if (!openSheetRow) return;

    const search = document.getElementById(`row-search-${openSheetRow}`);
    const results = document.getElementById(`row-results-${openSheetRow}`);

    if (search && results) {
      let timer = null;

      search.oninput =
        () => {
          clearTimeout(timer);

          const term = search.value.trim();

          if (term.length < 2) return;

          timer =
            setTimeout(
              async () => {
                try {

                  const found = await API.listProducts({ q: term, limit: 8 });

                  results.innerHTML =
                    (found.products || []).length
                      ? found.products.map((p) => `
                          <label class="intel-row" style="cursor:pointer;align-items:center;">
                            <input
                              type="radio"
                              name="sheet-row-${esc(openSheetRow)}"
                              value="${esc(p.id)}"
                              style="width:14px;height:14px;margin-right:2px;"
                            />
                            <div style="flex:1;min-width:0;">
                              <div class="title">${esc(p.description)}</div>
                              <div class="detail">
                                ${esc(p.sku || 'No SKU')}
                                ${p.bin_location ? ` · bin ${esc(p.bin_location)}` : ''}
                                · ${fmtQty(p.current_quantity)} in stock
                              </div>
                            </div>
                          </label>
                        `).join('')
                      : '<div class="cell-muted" style="font-size:13px;">No products match that search.</div>';

                } catch (error) {
                  console.warn('[SignOut] Product search failed:', error);
                }
              },
              250
            );
        };
    }

    const save = document.getElementById(`row-qty-${openSheetRow}`)
      ? content.querySelector(`[data-save-row="${openSheetRow}"]`)
      : null;

    if (save) {
      save.onclick =
        async () => {
          const rowId = save.dataset.saveRow;

          const chosen =
            content.querySelector(`input[name="sheet-row-${rowId}"]:checked`);

          const quantityInput = document.getElementById(`row-qty-${rowId}`);

          const fields = {};

          if (chosen) fields.product_id = chosen.value;

          if (quantityInput && quantityInput.value !== '') {
            const quantity = Number(quantityInput.value);

            if (!Number.isFinite(quantity) || quantity <= 0) {
              toast('Enter a quantity greater than zero.', 'error');

              return;
            }

            fields.quantity = quantity;
          }

          if (!Object.keys(fields).length) {
            toast('Choose a product or type a quantity first.', 'error');

            return;
          }

          save.disabled = true;

          try {

            const response = await API.updateStockSheetRow(sheet.id, rowId, fields);

            openSheetRow = null;

            toast('Line corrected', 'success');

            await paintSheet(response.sheet);

          } catch (error) {
            save.disabled = false;
            handleApiError(error, 'Unable to correct that line.');
          }
        };
    }

    content
      .querySelectorAll('[data-exclude-row]')
      .forEach((button) => {
        button.onclick =
          async () => {
            const rowId = button.dataset.excludeRow;

            const row = (sheet.rows || []).find((r) => r.id === rowId);

            const excluding = !row || row.status !== 'EXCLUDED';

            button.disabled = true;

            try {

              const response =
                await API.updateStockSheetRow(sheet.id, rowId, { excluded: excluding });

              openSheetRow = null;

              toast(
                excluding
                  ? 'Line excluded — no stock will move for it'
                  : 'Line put back on the sheet',
                'success'
              );

              await paintSheet(response.sheet);

            } catch (error) {
              button.disabled = false;
              handleApiError(error, 'Unable to update that line.');
            }
          };
      });
  }

  function bindSheetDecisions(sheet) {

    // A job number nobody has agreed to holds the sheet. Answer it here rather
    // than sending a person off to another screen to find out why Approve is
    // greyed out.
    document
      .querySelectorAll('[data-approve-job]')
      .forEach((button) => {
        button.onclick =
          async () => {
            button.disabled = true;

            try {

              const result = await API.approveJob(button.dataset.approveJob);

              toast(`${result.job.job_number} created.`, 'success');

              await renderStockSheetPage(sheet.id);

            } catch (error) {
              button.disabled = false;
              handleApiError(error, 'Unable to create the job.');
            }
          };
      });

    document
      .querySelectorAll('[data-reject-job-inline]')
      .forEach((button) => {
        button.onclick =
          async () => {
            button.disabled = true;

            try {

              await API.rejectJob(button.dataset.rejectJobInline, null);

              toast('No job created. The line stays unassigned.', 'success');

              await renderStockSheetPage(sheet.id);

            } catch (error) {
              button.disabled = false;
              handleApiError(error, 'Unable to record that decision.');
            }
          };
      });

    const approve = document.getElementById('btn-approve-sheet');

    if (approve) {
      approve.onclick =
        async () => {
          const included =
            (sheet.rows || []).filter((r) => r.status !== 'EXCLUDED');

          const units =
            included.reduce((sum, r) => sum + Number(r.quantity || 0), 0);

          const confirmed =
            await confirmDialog({
              title: 'Deduct this stock?',
              body:
                `${included.length} line${included.length === 1 ? '' : 's'} ` +
                `totalling ${units} unit${units === 1 ? '' : 's'} will be issued ` +
                `out of stock against ${sheet.sheet_number}. This posts to the ` +
                'ledger and cannot be undone except by an adjustment.',
              confirmLabel: 'Approve & deduct stock',
            });

          if (!confirmed) return;

          approve.disabled = true;

          try {

            const result = await API.approveStockSheet(sheet.id);

            toast(
              `Stock issue posted — ${result.transaction_count} movement${result.transaction_count === 1 ? '' : 's'}`,
              'success'
            );

            openSheetRow = null;

            await paintSheet(result.sheet);

          } catch (error) {
            approve.disabled = false;

            // A blocked posting is not a failure to report as an error: the
            // sheet says exactly which lines are in the way.
            handleApiError(error, 'This sheet could not be posted.');

            await renderStockSheetPage(sheet.id);
          }
        };
    }

    const cancel = document.getElementById('btn-cancel-sheet');

    if (cancel) {
      cancel.onclick =
        async () => {
          const confirmed =
            await confirmDialog({
              title: 'Cancel this sheet?',
              body:
                'The sheet stays on file for the record but will never post ' +
                'stock. No stock has moved for it.',
              confirmLabel: 'Cancel sheet',
              danger: true,
            });

          if (!confirmed) return;

          try {

            const result = await API.cancelStockSheet(sheet.id);

            toast('Sheet cancelled', 'success');

            await paintSheet(result.sheet);

          } catch (error) {
            handleApiError(error, 'Unable to cancel that sheet.');
          }
        };
    }

    const retry = document.getElementById('btn-retry-sheet');

    if (retry) {
      retry.onclick =
        async () => {
          retry.disabled = true;

          try {

            await API.retryStockSheet(sheet.id);

            toast('Reading the document again…', 'success');

            await renderStockSheetPage(sheet.id);

          } catch (error) {
            retry.disabled = false;
            handleApiError(error, 'Unable to read that sheet again.');
          }
        };
    }
  }

  // ===========================================================================
  // DOWNLOAD
  // ===========================================================================

  function triggerDownload(
    blob,
    filename
  ) {
    const url =
      URL.createObjectURL(
        blob
      );

    const a =
      document.createElement(
        'a'
      );

    a.href =
      url;

    a.download =
      filename;

    document.body.appendChild(
      a
    );

    a.click();

    a.remove();

    setTimeout(
      () => {
        URL.revokeObjectURL(
          url
        );
      },
      1000
    );
  }

  async function downloadAuthenticated(
    url,
    filenameFallback
  ) {
    const currentToken =
      hasFunction(
        API,
        'token'
      )
        ? API.token()
        : null;

    if (!currentToken) {
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
              `Bearer ${currentToken}`,
          },
        }
      );

    if (
      resp.status === 401 ||
      resp.status === 403
    ) {
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

  // ===========================================================================
  // HTML ESCAPE
  // ===========================================================================

  function escapeHtml(
    value
  ) {
    return String(
      value || ''
    )
      .replace(
        /&/g,
        '&amp;'
      )
      .replace(
        /</g,
        '&lt;'
      )
      .replace(
        />/g,
        '&gt;'
      )
      .replace(
        /"/g,
        '&quot;'
      )
      .replace(
        /'/g,
        '&#039;'
      );
  }

  // ===========================================================================
  // GLOBAL ERROR HANDLING
  // ===========================================================================

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

  window.addEventListener(
    'error',
    (event) => {
      console.error(
        '[InvoiceFlow] Frontend error:',
        event.error ||
        event.message
      );
    }
  );

  // ===========================================================================
  // JOBS
  //
  // A job number is the thread between an invoice and a stock issue. These
  // screens read the records those two systems already keep; they hold no data
  // of their own, so a change made anywhere else shows up here on reload.
  // ===========================================================================

  const JobState = {
    // What the last scan of existing records found. Held here so answering a
    // question does not wipe the summary that explains why it is being asked.
    scan: null,
    query: '',
    tab: 'invoices',
    openInvoice: null,
    jobId: null,
  };

  /**
   * Opens the document the invoice was captured from.
   *
   * The same stored file the invoice detail screen shows — fetched, not
   * copied, so a job never holds a second version of anything.
   */
  async function openInvoiceDocument(invoiceId) {
    try {

      const url = await API.fetchDocumentBlob(invoiceId);

      if (!url) {
        toast('No original document was stored with this invoice.', 'error');

        return;
      }

      const opened = window.open(url, '_blank');

      if (!opened) {
        toast('Allow pop-ups to view the original invoice.', 'error');
      }

    } catch (error) {
      handleApiError(error, 'Unable to open the original invoice.');
    }
  }

  async function renderJobsPageView() {
    const mounted =
      await mountShell(
        '<div class="loading-inline">Loading jobs…</div>',
        '#/jobs'
      );

    if (!mounted) return;

    try {

      const [list, approvals] =
        await Promise.all([
          API.listJobs({ q: JobState.query }),
          API.listJobApprovals('PENDING').catch(() => ({ approvals: [] })),
        ]);

      const content = document.querySelector('.content');

      if (!content) return;

      content.innerHTML =
        renderJobsPage({
          jobs: list.jobs || [],
          pending: approvals.approvals || [],
          query: JobState.query,
        });

      bindShellEvents();

      content
        .querySelectorAll('[data-job-id]')
        .forEach((row) => {
          row.onclick =
            () => {
              location.hash = `#/jobs/${row.dataset.jobId}`;
            };
        });

      const search = document.getElementById('job-search');

      if (search) {
        let timer = null;

        search.oninput =
          () => {
            clearTimeout(timer);

            timer =
              setTimeout(
                () => {
                  JobState.query = search.value.trim();
                  renderJobsPageView();
                },
                250
              );
          };
      }

    } catch (error) {
      handleApiError(error, 'Unable to load jobs.');
    }
  }

  async function renderJobDetailPage(jobId) {
    const mounted =
      await mountShell(
        '<div class="loading-inline">Loading job…</div>',
        '#/jobs'
      );

    if (!mounted) return;

    // A different job starts on its own first tab rather than inheriting the
    // last one looked at.
    if (JobState.jobId !== jobId) {
      JobState.jobId = jobId;
      JobState.tab = 'invoices';
      JobState.openInvoice = null;
    }

    try {

      const detail = await API.getJob(jobId);

      const content = document.querySelector('.content');

      if (!content) return;

      content.innerHTML =
        renderJobDetail(detail, {
          tab: JobState.tab,
          openInvoice: JobState.openInvoice,
        });

      bindShellEvents();

      content
        .querySelectorAll('[data-job-tab]')
        .forEach((tab) => {
          tab.onclick =
            () => {
              JobState.tab = tab.dataset.jobTab;
              renderJobDetailPage(jobId);
            };
        });

      // Opening one invoice closes the one before it: a job page is read one
      // record at a time.
      content
        .querySelectorAll('[data-invoice-toggle]')
        .forEach((head) => {
          head.onclick =
            () => {
              const id = head.dataset.invoiceToggle;

              JobState.openInvoice = JobState.openInvoice === id ? null : id;

              renderJobDetailPage(jobId);
            };
        });

      content
        .querySelectorAll('[data-open-invoice]')
        .forEach((button) => {
          button.onclick =
            (event) => {
              event.stopPropagation();
              location.hash = `#/invoices/${button.dataset.openInvoice}`;
            };
        });

      content
        .querySelectorAll('[data-view-document]')
        .forEach((button) => {
          button.onclick =
            (event) => {
              event.stopPropagation();
              openInvoiceDocument(button.dataset.viewDocument);
            };
        });

      content
        .querySelectorAll('[data-open-sheet]')
        .forEach((button) => {
          button.onclick =
            () => {
              location.hash = `#/stock/signout/${button.dataset.openSheet}`;
            };
        });

      content
        .querySelectorAll('[data-open-product]')
        .forEach((button) => {
          button.onclick =
            () => {
              location.hash = `#/stock/products/${button.dataset.openProduct}`;
            };
        });

    } catch (error) {

      if (handleApiError(error, 'Unable to load the job.')) return;

      location.hash = '#/jobs';
    }
  }

  /**
   * The approval gate.
   *
   * Nothing on this screen has happened yet. Each card is a job number found on
   * a document, and the job it names does not exist until somebody presses the
   * button.
   */
  async function renderJobApprovalsPage() {
    const mounted =
      await mountShell(
        '<div class="loading-inline">Loading job approvals…</div>',
        '#/jobs/approvals'
      );

    if (!mounted) return;

    try {

      const [approvals, list] =
        await Promise.all([
          API.listJobApprovals('ALL'),
          API.listJobs({ limit: 500 }),
        ]);

      const content = document.querySelector('.content');

      if (!content) return;

      content.innerHTML =
        renderJobApprovals({
          approvals: approvals.approvals || [],
          jobs: list.jobs || [],
          scan: JobState.scan,
        });

      bindShellEvents();

      // Reading the old records is two steps on purpose: see what is there,
      // then decide. The first step changes nothing at all.
      const scan = document.getElementById('btn-scan-existing');

      if (scan) {
        scan.onclick =
          async () => {
            scan.disabled = true;
            scan.textContent = 'Reading…';

            try {

              JobState.scan = await API.backfillJobs(true);

              await renderJobApprovalsPage();

            } catch (error) {
              scan.disabled = false;
              scan.textContent = 'Scan existing records';
              handleApiError(error, 'Unable to read the existing records.');
            }
          };
      }

      const runScan = document.getElementById('btn-run-backfill');

      if (runScan) {
        runScan.onclick =
          async () => {
            runScan.disabled = true;
            runScan.textContent = 'Working…';

            try {

              const result = await API.backfillJobs(false);

              JobState.scan = result;

              toast(
                `${result.counts.invoices_linked + result.counts.movements_linked} records linked; ` +
                `${result.unknown_jobs.length} job number${result.unknown_jobs.length === 1 ? '' : 's'} to answer.`,
                'success'
              );

              await renderJobApprovalsPage();

            } catch (error) {
              runScan.disabled = false;
              runScan.textContent = 'Link them and ask about the rest';
              handleApiError(error, 'Unable to read the existing records.');
            }
          };
      }

      const dismiss = document.getElementById('btn-dismiss-scan');

      if (dismiss) {
        dismiss.onclick =
          async () => {
            JobState.scan = null;

            await renderJobApprovalsPage();
          };
      }

      content
        .querySelectorAll('[data-approve-job]')
        .forEach((button) => {
          button.onclick =
            async () => {
              button.disabled = true;

              try {

                const result = await API.approveJob(button.dataset.approveJob);

                const settled = result.also_settled || 0;

                toast(
                  (result.created
                    ? `${result.job.job_number} created.`
                    : `${result.job.job_number} already existed — attached to it.`) +
                  (settled
                    ? ` ${settled + 1} records attached.`
                    : ''),
                  'success'
                );

                await renderJobApprovalsPage();

              } catch (error) {
                button.disabled = false;
                handleApiError(error, 'Unable to create the job.');
              }
            };
        });

      // Rejecting is not one click: refusing the new job still leaves a
      // document that has to go somewhere.
      content
        .querySelectorAll('[data-reject-job]')
        .forEach((button) => {
          button.onclick =
            () => {
              const panel =
                content.querySelector(
                  `[data-reject-panel="${button.dataset.rejectJob}"]`
                );

              if (panel) panel.hidden = false;
            };
        });

      content
        .querySelectorAll('[data-cancel-reject]')
        .forEach((button) => {
          button.onclick =
            () => {
              const panel =
                content.querySelector(
                  `[data-reject-panel="${button.dataset.cancelReject}"]`
                );

              if (panel) panel.hidden = true;
            };
        });

      const refuse = async (approvalId, jobId, message) => {
        try {

          await API.rejectJob(approvalId, jobId || null);

          toast(message, 'success');

          await renderJobApprovalsPage();

        } catch (error) {
          handleApiError(error, 'Unable to record that decision.');
        }
      };

      content
        .querySelectorAll('[data-confirm-assign]')
        .forEach((button) => {
          button.onclick =
            () => {
              const id = button.dataset.confirmAssign;

              const select =
                content.querySelector(`[data-assign-job="${id}"]`);

              const jobId = select ? select.value : '';

              if (!jobId) {
                toast('Choose the job it belongs to first.', 'error');

                return;
              }

              refuse(id, jobId, 'Assigned to the existing job.');
            };
        });

      content
        .querySelectorAll('[data-leave-unassigned]')
        .forEach((button) => {
          button.onclick =
            () =>
              refuse(
                button.dataset.leaveUnassigned,
                null,
                'Left unassigned. No job was created.'
              );
        });

    } catch (error) {
      handleApiError(error, 'Unable to load job approvals.');
    }
  }

  // ===========================================================================
  // EXPOSE GLOBAL STATE
  // ===========================================================================

  window.AppState =
    AppState;

   window.InvoiceFlowApp = {
    router,
    logout,
    toast,
    handleSessionExpired,
    runCapture,
    runBulkCapture,
  };

  // ===========================================================================
  // ROUTER INITIALIZATION
  // ===========================================================================

  window.addEventListener(
    'hashchange',
    () => {
      router();
    }
  );

  window.addEventListener(
    'load',
    () => {
      router();
    }
  );

  console.log(
    '[InvoiceFlow] Application module loaded successfully.'
  );

  // Start the application immediately.
  router();

})();
