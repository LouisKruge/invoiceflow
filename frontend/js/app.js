// =============================================================================
// InvoiceFlow — Frontend Application
// =============================================================================
// Browser-side SPA router, state management and event wiring.
// IMPORTANT:
// - This file runs in the browser.
// - Do NOT use require(), dotenv, express, pg, fs, path, or other Node modules.
// =============================================================================

(() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // APP STATE
  // ---------------------------------------------------------------------------

  const AppState = {
    user: null,
    health: null,

    setupRequired: false,
    setupChecked: false,

    invoiceFilters: {
      q: '',
      status: 'all',
    },

    selectedIds: new Set(),

    booting: false,
    sessionError: null,
  };

  const root = document.getElementById('app');

  if (!root) {
    console.error(
      '[InvoiceFlow] Fatal: #app element was not found in index.html.'
    );
    return;
  }

  // ---------------------------------------------------------------------------
  // SAFETY HELPERS
  // ---------------------------------------------------------------------------

  function hasAPI() {
    return (
      typeof window.API !== 'undefined' &&
      window.API !== null
    );
  }

  function hasFunction(object, name) {
    return (
      object &&
      typeof object[name] === 'function'
    );
  }

  // ---------------------------------------------------------------------------
  // TOASTS
  // ---------------------------------------------------------------------------

  function toast(message, type = '') {
    const container =
      document.getElementById('toast-root');

    if (!container) {
      console[type === 'error' ? 'error' : 'log'](
        '[InvoiceFlow]',
        message
      );
      return;
    }

    const el =
      document.createElement('div');

    el.className =
      `toast ${type}`;

    el.textContent =
      String(message || '');

    container.appendChild(el);

    setTimeout(() => {
      if (el.parentNode) {
        el.remove();
      }
    }, 3800);
  }

  // ---------------------------------------------------------------------------
  // AUTHENTICATION
  // ---------------------------------------------------------------------------

  function setLoggedIn(token, user) {
    if (!token) {
      throw new Error(
        'Authentication token was not returned by the server.'
      );
    }

    if (
      !hasAPI() ||
      !hasFunction(API, 'setToken')
    ) {
      throw new Error(
        'Authentication system is not available.'
      );
    }

    API.setToken(token);

    AppState.user =
      user || null;

    AppState.sessionError =
      null;
  }

  function logout(showMessage = false) {
    if (
      hasAPI() &&
      hasFunction(API, 'clearToken')
    ) {
      API.clearToken();
    }

    AppState.user = null;
    AppState.health = null;
    AppState.selectedIds.clear();
    AppState.sessionError = null;

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
      hasFunction(API, 'clearToken')
    ) {
      API.clearToken();
    }

    AppState.user = null;
    AppState.health = null;
    AppState.selectedIds.clear();
    AppState.sessionError =
      message;

    if (
      location.hash !== '#/login'
    ) {
      location.hash =
        '#/login';
    } else {
      renderLoginPage(message);
    }
  }

  function isAuthError(error) {
    return (
      error &&
      (
        error.status === 401 ||
        error.status === 403
      )
    );
  }

  // ---------------------------------------------------------------------------
  // GENERIC API ERROR HANDLING
  // ---------------------------------------------------------------------------

  function handleApiError(
    error,
    fallbackMessage = 'Something went wrong.'
  ) {
    console.error(
      '[InvoiceFlow]',
      error
    );

    if (isAuthError(error)) {
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

  // ---------------------------------------------------------------------------
  // SETUP STATUS
  // ---------------------------------------------------------------------------

  async function checkSetupStatus() {
    if (
      !hasAPI() ||
      !hasFunction(API, 'setupStatus')
    ) {
      console.warn(
        '[InvoiceFlow] setupStatus() is unavailable. Assuming normal login.'
      );

      AppState.setupRequired = false;
      AppState.setupChecked = true;

      return false;
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
        {
          setupRequired:
            AppState.setupRequired,
        }
      );

      return AppState.setupRequired;

    } catch (error) {
      console.error(
        '[InvoiceFlow] Failed to check setup status:',
        error
      );

      AppState.setupRequired = false;
      AppState.setupChecked = true;

      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // ROUTES
  // ---------------------------------------------------------------------------

  const routes = {
    '#/login':
      renderLoginPage,

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

  let routerRunning = false;

  async function router() {
    if (routerRunning) {
      return;
    }

    routerRunning = true;

    try {
      if (!hasAPI()) {
        console.error(
          '[InvoiceFlow] API object is not available.'
        );

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
                Please refresh the page or contact the administrator.
              </p>
            </div>
          </div>
        `;

        return;
      }

      let hash =
        location.hash ||
        '#/dashboard';

      const invoiceMatch =
        hash.match(
          /^#\/invoices\/(.+)$/
        );

      const reviewMatch =
        hash.match(
          /^#\/review\/(.+)$/
        );

      const token =
        hasFunction(API, 'token')
          ? API.token()
          : null;

      // ---------------------------------------------------------------
      // No session
      // ---------------------------------------------------------------

      if (
        !token &&
        hash !== '#/login'
      ) {
        location.hash =
          '#/login';

        return;
      }

      // ---------------------------------------------------------------
      // Already authenticated
      // ---------------------------------------------------------------

      if (
        token &&
        hash === '#/login'
      ) {
        location.hash =
          '#/dashboard';

        return;
      }

      // ---------------------------------------------------------------
      // Load authenticated user
      // ---------------------------------------------------------------

      if (
        token &&
        !AppState.user
      ) {
        try {
          if (
            !hasFunction(API, 'me')
          ) {
            throw new Error(
              'Authentication API is unavailable.'
            );
          }

          const response =
            await API.me();

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

        } catch (error) {
          if (isAuthError(error)) {
            handleSessionExpired(
              'Your session is no longer valid. Please sign in again.'
            );
          } else {
            console.error(
              '[Router] Failed to load authenticated user:',
              error
            );

            toast(
              error?.message ||
              'Unable to verify your session.',
              'error'
            );
          }

          return;
        }
      }

      // ---------------------------------------------------------------
      // Backend health
      // ---------------------------------------------------------------

      if (
        token &&
        !AppState.health
      ) {
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
          }
        } catch (error) {
          console.warn(
            '[Router] Health check failed:',
            error
          );
        }
      }

      // ---------------------------------------------------------------
      // Invoice detail
      // ---------------------------------------------------------------

      if (invoiceMatch) {
        await renderInvoiceDetailPage(
          invoiceMatch[1]
        );

        return;
      }

      // ---------------------------------------------------------------
      // Review
      // ---------------------------------------------------------------

      if (reviewMatch) {
        await renderReviewPage(
          reviewMatch[1]
        );

        return;
      }

      // ---------------------------------------------------------------
      // Standard route
      // ---------------------------------------------------------------

      const handler =
        routes[hash] ||
        renderDashboardPage;

      await handler();

    } catch (error) {
      console.error(
        '[InvoiceFlow] Router error:',
        error
      );

      toast(
        error?.message ||
        'Unable to load this page.',
        'error'
      );

    } finally {
      routerRunning = false;
    }
  }

  // ---------------------------------------------------------------------------
  // ROUTER EVENTS
  // ---------------------------------------------------------------------------

  window.addEventListener(
    'hashchange',
    router
  );

  window.addEventListener(
    'DOMContentLoaded',
    router
  );

  // ---------------------------------------------------------------------------
  // APPLICATION SHELL
  // ---------------------------------------------------------------------------

  async function mountShell(
    contentHtml,
    activeRoute
  ) {
    let exceptionsCount = 0;

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
          status: 'exception',
        });

      exceptionsCount =
        Array.isArray(
          response?.invoices
        )
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
      location.hash =
        '#/login';

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
      .forEach((el) => {
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
      });

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

  // ---------------------------------------------------------------------------
  // MOBILE NAVIGATION
  // ---------------------------------------------------------------------------

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
            aria-label="Close navigation"
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
      .forEach((el) => {
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
      });
  }

  // ===========================================================================
  // AUTH UI
  // ===========================================================================
  //
  // We render the authentication screen directly here rather than depending
  // on renderLogin(). This guarantees that the login/signup flow works even
  // if the old UI renderer does not know about registration yet.
  //
  // ===========================================================================

  function renderAuthPage(
    message = null
  ) {
    const setupRequired =
      AppState.setupRequired === true;

    const errorHtml =
      message
        ? `
          <div
            class="auth-error"
            style="
              margin-bottom:18px;
              padding:12px 14px;
              border-radius:10px;
            "
          >
            ${escapeHtml(message)}
          </div>
        `
        : '';

    root.innerHTML = `
      <div
        style="
          min-height:100vh;
          display:flex;
          align-items:center;
          justify-content:center;
          padding:24px;
          background:var(--bg,#f6f7f9);
        "
      >
        <div
          class="auth-card"
          style="
            width:100%;
            max-width:460px;
            background:#fff;
            border-radius:18px;
            padding:34px;
            box-shadow:0 15px 50px rgba(0,0,0,.08);
          "
        >

          <div
            style="
              text-align:center;
              margin-bottom:28px;
            "
          >
            <div
              style="
                font-size:28px;
                font-weight:800;
                letter-spacing:-.03em;
              "
            >
              InvoiceFlow
            </div>

            <div
              style="
                margin-top:7px;
                color:#6b7280;
                font-size:14px;
              "
            >
              ${setupRequired
                ? 'Create your administrator account'
                : 'Invoice intelligence for your business'}
            </div>
          </div>

          ${errorHtml}

          ${
            setupRequired
              ? renderSignupForm()
              : renderLoginForm()
          }

        </div>
      </div>
    `;

    bindAuthEvents();
  }

  // ---------------------------------------------------------------------------
  // LOGIN FORM
  // ---------------------------------------------------------------------------

  function renderLoginForm() {
    return `
      <form
        id="login-form"
        autocomplete="on"
      >

        <div style="margin-bottom:16px;">
          <label
            for="login-email"
            style="
              display:block;
              margin-bottom:7px;
              font-size:13px;
              font-weight:700;
            "
          >
            Email
          </label>

          <input
            id="login-email"
            name="email"
            type="email"
            autocomplete="email"
            required
            placeholder="you@company.com"
            style="
              width:100%;
              box-sizing:border-box;
              padding:13px 14px;
              border:1px solid #d7dce3;
              border-radius:10px;
              font-size:15px;
              outline:none;
            "
          />
        </div>

        <div style="margin-bottom:20px;">
          <label
            for="login-password"
            style="
              display:block;
              margin-bottom:7px;
              font-size:13px;
              font-weight:700;
            "
          >
            Password
          </label>

          <input
            id="login-password"
            name="password"
            type="password"
            autocomplete="current-password"
            required
            placeholder="Enter your password"
            style="
              width:100%;
              box-sizing:border-box;
              padding:13px 14px;
              border:1px solid #d7dce3;
              border-radius:10px;
              font-size:15px;
              outline:none;
            "
          />
        </div>

        <button
          id="login-submit"
          type="submit"
          style="
            width:100%;
            border:0;
            border-radius:10px;
            padding:14px 16px;
            font-size:15px;
            font-weight:750;
            cursor:pointer;
            background:var(--ink-900,#111827);
            color:#fff;
          "
        >
          Sign in
        </button>

      </form>

      <div
        style="
          margin-top:20px;
          text-align:center;
          font-size:13px;
          color:#6b7280;
        "
      >
        Sign in using your InvoiceFlow account.
      </div>
    `;
  }

  // ---------------------------------------------------------------------------
  // SIGNUP FORM
  // ---------------------------------------------------------------------------

  function renderSignupForm() {
    return `
      <div
        style="
          margin-bottom:20px;
          padding:13px 14px;
          background:#f7f8fa;
          border-radius:10px;
          font-size:13px;
          line-height:1.5;
          color:#4b5563;
        "
      >
        This is the first-time setup for InvoiceFlow.
        Create the administrator account for your company.
      </div>

      <form
        id="signup-form"
        autocomplete="on"
      >

        <div style="margin-bottom:16px;">
          <label
            for="signup-name"
            style="
              display:block;
              margin-bottom:7px;
              font-size:13px;
              font-weight:700;
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
              padding:13px 14px;
              border:1px solid #d7dce3;
              border-radius:10px;
              font-size:15px;
            "
          />
        </div>

        <div style="margin-bottom:16px;">
          <label
            for="signup-company"
            style="
              display:block;
              margin-bottom:7px;
              font-size:13px;
              font-weight:700;
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
              padding:13px 14px;
              border:1px solid #d7dce3;
              border-radius:10px;
              font-size:15px;
            "
          />
        </div>

        <div style="margin-bottom:16px;">
          <label
            for="signup-email"
            style="
              display:block;
              margin-bottom:7px;
              font-size:13px;
              font-weight:700;
            "
          >
            Email
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
              padding:13px 14px;
              border:1px solid #d7dce3;
              border-radius:10px;
              font-size:15px;
            "
          />
        </div>

        <div style="margin-bottom:16px;">
          <label
            for="signup-password"
            style="
              display:block;
              margin-bottom:7px;
              font-size:13px;
              font-weight:700;
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
            placeholder="Minimum 8 characters"
            style="
              width:100%;
              box-sizing:border-box;
              padding:13px 14px;
              border:1px solid #d7dce3;
              border-radius:10px;
              font-size:15px;
            "
          />
        </div>

        <div style="margin-bottom:20px;">
          <label
            for="signup-password-confirm"
            style="
              display:block;
              margin-bottom:7px;
              font-size:13px;
              font-weight:700;
            "
          >
            Confirm password
          </label>

          <input
            id="signup-password-confirm"
            name="password_confirm"
            type="password"
            autocomplete="new-password"
            required
            minlength="8"
            placeholder="Repeat your password"
            style="
              width:100%;
              box-sizing:border-box;
              padding:13px 14px;
              border:1px solid #d7dce3;
              border-radius:10px;
              font-size:15px;
            "
          />
        </div>

        <button
          id="signup-submit"
          type="submit"
          style="
            width:100%;
            border:0;
            border-radius:10px;
            padding:14px 16px;
            font-size:15px;
            font-weight:750;
            cursor:pointer;
            background:var(--ink-900,#111827);
            color:#fff;
          "
        >
          Create administrator account
        </button>

      </form>

      <div
        style="
          margin-top:18px;
          text-align:center;
          font-size:12px;
          color:#8a919c;
        "
      >
        The first account automatically becomes the administrator.
      </div>
    `;
  }

  // ---------------------------------------------------------------------------
  // AUTH EVENT BINDING
  // ---------------------------------------------------------------------------

  function bindAuthEvents() {
    const loginForm =
      document.getElementById(
        'login-form'
      );

    if (loginForm) {
      loginForm.onsubmit =
        handleLoginSubmit;
    }

    const signupForm =
      document.getElementById(
        'signup-form'
      );

    if (signupForm) {
      signupForm.onsubmit =
        handleSignupSubmit;
    }
  }

  // ---------------------------------------------------------------------------
  // LOGIN
  // ---------------------------------------------------------------------------

  async function handleLoginSubmit(
    event
  ) {
    event.preventDefault();

    const loginForm =
      event.currentTarget;

    const submitBtn =
      document.getElementById(
        'login-submit'
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

    if (!email || !password) {
      renderLoginPage(
        'Please enter your email and password.'
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
      console.log(
        '[Login] Attempting login:',
        email
      );

      const response =
        await API.login(
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

      AppState.sessionError =
        null;

      console.log(
        '[Login] Login successful:',
        response.user.email
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
  }

  // ---------------------------------------------------------------------------
  // SIGNUP
  // ---------------------------------------------------------------------------

  async function handleSignupSubmit(
    event
  ) {
    event.preventDefault();

    const signupForm =
      event.currentTarget;

    const submitBtn =
      document.getElementById(
        'signup-submit'
      );

    const form =
      new FormData(
        signupForm
      );

    const name =
      String(
        form.get('name') ||
        ''
      ).trim();

    const companyName =
      String(
        form.get('company_name') ||
        ''
      ).trim();

    const email =
      String(
        form.get('email') ||
        ''
      ).trim()
      .toLowerCase();

    const password =
      String(
        form.get('password') ||
        ''
      );

    const passwordConfirm =
      String(
        form.get('password_confirm') ||
        ''
      );

    // ---------------------------------------------------------------
    // Frontend validation
    // ---------------------------------------------------------------

    if (
      !name ||
      !companyName ||
      !email ||
      !password ||
      !passwordConfirm
    ) {
      renderSignupPage(
        'Please complete all fields.'
      );

      return;
    }

    if (password.length < 8) {
      renderSignupPage(
        'Password must be at least 8 characters.'
      );

      return;
    }

    if (password !== passwordConfirm) {
      renderSignupPage(
        'The passwords do not match.'
      );

      return;
    }

    // ---------------------------------------------------------------
    // Disable button
    // ---------------------------------------------------------------

    if (submitBtn) {
      submitBtn.disabled =
        true;

      submitBtn.textContent =
        'Creating account…';
    }

    try {
      console.log(
        '[Signup] Creating first administrator account:',
        {
          name,
          email,
          company_name:
            companyName,
        }
      );

      const response =
        await API.register(
          {
            name,
            email,
            password,
            company_name:
              companyName,
          }
        );

      // ---------------------------------------------------------------
      // Validate response
      // ---------------------------------------------------------------

      if (!response?.token) {
        throw new Error(
          'Account was created but the server did not return a session token.'
        );
      }

      if (!response?.user) {
        throw new Error(
          'Account was created but the server did not return the user profile.'
        );
      }

      // ---------------------------------------------------------------
      // Store session
      // ---------------------------------------------------------------

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
        response.user.email
      );

      toast(
        'Administrator account created successfully.',
        'success'
      );

      // ---------------------------------------------------------------
      // Go directly to dashboard
      // ---------------------------------------------------------------

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
          'Create administrator account';
      }

      renderSignupPage(
        error?.message ||
        'Unable to create your account.'
      );
    }
  }

  // ---------------------------------------------------------------------------
  // LOGIN PAGE
  // ---------------------------------------------------------------------------

  async function renderLoginPage(
    error
  ) {
    // ---------------------------------------------------------------
    // If a token exists, don't display authentication UI.
    // The router will take the user to dashboard.
    // ---------------------------------------------------------------

    const existingToken =
      hasFunction(API, 'token')
        ? API.token()
        : null;

    if (existingToken) {
      location.hash =
        '#/dashboard';

      return;
    }

    // ---------------------------------------------------------------
    // Always refresh setup status before displaying auth screen.
    // ---------------------------------------------------------------

    await checkSetupStatus();

    renderAuthPage(
      error ||
      AppState.sessionError ||
      null
    );
  }

  // ---------------------------------------------------------------------------
  // SIGNUP PAGE
  // ---------------------------------------------------------------------------

  async function renderSignupPage(
    error
  ) {
    // ---------------------------------------------------------------
    // Check again before showing signup.
    //
    // This prevents a second browser from showing signup after another
    // browser has already created the first account.
    // ---------------------------------------------------------------

    await checkSetupStatus();

    if (!AppState.setupRequired) {
      renderLoginPage(
        'Account setup has already been completed. Please sign in.'
      );

      return;
    }

    renderAuthPage(
      error ||
      AppState.sessionError ||
      null
    );
  }

  // ---------------------------------------------------------------------------
  // HTML ESCAPING
  // ---------------------------------------------------------------------------

  function escapeHtml(value) {
    return String(
      value ?? ''
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

  // ---------------------------------------------------------------------------
  // DASHBOARD
  // ---------------------------------------------------------------------------

  async function renderDashboardPage() {
    const mounted =
      await mountShell(
        `<div class="loading-inline">
          Loading dashboard…
        </div>`,
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
        'Unable to load dashboard.'
      );
    }
  }

  // ---------------------------------------------------------------------------
  // CAPTURE
  // ---------------------------------------------------------------------------

  async function renderCapturePage() {
    const mounted =
      await mountShell(
        renderCapture(),
        '#/capture'
      );

    if (!mounted) {
      return;
    }

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
      uploadBtn.onclick =
        () => {
          if (
            typeof window.Camera ===
              'undefined' ||
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

  // ---------------------------------------------------------------------------
  // INVOICE PROCESSING
  // ---------------------------------------------------------------------------

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
          name: file.name,
          type: file.type,
          size: file.size,
        }
      );

      const result =
        await API.captureInvoice(
          file
        );

      clearInterval(
        stageTimer
      );

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

      location.hash =
        '#/capture';
    }
  }

  // ---------------------------------------------------------------------------
  // REVIEW
  // ---------------------------------------------------------------------------

  async function renderReviewPage(
    id,
    warning
  ) {
    const mounted =
      await mountShell(
        `<div class="loading-inline">
          Loading invoice…
        </div>`,
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

  // ---------------------------------------------------------------------------
  // PAINT REVIEW
  // ---------------------------------------------------------------------------

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

    // ---------------------------------------------------------------
    // Document preview
    // ---------------------------------------------------------------

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

    // ---------------------------------------------------------------
    // Editable fields
    // ---------------------------------------------------------------

    document
      .querySelectorAll(
        '[data-field-input]'
      )
      .forEach((input) => {
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
      });

    // ---------------------------------------------------------------
    // APPROVE
    // ---------------------------------------------------------------

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

    // ---------------------------------------------------------------
    // REJECT
    // ---------------------------------------------------------------

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

    // ---------------------------------------------------------------
    // RETAKE / RETRY
    // ---------------------------------------------------------------

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
            !Camera.open
          ) {
            toast(
              'Camera is not available.',
              'error'
            );

            return;
          }

          Camera.open({
            onCapture:
              async (file) => {
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

  // ---------------------------------------------------------------------------
  // REJECT MODAL
  // ---------------------------------------------------------------------------

  function confirmReject(id) {
    const backdrop =
      document.createElement(
        'div'
      );

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

  // ---------------------------------------------------------------------------
  // INVOICE LIST
  // ---------------------------------------------------------------------------

  async function renderInvoicesPage(
    opts = {}
  ) {
    const activeRoute =
      opts.forceExceptionView
        ? '#/exceptions'
        : '#/invoices';

    const mounted =
      await mountShell(
        `<div class="loading-inline">
          Loading invoices…
        </div>`,
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
        q:
          filters.q,

        status:
          isExceptionView
            ? undefined
            : (
                filters.status ===
                'all'
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
        tr.onclick =
          () => {
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

    // ---------------------------------------------------------------
    // Export all
    // ---------------------------------------------------------------

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

    // ---------------------------------------------------------------
    // Export selected
    // ---------------------------------------------------------------

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
                  .slice(
                    0,
                    10
                  )}.xlsx`
              );

            } else if (
              response?.url
            ) {
              await downloadAuthenticated(
                response.url,
                `invoiceflow-selected-${new Date()
                  .toISOString()
                  .slice(
                    0,
                    10
                  )}.xlsx`
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

  // ---------------------------------------------------------------------------
  // SUPPLIERS
  // ---------------------------------------------------------------------------

  async function renderSuppliersPage() {
    const mounted =
      await mountShell(
        `<div class="loading-inline">
          Loading suppliers…
        </div>`,
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

  // ---------------------------------------------------------------------------
  // REPORTS
  // ---------------------------------------------------------------------------

  async function renderReportsPage() {
    const mounted =
      await mountShell(
        `<div class="loading-inline">
          Loading reports…
        </div>`,
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

  // ---------------------------------------------------------------------------
  // SETTINGS
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // DOWNLOAD
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // AUTHENTICATED DOWNLOAD
  // ---------------------------------------------------------------------------

  async function downloadAuthenticated(
    url,
    filenameFallback
  ) {
    const token =
      hasFunction(
        API,
        'token'
      )
        ? API.token()
        : null;

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

  // ---------------------------------------------------------------------------
  // GLOBAL ERROR HANDLING
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // EXPOSE STATE / APP
  // ---------------------------------------------------------------------------

  window.AppState =
    AppState;

  window.InvoiceFlowApp = {
    router,
    logout,
    toast,
    handleSessionExpired,
    runCapture,
    checkSetupStatus,
  };

})();
