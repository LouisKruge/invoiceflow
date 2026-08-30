// views.js — pure render functions.
//
// No API calls or mock data live in this file. All invoice, supplier,
// dashboard and AI data comes from the backend API.
//
// Design direction: monochrome financial operations interface. Status is
// carried by mark shape and weight rather than hue, numbers are tabular, and
// hierarchy comes from type and spacing instead of colour and shadow.

// Small 16px line icons — typography carries the interface, not the icons.
const Icons = {
  overview: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h5l2-6 3 12 2.5-8H21"/></svg>',

  invoices: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h9l3.5 3.5V21H6z"/><path d="M9.5 9.5h6M9.5 13h6M9.5 16.5h3.5"/></svg>',

  exceptions: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 8v4.5M12 16h.01"/></svg>',

  suppliers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 20.5V9l8.5-5 8.5 5v11.5"/><path d="M9.5 20.5V14h5v6.5"/></svg>',

  approvals: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5L20 6.5"/></svg>',

  analytics: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V4"/><path d="M4 20h16"/><rect x="8" y="12" width="3" height="5"/><rect x="14" y="8" width="3" height="9"/></svg>',

  reports: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h8l4 4v14H6z"/><path d="M9.5 12h5M9.5 16h5M9.5 8h2.5"/></svg>',

  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="2.75"/><path d="M12 3.5v2M12 18.5v2M20.5 12h-2M5.5 12h-2M18 6l-1.5 1.5M7.5 16.5L6 18M18 18l-1.5-1.5M7.5 7.5L6 6"/></svg>',

  upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4.5M12 4.5L7.5 9M12 4.5L16.5 9"/><path d="M4 16.5V19a1.5 1.5 0 001.5 1.5h13A1.5 1.5 0 0020 19v-2.5"/></svg>',

  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11.5M12 15.5L7.5 11M12 15.5L16.5 11"/><path d="M4 17v2a1.5 1.5 0 001.5 1.5h13A1.5 1.5 0 0020 19v-2"/></svg>',

  camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5A1.5 1.5 0 015 7h2l1-2h8l1 2h2a1.5 1.5 0 011.5 1.5v9A1.5 1.5 0 0119 19H5a1.5 1.5 0 01-1.5-1.5z"/><circle cx="12" cy="12.5" r="3"/></svg>',

  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="M20.5 20.5l-4.7-4.7"/></svg>',

  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M12 5.5v13M5.5 12h13"/></svg>',

  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12.5l5 5 10-11"/></svg>',

  warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4L2.5 20.5h19z"/><path d="M12 10v4.5M12 17.5h.01"/></svg>',

  dash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6 12h12"/></svg>',

  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',

  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',

  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 7h15"/><path d="M9.5 7V5.5A1.5 1.5 0 0111 4h2a1.5 1.5 0 011.5 1.5V7"/><path d="M6.5 7l.8 12.1a1.5 1.5 0 001.5 1.4h6.4a1.5 1.5 0 001.5-1.4L17.5 7"/><path d="M10.5 11v6M13.5 11v6"/></svg>',

  arrowRight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h13M13 7l5 5-5 5"/></svg>',

  arrowLeft: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H6M11 7l-5 5 5 5"/></svg>',

  signout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4.5H6.5A1.5 1.5 0 005 6v12a1.5 1.5 0 001.5 1.5H14"/><path d="M18.5 12H10M15.5 8.5l3.5 3.5-3.5 3.5"/></svg>',

  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M21.5 12h-2M4.5 12h-2M18.4 5.6l-1.4 1.4M7 17l-1.4 1.4M18.4 18.4L17 17M7 7L5.6 5.6"/></svg>',

  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z"/></svg>',

  zoomIn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M12 6.5v11M6.5 12h11"/></svg>',

  zoomOut: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6.5 12h11"/></svg>',

  rotate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11.5a8 8 0 10-2.3 6"/><path d="M20 5.5v6h-6"/></svg>',

  file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 3h8L18 6.5V21h-11.5z"/></svg>',

  filter: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 6.5h16M7 12h10M10 17.5h4"/></svg>',

  stock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 7.5L12 3.5l8.5 4v9L12 20.5l-8.5-4z"/><path d="M3.5 7.5L12 11.5l8.5-4M12 11.5v9"/></svg>',

  products: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="7" height="7" rx="1"/><rect x="13.5" y="3.5" width="7" height="7" rx="1"/><rect x="3.5" y="13.5" width="7" height="7" rx="1"/><rect x="13.5" y="13.5" width="7" height="7" rx="1"/></svg>',

  ledger: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5h16v13H4z"/><path d="M8 5.5v13M4 10h16M4 14h16"/></svg>',

  adjust: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 8h10M18 8h2M4 16h4M12 16h8"/><circle cx="16" cy="8" r="2"/><circle cx="10" cy="16" r="2"/></svg>',

  importFile: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 3h8L18 6.5V21h-11.5z"/><path d="M12 16V9.5M12 9.5L9.5 12M12 9.5L14.5 12"/></svg>',

  signoutSheet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 4.5H9a2 2 0 014 0h2.5A1.5 1.5 0 0117 6v13.5H5V6a1.5 1.5 0 011.5-1.5z"/><path d="M8.5 12.5h6M14.5 12.5L12 10M14.5 12.5L12 15"/></svg>',
  review: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="6.5"/><path d="M20.5 20.5l-4.7-4.7M11 8v3.5M11 14h.01"/></svg>',
};

// ---------------------------------------------------------------------------
// VIEW CONTEXT
//
// The signed-in user, so views can decide what to offer without every caller
// threading a permissions flag through.
// ---------------------------------------------------------------------------

let VIEW_USER = null;

function setViewUser(user) {
  VIEW_USER = user || null;
}

// Deleting an invoice destroys an audit trail, so it stays with the roles the
// API already restricts it to.
function userCanDelete() {
  return Boolean(
    VIEW_USER &&
    ['admin', 'reviewer'].includes(VIEW_USER.role)
  );
}

function userCanApprove() {
  return Boolean(
    VIEW_USER &&
    ['admin', 'reviewer'].includes(VIEW_USER.role)
  );
}

// ---------------------------------------------------------------------------
// FORMATTERS
// ---------------------------------------------------------------------------

function esc(s) {
  if (s === null || s === undefined) return '';

  return String(s).replace(
    /[&<>"']/g,
    c => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[c])
  );
}

function currencySymbol(currency) {
  return currency === 'ZAR' || !currency
    ? 'R'
    : currency;
}

function fmtMoney(n, currency = 'ZAR') {
  if (n === null || n === undefined || n === '') return '—';

  const value = Number(n);

  if (!Number.isFinite(value)) return '—';

  // Comma thousands / dot decimals. The en-ZA locale would render
  // "R2 420 840,00", which reads ambiguously and does not match the grouping
  // the Excel export already uses.
  return `${currencySymbol(currency)}${value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

// Compact form for headline figures — R428K / R1.84M rather than a wall of digits.
function fmtMoneyCompact(n, currency = 'ZAR') {
  if (n === null || n === undefined || n === '') return '—';

  const value = Number(n);

  if (!Number.isFinite(value)) return '—';

  const symbol = currencySymbol(currency);
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';

  if (abs >= 1000000) {
    return `${sign}${symbol}${(abs / 1000000).toFixed(2).replace(/\.?0+$/, '')}M`;
  }

  if (abs >= 10000) {
    return `${sign}${symbol}${Math.round(abs / 1000)}K`;
  }

  return `${sign}${symbol}${abs.toLocaleString('en-US', {
    maximumFractionDigits: 0
  })}`;
}

function parseStamp(d) {
  if (!d) return null;

  // Date-only values are local dates; timestamps from Postgres arrive as ISO
  // strings and are already zoned.
  const raw = String(d);

  const date = new Date(
    raw.includes('T') || raw.includes(' ')
      ? raw
      : `${raw}T00:00:00`
  );

  return isNaN(date.getTime()) ? null : date;
}

function fmtDate(d) {
  const date = parseStamp(d);

  if (!date) return d ? String(d) : '—';

  return date.toLocaleDateString('en-ZA', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
}

// Table-density date: "29 Aug".
function fmtDateShort(d) {
  const date = parseStamp(d);

  if (!date) return '—';

  return date.toLocaleDateString('en-ZA', {
    day: '2-digit',
    month: 'short'
  });
}

function fmtDateTime(d) {
  const date = parseStamp(d);

  if (!date) return '—';

  return date.toLocaleString('en-ZA', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function fmtMonth(ym) {
  if (!ym) return '—';

  const date = new Date(`${ym}-01T00:00:00`);

  if (isNaN(date.getTime())) return ym;

  return date.toLocaleDateString('en-ZA', {
    month: 'short',
    year: '2-digit'
  });
}

function timeAgo(d) {
  const date = parseStamp(d);

  if (!date) return '—';

  const mins = Math.floor(
    Math.max(0, Date.now() - date.getTime()) / 60000
  );

  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;

  const hrs = Math.floor(mins / 60);

  if (hrs < 24) return `${hrs}h ago`;

  const days = Math.floor(hrs / 24);

  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days}d ago`;

  return fmtDateShort(d);
}

function initials(name) {
  if (!name) return '?';

  return name
    .trim()
    .split(/\s+/)
    .map(p => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function fileSize(bytes) {
  if (!Number.isFinite(bytes)) return '';

  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// STATUS
// ---------------------------------------------------------------------------

function statusLabel(s) {
  return ({
    processing: 'Processing',
    review_required: 'Review',
    approved: 'Approved',
    rejected: 'Rejected',
    duplicate: 'Duplicate',
    exception: 'Exception'
  })[s] || s || '—';
}

function statusMark(status) {
  return `
    <span class="status status-${esc(status)}">
      <span class="mark"></span>${esc(statusLabel(status))}
    </span>
  `;
}

function confidenceText(score) {
  if (score === null || score === undefined) {
    return '<span class="confidence">—</span>';
  }

  const pct = Math.round(Number(score) * 100);

  return `
    <span class="confidence ${pct < 85 ? 'low' : ''}">${pct}%</span>
  `;
}

// ---------------------------------------------------------------------------
// AUTH
// ---------------------------------------------------------------------------

function renderLogin(error) {
  return `
  <div class="auth-screen">
    <div class="auth-card">

      <div class="auth-wordmark">
        <div class="word">InvoiceFlow</div>
        <div class="tag">Finance Intelligence</div>
      </div>

      <h1>Sign in</h1>
      <p class="sub">Access your invoice operations.</p>

      ${error ? `<div class="auth-error">${esc(error)}</div>` : ''}

      <form id="login-form">

        <div class="field">
          <label>Email</label>
          <input
            type="email"
            name="email"
            required
            autocomplete="username"
            placeholder="you@company.co.za"
          />
        </div>

        <div class="field" style="margin-bottom:22px;">
          <label>Password</label>
          <input
            type="password"
            name="password"
            required
            autocomplete="current-password"
            placeholder="••••••••"
          />
        </div>

        <button class="btn btn-primary btn-block btn-lg" type="submit">
          Sign in
        </button>

      </form>

    </div>
  </div>`;
}

function renderSignup(error) {
  return `
  <div class="auth-screen">
    <div class="auth-card">

      <div class="auth-wordmark">
        <div class="word">InvoiceFlow</div>
        <div class="tag">Finance Intelligence</div>
      </div>

      <h1>Create your account</h1>
      <p class="sub">
        Set up the administrator account for your organisation.
      </p>

      ${error ? `<div class="auth-error">${esc(error)}</div>` : ''}

      <form id="signup-form">

        <div class="field">
          <label>Full name</label>
          <input
            id="signup-name"
            name="name"
            type="text"
            required
            autocomplete="name"
            placeholder="Your name"
          />
        </div>

        <div class="field">
          <label>Email</label>
          <input
            id="signup-email"
            name="email"
            type="email"
            required
            autocomplete="username"
            placeholder="you@company.co.za"
          />
        </div>

        <div class="field">
          <label>Company</label>
          <input
            id="signup-company"
            name="company_name"
            type="text"
            required
            autocomplete="organization"
            placeholder="Your company"
          />
        </div>

        <div class="field">
          <label>Password</label>
          <input
            id="signup-password"
            name="password"
            type="password"
            required
            autocomplete="new-password"
            placeholder="At least 8 characters"
          />
        </div>

        <div class="field" style="margin-bottom:22px;">
          <label>Confirm password</label>
          <input
            id="signup-confirm-password"
            name="confirm_password"
            type="password"
            required
            autocomplete="new-password"
            placeholder="Enter the password again"
          />
        </div>

        <button class="btn btn-primary btn-block btn-lg" type="submit">
          Create account
        </button>

      </form>

    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// SHELL
// ---------------------------------------------------------------------------

const NAV_GROUPS = [
  [null, [
    ['#/dashboard', 'overview', 'Overview'],
  ]],
  ['Transactions', [
    ['#/invoices', 'invoices', 'Invoices'],
    ['#/exceptions', 'exceptions', 'Exceptions'],
  ]],
  ['Operations', [
    ['#/suppliers', 'suppliers', 'Suppliers'],
    ['#/approvals', 'approvals', 'Approvals'],
  ]],
  ['Stock', [
    ['#/stock', 'stock', 'Stock Overview'],
    ['#/stock/products', 'products', 'Products'],
    ['#/stock/transactions', 'ledger', 'Transactions'],
    ['#/stock/adjustments', 'adjust', 'Adjustments'],
    ['#/stock/import', 'importFile', 'Import Stock'],
    ['#/stock/signout', 'signoutSheet', 'Stock Sign-Out'],
    ['#/stock/review', 'review', 'Stock Review'],
  ]],
  ['Intelligence', [
    ['#/reports', 'reports', 'Reports'],
  ]],
];

const ROUTE_TITLES = {
  '#/dashboard': 'Overview',
  '#/invoices': 'Invoices',
  '#/exceptions': 'Exceptions',
  '#/suppliers': 'Suppliers',
  '#/approvals': 'Approvals',
  '#/reports': 'Reports',
  '#/settings': 'Settings',
  '#/capture': 'Upload Invoices',
  '#/stock': 'Stock Overview',
  '#/stock/products': 'Products',
  '#/stock/transactions': 'Stock Transactions',
  '#/stock/adjustments': 'Stock Adjustments',
  '#/stock/import': 'Import Stock',
  '#/stock/review': 'Stock Review',
  '#/stock/signout': 'Stock Sign-Out',
};

function routeTitle(route) {
  if (ROUTE_TITLES[route]) return ROUTE_TITLES[route];

  if (route && route.startsWith('#/invoices/')) return 'Invoice';
  if (route && route.startsWith('#/suppliers/')) return 'Supplier';
  if (route && route.startsWith('#/stock/products/')) return 'Product';
  if (route && route.startsWith('#/stock/transactions/')) return 'Stock Transaction';
  if (route && route.startsWith('#/stock/signout/')) return 'Sign-Out Sheet';

  return 'InvoiceFlow';
}

function navItem(route, iconKey, label, active, count, critical) {
  return `
    <button
      class="nav-item ${active ? 'active' : ''} ${critical ? 'has-critical' : ''}"
      data-route="${esc(route)}"
    >
      ${Icons[iconKey] || ''}
      <span>${esc(label)}</span>
      ${count ? `<span class="count">${esc(String(count))}</span>` : ''}
    </button>
  `;
}

function navMarkup(route, counts) {
  return NAV_GROUPS
    .map(([group, items]) => `
      ${group ? `<div class="nav-group-label">${esc(group)}</div>` : ''}
      ${items.map(([r, icon, label]) => {
        const count =
          r === '#/exceptions'
            ? counts.exceptions
            : r === '#/approvals'
              ? counts.approvals
              : r === '#/stock/review'
                ? counts.stockReview
                : r === '#/stock/signout'
                  ? counts.stockSheets
                  : 0;

        return navItem(
          r,
          icon,
          label,
          route === r,
          count,
          (r === '#/exceptions' || r === '#/stock/review') && Boolean(count)
        );
      }).join('')}
    `)
    .join('') +
    `
      <div class="nav-group-label">System</div>
      ${navItem('#/settings', 'settings', 'Settings', route === '#/settings')}
    `;
}

function renderShell(route, user, exceptionsCount, contentHtml, counts = {}) {
  const navCounts = {
    exceptions: exceptionsCount || 0,
    approvals: counts.approvals || 0,
    stockReview: counts.stockReview || 0,
  };

  return `
  <div class="shell">

    <aside class="sidebar">

      <div class="sidebar-brand">
        <div class="word">InvoiceFlow</div>
        <div class="tag">Finance Intelligence</div>
      </div>

      <div class="sidebar-rule"></div>

      <nav class="sidebar-nav">
        ${navMarkup(route, navCounts)}
      </nav>

      <div class="sidebar-foot">
        <div class="sidebar-user">

          <div class="avatar">${esc(initials(user.name))}</div>

          <div style="min-width:0;">
            <div class="name">${esc(user.name)}</div>
            <div class="role">${esc(user.role)}</div>
          </div>

          <button class="signout" id="logout-btn" title="Sign out">
            ${Icons.signout}
          </button>

        </div>
      </div>

    </aside>

    <div class="main">

      <div class="topbar">

        <button class="icon-btn mobile-nav-btn" id="mobile-nav-btn">
          ${Icons.menu}
        </button>

        <div class="page-name">${esc(routeTitle(route))}</div>

        <div class="spacer"></div>

        <button class="search-trigger" id="search-trigger">
          ${Icons.search}
          <span class="label">Search</span>
          <span class="kbd">⌘K</span>
        </button>

        <button class="icon-btn" id="theme-toggle" title="Toggle theme">
          ${Icons.sun}
        </button>

        <button class="btn btn-primary" data-route="#/capture">
          ${Icons.plus}
          Upload Invoice
        </button>

      </div>

      <div class="content">
        ${contentHtml}
      </div>

    </div>

  </div>`;
}

// ---------------------------------------------------------------------------
// DASHBOARD
// ---------------------------------------------------------------------------

function greeting() {
  const hour = new Date().getHours();

  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';

  return 'Good evening';
}

function firstName(user) {
  if (!user || !user.name) return '';

  return user.name.trim().split(/\s+/)[0];
}

// The failed validation rule, phrased for a person scanning the dashboard.
function attentionIssue(item) {
  if (item.status === 'duplicate') {
    return { text: 'Duplicate detected', critical: true };
  }

  if (item.issue_message) {
    return {
      text: item.issue_message,
      critical: item.issue_severity === 'error'
    };
  }

  if (item.status === 'exception') {
    return { text: 'Processing exception', critical: true };
  }

  return { text: 'Awaiting review', critical: false };
}

function renderDashboard(d, user) {
  const attention = d.needs_attention || [];
  const recent = d.recent_invoices || [];
  const trend = d.spend_trend || [];

  const attentionRows = attention
    .slice(0, 4)
    .map(item => {
      const issue = attentionIssue(item);

      return `
        <div class="attention-row" data-id="${esc(item.id)}">

          <div class="attention-main">
            <div class="title">
              ${esc(item.invoice_number || 'Unnumbered invoice')}
            </div>
            <div class="supplier">
              ${esc(item.supplier_name || 'Unidentified supplier')}
            </div>
            <div class="issue ${issue.critical ? 'critical' : ''}">
              ${issue.critical ? Icons.warning : Icons.dash}
              ${esc(issue.text)}
            </div>
          </div>

          <div class="attention-amount">
            ${fmtMoney(item.total_amount, item.currency)}
          </div>

          <div class="attention-cta">
            Review ${Icons.arrowRight}
          </div>

        </div>
      `;
    })
    .join('');

  const recentRows = recent
    .slice(0, 6)
    .map(inv => `
      <tr class="clickable" data-id="${esc(inv.id)}">
        <td class="cell-id">${esc(inv.invoice_number || '—')}</td>
        <td class="cell-strong">${esc(inv.supplier_name || '—')}</td>
        <td class="cell-id cell-muted">${esc(inv.account_code || '—')}</td>
        <td class="cell-num">${fmtMoney(inv.total_amount, inv.currency)}</td>
        <td>${statusMark(inv.status)}</td>
        <td class="cell-muted">${esc(timeAgo(inv.created_at))}</td>
        ${userCanDelete() ? `
          <td class="cell-actions">
            <button
              class="icon-btn row-action danger"
              data-delete="${esc(inv.id)}"
              data-label="${esc(inv.invoice_number || 'this invoice')}"
              title="Delete invoice"
            >${Icons.trash}</button>
          </td>
        ` : ''}
      </tr>
    `)
    .join('');

  const monthChange =
    d.month_change_pct === null || d.month_change_pct === undefined
      ? `${d.month_invoice_count || 0} invoice${d.month_invoice_count === 1 ? '' : 's'}`
      : `${d.month_change_pct > 0 ? '+' : ''}${d.month_change_pct}% vs last month`;

  return `
  <div class="page-head">
    <div>
      <h1>${esc(greeting())}${firstName(user) ? `, ${esc(firstName(user))}` : ''}.</h1>
      <p class="sub">Here's what's happening with your invoices.</p>
    </div>

    <div class="page-actions">
      <button class="btn btn-primary" data-route="#/capture">
        ${Icons.plus} Upload Invoice
      </button>
    </div>
  </div>

  <div class="kpi-row">

    <div class="kpi">
      <div class="label">Outstanding</div>
      <div class="value">${fmtMoneyCompact(d.outstanding_value)}</div>
      <div class="foot">
        ${d.outstanding_count || 0} invoice${d.outstanding_count === 1 ? '' : 's'}
      </div>
    </div>

    <div class="kpi">
      <div class="label">This month</div>
      <div class="value">${fmtMoneyCompact(d.month_spend)}</div>
      <div class="foot">${esc(monthChange)}</div>
    </div>

    <div class="kpi">
      <div class="label">Processing</div>
      <div class="value">${d.processing_count ?? 0}</div>
      <div class="foot">${d.processing_today ?? 0} today</div>
    </div>

    <div class="kpi">
      <div class="label">Exceptions</div>
      <div class="value">${d.exceptions ?? 0}</div>
      <div class="foot ${d.critical_exceptions ? 'critical' : ''}">
        ${
          d.critical_exceptions
            ? `${d.critical_exceptions} duplicate${d.critical_exceptions === 1 ? '' : 's'}`
            : 'None critical'
        }
      </div>
    </div>

  </div>

  <div class="section">
    <div class="section-head">
      <h2>Needs attention</h2>
      ${
        attention.length
          ? '<button class="section-link" data-route="#/exceptions">View all →</button>'
          : ''
      }
    </div>

    <div class="attention-list">
      ${
        attentionRows ||
        `
          <div class="empty-state">
            ${Icons.check}
            <p>Nothing needs your attention.</p>
            <div class="hint">Every captured invoice has been dealt with.</div>
          </div>
        `
      }
    </div>
  </div>

  <div class="section">
    <div class="section-head">
      <h2>Recent activity</h2>
      <button class="section-link" data-route="#/invoices">View all →</button>
    </div>

    <div class="table-wrap">
      <table class="data-table" id="recent-table">
        <thead>
          <tr>
            <th>Invoice</th>
            <th>Supplier</th>
            <th>Account</th>
            <th class="th-num">Amount</th>
            <th>Status</th>
            <th>Date</th>
            ${userCanDelete() ? '<th></th>' : ''}
          </tr>
        </thead>
        <tbody>
          ${
            recentRows ||
            `
              <tr>
                <td colspan="${userCanDelete() ? 7 : 6}">
                  <div class="empty-state">
                    ${Icons.file}
                    <p>No invoices yet.</p>
                    <div class="hint">Upload your first invoice to get started.</div>
                  </div>
                </td>
              </tr>
            `
          }
        </tbody>
      </table>
    </div>
  </div>

  ${
    trend.length > 1
      ? `
        <div class="section">
          <div class="section-head">
            <h2>Spending</h2>
            <button class="section-link" data-route="#/reports">Reports →</button>
          </div>
          ${trendChart(trend)}
        </div>
      `
      : ''
  }`;
}

// Month-by-month spend, drawn with the same 1px vocabulary as everything else.
function trendChart(trend) {
  const max = Math.max(1, ...trend.map(t => t.total || 0));

  return `
    <div class="trend-chart">
      ${trend
        .map(t => `
          <div class="trend-row">
            <span class="m">${esc(fmtMonth(t.month))}</span>
            <span class="bar">
              <span style="width:${Math.max(1, ((t.total || 0) / max) * 100)}%"></span>
            </span>
            <span class="v">${fmtMoney(t.total)}</span>
          </div>
        `)
        .join('')}
    </div>
  `;
}

// ---------------------------------------------------------------------------
// UPLOAD
// ---------------------------------------------------------------------------

function renderCapture() {
  return `
  <div class="page-head">
    <div>
      <h1>Upload invoices</h1>
      <p class="sub">
        Photograph a paper invoice, or drop existing files in to extract them.
      </p>
    </div>
  </div>

  <div class="dropzone" id="dropzone">

    <h2>Drag &amp; drop invoices here</h2>

    <div class="or">or</div>

    <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">
      <button class="btn btn-primary" id="btn-upload-invoice">
        ${Icons.plus} Select files
      </button>
      <button class="btn btn-secondary" id="btn-take-photo">
        ${Icons.camera} Take photo
      </button>
    </div>

    <div class="hint">
      PDF, JPG, PNG, WEBP<br />
      Up to 15 MB per file
    </div>

  </div>

  <div id="selected-files"></div>`;
}

// The staged file list shown before processing starts.
function renderSelectedFiles(files) {
  if (!files.length) return '';

  return `
  <div class="section" style="margin-top:30px;">

    <div class="section-head">
      <h2>Selected</h2>
      <button class="section-link" id="btn-clear-files">Clear</button>
    </div>

    <div class="file-list">
      ${files
        .map((file, index) => `
          <div class="file-row">
            <span style="color:var(--ink-faint);display:flex;">${Icons.file}</span>
            <span class="name">${esc(file.name)}</span>
            <span class="size">${esc(fileSize(file.size))}</span>
            <button class="remove" data-remove-index="${index}" title="Remove">
              ${Icons.x}
            </button>
          </div>
        `)
        .join('')}
    </div>

    <div style="display:flex;justify-content:flex-end;margin-top:18px;">
      <button class="btn btn-primary btn-lg" id="btn-process-files">
        Process ${files.length} invoice${files.length === 1 ? '' : 's'}
      </button>
    </div>

  </div>`;
}

// ---------------------------------------------------------------------------
// PROCESSING
// ---------------------------------------------------------------------------

function stepMark(state) {
  if (state === 'done') {
    return `<span class="step-mark" style="color:var(--ink);">${Icons.check}</span>`;
  }

  if (state === 'failed') {
    return `<span class="step-mark" style="color:var(--critical);">${Icons.x}</span>`;
  }

  if (state === 'active') {
    return '<span class="step-mark"><span class="ring active"></span></span>';
  }

  return '<span class="step-mark"><span class="ring"></span></span>';
}

function renderProcessing(stageIndex, stages, warningMode) {
  return `
  <div class="processing-screen">
    <div class="processing-inner">

      <h2>Processing invoice</h2>

      <div class="progress-track">
        <div
          class="progress-fill"
          style="width:${Math.round(((stageIndex + 1) / stages.length) * 100)}%"
        ></div>
      </div>

      ${stages
        .map((stage, i) => `
          <div class="batch-row ${i > stageIndex ? 'pending' : ''}">
            ${stepMark(
              i < stageIndex
                ? 'done'
                : i === stageIndex
                  ? 'active'
                  : 'pending'
            )}
            <div class="label"><div class="name">${esc(stage)}</div></div>
          </div>
        `)
        .join('')}

      <div style="margin-top:20px;font-size:12.5px;color:var(--ink-muted);">
        ${
          warningMode
            ? 'This is taking longer than usual…'
            : 'Usually takes under a minute.'
        }
      </div>

    </div>
  </div>`;
}

/**
 * Batch progress.
 * @param {Array} items - [{ name, state, invoice_number, message }]
 *   state: 'done' | 'active' | 'pending' | 'failed'
 */
function renderBatchProgress(items) {
  const done = items.filter(i => i.state === 'done').length;
  const failed = items.filter(i => i.state === 'failed').length;
  const finished = done + failed;

  return `
  <div class="processing-screen">
    <div class="processing-inner">

      <h2>Processing invoices</h2>

      <div class="progress-track">
        <div
          class="progress-fill"
          style="width:${Math.round((finished / Math.max(1, items.length)) * 100)}%"
        ></div>
      </div>

      <div style="font-size:13px;margin-bottom:16px;">
        <span class="num">${finished}</span>
        <span style="color:var(--ink-muted);"> / ${items.length} completed</span>
      </div>

      ${items
        .map(item => `
          <div class="batch-row ${item.state === 'pending' ? 'pending' : ''} ${
            item.state === 'failed' ? 'failed' : ''
          }">
            ${stepMark(item.state)}
            <div class="label">
              <div class="name">
                ${esc(item.invoice_number || item.name)}
              </div>
              ${
                item.message
                  ? `<div class="state">${esc(item.message)}</div>`
                  : ''
              }
            </div>
          </div>
        `)
        .join('')}

      <div class="batch-summary">
        <div class="item">
          <div class="n">${items.length}</div>
          <div class="l">Invoices</div>
        </div>
        <div class="item">
          <div class="n">${done}</div>
          <div class="l">Extracted</div>
        </div>
        <div class="item">
          <div class="n">${failed}</div>
          <div class="l">Failed</div>
        </div>
      </div>

    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// INVOICE DETAIL
// ---------------------------------------------------------------------------

const FIELD_DEFS = [
  ['supplier_name', 'Supplier', 'text', 2],
  ['invoice_number', 'Invoice number', 'mono', 1],
  ['account_code', 'Account code', 'mono', 1],
  ['purchase_order_number', 'PO number', 'mono', 1],
  ['supplier_vat_number', 'VAT number', 'mono', 1],
  ['invoice_date', 'Invoice date', 'date', 1],
  ['due_date', 'Due date', 'date', 1],
  ['subtotal', 'Subtotal', 'number', 1],
  ['vat_amount', 'VAT', 'number', 1],
  ['total_amount', 'Total', 'number', 1],
  ['currency', 'Currency', 'mono', 1],
  ['payment_terms', 'Payment terms', 'text', 2],
  ['supplier_address', 'Supplier address', 'text', 2],
  ['supplier_contact', 'Supplier contact', 'text', 2],
];

// The fields worth showing a confidence read-out for — the ones a person
// would actually re-check against the document.
const CONFIDENCE_FIELDS = [
  ['supplier_name', 'Supplier'],
  ['invoice_number', 'Invoice number'],
  ['account_code', 'Account code'],
  ['invoice_date', 'Invoice date'],
  ['total_amount', 'Total'],
  ['vat_amount', 'VAT'],
];

function fieldHtml(invoice, key, label, type, readOnly) {
  const conf = (invoice.field_confidence || {})[key];

  const low =
    Array.isArray(invoice.low_confidence_fields) &&
    invoice.low_confidence_fields.includes(key);

  const inputType =
    type === 'number'
      ? 'number'
      : type === 'date'
        ? 'date'
        : 'text';

  return `
  <div class="rf ${low ? 'low-confidence' : ''} ${
    type === 'mono' || type === 'number' ? 'is-mono' : ''
  }" data-field="${esc(key)}">

    <div class="rf-head">
      <label>${esc(label)}</label>
      ${conf !== undefined && conf !== null ? confidenceText(conf) : ''}
    </div>

    <input
      type="${inputType}"
      ${type === 'number' ? 'step="0.01"' : ''}
      value="${esc(invoice[key] ?? '')}"
      data-field-input="${esc(key)}"
      ${readOnly ? 'disabled' : ''}
      placeholder="—"
    />

  </div>`;
}

function confidencePanel(invoice) {
  const confidence = invoice.field_confidence || {};

  const rows = CONFIDENCE_FIELDS
    .filter(([key]) => confidence[key] !== undefined && confidence[key] !== null)
    .map(([key, label]) => {
      const pct = Math.round(Number(confidence[key]) * 100);

      return `
        <div class="conf-row ${pct < 85 ? 'low' : ''}">
          <span class="name">${esc(label)}</span>
          <span class="bar"><span style="width:${Math.max(2, pct)}%"></span></span>
          <span class="pct">${pct}%</span>
        </div>
      `;
    })
    .join('');

  if (!rows) return '';

  return `
  <div class="detail-block">
    <div class="head">
      <h3>Extraction confidence</h3>
      ${
        invoice.overall_confidence != null
          ? `<span class="confidence">${Math.round(
              Number(invoice.overall_confidence) * 100
            )}% overall</span>`
          : ''
      }
    </div>
    <div class="body">${rows}</div>
  </div>`;
}

function intelligencePanel(invoice) {
  const items = invoice.intelligence || [];

  if (!items.length) return '';

  const rows = items
    .map(item => {
      const glyph =
        item.state === 'ok'
          ? Icons.check
          : item.state === 'warning'
            ? Icons.warning
            : Icons.dash;

      const variance =
        item.key === 'price_variance' && item.previous_average != null
          ? `
            <div class="variance-table">
              <div class="r">
                <span class="k">Previous average</span>
                <span class="v">${fmtMoney(item.previous_average, invoice.currency)}</span>
              </div>
              <div class="r">
                <span class="k">Current invoice</span>
                <span class="v">${fmtMoney(item.current_amount, invoice.currency)}</span>
              </div>
              <div class="r total">
                <span class="k">Difference</span>
                <span class="v">
                  ${item.difference > 0 ? '+' : ''}${fmtMoney(
                    item.difference,
                    invoice.currency
                  )}
                </span>
              </div>
            </div>
          `
          : '';

      return `
        <div class="intel-row ${esc(item.state)}">
          <span class="glyph">${glyph}</span>
          <div style="min-width:0;flex:1;">
            <div class="title">${esc(item.title)}</div>
            ${item.detail ? `<div class="detail">${esc(item.detail)}</div>` : ''}
            ${variance}
          </div>
        </div>
      `;
    })
    .join('');

  return `
  <div class="detail-block">
    <div class="head"><h3>Invoice intelligence</h3></div>
    <div class="body">${rows}</div>
  </div>`;
}

function logStageLabel(l) {
  const map = {
    uploaded: `Invoice uploaded (${l.detail?.filename || 'file'})`,

    ai_extracted: `AI extraction complete (${l.detail?.provider || 'unknown'})`,

    validated: `Validated — status set to ${statusLabel(l.detail?.status)}`,

    field_edited: `Manually corrected ${(l.detail?.changes || [])
      .map(c => c.field)
      .join(', ')}`,

    approved: 'Invoice approved',

    rejected: `Invoice rejected${l.detail?.reason ? ': ' + l.detail.reason : ''}`,

    retried: `Re-processed (${l.detail?.provider || 'unknown'})`,

    error: `Processing error: ${l.detail?.message || ''}`,
  };

  return map[l.stage] || l.stage;
}

function renderInvoiceDetail(invoice, opts = {}) {
  const isFinal = ['approved', 'rejected'].includes(invoice.status);

  const isPdf = (invoice.documents || []).some(
    d => (d.mime_type || '').includes('pdf')
  );

  const lineItems = (invoice.line_items || [])
    .map(li => `
      <tr>
        <td>${esc(li.description || '—')}</td>
        <td class="cell-num">${li.quantity ?? '—'}</td>
        <td class="cell-num">
          ${li.unit_price != null ? fmtMoney(li.unit_price, invoice.currency) : '—'}
        </td>
        <td class="cell-num">
          ${li.total != null ? fmtMoney(li.total, invoice.currency) : '—'}
        </td>
      </tr>
    `)
    .join('');

  const checks = (invoice.validation_results || [])
    .map(vr => {
      const passed = vr.passed === 1 || vr.passed === true;

      const cls = passed
        ? 'pass'
        : vr.severity === 'error'
          ? 'fail'
          : 'warn';

      return `
        <div class="check-row ${cls}">
          <span class="glyph">${passed ? Icons.check : Icons.warning}</span>
          <span>${esc(vr.message)}</span>
        </div>
      `;
    })
    .join('');

  const audit = (invoice.processing_logs || [])
    .map(l => `
      <div class="audit-row">
        <span class="t">${esc(fmtDateTime(l.created_at))}</span>
        <span class="d">
          ${esc(logStageLabel(l))}
          ${l.actor_name ? `<span class="actor">— ${esc(l.actor_name)}</span>` : ''}
        </span>
      </div>
    `)
    .join('');

  return `
  <button class="back-link" data-route="#/invoices">
    ${Icons.arrowLeft} Invoices
  </button>

  <div class="page-head">
    <div>
      <h1>${esc(invoice.invoice_number || 'Unnumbered invoice')}</h1>
      <p class="sub">
        ${esc(invoice.supplier_name || 'Unidentified supplier')}
        ${invoice.account_code ? ` · ${esc(invoice.account_code)}` : ''}
        ${invoice.invoice_date ? ` · ${esc(fmtDate(invoice.invoice_date))}` : ''}
      </p>

      ${
        invoice.total_amount != null
          ? `
            <div
              class="num"
              style="font-size:22px;font-weight:600;margin-top:10px;"
            >${fmtMoney(invoice.total_amount, invoice.currency)}</div>
          `
          : ''
      }
    </div>

    <div class="page-actions decision-bar">
      ${statusMark(invoice.status)}

      ${
        !isFinal && userCanApprove()
          ? `
            <button class="btn btn-secondary" id="btn-reject">Reject</button>
            <button class="btn btn-primary" id="btn-approve">Approve</button>
          `
          : ''
      }

      ${
        userCanDelete()
          ? `
            <button
              class="btn btn-danger"
              id="btn-delete-invoice"
              data-id="${esc(invoice.id)}"
              data-label="${esc(invoice.invoice_number || 'this invoice')}"
            >${Icons.trash} Delete</button>
          `
          : ''
      }
    </div>
  </div>

  ${
    opts.warning
      ? `
        <div class="detail-block" style="border-color:var(--critical);margin-bottom:20px;">
          <div class="body" style="padding:14px 18px;">
            <div class="check-row fail" style="border:none;padding:0;">
              <span class="glyph">${Icons.warning}</span>
              <span>${esc(opts.warning)}</span>
            </div>
          </div>
        </div>
      `
      : ''
  }

  <div class="workspace">

    <div class="doc-panel">

      <div class="doc-toolbar">
        <button class="icon-btn" id="doc-zoom-out" title="Zoom out">
          ${Icons.zoomOut}
        </button>
        <span class="zoom-label" id="doc-zoom-label">100%</span>
        <button class="icon-btn" id="doc-zoom-in" title="Zoom in">
          ${Icons.zoomIn}
        </button>
        <button class="icon-btn" id="doc-rotate" title="Rotate">
          ${Icons.rotate}
        </button>

        <div class="spacer"></div>

        <button class="icon-btn" id="doc-download" title="Download original">
          ${Icons.download}
        </button>
      </div>

      <div class="doc-stage" id="doc-stage" data-pdf="${isPdf ? '1' : '0'}">
        <div class="doc-empty">Loading document…</div>
      </div>

    </div>

    <div>

      <div class="detail-block">
        <div class="head">
          <h3>Invoice information</h3>
          ${
            !isFinal
              ? '<span style="font-size:11.5px;color:var(--ink-faint);">Click a value to correct it</span>'
              : ''
          }
        </div>
        <div class="body">
          <div class="field-grid">
            ${FIELD_DEFS.map(([k, l, t, span]) => `
              <div class="${span === 2 ? 'span-2' : ''}">
                ${fieldHtml(invoice, k, l, t, isFinal)}
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      ${intelligencePanel(invoice)}

      ${confidencePanel(invoice)}

      ${
        lineItems
          ? `
            <div class="detail-block">
              <div class="head"><h3>Line items</h3></div>
              <div class="table-wrap">
                <table class="data-table">
                  <thead>
                    <tr>
                      <th style="padding-left:18px;">Description</th>
                      <th class="th-num">Qty</th>
                      <th class="th-num">Unit price</th>
                      <th class="th-num" style="padding-right:18px;">Total</th>
                    </tr>
                  </thead>
                  <tbody>${lineItems}</tbody>
                </table>
              </div>
            </div>
          `
          : ''
      }

      <div class="detail-block">
        <div class="head"><h3>Validation</h3></div>
        <div class="body">
          ${checks || '<div class="check-row pass">No validation results yet.</div>'}
        </div>
      </div>

      ${
        audit
          ? `
            <div class="detail-block">
              <div class="head"><h3>Processing history</h3></div>
              <div class="body">${audit}</div>
            </div>
          `
          : ''
      }

      ${
        !isFinal
          ? `
            <div style="display:flex;gap:8px;">
              <button class="btn btn-secondary" id="btn-retake">
                ${Icons.camera} Retake photo
              </button>
            </div>
          `
          : ''
      }

    </div>

  </div>`;
}

// Kept so existing callers continue to work.
function renderReview(invoice, opts = {}) {
  return renderInvoiceDetail(invoice, opts);
}

// ---------------------------------------------------------------------------
// INVOICES LIST
// ---------------------------------------------------------------------------

const STATUS_FILTERS = [
  ['all', 'All'],
  ['review_required', 'Review'],
  ['approved', 'Approved'],
  ['processing', 'Processing'],
  ['exception', 'Exception'],
  ['duplicate', 'Duplicate'],
  ['rejected', 'Rejected'],
];

function renderInvoicesList(invoices, filters, title = 'Invoices') {
  const canDelete = userCanDelete();

  const rows = invoices
    .map(inv => `
      <tr data-id="${esc(inv.id)}">

        <td class="cell-check">
          <input
            type="checkbox"
            class="row-check"
            data-id="${esc(inv.id)}"
          />
        </td>

        <td class="cell-id clickable-cell">${esc(inv.invoice_number || '—')}</td>
        <td class="cell-strong clickable-cell">${esc(inv.supplier_name || '—')}</td>
        <td class="cell-id cell-muted clickable-cell">${esc(inv.account_code || '—')}</td>
        <td class="cell-num clickable-cell">
          ${fmtMoney(inv.total_amount, inv.currency)}
        </td>
        <td class="clickable-cell">${statusMark(inv.status)}</td>
        <td class="cell-muted clickable-cell">${esc(fmtDateShort(inv.invoice_date || inv.created_at))}</td>

        ${
          canDelete
            ? `
              <td class="cell-actions">
                <button
                  class="icon-btn row-action danger"
                  data-delete="${esc(inv.id)}"
                  data-label="${esc(inv.invoice_number || 'this invoice')}"
                  title="Delete invoice"
                >${Icons.trash}</button>
              </td>
            `
            : ''
        }

      </tr>
    `)
    .join('');

  const colCount = canDelete ? 8 : 7;

  return `
  <div class="page-head">
    <div>
      <h1>${esc(title)}</h1>
      <p class="sub">
        ${invoices.length} invoice${invoices.length === 1 ? '' : 's'}
      </p>
    </div>

    <div class="page-actions">
      <button class="btn btn-secondary" id="btn-export-all">
        ${Icons.download} Export
      </button>
      <button class="btn btn-primary" data-route="#/capture">
        ${Icons.plus} Upload Invoice
      </button>
    </div>
  </div>

  <div class="toolbar">
    <div class="toolbar-search">
      ${Icons.search}
      <input
        type="text"
        id="invoice-search"
        placeholder="Search invoice number, supplier, account code, VAT, PO or amount…"
        value="${esc(filters.q || '')}"
      />
    </div>
  </div>

  <div class="filter-row">
    ${STATUS_FILTERS.map(([v, l]) => `
      <button
        class="filter-chip ${
          filters.status === v || (!filters.status && v === 'all') ? 'active' : ''
        }"
        data-status="${esc(v)}"
      >${esc(l)}</button>
    `).join('')}
  </div>

  <div id="bulk-bar-slot"></div>

  <div class="card">
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th class="cell-check">
              <input type="checkbox" id="check-all" />
            </th>
            <th>Invoice</th>
            <th>Supplier</th>
            <th>Account</th>
            <th class="th-num">Amount</th>
            <th>Status</th>
            <th>Date</th>
            ${canDelete ? '<th></th>' : ''}
          </tr>
        </thead>
        <tbody>
          ${
            rows ||
            `
              <tr>
                <td colspan="${colCount}">
                  <div class="empty-state">
                    ${Icons.file}
                    <p>No invoices match your filters.</p>
                    <div class="hint">Try a different status or clear the search.</div>
                  </div>
                </td>
              </tr>
            `
          }
        </tbody>
      </table>
    </div>
  </div>`;
}

function renderBulkBar(count) {
  if (!count) return '';

  return `
  <div class="bulk-bar">
    <span class="count">
      ${count} invoice${count === 1 ? '' : 's'} selected
    </span>
    <span class="spacer"></span>
    <button class="btn btn-secondary btn-sm" id="btn-export-selected">
      ${Icons.download} Export
    </button>
    ${
      userCanDelete()
        ? `
          <button class="btn btn-danger btn-sm" id="btn-delete-selected">
            ${Icons.trash} Delete
          </button>
        `
        : ''
    }
  </div>`;
}

// ---------------------------------------------------------------------------
// EXCEPTIONS
// ---------------------------------------------------------------------------

// Exceptions are grouped by what a person has to do about them, not by the
// internal status value.
function exceptionSeverity(invoice) {
  if (invoice.status === 'duplicate') return 'critical';

  // The list endpoint supplies the top failing rule directly; the detail
  // payload carries the full set. Either is enough to group by.
  const rule =
    invoice.issue_rule ||
    (invoice.validation_results || [])
      .filter(v => !(v.passed === 1 || v.passed === true))
      .find(v => v.severity === 'error')?.rule_code;

  const severity =
    invoice.issue_severity ||
    (invoice.validation_results || [])
      .filter(v => !(v.passed === 1 || v.passed === true))[0]?.severity;

  if (rule === 'MISSING_FIELD') return 'missing';
  if (rule === 'DUPLICATE_CHECK') return 'critical';
  if (severity === 'error') return 'critical';
  if (severity === 'warning') return 'warning';

  return invoice.status === 'exception' ? 'critical' : 'warning';
}

function exceptionReason(invoice) {
  if (invoice.status === 'duplicate') return 'Duplicate invoice detected';

  if (invoice.issue_message) return invoice.issue_message;

  const failed = (invoice.validation_results || []).filter(
    v => !(v.passed === 1 || v.passed === true)
  );

  const worst =
    failed.find(v => v.severity === 'error') || failed[0];

  return worst ? worst.message : 'Requires review';
}

const EXCEPTION_GROUPS = [
  ['critical', 'Critical'],
  ['warning', 'Warning'],
  ['missing', 'Missing data'],
];

function renderExceptions(invoices) {
  const buckets = { critical: [], warning: [], missing: [] };

  invoices.forEach(inv => {
    buckets[exceptionSeverity(inv)].push(inv);
  });

  const groups = EXCEPTION_GROUPS
    .filter(([key]) => buckets[key].length)
    .map(([key, label]) => `
      <div class="exception-group">
        <div class="exception-group-head">
          <span class="label ${
            key === 'critical' ? 'critical' : key === 'warning' ? 'caution' : 'neutral'
          }">${esc(label)}</span>
          <span class="n">${buckets[key].length}</span>
        </div>

        ${buckets[key]
          .map(inv => `
            <div class="attention-row" data-id="${esc(inv.id)}">
              <div class="attention-main">
                <div class="title">${esc(inv.invoice_number || 'Unnumbered invoice')}</div>
                <div class="supplier">
                  ${esc(inv.supplier_name || 'Unidentified supplier')}
                  ${inv.account_code ? ` · ${esc(inv.account_code)}` : ''}
                </div>
                <div class="issue ${key === 'critical' ? 'critical' : ''}">
                  ${key === 'critical' ? Icons.warning : Icons.dash}
                  ${esc(exceptionReason(inv))}
                </div>
              </div>

              <div class="attention-amount">
                ${fmtMoney(inv.total_amount, inv.currency)}
              </div>

              <div class="attention-cta">Review ${Icons.arrowRight}</div>

              ${
                userCanDelete()
                  ? `
                    <button
                      class="icon-btn row-action danger"
                      data-delete="${esc(inv.id)}"
                      data-label="${esc(inv.invoice_number || 'this invoice')}"
                      title="Delete invoice"
                    >${Icons.trash}</button>
                  `
                  : ''
              }
            </div>
          `)
          .join('')}
      </div>
    `)
    .join('');

  return `
  <div class="page-head">
    <div>
      <h1>Exceptions</h1>
      <p class="sub">
        ${
          invoices.length
            ? `${invoices.length} invoice${
                invoices.length === 1 ? '' : 's'
              } require${invoices.length === 1 ? 's' : ''} attention.`
            : 'Nothing requires attention.'
        }
      </p>
    </div>
  </div>

  ${
    groups ||
    `
      <div class="empty-state">
        ${Icons.check}
        <p>No exceptions.</p>
        <div class="hint">Every invoice passed validation.</div>
      </div>
    `
  }`;
}

// ---------------------------------------------------------------------------
// SUPPLIERS
// ---------------------------------------------------------------------------

function renderSuppliers(suppliers) {
  const rows = suppliers
    .slice()
    .sort((a, b) => Number(b.total_spend || 0) - Number(a.total_spend || 0))
    .map(s => `
      <tr class="clickable" data-supplier-id="${esc(s.id)}">
        <td class="cell-strong">${esc(s.name)}</td>
        <td class="cell-id cell-muted">${esc(s.account_code || '—')}</td>
        <td class="cell-num">${fmtMoney(s.total_spend)}</td>
        <td class="cell-num">${s.invoice_count ?? 0}</td>
        <td class="cell-num">
          ${
            s.average_invoice != null
              ? fmtMoney(s.average_invoice)
              : '—'
          }
        </td>
        <td class="cell-muted">${esc(timeAgo(s.last_invoice_at))}</td>
        <td>
          ${
            Number(s.exception_count) > 0
              ? `<span class="status status-exception"><span class="mark"></span>${
                  s.exception_count
                } open</span>`
              : '<span class="status status-approved"><span class="mark"></span>Clear</span>'
          }
        </td>
      </tr>
    `)
    .join('');

  return `
  <div class="page-head">
    <div>
      <h1>Suppliers</h1>
      <p class="sub">
        ${suppliers.length} supplier${suppliers.length === 1 ? '' : 's'} on file.
      </p>
    </div>
  </div>

  <div class="card">
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Supplier</th>
            <th>Account</th>
            <th class="th-num">Spend</th>
            <th class="th-num">Invoices</th>
            <th class="th-num">Average</th>
            <th>Last invoice</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${
            rows ||
            `
              <tr>
                <td colspan="7">
                  <div class="empty-state">
                    ${Icons.suppliers}
                    <p>No suppliers yet.</p>
                    <div class="hint">
                      Suppliers are created automatically from captured invoices.
                    </div>
                  </div>
                </td>
              </tr>
            `
          }
        </tbody>
      </table>
    </div>
  </div>`;
}

// Reads the last few months of a supplier's spend and says whether pricing
// is drifting — the point where this stops being an invoice list.
function supplierTrendNote(trend) {
  if (!trend || trend.length < 4) return '';

  const half = Math.floor(trend.length / 2);

  const avg = rows =>
    rows.reduce((sum, r) => sum + (r.total || 0) / Math.max(1, r.count || 1), 0) /
    Math.max(1, rows.length);

  const earlier = avg(trend.slice(0, half));
  const later = avg(trend.slice(half));

  if (!earlier) return '';

  const pct = Math.round(((later - earlier) / earlier) * 1000) / 10;

  if (Math.abs(pct) < 5) return '';

  return `
    <div class="intel-row ${Math.abs(pct) >= 10 ? 'warning' : 'ok'}"
         style="border:none;padding-top:0;">
      <span class="glyph">${Math.abs(pct) >= 10 ? Icons.warning : Icons.dash}</span>
      <div>
        <div class="title">
          Average invoice value ${pct > 0 ? 'increased' : 'decreased'}
          ${Math.abs(pct).toFixed(1)}%
        </div>
        <div class="detail">
          Comparing the most recent months on file with the earlier period.
        </div>
      </div>
    </div>
  `;
}

function renderSupplierDetail(data) {
  const { supplier, stats, invoices, trend } = data;

  const rows = (invoices || [])
    .map(inv => `
      <tr class="clickable" data-id="${esc(inv.id)}">
        <td class="cell-id">${esc(inv.invoice_number || '—')}</td>
        <td class="cell-id cell-muted">${esc(inv.account_code || '—')}</td>
        <td class="cell-muted">${esc(fmtDateShort(inv.invoice_date || inv.created_at))}</td>
        <td class="cell-num">${fmtMoney(inv.total_amount, inv.currency)}</td>
        <td>${statusMark(inv.status)}</td>
      </tr>
    `)
    .join('');

  return `
  <button class="back-link" data-route="#/suppliers">
    ${Icons.arrowLeft} Suppliers
  </button>

  <div class="page-head">
    <div>
      <h1>${esc(supplier.name)}</h1>
      <p class="sub">
        ${
          supplier.vat_number
            ? `VAT ${esc(supplier.vat_number)}`
            : 'No VAT number on file'
        }
      </p>
    </div>
  </div>

  <div class="stat-inline">
    <div class="item">
      <div class="l">Total spend</div>
      <div class="v">${fmtMoney(stats.total_spend)}</div>
    </div>
    <div class="item">
      <div class="l">Invoices</div>
      <div class="v">${stats.invoice_count}</div>
    </div>
    <div class="item">
      <div class="l">Average invoice</div>
      <div class="v">
        ${stats.average_invoice != null ? fmtMoney(stats.average_invoice) : '—'}
      </div>
    </div>
    <div class="item">
      <div class="l">Largest invoice</div>
      <div class="v">
        ${stats.largest_invoice != null ? fmtMoney(stats.largest_invoice) : '—'}
      </div>
    </div>
  </div>

  ${
    trend && trend.length > 1
      ? `
        <div class="section">
          <div class="section-head"><h2>Spend movement</h2></div>
          ${trendChart(trend)}
          ${supplierTrendNote(trend)}
        </div>
      `
      : ''
  }

  <div class="section">
    <div class="section-head"><h2>Recent invoices</h2></div>

    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Invoice</th>
            <th>Account</th>
            <th>Date</th>
            <th class="th-num">Amount</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${
            rows ||
            `
              <tr>
                <td colspan="5">
                  <div class="empty-state">
                    ${Icons.file}
                    <p>No invoices from this supplier yet.</p>
                  </div>
                </td>
              </tr>
            `
          }
        </tbody>
      </table>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// REPORTS
// ---------------------------------------------------------------------------

function renderReports(suppliers, summary) {
  const ranked = suppliers
    .slice()
    .sort((a, b) => Number(b.total_spend || 0) - Number(a.total_spend || 0))
    .slice(0, 10);

  const max = Math.max(1, ...ranked.map(s => Number(s.total_spend || 0)));

  const totalSpend = suppliers.reduce(
    (sum, s) => sum + Number(s.total_spend || 0),
    0
  );

  const bars = ranked
    .map(s => `
      <div class="trend-row">
        <span class="m" style="width:auto;min-width:150px;flex:0 0 auto;">
          ${esc(s.name)}
        </span>
        <span class="bar">
          <span style="width:${Math.max(1, (Number(s.total_spend || 0) / max) * 100)}%"></span>
        </span>
        <span class="v">${fmtMoney(s.total_spend)}</span>
      </div>
    `)
    .join('');

  return `
  <div class="page-head">
    <div>
      <h1>Reports</h1>
      <p class="sub">Spend concentration across your supplier base.</p>
    </div>

    <div class="page-actions">
      <button class="btn btn-secondary" id="btn-export-all">
        ${Icons.download} Export to Excel
      </button>
    </div>
  </div>

  <div class="kpi-row">
    <div class="kpi">
      <div class="label">Total spend</div>
      <div class="value">${fmtMoneyCompact(totalSpend)}</div>
      <div class="foot">Across all suppliers</div>
    </div>
    <div class="kpi">
      <div class="label">Suppliers</div>
      <div class="value">${suppliers.length}</div>
      <div class="foot">On file</div>
    </div>
    <div class="kpi">
      <div class="label">Today's value</div>
      <div class="value">${fmtMoneyCompact(summary.total_invoice_value)}</div>
      <div class="foot">${summary.today_invoices ?? 0} captured</div>
    </div>
    <div class="kpi">
      <div class="label">Avg. processing</div>
      <div class="value">
        ${summary.avg_processing_seconds ? summary.avg_processing_seconds + 's' : '—'}
      </div>
      <div class="foot">Upload to decision</div>
    </div>
  </div>

  <div class="section">
    <div class="section-head"><h2>Spend by supplier</h2></div>
    ${
      bars ||
      `
        <div class="empty-state">
          ${Icons.analytics}
          <p>No spend data yet.</p>
        </div>
      `
    }
  </div>

  ${
    summary.spend_trend && summary.spend_trend.length > 1
      ? `
        <div class="section">
          <div class="section-head"><h2>Monthly spend</h2></div>
          ${trendChart(summary.spend_trend)}
        </div>
      `
      : ''
  }`;
}

// ---------------------------------------------------------------------------
// APPROVALS
// ---------------------------------------------------------------------------

function renderApprovals(invoices) {
  const rows = invoices
    .map(inv => `
      <tr class="clickable" data-id="${esc(inv.id)}">
        <td class="cell-id">${esc(inv.invoice_number || '—')}</td>
        <td class="cell-strong">${esc(inv.supplier_name || '—')}</td>
        <td class="cell-id cell-muted">${esc(inv.account_code || '—')}</td>
        <td class="cell-num">${fmtMoney(inv.total_amount, inv.currency)}</td>
        <td>${confidenceText(inv.overall_confidence)}</td>
        <td class="cell-muted">${esc(timeAgo(inv.created_at))}</td>
      </tr>
    `)
    .join('');

  return `
  <div class="page-head">
    <div>
      <h1>Approvals</h1>
      <p class="sub">
        ${
          invoices.length
            ? `${invoices.length} invoice${
                invoices.length === 1 ? '' : 's'
              } waiting on a decision.`
            : 'Nothing is waiting on a decision.'
        }
      </p>
    </div>
  </div>

  <div class="card">
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Invoice</th>
            <th>Supplier</th>
            <th>Account</th>
            <th class="th-num">Amount</th>
            <th>Confidence</th>
            <th>Captured</th>
          </tr>
        </thead>
        <tbody>
          ${
            rows ||
            `
              <tr>
                <td colspan="6">
                  <div class="empty-state">
                    ${Icons.check}
                    <p>The approval queue is empty.</p>
                  </div>
                </td>
              </tr>
            `
          }
        </tbody>
      </table>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// SETTINGS
// ---------------------------------------------------------------------------

function renderSettings(user, health) {
  const provider = health?.ai_provider || '—';

  return `
  <div class="page-head">
    <div>
      <h1>Settings</h1>
      <p class="sub">Account and system configuration.</p>
    </div>
  </div>

  <div style="max-width:520px;">

    <div class="detail-block">
      <div class="head"><h3>Account</h3></div>
      <div class="body" style="padding-top:14px;">
        <div class="field"><label>Name</label><input value="${esc(user.name)}" disabled /></div>
        <div class="field"><label>Email</label><input value="${esc(user.email)}" disabled /></div>
        <div class="field">
          <label>Role</label>
          <input value="${esc(user.role)}" disabled style="text-transform:capitalize" />
        </div>
        <div class="field" style="margin-bottom:4px;">
          <label>Company</label>
          <input value="${esc(user.company_name || '')}" disabled />
        </div>
      </div>
    </div>

    <div class="detail-block">
      <div class="head"><h3>Appearance</h3></div>
      <div class="body" style="padding-top:16px;padding-bottom:18px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;">
          <div>
            <div style="font-size:13.5px;font-weight:500;">Theme</div>
            <div style="font-size:12.5px;color:var(--ink-muted);margin-top:2px;">
              Light or dark. Your choice is remembered on this device.
            </div>
          </div>
          <button class="btn btn-secondary" id="settings-theme-toggle">
            Switch theme
          </button>
        </div>
      </div>
    </div>

    <div class="detail-block">
      <div class="head"><h3>AI extraction</h3></div>
      <div class="body" style="padding-top:14px;padding-bottom:18px;">
        <div class="conf-row">
          <span class="name">Provider</span>
          <span class="pct" style="min-width:0;text-transform:capitalize;">
            ${esc(provider)}
          </span>
        </div>
        <div class="conf-row" style="border-bottom:none;">
          <span class="name">Status</span>
          <span class="pct" style="min-width:0;">
            ${health?.ai_configured ? 'Configured' : 'Not configured'}
          </span>
        </div>
        <p style="font-size:12.5px;color:var(--ink-muted);margin:14px 0 0;line-height:1.6;">
          Invoices are read by a vision model, which returns structured fields
          with a confidence score for each one. Anything below the confidence
          threshold is flagged for a human before approval.
        </p>
      </div>
    </div>

  </div>`;
}

// ---------------------------------------------------------------------------
// COMMAND PALETTE
// ---------------------------------------------------------------------------

function renderPalette(query, results, activeIndex) {
  const groups = [];

  const navResults = results.filter(r => r.type === 'action');
  const invoiceResults = results.filter(r => r.type === 'invoice');

  let index = -1;

  const itemHtml = (item) => {
    index += 1;

    const active = index === activeIndex;

    return `
      <button
        class="palette-item ${active ? 'active' : ''}"
        data-index="${index}"
      >
        ${Icons[item.icon] || Icons.arrowRight}
        <span class="pi-text">
          <span class="t">${esc(item.title)}</span>
          ${item.subtitle ? `<span class="s">${esc(item.subtitle)}</span>` : ''}
        </span>
        ${item.amount ? `<span class="amt">${esc(item.amount)}</span>` : ''}
      </button>
    `;
  };

  if (invoiceResults.length) {
    groups.push(`
      <div class="palette-group">Invoices</div>
      ${invoiceResults.map(itemHtml).join('')}
    `);
  }

  if (navResults.length) {
    groups.push(`
      <div class="palette-group">Actions</div>
      ${navResults.map(itemHtml).join('')}
    `);
  }

  return `
  <div class="palette-backdrop" id="palette-backdrop">
    <div class="palette" id="palette">

      <div class="palette-input-row">
        ${Icons.search}
        <input
          id="palette-input"
          type="text"
          placeholder="Search InvoiceFlow…"
          value="${esc(query || '')}"
          autocomplete="off"
          spellcheck="false"
        />
        <span class="kbd">ESC</span>
      </div>

      <div class="palette-results" id="palette-results">
        ${
          groups.join('') ||
          '<div class="palette-empty">No matches.</div>'
        }
      </div>

      <div class="palette-foot">
        <span>↑↓ Navigate</span>
        <span>↵ Open</span>
        <span>ESC Close</span>
      </div>

    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// CONFIRM MODAL
// ---------------------------------------------------------------------------

function renderConfirm({ title, body, confirmLabel, danger }) {
  return `
  <div class="modal-backdrop" id="confirm-backdrop">
    <div class="modal-card">
      <h3>${esc(title)}</h3>
      <p>${esc(body)}</p>
      <div class="modal-actions">
        <button class="btn btn-secondary" id="confirm-cancel">Cancel</button>
        <button
          class="btn ${danger ? 'btn-danger' : 'btn-primary'}"
          id="confirm-ok"
        >${esc(confirmLabel || 'Confirm')}</button>
      </div>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// STOCK
//
// Built from the same components as the rest of InvoiceFlow: the KPI row, the
// data table, the monochrome status marks, the detail blocks. Stock status
// reuses the status-mark vocabulary rather than introducing colours of its own.
// ---------------------------------------------------------------------------

const STOCK_STATUS_LABELS = {
  IN_STOCK: 'In stock',
  LOW_STOCK: 'Low stock',
  OUT_OF_STOCK: 'Out of stock',
};

// In stock reads as settled (filled), low as needing a look (hollow), and out
// of stock as the one condition that genuinely stops work (square, critical).
function stockStatusMark(status) {
  const cls = ({
    IN_STOCK: 'status-approved',
    LOW_STOCK: 'status-review_required',
    OUT_OF_STOCK: 'status-exception',
  })[status] || 'status-processing';

  return `
    <span class="status ${cls}">
      <span class="mark"></span>${esc(STOCK_STATUS_LABELS[status] || status)}
    </span>
  `;
}

const TRANSACTION_LABELS = {
  OPENING_BALANCE: 'Opening balance',
  PURCHASE_RECEIPT: 'Purchase receipt',
  STOCK_ISSUE: 'Stock issue',
  STOCK_RETURN: 'Stock return',
  STOCK_ADJUSTMENT: 'Adjustment',
  STOCK_TRANSFER: 'Transfer',
  STOCK_COUNT: 'Stock count',
};

function transactionLabel(type) {
  return TRANSACTION_LABELS[type] || type || '—';
}

// A movement is shown with its sign, because the sign is the whole point.
function signedQuantity(row) {
  const value = Number(row.signed_quantity ?? (row.quantity * (row.direction || 1)));

  const text = `${value > 0 ? '+' : ''}${value.toLocaleString('en-US')}`;

  return `<span class="${value < 0 ? 'cell-muted' : ''}">${esc(text)}</span>`;
}

function fmtQty(n, unit) {
  if (n === null || n === undefined) return '—';

  const value = Number(n);

  if (!Number.isFinite(value)) return '—';

  return `${value.toLocaleString('en-US')}${unit ? ` ${esc(unit)}` : ''}`;
}

// --------------------------------- Overview ---------------------------------

function renderStockOverview(data) {
  const recent = data.recent_transactions || [];

  const rows = recent
    .map(row => `
      <tr class="clickable" data-transaction-id="${esc(row.id)}">
        <td class="cell-id">${esc(row.sku || '—')}</td>
        <td class="cell-strong">${esc(row.product_description || '—')}</td>
        <td>${esc(transactionLabel(row.transaction_type))}</td>
        <td class="cell-num">${signedQuantity(row)}</td>
        <td class="cell-muted">${esc(row.created_by_name || 'System')}</td>
        <td class="cell-muted">${esc(timeAgo(row.created_at))}</td>
      </tr>
    `)
    .join('');

  return `
  <div class="page-head">
    <div>
      <h1>Stock overview</h1>
      <p class="sub">Every quantity here is derived from the stock ledger.</p>
    </div>

    <div class="page-actions">
      <button class="btn btn-secondary" data-route="#/stock/adjustments">
        ${Icons.adjust} Adjust stock
      </button>
      <button class="btn btn-secondary" data-route="#/stock/signout">
        ${Icons.signoutSheet} Sign out stock
      </button>
      <button class="btn btn-primary" data-route="#/stock/import">
        ${Icons.importFile} Import stock
      </button>
    </div>
  </div>

  <div class="kpi-row">
    <div class="kpi">
      <div class="label">Total products</div>
      <div class="value">${data.total_products ?? 0}</div>
      <div class="foot">On the product master</div>
    </div>
    <div class="kpi">
      <div class="label">Stock units</div>
      <div class="value">${Number(data.total_units || 0).toLocaleString('en-US')}</div>
      <div class="foot">Across all locations</div>
    </div>
    <div class="kpi">
      <div class="label">Inventory value</div>
      <div class="value">${fmtMoneyCompact(data.total_value)}</div>
      <div class="foot">Quantity × unit cost</div>
    </div>
    <div class="kpi">
      <div class="label">Needs ordering</div>
      <div class="value">${(data.low_stock ?? 0) + (data.out_of_stock ?? 0)}</div>
      <div class="foot ${data.out_of_stock ? 'critical' : ''}">
        ${data.low_stock ?? 0} low · ${data.out_of_stock ?? 0} out
      </div>
    </div>
  </div>

  ${
    data.pending_review
      ? `
        <div class="section">
          <div class="attention-row" data-route="#/stock/review">
            <div class="attention-main">
              <div class="title">
                ${data.pending_review} stock line${data.pending_review === 1 ? '' : 's'} awaiting review
              </div>
              <div class="issue critical">
                ${Icons.warning}
                These lines could not be matched to a product confidently, so no stock was moved.
              </div>
            </div>
            <div class="attention-cta">Review ${Icons.arrowRight}</div>
          </div>
        </div>
      `
      : ''
  }

  <div class="section">
    <div class="section-head">
      <h2>Recent stock movements</h2>
      <button class="section-link" data-route="#/stock/transactions">View all →</button>
    </div>

    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>SKU</th>
            <th>Product</th>
            <th>Movement</th>
            <th class="th-num">Qty</th>
            <th>By</th>
            <th>When</th>
          </tr>
        </thead>
        <tbody>
          ${
            rows ||
            `
              <tr>
                <td colspan="6">
                  <div class="empty-state">
                    ${Icons.stock}
                    <p>No stock movements yet.</p>
                    <div class="hint">Import your stock spreadsheet to establish opening balances.</div>
                  </div>
                </td>
              </tr>
            `
          }
        </tbody>
      </table>
    </div>
  </div>`;
}

// --------------------------------- Products ---------------------------------

const STOCK_FILTERS = [
  ['', 'All'],
  ['IN_STOCK', 'In stock'],
  ['LOW_STOCK', 'Low stock'],
  ['OUT_OF_STOCK', 'Out of stock'],
];

function groupLabel(name) {
  if (!name || name === 'UNGROUPED') return 'Not grouped';

  return String(name);
}

function renderProducts(data, filters) {
  const products = data.products || [];
  const groups = data.groups || [];

  const productRow = (p) => `
      <tr class="clickable" data-product-id="${esc(p.id)}">
        <td class="cell-id">${esc(p.sku || p.product_code || '—')}</td>
        <td class="cell-strong">${esc(p.description)}</td>
        <td class="cell-bin">
          ${esc(p.bin_location || '—')}${p.bin_count > 1 ? ` +${p.bin_count - 1}` : ''}
        </td>
        <td class="cell-muted">${esc(p.category || '—')}</td>
        <td class="cell-num">${fmtQty(p.current_quantity)}</td>
        <td class="cell-muted">${esc(p.unit_of_measure || 'ea')}</td>
        <td class="cell-num">${fmtMoney(p.unit_cost)}</td>
        <td class="cell-num">${fmtMoney(p.inventory_value)}</td>
        <td class="cell-num cell-muted">${p.reorder_level || 0}</td>
        <td>${stockStatusMark(p.stock_status)}</td>
        <td class="cell-muted">${esc(p.last_movement_at ? timeAgo(p.last_movement_at) : '—')}</td>
      </tr>
    `;

  // A store that has grouped any of its stock gets the group treatment, even
  // while only one list has been named — seeing the list it belongs to is how
  // a person knows the grouping took.
  const hasGroups = groups.some(g => g.name !== 'UNGROUPED');

  // With no group chosen the table is not one long list: each stock list gets
  // its own heading, so consumables and fittings read as separate things even
  // when they are on screen together.
  const rows =
    filters.group || !hasGroups
      ? products.map(productRow).join('')
      : (() => {
          const order = [];
          const buckets = new Map();

          products.forEach((p) => {
            const key = p.stock_group || 'UNGROUPED';

            if (!buckets.has(key)) {
              buckets.set(key, []);
              order.push(key);
            }

            buckets.get(key).push(p);
          });

          return order
            .map((key) => `
              <tr class="group-row">
                <td colspan="11">${esc(groupLabel(key))}</td>
              </tr>
              ${buckets.get(key).map(productRow).join('')}
            `)
            .join('');
        })();

  const categoryOptions =
    (data.categories || [])
      .map(c => `<option value="${esc(c)}" ${filters.category === c ? 'selected' : ''}>${esc(c)}</option>`)
      .join('');

  return `
  <div class="page-head">
    <div>
      <h1>Products</h1>
      <p class="sub">
        ${data.total ?? products.length} product${(data.total ?? products.length) === 1 ? '' : 's'}
        ${filters.group ? `in ${esc(groupLabel(filters.group))}` : 'on the product master'}.
      </p>
    </div>

    <div class="page-actions">
      <button class="btn btn-secondary" id="btn-new-product">
        ${Icons.plus} New product
      </button>
      <button class="btn btn-primary" data-route="#/stock/import">
        ${Icons.importFile} Import stock
      </button>
    </div>
  </div>

  <div class="toolbar">
    <div class="toolbar-search">
      ${Icons.search}
      <input
        type="text"
        id="product-search"
        placeholder="Search SKU, bin, description, product code, supplier code or supplier…"
        value="${esc(filters.q || '')}"
      />
    </div>

    <select id="product-category" class="btn btn-secondary" style="padding-right:28px;">
      <option value="">All categories</option>
      ${categoryOptions}
    </select>
  </div>

  ${
    hasGroups
      ? `
        <div class="filter-row group-row-filters">
          <button
            class="filter-chip ${!filters.group ? 'active' : ''}"
            data-stock-group=""
          >All stock</button>
          ${groups.map(g => `
            <button
              class="filter-chip ${filters.group === g.name ? 'active' : ''}"
              data-stock-group="${esc(g.name)}"
            >${esc(groupLabel(g.name))} <span class="chip-count">${g.product_count}</span></button>
          `).join('')}
        </div>
      `
      : ''
  }

  <div class="filter-row">
    ${STOCK_FILTERS.map(([v, l]) => `
      <button
        class="filter-chip ${(filters.status || '') === v ? 'active' : ''}"
        data-stock-status="${esc(v)}"
      >${esc(l)}</button>
    `).join('')}
  </div>

  <div class="card">
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th data-sort="sku">SKU</th>
            <th data-sort="description">Description</th>
            <th>Bin</th>
            <th data-sort="category">Category</th>
            <th class="th-num" data-sort="quantity">Qty</th>
            <th>Unit</th>
            <th class="th-num" data-sort="unit_cost">Unit cost</th>
            <th class="th-num" data-sort="value">Value</th>
            <th class="th-num">Reorder</th>
            <th>Status</th>
            <th data-sort="last_movement">Last movement</th>
          </tr>
        </thead>
        <tbody>
          ${
            rows ||
            `
              <tr>
                <td colspan="11">
                  <div class="empty-state">
                    ${Icons.products}
                    <p>No products match.</p>
                    <div class="hint">Import a stock spreadsheet to create your product master.</div>
                  </div>
                </td>
              </tr>
            `
          }
        </tbody>
      </table>
    </div>
  </div>

  ${renderPager(data)}`;
}

function renderPager(data) {
  const pages = data.pages || 1;

  if (pages <= 1) return '';

  return `
  <div class="toolbar" style="margin-top:16px;justify-content:flex-end;">
    <button class="btn btn-secondary btn-sm" id="page-prev" ${data.page <= 1 ? 'disabled' : ''}>
      Previous
    </button>
    <span style="font-size:12.5px;color:var(--ink-muted);">
      Page ${data.page} of ${pages}
    </span>
    <button class="btn btn-secondary btn-sm" id="page-next" ${data.page >= pages ? 'disabled' : ''}>
      Next
    </button>
  </div>`;
}

// ------------------------------ Product detail ------------------------------

// The answer to "why is the stock what it is": every movement, in order, with
// a running balance and a link to the document that caused it.
function renderProductDetail(detail, history) {
  const product = detail.product;
  const transactions = (history && history.transactions) || [];

  const rows = transactions
    .slice()
    .reverse()
    .map(t => `
      <tr class="clickable" data-transaction-id="${esc(t.id)}">
        <td class="cell-muted">${esc(fmtDateTime(t.created_at))}</td>
        <td>${esc(transactionLabel(t.transaction_type))}</td>
        <td class="cell-num">${signedQuantity(t)}</td>
        <td class="cell-num cell-strong">${Number(t.running_balance).toLocaleString('en-US')}</td>
        <td>
          ${
            t.source_document_type === 'INVOICE' && t.source_document_id
              ? `<button class="section-link" data-invoice-id="${esc(t.source_document_id)}">
                   ${esc(t.invoice_number || 'Invoice')} →
                 </button>`
              : t.source_document_type === 'STOCK_SHEET' && t.source_document_id
                ? `<button class="section-link" data-sheet-link="${esc(t.source_document_id)}">
                     Stock sheet ${esc(t.sheet_number || '')} →
                   </button>`
                : t.source_document_type === 'STOCK_IMPORT'
                  ? '<span class="cell-muted">Spreadsheet import</span>'
                  : '<span class="cell-muted">—</span>'
          }
        </td>
        <td class="cell-muted">${esc(t.reason || '—')}</td>
        <td class="cell-muted">${esc(t.created_by_name || 'System')}</td>
      </tr>
    `)
    .join('');

  return `
  <button class="back-link" data-route="#/stock/products">
    ${Icons.arrowLeft} Products
  </button>

  <div class="page-head">
    <div>
      <h1>${esc(product.description)}</h1>
      <p class="sub">
        ${esc(product.sku || product.product_code || 'No SKU')}
        ${product.category ? ` · ${esc(product.category)}` : ''}
        ${product.supplier_name ? ` · ${esc(product.supplier_name)}` : ''}
      </p>
    </div>

    <div class="page-actions">
      ${stockStatusMark(product.stock_status)}
      <button
        class="btn btn-secondary"
        id="btn-edit-bin"
        data-product-id="${esc(product.id)}"
        data-bin="${esc(product.bin_location || '')}"
      >${product.bin_location ? 'Edit bin' : 'Set bin'}</button>
      <button
        class="btn btn-secondary"
        id="btn-adjust-product"
        data-product-id="${esc(product.id)}"
      >${Icons.adjust} Adjust</button>
    </div>
  </div>

  <div class="stat-inline">
    <div class="item">
      <div class="l">Current quantity</div>
      <div class="v">${fmtQty(product.current_quantity)}</div>
    </div>
    <div class="item">
      <div class="l">Unit cost</div>
      <div class="v">${fmtMoney(product.unit_cost)}</div>
    </div>
    <div class="item">
      <div class="l">Inventory value</div>
      <div class="v">${fmtMoney(product.inventory_value)}</div>
    </div>
    <div class="item">
      <div class="l">Reorder level</div>
      <div class="v">${product.reorder_level || 0}</div>
    </div>
    <div class="item">
      <div class="l">Group</div>
      <div class="v">${esc(product.stock_group || '—')}</div>
    </div>
    <div class="item">
      <div class="l">${(detail.bins || []).length > 1 ? 'Bins' : 'Bin'}</div>
      <div class="v mono">
        ${
          (detail.bins || []).length
            ? esc(detail.bins.map(b => b.bin).join(', '))
            : esc(product.bin_location || '—')
        }
      </div>
    </div>
  </div>

  ${
    detail.reconciled === false
      ? `
        <div class="detail-block" style="border-color:var(--critical);">
          <div class="body" style="padding:14px 18px;">
            <div class="check-row fail" style="border:none;padding:0;">
              <span class="glyph">${Icons.warning}</span>
              <span>
                The cached quantity (${fmtQty(product.current_quantity)}) does not match
                the ledger (${fmtQty(detail.ledger_quantity)}). Run a reconcile from
                Stock Overview.
              </span>
            </div>
          </div>
        </div>
      `
      : ''
  }

  <div class="section">
    <div class="section-head">
      <h2>Movement history</h2>
      <span style="font-size:12.5px;color:var(--ink-faint);">
        ${transactions.length} movement${transactions.length === 1 ? '' : 's'}
        · newest first
      </span>
    </div>

    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Movement</th>
            <th class="th-num">Change</th>
            <th class="th-num">Balance</th>
            <th>Source document</th>
            <th>Reason</th>
            <th>By</th>
          </tr>
        </thead>
        <tbody>
          ${
            rows ||
            `
              <tr>
                <td colspan="7">
                  <div class="empty-state">
                    ${Icons.ledger}
                    <p>No movements recorded for this product.</p>
                  </div>
                </td>
              </tr>
            `
          }
        </tbody>
      </table>
    </div>
  </div>

  ${
    (detail.balances_by_location || []).length > 1
      ? `
        <div class="section">
          <div class="section-head"><h2>By location</h2></div>
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr><th>Location</th><th class="th-num">Quantity</th><th>Last movement</th></tr>
              </thead>
              <tbody>
                ${detail.balances_by_location.map(b => `
                  <tr>
                    <td class="cell-strong">${esc(b.location_name || b.location_code || '—')}</td>
                    <td class="cell-num">${fmtQty(b.quantity)}</td>
                    <td class="cell-muted">${esc(b.last_movement_at ? timeAgo(b.last_movement_at) : '—')}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `
      : ''
  }`;
}

// ------------------------------- Transactions -------------------------------

function renderStockTransactions(data, filters) {
  const rows = (data.transactions || [])
    .map(t => `
      <tr class="clickable" data-transaction-id="${esc(t.id)}">
        <td class="cell-muted">${esc(fmtDateTime(t.created_at))}</td>
        <td class="cell-id">${esc(t.sku || '—')}</td>
        <td class="cell-strong">${esc(t.product_description || '—')}</td>
        <td>${esc(transactionLabel(t.transaction_type))}</td>
        <td class="cell-num">${signedQuantity(t)}</td>
        <td class="cell-num">${t.unit_cost != null ? fmtMoney(t.unit_cost) : '—'}</td>
        <td class="cell-num">${t.total_value != null ? fmtMoney(t.total_value) : '—'}</td>
        <td class="cell-muted">${esc(t.location_code || '—')}</td>
        <td class="cell-muted">${esc(t.created_by_name || 'System')}</td>
      </tr>
    `)
    .join('');

  const typeChips =
    [['', 'All']]
      .concat((data.types || []).map(t => [t, transactionLabel(t)]))
      .map(([v, l]) => `
        <button
          class="filter-chip ${(filters.type || '') === v ? 'active' : ''}"
          data-tx-type="${esc(v)}"
        >${esc(l)}</button>
      `)
      .join('');

  return `
  <div class="page-head">
    <div>
      <h1>Stock transactions</h1>
      <p class="sub">
        ${data.total ?? 0} movement${(data.total ?? 0) === 1 ? '' : 's'} in the ledger.
        Entries are never edited — corrections are posted as adjustments.
      </p>
    </div>
  </div>

  <div class="toolbar">
    <div class="toolbar-search">
      ${Icons.search}
      <input
        type="text"
        id="tx-search"
        placeholder="Search product, SKU, reason, employee or job…"
        value="${esc(filters.q || '')}"
      />
    </div>
  </div>

  <div class="filter-row">${typeChips}</div>

  <div class="card">
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>SKU</th>
            <th>Product</th>
            <th>Movement</th>
            <th class="th-num">Change</th>
            <th class="th-num">Unit cost</th>
            <th class="th-num">Value</th>
            <th>Location</th>
            <th>By</th>
          </tr>
        </thead>
        <tbody>
          ${
            rows ||
            `
              <tr>
                <td colspan="9">
                  <div class="empty-state">
                    ${Icons.ledger}
                    <p>No stock movements match.</p>
                  </div>
                </td>
              </tr>
            `
          }
        </tbody>
      </table>
    </div>
  </div>

  ${renderPager(data)}`;
}

function renderStockTransactionDetail(data) {
  const t = data.transaction;

  // A movement off a sign-out sheet carries the sheet, so the document it came
  // from is always one click away.
  const sheet = data.stock_sheet || {};

  const field = (label, value) => `
    <div class="conf-row">
      <span class="name">${esc(label)}</span>
      <span class="pct" style="min-width:0;text-align:right;">${value}</span>
    </div>
  `;

  return `
  <button class="back-link" data-route="#/stock/transactions">
    ${Icons.arrowLeft} Stock transactions
  </button>

  <div class="page-head">
    <div>
      <h1>${esc(transactionLabel(t.transaction_type))}</h1>
      <p class="sub">
        ${esc(t.product_description || '')}
        ${t.sku ? ` · ${esc(t.sku)}` : ''}
      </p>
      <div class="num" style="font-size:22px;font-weight:600;margin-top:10px;">
        ${signedQuantity(t)} ${esc(t.unit_of_measure || '')}
      </div>
    </div>
  </div>

  <div style="max-width:560px;">
    <div class="detail-block">
      <div class="head"><h3>Movement</h3></div>
      <div class="body" style="padding-top:8px;padding-bottom:14px;">
        ${field('Product', esc(t.product_description || '—'))}
        ${field('SKU', esc(t.sku || '—'))}
        ${field('Type', esc(transactionLabel(t.transaction_type)))}
        ${field('Quantity', signedQuantity(t))}
        ${field('Unit cost', t.unit_cost != null ? fmtMoney(t.unit_cost) : '—')}
        ${field('Total value', t.total_value != null ? fmtMoney(t.total_value) : '—')}
        ${field('Location', esc(t.location_name || t.location_code || '—'))}
        ${field('Date', esc(fmtDateTime(t.created_at)))}
      </div>
    </div>

    <div class="detail-block">
      <div class="head"><h3>Source</h3></div>
      <div class="body" style="padding-top:8px;padding-bottom:14px;">
        ${field('Document type', esc(t.source_document_type || 'Manual'))}
        ${
          t.source_document_type === 'INVOICE' && t.source_document_id
            ? field(
                'Document',
                `<button class="section-link" data-invoice-id="${esc(t.source_document_id)}">
                   ${esc(t.invoice_number || t.source_document_id)} →
                 </button>`
              )
            : t.source_document_type === 'STOCK_SHEET' && t.source_document_id
              ? field(
                  'Document',
                  `<button class="section-link" data-sheet-link="${esc(t.source_document_id)}">
                     ${esc(sheet.sheet_number || t.sheet_number || 'Stock sheet')} →
                   </button>`
                )
              : field('Document', esc(t.source_document_id || '—'))
        }
        ${field('Supplier', esc(t.supplier_name || '—'))}
        ${field('Employee', esc(t.employee_name || '—'))}
        ${field('Job', esc(t.job_reference || '—'))}
        ${field('Match confidence', t.match_confidence != null ? confidenceText(t.match_confidence) : '—')}
      </div>
    </div>

    <div class="detail-block">
      <div class="head"><h3>Record</h3></div>
      <div class="body" style="padding-top:8px;padding-bottom:14px;">
        ${field('Reason', esc(t.reason || '—'))}
        ${field('Notes', esc(t.notes || data.adjustment?.notes || '—'))}
        ${field('Created by', esc(t.created_by_name || 'System'))}
        ${field('Transaction ID', `<span class="mono" style="font-size:11px;">${esc(t.id)}</span>`)}
      </div>
    </div>
  </div>`;
}

// ------------------------------- Adjustments --------------------------------

function renderStockAdjustments(products, recent) {
  const rows = (recent || [])
    .map(t => `
      <tr class="clickable" data-transaction-id="${esc(t.id)}">
        <td class="cell-muted">${esc(fmtDateTime(t.created_at))}</td>
        <td class="cell-id">${esc(t.sku || '—')}</td>
        <td class="cell-strong">${esc(t.product_description || '—')}</td>
        <td class="cell-num">${signedQuantity(t)}</td>
        <td>${esc(t.reason || '—')}</td>
        <td class="cell-muted">${esc(t.created_by_name || 'System')}</td>
      </tr>
    `)
    .join('');

  return `
  <div class="page-head">
    <div>
      <h1>Stock adjustments</h1>
      <p class="sub">
        A correction is posted as its own movement. The original quantity is
        never rewritten.
      </p>
    </div>
  </div>

  <div style="max-width:560px;margin-bottom:34px;">
    <div class="detail-block">
      <div class="head"><h3>New adjustment</h3></div>
      <div class="body" style="padding-top:16px;padding-bottom:18px;">

        <div class="field">
          <label>Product</label>
          <input
            type="text"
            id="adj-product-search"
            placeholder="Search by SKU or description…"
            autocomplete="off"
          />
          <div id="adj-product-results"></div>
          <input type="hidden" id="adj-product-id" />
        </div>

        <div style="display:flex;gap:12px;">
          <div class="field" style="flex:1;">
            <label>Direction</label>
            <select id="adj-direction">
              <option value="1">Increase</option>
              <option value="-1" selected>Decrease</option>
            </select>
          </div>

          <div class="field" style="flex:1;">
            <label>Quantity</label>
            <input type="number" id="adj-quantity" min="0" step="0.01" placeholder="0" />
          </div>
        </div>

        <div class="field">
          <label>Reason</label>
          <select id="adj-reason">
            <option value="">Choose a reason…</option>
            <option>Damaged stock</option>
            <option>Stock count correction</option>
            <option>Write-off</option>
            <option>Found stock</option>
            <option>Returned to supplier</option>
            <option>Data entry correction</option>
            <option>Other</option>
          </select>
        </div>

        <div class="field" style="margin-bottom:18px;">
          <label>Notes</label>
          <input type="text" id="adj-notes" placeholder="Optional" />
        </div>

        <button class="btn btn-primary btn-block" id="btn-post-adjustment">
          Post adjustment
        </button>

      </div>
    </div>
  </div>

  <div class="section">
    <div class="section-head"><h2>Recent adjustments</h2></div>

    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Date</th><th>SKU</th><th>Product</th>
            <th class="th-num">Change</th><th>Reason</th><th>By</th>
          </tr>
        </thead>
        <tbody>
          ${
            rows ||
            `
              <tr>
                <td colspan="6">
                  <div class="empty-state">
                    ${Icons.adjust}
                    <p>No adjustments posted yet.</p>
                  </div>
                </td>
              </tr>
            `
          }
        </tbody>
      </table>
    </div>
  </div>`;
}

// ---------------------------------- Import ----------------------------------

function renderStockImport() {
  return `
  <div class="page-head">
    <div>
      <h1>Import stock</h1>
      <p class="sub">
        Upload your existing stock spreadsheet. Each row becomes a product and
        an opening balance in the ledger.
      </p>
    </div>
  </div>

  <div class="dropzone" id="stock-dropzone">
    <h2>Drag &amp; drop your stock spreadsheet</h2>
    <div class="or">or</div>
    <button class="btn btn-primary" id="btn-select-sheet">
      ${Icons.plus} Select file
    </button>
    <div class="hint">
      Excel (.xlsx) or CSV<br />
      Column names do not need to match — you confirm the mapping next
    </div>
  </div>

  <div id="import-stage"></div>`;
}

/**
 * The mapping step. Every spreadsheet column gets a dropdown so the guess can
 * be corrected before anything is written.
 */
function renderImportMapping(inspection) {
  const fields = inspection.target_fields || [];

  const options = (selected) =>
    ['<option value="">— Ignore this column —</option>']
      .concat(
        fields.map(f =>
          `<option value="${esc(f.key)}" ${selected === f.key ? 'selected' : ''}>${esc(f.label)}</option>`
        )
      )
      .join('');

  const headerRows =
    (inspection.headers || [])
      .map((header, index) => {
        const guess = inspection.suggested_mapping[String(index)] || '';
        const confidence = (inspection.mapping_confidence || {})[String(index)];

        const samples =
          (inspection.sample_rows || [])
            .slice(0, 3)
            .map(row => row[index])
            .filter(v => v !== undefined && String(v).trim())
            .join(' · ');

        return `
          <tr>
            <td>
              <div class="cell-strong">${esc(header || `Column ${index + 1}`)}</div>
              <div class="cell-muted" style="font-size:12px;margin-top:2px;">
                ${esc(samples || 'No sample values')}
              </div>
            </td>
            <td style="width:44px;text-align:center;color:var(--ink-faint);">
              ${Icons.arrowRight}
            </td>
            <td style="width:230px;">
              <select class="btn btn-secondary map-select" data-column="${index}" style="width:100%;">
                ${options(guess)}
              </select>
              ${
                guess && confidence !== undefined && confidence < 1
                  ? '<div class="cell-muted" style="font-size:11.5px;margin-top:4px;">Best guess — please confirm</div>'
                  : ''
              }
            </td>
          </tr>
        `;
      })
      .join('');

  return `
  <div class="section" style="margin-top:30px;">
    <div class="section-head">
      <h2>Confirm the column mapping</h2>
      <span style="font-size:12.5px;color:var(--ink-faint);">
        ${inspection.total_rows} row${inspection.total_rows === 1 ? '' : 's'}
        ${inspection.sheet_name ? ` · sheet “${esc(inspection.sheet_name)}”` : ''}
      </span>
    </div>

    <div class="card">
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Spreadsheet column</th>
              <th></th>
              <th>InvoiceFlow field</th>
            </tr>
          </thead>
          <tbody>${headerRows}</tbody>
        </table>
      </div>
    </div>

    <div class="card" style="margin-top:16px;padding:14px 18px;">
      <div class="field" style="margin-bottom:0;max-width:420px;">
        <label>Stock group for this sheet</label>
        <input
          id="import-stock-group"
          placeholder="e.g. Consumable Stock, Fitting Stock"
        />
        <div class="cell-muted" style="font-size:12px;margin-top:6px;">
          A store keeps its stock as separate lists. Name this one and its
          products stay grouped under it, instead of joining one long list.
          Leave it blank if the sheet has a stock group column of its own.
        </div>
      </div>
    </div>

    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:18px;gap:12px;">
      <span style="font-size:12.5px;color:var(--ink-muted);">
        Each row with a quantity becomes an opening balance transaction.
        <label style="display:flex;align-items:center;gap:7px;margin-top:8px;cursor:pointer;">
          <input type="checkbox" id="import-update-only" />
          <span>
            Only update products that already exist — do not create new ones,
            and do not post any quantities
          </span>
        </label>
      </span>

      <span style="display:flex;gap:8px;">
        <button class="btn btn-secondary" id="btn-cancel-import">Cancel</button>
        <button class="btn btn-primary" id="btn-commit-import">
          Import ${inspection.total_rows} row${inspection.total_rows === 1 ? '' : 's'}
        </button>
      </span>
    </div>
  </div>`;
}

function renderImportResult(result) {
  return `
  <div class="section" style="margin-top:30px;">
    <div class="section-head"><h2>Import complete</h2></div>

    <div class="batch-summary" style="border-top:none;margin-top:0;">
      <div class="item">
        <div class="n">${result.imported}</div>
        <div class="l">${result.update_only ? 'Updated' : 'Imported'}</div>
      </div>
      <div class="item">
        <div class="n">${result.skipped}</div>
        <div class="l">Skipped</div>
      </div>
      ${
        result.bins_recorded
          ? `
            <div class="item">
              <div class="n">${result.bins_recorded}</div>
              <div class="l">Bins recorded</div>
            </div>
          `
          : ''
      }
    </div>

    ${
      // What the import actually did with the settings on the previous screen,
      // so a run that ignored them is visible rather than silent.
      result.stock_group || result.update_only
        ? `
          <div class="body" style="padding:14px 0 0;">
            ${
              result.stock_group
                ? `
                  <div class="check-row pass">
                    <span class="glyph">${Icons.check}</span>
                    <span>Grouped as <strong>${esc(result.stock_group)}</strong>.</span>
                  </div>
                `
                : ''
            }
            ${
              result.update_only
                ? `
                  <div class="check-row pass">
                    <span class="glyph">${Icons.check}</span>
                    <span>
                      Existing products only — nothing was created
                      ${result.skipped ? `, and ${result.skipped} row${result.skipped === 1 ? '' : 's'} matched no product` : ''}
                      — and no stock was moved.
                    </span>
                  </div>
                `
                : ''
            }
          </div>
        `
        : ''
    }

    ${
      (result.errors || []).length
        ? `
          <div class="detail-block" style="margin-top:20px;">
            <div class="head"><h3>Rows that could not be imported</h3></div>
            <div class="body">
              ${result.errors.map(e => `
                <div class="check-row warn">
                  <span class="glyph">${Icons.warning}</span>
                  <span>${esc(e)}</span>
                </div>
              `).join('')}
            </div>
          </div>
        `
        : ''
    }

    <div style="display:flex;gap:8px;margin-top:20px;">
      <button class="btn btn-primary" data-route="#/stock/products">View products</button>
      <button class="btn btn-secondary" data-route="#/stock">Stock overview</button>
    </div>
  </div>`;
}

// ------------------------------- Review queue -------------------------------

function renderStockReview(items) {
  const cards = items
    .map(item => `
      <div class="detail-block" data-review-id="${esc(item.id)}">
        <div class="head">
          <h3>
            ${esc(item.invoice_number || item.source_document_type || 'Document')}
            · ${esc(item.raw_description || 'Unnamed line')}
          </h3>
          <span class="confidence ${Number(item.best_confidence) < 0.9 ? 'low' : ''}">
            best ${Math.round(Number(item.best_confidence || 0) * 100)}%
          </span>
        </div>

        <div class="body" style="padding-top:14px;padding-bottom:16px;">
          <div class="conf-row">
            <span class="name">Quantity</span>
            <span class="pct" style="min-width:0;">${fmtQty(item.quantity)}</span>
          </div>
          <div class="conf-row">
            <span class="name">Supplier</span>
            <span class="pct" style="min-width:0;">${esc(item.supplier_name || '—')}</span>
          </div>

          <div class="eyebrow" style="margin:16px 0 8px;">Possible matches</div>

          ${
            (item.candidates || []).length
              ? item.candidates.map(c => `
                  <label class="intel-row" style="cursor:pointer;align-items:center;">
                    <input
                      type="radio"
                      name="review-${esc(item.id)}"
                      value="${esc(c.product_id)}"
                      style="width:14px;height:14px;margin-right:2px;"
                    />
                    <div style="flex:1;min-width:0;">
                      <div class="title">${esc(c.description)}</div>
                      <div class="detail">
                        ${esc(c.sku || 'No SKU')} · matched on ${esc(c.method || 'similarity')}
                      </div>
                    </div>
                    <span class="confidence ${c.confidence < 0.9 ? 'low' : ''}">
                      ${Math.round(c.confidence * 100)}%
                    </span>
                  </label>
                `).join('')
              : '<div class="cell-muted" style="font-size:13px;">No candidate products were found.</div>'
          }

          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
            <button class="btn btn-secondary btn-sm" data-dismiss="${esc(item.id)}">
              Not a stock item
            </button>
            <button class="btn btn-primary btn-sm" data-resolve="${esc(item.id)}">
              Confirm match
            </button>
          </div>
        </div>
      </div>
    `)
    .join('');

  return `
  <div class="page-head">
    <div>
      <h1>Stock review</h1>
      <p class="sub">
        ${
          items.length
            ? `${items.length} line${items.length === 1 ? '' : 's'} could not be matched confidently. No stock has moved for these.`
            : 'Nothing is waiting for review.'
        }
      </p>
    </div>
  </div>

  ${
    cards ||
    `
      <div class="empty-state">
        ${Icons.check}
        <p>Every document line has been matched.</p>
        <div class="hint">Lines the matcher is unsure about will appear here.</div>
      </div>
    `
  }`;
}

// ------------------------------ Stock sign-out ------------------------------

// A sheet's own progress through the pipeline. The shapes follow the same rule
// as everywhere else: filled = settled, hollow = in flight, square = a person
// has to look at it.
const SHEET_STATUS = {
  UPLOADED:        ['processing',       'Uploaded'],
  PROCESSING:      ['processing',       'Reading'],
  EXTRACTED:       ['review_required',  'Extracted'],
  REVIEW_REQUIRED: ['exception',        'Needs review'],
  READY:           ['review_required',  'Ready to post'],
  POSTED:          ['approved',         'Posted'],
  FAILED:          ['exception',        'Failed'],
  CANCELLED:       ['rejected',         'Cancelled'],
};

const SHEET_ROW_STATUS = {
  PENDING:            ['processing',      'Pending'],
  MATCHED:            ['approved',        'Matched'],
  RESOLVED:           ['approved',        'Corrected'],
  REVIEW_REQUIRED:    ['exception',       'Needs review'],
  INSUFFICIENT_STOCK: ['exception',       'Not enough stock'],
  EXCLUDED:           ['rejected',        'Excluded'],
  POSTED:             ['approved',        'Posted'],
};

function sheetStatusMark(status, table = SHEET_STATUS) {
  const [cls, label] = table[status] || ['processing', status || '—'];

  return `
    <span class="status status-${cls}">
      <span class="mark"></span>${esc(label)}
    </span>
  `;
}

const SHEET_FILTERS = [
  ['', 'All'],
  ['REVIEW_REQUIRED', 'Needs review'],
  ['READY', 'Ready'],
  ['POSTED', 'Posted'],
  ['FAILED', 'Failed'],
];

/**
 * The Stock Sign-Out landing screen: upload, the day's figures, and the
 * history of every sheet that has been through the system.
 */
function renderStockSignOut(data = {}) {
  const metrics = data.metrics || {};
  const totals = metrics.totals || {};
  const sheets = data.sheets || [];
  const filters = data.filters || {};

  const rows = sheets
    .map(sheet => `
      <tr class="clickable" data-sheet-id="${esc(sheet.id)}">
        <td class="cell-id">${esc(sheet.sheet_number)}</td>
        <td class="cell-strong">${esc(sheet.employee_name || 'Unnamed')}</td>
        <td class="cell-muted">${esc(sheet.job_reference || '—')}</td>
        <td class="cell-num">${sheet.row_count ?? 0}</td>
        <td class="cell-num">${fmtQty(sheet.total_quantity)}</td>
        <td>${sheetStatusMark(sheet.status)}</td>
        <td class="cell-muted">${esc(sheet.filename || '—')}</td>
        <td class="cell-muted">${esc(timeAgo(sheet.posted_at || sheet.created_at))}</td>
      </tr>
    `)
    .join('');

  const chips = SHEET_FILTERS
    .map(([value, label]) => `
      <button
        class="filter-chip ${(filters.status || '') === value ? 'active' : ''}"
        data-sheet-status="${esc(value)}"
      >${esc(label)}</button>
    `)
    .join('');

  return `
  <div class="page-head">
    <div>
      <h1>Stock sign-out</h1>
      <p class="sub">
        Upload a stock sign-out sheet and InvoiceFlow will read the products and
        quantities off it and deduct them from inventory once you approve.
      </p>
    </div>
  </div>

  <div class="kpi-row">
    <div class="kpi">
      <div class="label">Sheets today</div>
      <div class="value">${totals.uploaded_today ?? 0}</div>
      <div class="foot">${totals.posted_today ?? 0} posted</div>
    </div>
    <div class="kpi">
      <div class="label">Units issued today</div>
      <div class="value">${fmtQty(metrics.units_issued_today)}</div>
      <div class="foot">
        ${metrics.movements_today ?? 0} movement${metrics.movements_today === 1 ? '' : 's'} ·
        ${fmtQty(metrics.units_issued)} in 30 days
      </div>
    </div>
    <div class="kpi">
      <div class="label">Awaiting review</div>
      <div class="value">${totals.review ?? 0}</div>
      <div class="foot ${totals.review ? 'critical' : ''}">
        ${totals.ready ?? 0} ready to post
      </div>
    </div>
    <div class="kpi">
      <div class="label">Failed documents</div>
      <div class="value">${totals.failed ?? 0}</div>
      <div class="foot ${totals.failed ? 'critical' : ''}">
        ${totals.failed ? 'Retry or cancel these' : 'Nothing failed'}
      </div>
    </div>
  </div>

  <div class="dropzone" id="sheet-dropzone">
    <h2>Drag &amp; drop a stock sign-out sheet</h2>
    <div class="or">or</div>
    <button class="btn btn-primary" id="btn-select-sheet-doc">
      ${Icons.plus} Select file
    </button>
    <div class="hint">
      Photo, PDF, Excel or CSV<br />
      Nothing is deducted until you approve what was read
    </div>
  </div>

  <div id="sheet-stage"></div>

  ${
    (metrics.top_employees || []).length
      ? `
        <div class="section">
          <div class="detail-block">
            <div class="head">
              <h3>Who is taking stock</h3>
              <span style="font-size:11.5px;color:var(--ink-faint);">Units issued · last 90 days</span>
            </div>
            <div class="body">
              ${metrics.top_employees.map(e => `
                <div class="intel-row">
                  <div style="flex:1;min-width:0;">
                    <div class="title">${esc(e.employee_name)}</div>
                    <div class="detail">
                      ${e.movements} movement${e.movements === 1 ? '' : 's'}
                    </div>
                  </div>
                  <span class="num">${fmtQty(e.units)}</span>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      `
      : ''
  }

  <div class="section">
    <div class="section-head">
      <h2>Sign-out sheets</h2>
      <div class="filter-row" style="margin:0;">${chips}</div>
    </div>

    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Sheet</th>
            <th>Employee</th>
            <th>Job</th>
            <th class="th-num">Lines</th>
            <th class="th-num">Units</th>
            <th>Status</th>
            <th>File</th>
            <th>When</th>
          </tr>
        </thead>
        <tbody>
          ${
            rows ||
            `
              <tr>
                <td colspan="8">
                  <div class="empty-state">
                    ${Icons.stock}
                    <p>No sign-out sheets yet.</p>
                    <div class="hint">Upload one above and it will appear here.</div>
                  </div>
                </td>
              </tr>
            `
          }
        </tbody>
      </table>
    </div>
  </div>`;
}

const SHEET_STAGES = [
  'Uploading the sheet',
  'Reading the document',
  'Extracting rows',
  'Matching products',
  'Validating quantities',
];

function renderSheetProcessing(stageIndex, failure) {
  return `
  <div class="detail-block" style="margin-top:24px;">
    <div class="head">
      <h3>${failure ? 'This sheet could not be read' : 'Reading the sheet'}</h3>
    </div>
    <div class="body">
      ${
        failure
          ? `
            <div class="check-row fail" style="border:none;padding:0 0 10px;">
              <span class="glyph">${Icons.warning}</span>
              <span>${esc(failure)}</span>
            </div>
            <div class="cell-muted" style="font-size:12.5px;">
              No stock has been touched. Fix the document and upload it again.
            </div>
          `
          : SHEET_STAGES.map((stage, i) => `
              <div class="batch-row ${i > stageIndex ? 'pending' : ''}">
                ${stepMark(i < stageIndex ? 'done' : i === stageIndex ? 'active' : 'pending')}
                <div class="label"><div class="name">${esc(stage)}</div></div>
              </div>
            `).join('')
      }
    </div>
  </div>`;
}

/**
 * One line of a sheet, with its correction panel when it needs one.
 */
function sheetRowHtml(row, sheet, expandedRowId) {
  const needsWork =
    row.status === 'REVIEW_REQUIRED' || row.status === 'INSUFFICIENT_STOCK';

  const posted = sheet.status === 'POSTED';
  const expanded = expandedRowId === row.id;

  const product =
    row.product_id
      ? `
        <div class="cell-strong">${esc(row.product_description || '—')}</div>
        <div class="cell-muted" style="font-size:12px;">
          ${esc(row.sku || 'No SKU')}
          ${row.product_bin ? ` · bin ${esc(row.product_bin)}` : ''}
          ${row.match_method ? ` · ${esc(String(row.match_method).replace(/_/g, ' '))}` : ''}
        </div>
      `
      : '<span class="cell-muted">Not identified</span>';

  const candidates =
    (row.candidates || [])
      .map(c => `
        <label class="intel-row" style="cursor:pointer;align-items:center;">
          <input
            type="radio"
            name="sheet-row-${esc(row.id)}"
            value="${esc(c.product_id)}"
            style="width:14px;height:14px;margin-right:2px;"
          />
          <div style="flex:1;min-width:0;">
            <div class="title">${esc(c.description)}</div>
            <div class="detail">
              ${esc(c.sku || 'No SKU')} · matched on ${esc(String(c.method || 'similarity').replace(/_/g, ' '))}
            </div>
          </div>
          <span class="confidence ${c.confidence < 0.9 ? 'low' : ''}">
            ${Math.round(Number(c.confidence || 0) * 100)}%
          </span>
        </label>
      `)
      .join('');

  return `
    <tr class="${needsWork ? 'row-attention' : ''}">
      <td class="cell-muted">${row.row_number}</td>
      <td>
        <div class="cell-strong">
          ${esc(row.raw_description || (row.raw_bin ? `Bin ${row.raw_bin}` : '—'))}
        </div>
        <div class="cell-muted" style="font-size:12px;">
          ${
            esc(
              [
                row.raw_product_code,
                row.raw_bin && row.raw_description ? `bin ${row.raw_bin}` : null,
              ]
                .filter(Boolean)
                .join(' · ') || 'No code on the sheet'
            )
          }
        </div>
      </td>
      <td class="cell-num">
        ${row.quantity != null ? fmtQty(row.quantity) : `<span class="cell-muted">${esc(row.raw_quantity || '—')}</span>`}
      </td>
      <td>${product}</td>
      <td class="cell-num">${confidenceText(row.match_confidence)}</td>
      <td class="cell-num">${row.stock_before != null ? fmtQty(row.stock_before) : '—'}</td>
      <td class="cell-num">${row.stock_after != null ? fmtQty(row.stock_after) : '—'}</td>
      <td>
        ${sheetStatusMark(row.status, SHEET_ROW_STATUS)}
        ${row.issue ? `<div class="cell-muted" style="font-size:12px;margin-top:3px;">${esc(row.issue)}</div>` : ''}
      </td>
      <td class="sheet-actions">
        ${
          posted
            ? ''
            : `<button class="btn btn-secondary btn-sm" data-fix-row="${esc(row.id)}">
                 ${expanded ? 'Close' : needsWork ? 'Resolve' : 'Edit'}
               </button>`
        }
      </td>
    </tr>

    ${
      expanded && !posted
        ? `
          <tr class="row-editor">
            <td colspan="9">
              <div class="sheet-editor">

                <div class="eyebrow">What was written on the sheet</div>
                <div class="cell-muted" style="font-size:13px;margin-bottom:14px;">
                  ${
                    row.raw_description
                      ? `“${esc(row.raw_description)}”`
                      : row.raw_bin
                        ? `bin “${esc(row.raw_bin)}” and nothing else`
                        : '“”'
                  }
                  ${row.raw_bin && row.raw_description ? ` · bin “${esc(row.raw_bin)}”` : ''}
                  ${row.raw_quantity ? ` · quantity read as “${esc(row.raw_quantity)}”` : ''}
                </div>

                <div style="display:flex;gap:12px;flex-wrap:wrap;">
                  <div class="field" style="flex:0 0 160px;">
                    <label>Quantity issued</label>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      id="row-qty-${esc(row.id)}"
                      value="${row.quantity != null ? esc(row.quantity) : ''}"
                      placeholder="Type the quantity"
                    />
                  </div>

                  <div class="field" style="flex:1;min-width:220px;">
                    <label>Find a product</label>
                    <input
                      type="search"
                      id="row-search-${esc(row.id)}"
                      placeholder="Search the product master"
                      autocomplete="off"
                    />
                  </div>
                </div>

                <div class="eyebrow" style="margin:16px 0 8px;">Possible matches</div>

                <div id="row-results-${esc(row.id)}">
                  ${candidates || '<div class="cell-muted" style="font-size:13px;">No candidates were found — search above.</div>'}
                </div>

                <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
                  <button class="btn btn-secondary btn-sm" data-exclude-row="${esc(row.id)}">
                    ${row.status === 'EXCLUDED' ? 'Put back on the sheet' : 'Not stock — exclude'}
                  </button>
                  <button class="btn btn-primary btn-sm" data-save-row="${esc(row.id)}">
                    Save correction
                  </button>
                </div>

              </div>
            </td>
          </tr>
        `
        : ''
    }
  `;
}

/**
 * The review screen for one sheet: the document on the left, what was read
 * from it on the right, and the approval that turns it into stock movements.
 */
function renderStockSheetDetail(sheet, opts = {}) {
  const posted = sheet.status === 'POSTED';
  const cancelled = sheet.status === 'CANCELLED';
  const failed = sheet.status === 'FAILED';
  const working = sheet.status === 'UPLOADED' || sheet.status === 'PROCESSING';

  const rows = sheet.rows || [];

  const blocking =
    rows.filter(
      r => r.status === 'REVIEW_REQUIRED' || r.status === 'INSUFFICIENT_STOCK'
    ).length;

  const included = rows.filter(r => r.status !== 'EXCLUDED');

  const isPdf = String(sheet.mime_type || '').includes('pdf');
  const isImage = String(sheet.mime_type || '').startsWith('image/');

  const header = [
    ['employee_name', 'Employee'],
    ['job_reference', 'Job'],
    ['department', 'Department'],
    ['vehicle', 'Vehicle'],
    ['issue_date', 'Date'],
  ];

  return `
  <button class="back-link" data-route="#/stock/signout">
    ${Icons.arrowLeft} Stock sign-out
  </button>

  <div class="page-head">
    <div>
      <h1>${esc(sheet.sheet_number)}</h1>
      <p class="sub">
        ${esc(sheet.filename || 'Uploaded document')}
        ${sheet.created_by_name ? ` · uploaded by ${esc(sheet.created_by_name)}` : ''}
        ${sheet.created_at ? ` · ${esc(fmtDateTime(sheet.created_at))}` : ''}
      </p>
    </div>

    <div class="page-actions decision-bar">
      ${sheetStatusMark(sheet.status)}

      ${
        failed
          ? `<button class="btn btn-secondary" id="btn-retry-sheet">Read it again</button>`
          : ''
      }

      ${
        !posted && !cancelled && userCanApprove()
          ? `
            <button class="btn btn-secondary" id="btn-cancel-sheet">Cancel sheet</button>
            <button
              class="btn btn-primary"
              id="btn-approve-sheet"
              ${blocking || working ? 'disabled' : ''}
            >Approve &amp; deduct stock</button>
          `
          : ''
      }
    </div>
  </div>

  ${
    opts.warning
      ? `
        <div class="detail-block" style="border-color:var(--critical);margin-bottom:20px;">
          <div class="body" style="padding:14px 18px;">
            <div class="check-row fail" style="border:none;padding:0;">
              <span class="glyph">${Icons.warning}</span>
              <span>${esc(opts.warning)}</span>
            </div>
          </div>
        </div>
      `
      : ''
  }

  ${
    posted
      ? `
        <div class="detail-block" style="margin-bottom:20px;">
          <div class="body" style="padding:14px 18px;">
            <div class="check-row pass" style="border:none;padding:0;">
              <span class="glyph">${Icons.check}</span>
              <span>
                Stock issued on ${esc(fmtDateTime(sheet.posted_at))}
                ${sheet.posted_by_name ? ` by ${esc(sheet.posted_by_name)}` : ''}.
                ${included.length} movement${included.length === 1 ? '' : 's'} posted to the ledger.
              </span>
            </div>
          </div>
        </div>
      `
      : ''
  }

  ${
    failed
      ? `
        <div class="detail-block" style="border-color:var(--critical);margin-bottom:20px;">
          <div class="body" style="padding:14px 18px;">
            <div class="check-row fail" style="border:none;padding:0;">
              <span class="glyph">${Icons.warning}</span>
              <span>${esc(sheet.error_message || 'The document could not be read.')}</span>
            </div>
            <div class="cell-muted" style="font-size:12.5px;margin-top:8px;">
              No stock has been touched.
            </div>
          </div>
        </div>
      `
      : ''
  }

  <div class="workspace">

    <div class="doc-panel">
      <div class="doc-toolbar">
        <button class="icon-btn" id="doc-zoom-out" title="Zoom out">${Icons.zoomOut}</button>
        <span class="zoom-label" id="doc-zoom-label">100%</span>
        <button class="icon-btn" id="doc-zoom-in" title="Zoom in">${Icons.zoomIn}</button>
        <button class="icon-btn" id="doc-rotate" title="Rotate">${Icons.rotate}</button>
        <div class="spacer"></div>
        <button class="icon-btn" id="doc-download" title="Download original">${Icons.download}</button>
      </div>

      <div
        class="doc-stage"
        id="doc-stage"
        data-pdf="${isPdf ? '1' : '0'}"
        data-image="${isImage ? '1' : '0'}"
      >
        <div class="doc-empty">Loading document…</div>
      </div>
    </div>

    <div>

      <div class="detail-block">
        <div class="head">
          <h3>Who signed for this</h3>
          ${
            posted
              ? ''
              : '<span style="font-size:11.5px;color:var(--ink-faint);">Correct anything the sheet did not say clearly</span>'
          }
        </div>
        <div class="body">
          <div class="field-grid">
            ${header.map(([key, label]) => `
              <div class="field">
                <label>${esc(label)}</label>
                <input
                  class="sheet-header-field"
                  data-field="${esc(key)}"
                  value="${esc(sheet[key] == null ? '' : sheet[key])}"
                  placeholder="Not on the sheet"
                  ${posted ? 'disabled' : ''}
                />
              </div>
            `).join('')}
          </div>

          ${
            posted
              ? ''
              : `
                <div style="display:flex;justify-content:flex-end;margin-top:14px;">
                  <button class="btn btn-secondary btn-sm" id="btn-save-sheet-header">
                    Save details
                  </button>
                </div>
              `
          }
        </div>
      </div>

      ${
        sheet.extraction_source
          ? `
            <div class="detail-block">
              <div class="head"><h3>How this was read</h3></div>
              <div class="body">
                <div class="conf-row">
                  <span class="name">Source</span>
                  <span class="pct" style="min-width:0;">
                    ${sheet.extraction_source === 'SPREADSHEET' ? 'Read directly from the spreadsheet' : 'Read from the document by AI'}
                  </span>
                </div>
                ${
                  sheet.extraction_model
                    ? `
                      <div class="conf-row">
                        <span class="name">Model</span>
                        <span class="pct" style="min-width:0;">${esc(sheet.extraction_model)}</span>
                      </div>
                    `
                    : ''
                }
                ${
                  Object.entries(sheet.header_confidence || {}).map(([field, score]) => `
                    <div class="conf-row">
                      <span class="name">${esc(field)}</span>
                      <span class="pct" style="min-width:0;">${confidenceText(score)}</span>
                    </div>
                  `).join('')
                }
                <div class="cell-muted" style="font-size:12.5px;margin-top:12px;">
                  A confident reading is never enough on its own — every line is
                  still checked against the product master and against what is
                  actually in stock.
                </div>
              </div>
            </div>
          `
          : ''
      }

    </div>

  </div>

  <div class="section">
    <div class="detail-block">
      <div class="head">
        <h3>What was read from the sheet</h3>
        <span class="confidence">
          ${included.length} line${included.length === 1 ? '' : 's'} ·
          ${sheet.matched_count ?? 0} matched ·
          ${blocking} need${blocking === 1 ? 's' : ''} review
        </span>
      </div>

      <div class="table-wrap">
        <table class="data-table sheet-lines">
          <thead>
            <tr>
              <th style="padding-left:18px;">#</th>
              <th>Read from the sheet</th>
              <th class="th-num">Qty</th>
              <th>Matched product</th>
              <th class="th-num">Confidence</th>
              <th class="th-num">In stock</th>
              <th class="th-num">After issue</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${
              rows.length
                ? rows.map(row => sheetRowHtml(row, sheet, opts.expandedRow)).join('')
                : `
                  <tr>
                    <td colspan="9">
                      <div class="empty-state">
                        ${Icons.review}
                        <p>${working ? 'Still reading this document…' : 'No lines were read from this document.'}</p>
                      </div>
                    </td>
                  </tr>
                `
            }
          </tbody>
        </table>
      </div>
    </div>
  </div>`;
}
