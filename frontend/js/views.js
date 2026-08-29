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
};

function routeTitle(route) {
  if (ROUTE_TITLES[route]) return ROUTE_TITLES[route];

  if (route && route.startsWith('#/invoices/')) return 'Invoice';
  if (route && route.startsWith('#/suppliers/')) return 'Supplier';

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
              : 0;

        return navItem(
          r,
          icon,
          label,
          route === r,
          count,
          r === '#/exceptions' && Boolean(count)
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
