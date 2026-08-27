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

    '#/reports':
      renderReportsPage,

    '#/settings':
      renderSettingsPage,
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

      const response =
        await API.listInvoices({
          status:
            'exception',
        });

      exceptionsCount =
        Array.isArray(
          response?.invoices
        )
          ? response.invoices.length
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

    root.innerHTML =
      renderShell(
        activeRoute,
        AppState.user,
        exceptionsCount,
        contentHtml
      );

    bindShellEvents();

    return true;
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

    const fab =
      document.getElementById(
        'fab-capture'
      );

    if (fab) {
      fab.onclick =
        () => {
          location.hash =
            '#/capture';
        };
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
      'modal-backdrop mobile-nav-backdrop';

    backdrop.style.justifyContent =
      'flex-start';

    backdrop.style.alignItems =
      'stretch';

    backdrop.style.padding =
      '0';

    const items = [
      ['#/dashboard', 'Dashboard'],
      ['#/invoices', 'Invoices'],
      ['#/capture', 'Capture Invoice'],
      ['#/suppliers', 'Suppliers'],
      ['#/exceptions', 'Exceptions'],
      ['#/reports', 'Reports'],
      ['#/settings', 'Settings'],
    ];

    const xIcon =
      window.Icons &&
      window.Icons.x
        ? window.Icons.x
        : '×';

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
            ${xIcon}
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
          data
        );

      bindShellEvents();

      document
        .querySelectorAll(
          '#recent-table tbody tr[data-id]'
        )
        .forEach(
          (tr) => {
            tr.onclick =
              () => {
                location.hash =
                  `#/invoices/${tr.dataset.id}`;
              };
          }
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

  async function renderCapturePage() {
    const mounted =
      await mountShell(
        renderCapture(),
        '#/capture'
      );

    if (!mounted) {
      return;
    }

    // =========================================================================
    // TAKE PHOTO
    // =========================================================================

    const takePhotoBtn =
      document.getElementById(
        'btn-take-photo'
      );

    if (takePhotoBtn) {
      takePhotoBtn.onclick =
        () => {
          if (
            typeof window.Camera ===
              'undefined' ||
            typeof window.Camera.open !==
              'function'
          ) {
            toast(
              'Camera is not available on this device.',
              'error'
            );

            return;
          }

          Camera.open({
            onCapture: (
              file
            ) => {
              if (file) {
                runCapture(
                  file
                );
              }
            },

            onCancel: () => {},
          });
        };
    }

    // =========================================================================
    // BULK UPLOAD
    // =========================================================================
    //
    // This uses the standard browser file input.
    //
    // IMPORTANT:
    //
    // The previous implementation had:
    //
    //     fileInput.multiple = false;
    //
    // and then processed only:
    //
    //     files[0]
    //
    // This version supports multiple invoices.
    //
    // The selected files are processed one at a time through the existing:
    //
    //     API.captureInvoice(file)
    //
    // endpoint.
    //
    // Supported:
    //
    // - PDF
    // - JPG
    // - JPEG
    // - PNG
    // - WEBP
    // - GIF
    // - BMP
    // - HEIC
    // - HEIF
    //
    // =========================================================================

    const uploadBtn =
      document.getElementById(
        'btn-upload-invoice'
      );

    if (uploadBtn) {

      // -----------------------------------------------------------------------
      // Prevent duplicate hidden inputs if this route gets rendered repeatedly.
      // -----------------------------------------------------------------------

      const existingInput =
        document.getElementById(
          'invoice-file-input'
        );

      if (existingInput) {
        existingInput.remove();
      }

      // -----------------------------------------------------------------------
      // Create native browser file input.
      // -----------------------------------------------------------------------

      const fileInput =
        document.createElement(
          'input'
        );

      fileInput.type =
        'file';

      fileInput.id =
        'invoice-file-input';

      fileInput.name =
        'invoice';

      fileInput.accept =
        'image/*,.pdf,application/pdf';

      // -----------------------------------------------------------------------
      // IMPORTANT:
      // Allow multiple files to be selected.
      // -----------------------------------------------------------------------

      fileInput.multiple =
        true;

      fileInput.style.position =
        'fixed';

      fileInput.style.left =
        '-9999px';

      fileInput.style.top =
        '-9999px';

      fileInput.style.width =
        '1px';

      fileInput.style.height =
        '1px';

      fileInput.style.opacity =
        '0';

      fileInput.setAttribute(
        'aria-hidden',
        'true'
      );

      document.body.appendChild(
        fileInput
      );

      // -----------------------------------------------------------------------
      // File validation helper.
      // -----------------------------------------------------------------------

      function validateInvoiceFile(
        file
      ) {
        if (!file) {
          return {
            valid: false,
            message:
              'No file was selected.',
          };
        }

        const fileName =
          String(
            file.name ||
            ''
          ).toLowerCase();

        const isPdf =
          file.type ===
            'application/pdf' ||
          fileName.endsWith(
            '.pdf'
          );

        const isImage =
          file.type.startsWith(
            'image/'
          ) ||
          /\.(jpg|jpeg|png|webp|gif|bmp|heic|heif)$/i.test(
            fileName
          );

        if (
          !isPdf &&
          !isImage
        ) {
          return {
            valid: false,
            message:
              'Please select a PDF or image invoice.',
          };
        }

        // ---------------------------------------------------------------------
        // 25 MB per-file frontend limit.
        // ---------------------------------------------------------------------

        const maxFileSize =
          25 *
          1024 *
          1024;

        if (
          file.size >
          maxFileSize
        ) {
          return {
            valid: false,
            message:
              'The invoice file is too large. Maximum size is 25 MB.',
          };
        }

        if (
          file.size <= 0
        ) {
          return {
            valid: false,
            message:
              'The selected file is empty.',
          };
        }

        return {
          valid: true,
        };
      }

      // -----------------------------------------------------------------------
      // When the user selects one or more files.
      // -----------------------------------------------------------------------

      fileInput.addEventListener(
        'change',
        async (event) => {
          try {
            const fileList =
              event.target.files;

            if (
              !fileList ||
              !fileList.length
            ) {
              console.log(
                '[Capture] File picker closed without selecting files.'
              );

              return;
            }

            const files =
              Array.from(
                fileList
              );

            console.log(
              '[Capture] Invoice files selected:',
              files.map(
                (file) => ({
                  name:
                    file.name,

                  type:
                    file.type,

                  size:
                    file.size,

                  lastModified:
                    file.lastModified,
                })
              )
            );      

            // -----------------------------------------------------------------
            // Validate every selected file before processing anything.
            // -----------------------------------------------------------------

            const validFiles = [];

            const invalidFiles = [];

            files.forEach(
              (file) => {
                const validation =
                  validateInvoiceFile(
                    file
                  );

                if (
                  validation.valid
                ) {
                  validFiles.push(
                    file
                  );
                } else {
                  invalidFiles.push({
                    file,
                    message:
                      validation.message,
                  });
                }
              }
            );

            // -----------------------------------------------------------------
            // Tell the user about invalid files.
            // -----------------------------------------------------------------

            if (
              invalidFiles.length
            ) {
              console.warn(
                '[Capture] Invalid invoice files:',
                invalidFiles
              );

              const invalidNames =
                invalidFiles
                  .map(
                    (item) =>
                      item.file.name
                  )
                  .slice(
                    0,
                    3
                  );

              const suffix =
                invalidFiles.length > 3
                  ? ` and ${invalidFiles.length - 3} more`
                  : '';

              toast(
                `${invalidFiles.length} file${
                  invalidFiles.length === 1
                    ? ''
                    : 's'
                } skipped: ${
                  invalidNames.join(
                    ', '
                  )
                }${suffix}`,
                'error'
              );
            }

            if (
              !validFiles.length
            ) {
              toast(
                'No valid invoice files were selected.',
                'error'
              );

              return;
            }

            // -----------------------------------------------------------------
            // Single file:
            //
            // Keep the original behaviour and send directly into the
            // single-invoice processing flow.
            // -----------------------------------------------------------------

            if (
              validFiles.length === 1
            ) {
              await runCapture(
                validFiles[0]
              );

              return;
            }

            // -----------------------------------------------------------------
            // Multiple files:
            //
            // Process them sequentially.
            // -----------------------------------------------------------------

            await runBulkCapture(
              validFiles
            );

          } catch (error) {
            console.error(
              '[Capture] Error handling selected invoice files:',
              error
            );

            toast(
              error?.message ||
              'Unable to read the selected invoice files.',
              'error'
            );

          } finally {
            // -----------------------------------------------------------------
            // Clear the input.
            //
            // This allows the user to select the exact same files again.
            // -----------------------------------------------------------------

            fileInput.value =
              '';
          }
        }
      );

      // -----------------------------------------------------------------------
      // Open the browser's native file picker.
      // -----------------------------------------------------------------------

      uploadBtn.onclick =
        (event) => {
          event.preventDefault();

          console.log(
            '[Capture] Opening browser file picker for bulk invoice upload...'
          );

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
      Math.max(
        Number(total) || 0,
        1
      );

    const safeCompleted =
      Math.min(
        Math.max(
          Number(completed) || 0,
          0
        ),
        safeTotal
      );

    const percentage =
      Math.round(
        (
          safeCompleted /
          safeTotal
        ) *
        100
      );

    const currentFileName =
      currentFile?.name ||
      '';

    const failedResults =
      Array.isArray(results)
        ? results.filter(
            (result) =>
              !result.success
          )
        : [];

    const successResults =
      Array.isArray(results)
        ? results.filter(
            (result) =>
              result.success
          )
        : [];

    root.innerHTML = `
      <div
        style="
          min-height:100vh;
          display:flex;
          align-items:center;
          justify-content:center;
          padding:32px 20px;
          background:#f6f8fb;
          box-sizing:border-box;
          font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
        "
      >

        <div
          style="
            width:100%;
            max-width:680px;
            background:#fff;
            border:1px solid #e4e7ec;
            border-radius:20px;
            padding:32px;
            box-sizing:border-box;
            box-shadow:0 20px 60px rgba(16,24,40,.08);
          "
        >

          <div
            style="
              display:flex;
              align-items:flex-start;
              justify-content:space-between;
              gap:20px;
              margin-bottom:28px;
            "
          >

            <div>

              <div
                style="
                  font-size:12px;
                  font-weight:800;
                  letter-spacing:.12em;
                  text-transform:uppercase;
                  color:#667085;
                  margin-bottom:8px;
                "
              >
                InvoiceFlow
              </div>

              <h1
                style="
                  margin:0;
                  font-size:28px;
                  line-height:1.15;
                  color:#101828;
                "
              >
                Processing invoices
              </h1>

              <p
                style="
                  margin:8px 0 0;
                  color:#667085;
                  font-size:15px;
                "
              >
                ${escapeHtml(statusMessage || 'Processing...')}
              </p>

            </div>

            <div
              style="
                min-width:76px;
                text-align:right;
              "
            >
              <div
                style="
                  font-size:26px;
                  font-weight:800;
                  color:#101828;
                "
              >
                ${percentage}%
              </div>

              <div
                style="
                  font-size:12px;
                  color:#667085;
                "
              >
                ${safeCompleted} / ${safeTotal}
              </div>
            </div>

          </div>

          <div
            style="
              width:100%;
              height:10px;
              background:#eaecf0;
              border-radius:999px;
              overflow:hidden;
              margin-bottom:24px;
            "
          >
            <div
              style="
                width:${percentage}%;
                height:100%;
                background:#111827;
                border-radius:999px;
                transition:width .3s ease;
              "
            ></div>
          </div>

          ${
            currentFileName
              ? `
                <div
                  style="
                    padding:16px;
                    border:1px solid #eaecf0;
                    border-radius:14px;
                    background:#f9fafb;
                    margin-bottom:20px;
                  "
                >
                  <div
                    style="
                      font-size:12px;
                      font-weight:700;
                      color:#667085;
                      margin-bottom:5px;
                    "
                  >
                    CURRENT INVOICE
                  </div>

                  <div
                    style="
                      font-size:15px;
                      font-weight:700;
                      color:#101828;
                      word-break:break-word;
                    "
                  >
                    ${escapeHtml(currentFileName)}
                  </div>
                </div>
              `
              : ''
          }

          <div
            style="
              display:grid;
              grid-template-columns:repeat(3,minmax(0,1fr));
              gap:12px;
              margin-bottom:24px;
            "
          >

            <div
              style="
                padding:16px;
                border:1px solid #eaecf0;
                border-radius:14px;
              "
            >
              <div
                style="
                  font-size:12px;
                  color:#667085;
                  margin-bottom:4px;
                "
              >
                Total
              </div>

              <div
                style="
                  font-size:22px;
                  font-weight:800;
                  color:#101828;
                "
              >
                ${safeTotal}
              </div>
            </div>

            <div
              style="
                padding:16px;
                border:1px solid #eaecf0;
                border-radius:14px;
              "
            >
              <div
                style="
                  font-size:12px;
                  color:#667085;
                  margin-bottom:4px;
                "
              >
                Successful
              </div>

              <div
                style="
                  font-size:22px;
                  font-weight:800;
                  color:#101828;
                "
              >
                ${Number(successful) || 0}
              </div>
            </div>

            <div
              style="
                padding:16px;
                border:1px solid #eaecf0;
                border-radius:14px;
              "
            >
              <div
                style="
                  font-size:12px;
                  color:#667085;
                  margin-bottom:4px;
                "
              >
                Failed
              </div>

              <div
                style="
                  font-size:22px;
                  font-weight:800;
                  color:#101828;
                "
              >
                ${Number(failed) || 0}
              </div>
            </div>

          </div>

          ${
            failedResults.length
              ? `
                <div
                  style="
                    margin-top:8px;
                    padding:16px;
                    border-radius:14px;
                    background:#fff7f7;
                    border:1px solid #fecdca;
                  "
                >

                  <div
                    style="
                      font-size:13px;
                      font-weight:800;
                      color:#b42318;
                      margin-bottom:10px;
                    "
                  >
                    Failed invoices
                  </div>

                  <div
                    style="
                      display:flex;
                      flex-direction:column;
                      gap:8px;
                    "
                  >
                    ${failedResults
                      .slice(
                        0,
                        8
                      )
                      .map(
                        (result) => `
                          <div
                            style="
                              font-size:13px;
                              color:#7a271a;
                              word-break:break-word;
                            "
                          >
                            <strong>
                              ${escapeHtml(
                                result.fileName
                              )}
                            </strong>
                            — 
                            ${escapeHtml(
                              result.error
                            )}
                          </div>
                        `
                      )
                      .join('')}
                  </div>

                  ${
                    failedResults.length > 8
                      ? `
                        <div
                          style="
                            margin-top:8px;
                            font-size:12px;
                            color:#b42318;
                          "
                        >
                          ${
                            failedResults.length - 8
                          } more failed invoice${
                            failedResults.length - 8 === 1
                              ? ''
                              : 's'
                          }.
                        </div>
                      `
                      : ''
                  }

                </div>
              `
              : ''
          }

          ${
            successResults.length &&
            safeCompleted === safeTotal
              ? `
                <div
                  style="
                    margin-top:16px;
                    padding:14px 16px;
                    border-radius:12px;
                    background:#f6fef9;
                    border:1px solid #abefc6;
                    color:#067647;
                    font-size:14px;
                    font-weight:700;
                  "
                >
                  Batch complete. Returning to invoices...
                </div>
              `
              : ''
          }

        </div>

      </div>
    `;
  }

 
  // ===========================================================================
  // SINGLE INVOICE PROCESSING
  // ===========================================================================

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

    content.innerHTML =
      renderReview(
        invoice,
        {
          warning,
        }
      );

    bindShellEvents();

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
        if (
          isAuthError(error)
        ) {
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

  function confirmReject(
    id
  ) {
    const backdrop =
      document.createElement(
        'div'
      );

    backdrop.className =
      'modal-backdrop';

    backdrop.innerHTML = `
      <div class="modal-card">

        <h3>
          Reject this invoice?
        </h3>

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
      cancelBtn.onclick =
        () =>
          backdrop.remove();
    }

    const confirmBtn =
      backdrop.querySelector(
        '#confirm-reject'
      );

    if (confirmBtn) {
      confirmBtn.onclick =
        async () => {
          confirmBtn.disabled =
            true;

          confirmBtn.textContent =
            'Rejecting…';

          try {
            const response =
              await API.rejectInvoice(
                id
              );

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

            confirmBtn.disabled =
              false;

            confirmBtn.textContent =
              'Reject Invoice';
          }
        };
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
      Array.isArray(
        response?.invoices
      )
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

    if (!content) {
      return;
    }

    content.innerHTML =
      renderInvoicesList(
        finalList,
        filters,
        title ||
          'Invoices'
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
    document
      .querySelectorAll(
        'table.data-table tbody tr[data-id]'
      )
      .forEach(
        (tr) => {
          tr.onclick =
            () => {
              location.hash =
                `#/invoices/${tr.dataset.id}`;
            };
        }
      );

    const searchInput =
      document.getElementById(
        'invoice-search'
      );

    if (searchInput) {
      let timer;

      searchInput.oninput =
        () => {
          clearTimeout(
            timer
          );

          timer =
            setTimeout(
              () => {
                AppState.invoiceFilters.q =
                  searchInput.value;

                loadAndPaintInvoices(
                  AppState.invoiceFilters,
                  title,
                  isExceptionView
                );
              },
              300
            );
        };
    }

    document
      .querySelectorAll(
        '.chip[data-status]'
      )
      .forEach(
        (chip) => {
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
        }
      );

    const exportAllBtn =
      document.getElementById(
        'btn-export-all'
      );

    if (exportAllBtn) {
      exportAllBtn.onclick =
        async () => {
          exportAllBtn.disabled =
            true;

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
            exportAllBtn.disabled =
              false;
          }
        };
    }

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

          exportSelectedBtn.disabled =
            true;

          try {
            const response =
              await API.exportSelected(
                ids
              );

            if (
              response instanceof
              Response
            ) {
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

            } else if (
              response?.url
            ) {
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
            exportSelectedBtn.disabled =
              false;
          }
        };
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

    } catch (error) {
      handleApiError(
        error,
        'Unable to load suppliers.'
      );
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
