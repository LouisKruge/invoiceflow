// views.js — pure(ish) render functions.
// Nothing here calls the API directly;
// app.js wires up events after mounting the returned HTML.
//
// InvoiceFlow production UI:
// - Gemini is the production AI extraction provider.
// - No mock/demo extraction references.
// - No Claude references.
// - Session expiry is handled by api.js/app.js.
// - UI is designed for real company invoice processing.

const Icons = {
  logo: '<svg viewBox="0 0 24 24" fill="none"><path d="M6 3h9l3 3v15H6V3z" stroke="currentColor" stroke-width="1.6"/><path d="M9 9h6M9 13h6M9 17h3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',

  dashboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>',

  invoices: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M7 3h8l4 4v14H7V3z"/><path d="M10 9h6M10 13h6M10 17h4"/></svg>',

  capture: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 8a2 2 0 012-2h1.5l1-2h7l1 2H18a2 2 0 012 2v9a2 2 0 01-2 2H6a2 2 0 01-2-2V8z"/><circle cx="12" cy="13" r="3.3"/></svg>',

  suppliers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 21V8l9-5 9 5v13"/><path d="M9 21v-6h6v6M3 8l9 5 9-5"/></svg>',

  exceptions: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/></svg>',

  reports: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-7"/></svg>',

  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.9 2.9l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.6V21a2 2 0 11-4 0v-.2a1.7 1.7 0 00-1-1.6 1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.9-2.9l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.6-1H3a2 2 0 110-4h.2a1.7 1.7 0 001.6-1 1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.9-2.9l.1.1a1.7 1.7 0 001.9.3H9a1.7 1.7 0 001-1.6V3a2 2 0 114 0v.2a1.7 1.7 0 001 1.6 1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.9 2.9l-.1.1a1.7 1.7 0 00-.3 1.9V9a1.7 1.7 0 001.6 1H21a2 2 0 110 4h-.2a1.7 1.7 0 00-1.6 1z"/></svg>',

  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',

  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',

  alertTriangle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>',

  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',

  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',

  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',

  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0l-4-4m4 4l4-4"/><path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2"/></svg>',

  fileEmpty: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M7 3h8l4 4v14H7V3z"/></svg>'
};


// ============================================================
// FORMATTING HELPERS
// ============================================================

function fmtMoney(n, currency = 'ZAR') {
  if (n === null || n === undefined || n === '') {
    return '—';
  }

  const symbol =
    currency === 'ZAR'
      ? 'R'
      : (currency || '');

  const numericValue =
    Number(n);

  if (!Number.isFinite(numericValue)) {
    return '—';
  }

  return `${symbol} ${numericValue.toLocaleString(
    'en-ZA',
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }
  )}`;
}


function fmtDate(d) {
  if (!d) {
    return '—';
  }

  const value =
    String(d);

  const date =
    new Date(
      value.includes('T') ||
      value.includes(' ')
        ? value
        : value + 'T00:00:00'
    );

  if (isNaN(date)) {
    return value;
  }

  return date.toLocaleDateString(
    'en-ZA',
    {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    }
  );
}


function fmtDateTime(d) {
  if (!d) {
    return '—';
  }

  const value =
    String(d);

  let date;

  try {
    date =
      new Date(
        value.includes('T')
          ? value
          : value.replace(' ', 'T') + 'Z'
      );
  } catch {
    return value;
  }

  if (isNaN(date)) {
    return value;
  }

  return date.toLocaleString(
    'en-ZA',
    {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    }
  );
}


function timeAgo(d) {
  if (!d) {
    return '—';
  }

  const value =
    String(d);

  const then =
    new Date(
      value.includes('T')
        ? value
        : value.replace(' ', 'T') + 'Z'
    ).getTime();

  if (!Number.isFinite(then)) {
    return '—';
  }

  const diff =
    Math.max(
      0,
      Date.now() - then
    );

  const mins =
    Math.floor(
      diff / 60000
    );

  if (mins < 1) {
    return 'Just now';
  }

  if (mins < 60) {
    return `${mins}m ago`;
  }

  const hrs =
    Math.floor(
      mins / 60
    );

  if (hrs < 24) {
    return `${hrs}h ago`;
  }

  const days =
    Math.floor(
      hrs / 24
    );

  if (days === 1) {
    return 'Yesterday';
  }

  return `${days}d ago`;
}


function initials(name) {
  if (!name) {
    return '?';
  }

  return String(name)
    .split(' ')
    .map(p => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}


function statusLabel(s) {
  return ({
    processing: 'Processing',
    review_required: 'Review',
    approved: 'Approved',
    rejected: 'Rejected',
    duplicate: 'Duplicate',
    exception: 'Exception'
  })[s] || s || 'Unknown';
}


function statusBadge(status) {
  return `
    <span class="badge badge-${esc(status || 'exception')}">
      <span class="badge-dot"></span>
      ${esc(statusLabel(status))}
    </span>
  `;
}


function confidenceTag(score) {
  if (
    score === null ||
    score === undefined ||
    score === ''
  ) {
    return `
      <span class="confidence-tag confidence-low">
        —
      </span>
    `;
  }

  const numeric =
    Number(score);

  if (!Number.isFinite(numeric)) {
    return `
      <span class="confidence-tag confidence-low">
        —
      </span>
    `;
  }

  const safeScore =
    Math.max(
      0,
      Math.min(
        1,
        numeric
      )
    );

  const pct =
    Math.round(
      safeScore * 100
    );

  const cls =
    safeScore >= 0.85
      ? 'confidence-high'
      : safeScore >= 0.6
        ? 'confidence-mid'
        : 'confidence-low';

  return `
    <span class="confidence-tag ${cls}">
      ${pct}%
    </span>
  `;
}


function esc(s) {
  if (
    s === null ||
    s === undefined
  ) {
    return '';
  }

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


// ============================================================
// LOGIN
// ============================================================

function renderLogin(error) {
  return `
    <div class="auth-screen">
      <div class="auth-card">

        <div class="auth-logo">
          <div class="mark">
            ${Icons.logo}
          </div>

          <div class="word">
            InvoiceFlow
          </div>
        </div>

        <h1>Sign in</h1>

        <p class="sub">
          Physical invoice → AI capture → validated Excel export.
        </p>

        ${
          error
            ? `
              <div class="auth-error">
                ${esc(error)}
              </div>
            `
            : ''
        }

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

          <div class="field">
            <label>Password</label>

            <input
              type="password"
              name="password"
              required
              autocomplete="current-password"
              placeholder="••••••••"
            />
          </div>

          <button
            class="btn btn-accent btn-block btn-lg"
            type="submit"
          >
            Sign in
          </button>

        </form>

      </div>
    </div>
  `;
}


// ============================================================
// APPLICATION SHELL
// ============================================================

function navItem(
  route,
  icon,
  label,
  active,
  count,
  exception
) {
  return `
    <button
      class="nav-item ${active ? 'active' : ''} ${exception ? 'exception-item' : ''}"
      data-route="${esc(route)}"
    >
      ${icon}
      <span>${esc(label)}</span>

      ${
        count
          ? `<span class="count">${esc(count)}</span>`
          : ''
      }
    </button>
  `;
}


function renderShell(
  route,
  user,
  exceptionsCount,
  contentHtml
) {
  const items = [
    [
      '#/dashboard',
      Icons.dashboard,
      'Dashboard'
    ],
    [
      '#/invoices',
      Icons.invoices,
      'Invoices'
    ],
    [
      '#/capture',
      Icons.capture,
      'Capture Invoice'
    ],
    [
      '#/suppliers',
      Icons.suppliers,
      'Suppliers'
    ],
    [
      '#/exceptions',
      Icons.exceptions,
      'Exceptions',
      exceptionsCount
    ],
    [
      '#/reports',
      Icons.reports,
      'Reports'
    ]
  ];

  return `
    <div class="shell">

      <aside class="sidebar">

        <div class="sidebar-brand">
          <div class="mark">
            ${Icons.logo}
          </div>

          <div class="word">
            InvoiceFlow
          </div>
        </div>

        <nav class="sidebar-nav">

          ${
            items.map(
              ([r, icon, label, count]) =>
                navItem(
                  r,
                  icon,
                  label,
                  route === r,
                  count,
                  r === '#/exceptions'
                )
            ).join('')
          }

          <div class="nav-divider"></div>

          ${
            navItem(
              '#/settings',
              Icons.settings,
              'Settings',
              route === '#/settings'
            )
          }

        </nav>

        <div class="sidebar-foot">

          <div class="sidebar-user">

            <div class="avatar">
              ${initials(user?.name)}
            </div>

            <div>
              <div class="name">
                ${esc(user?.name || '')}
              </div>

              <div class="role">
                ${esc(user?.role || '')}
              </div>
            </div>

          </div>

          ${
            user?.company_name
              ? `
                <div class="sidebar-company">
                  ${esc(user.company_name)}
                </div>
              `
              : ''
          }

          <button
            class="logout-btn"
            id="logout-btn"
            type="button"
          >
            Sign out
          </button>

        </div>

      </aside>


      <div class="main">

        <div class="topbar">

          <div class="brand">
            <div class="mark">
              ${Icons.logo}
            </div>

            InvoiceFlow
          </div>

          <button
            class="icon-btn"
            id="mobile-nav-btn"
            type="button"
            aria-label="Open navigation"
          >
            ${Icons.menu}
          </button>

        </div>

        <div class="content">
          ${contentHtml}
        </div>

      </div>

      <button
        class="fab"
        id="fab-capture"
        title="Capture invoice"
        type="button"
      >
        ${Icons.plus}
      </button>

    </div>
  `;
}


// ============================================================
// DASHBOARD
// ============================================================

function renderDashboard(d = {}) {
  const rows =
    (d.recent_invoices || [])
      .map(inv => `
        <tr data-id="${esc(inv.id)}">

          <td class="mono">
            ${esc(inv.invoice_number || '—')}
          </td>

          <td>
            ${esc(inv.supplier_name || '—')}
          </td>

          <td class="num-cell">
            ${fmtMoney(
              inv.total_amount,
              inv.currency
            )}
          </td>

          <td>
            ${statusBadge(inv.status)}
          </td>

          <td>
            ${confidenceTag(
              inv.overall_confidence
            )}
          </td>

          <td>
            ${timeAgo(inv.created_at)}
          </td>

        </tr>
      `)
      .join('');

  return `
    <div class="page-head">

      <div>
        <h1>Dashboard</h1>

        <p class="sub">
          Today's invoice processing at a glance.
        </p>
      </div>

      <div class="page-actions">

        <button
          class="btn btn-accent"
          data-route="#/capture"
          type="button"
        >
          ${Icons.plus}
          Capture Invoice
        </button>

      </div>

    </div>


    <div class="stat-grid">

      <div class="card stat-card">
        <div class="label">
          Today's Invoices
        </div>

        <div class="value">
          ${d.today_invoices ?? 0}
        </div>
      </div>


      <div class="card stat-card">
        <div class="label">
          Processed
        </div>

        <div class="value">
          ${d.processed ?? 0}
        </div>
      </div>


      <div class="card stat-card">
        <div class="label">
          Awaiting Review
        </div>

        <div class="value warn">
          ${d.awaiting_review ?? 0}
        </div>
      </div>


      <div class="card stat-card">
        <div class="label">
          Exceptions
        </div>

        <div class="value bad">
          ${d.exceptions ?? 0}
        </div>
      </div>


      <div class="card stat-card">
        <div class="label">
          Total Value
        </div>

        <div class="value accent">
          ${fmtMoney(
            d.total_invoice_value,
            d.currency
          )}
        </div>
      </div>

    </div>


    <div class="card">

      <div
        class="card-pad"
        style="padding-bottom:0;display:flex;justify-content:space-between;align-items:center;"
      >

        <h3
          style="margin:0 0 12px;font-size:14px;"
        >
          Recent Invoices
        </h3>

        ${
          d.avg_processing_seconds
            ? `
              <span
                style="font-size:12px;color:var(--ink-500);"
              >
                Avg processing:
                <strong class="mono">
                  ${esc(d.avg_processing_seconds)}s
                </strong>
              </span>
            `
            : ''
        }

      </div>


      <div class="table-wrap">

        <table
          class="data-table"
          id="recent-table"
        >

          <thead>
            <tr>
              <th>Invoice</th>
              <th>Supplier</th>
              <th style="text-align:right">
                Amount
              </th>
              <th>Status</th>
              <th>Confidence</th>
              <th>Date</th>
            </tr>
          </thead>

          <tbody>

            ${
              rows ||
              `
                <tr>
                  <td colspan="6">

                    <div class="empty-state">
                      ${Icons.fileEmpty}

                      <p>
                        No invoices yet — capture your first one.
                      </p>
                    </div>

                  </td>
                </tr>
              `
            }

          </tbody>

        </table>

      </div>

    </div>
  `;
}


// ============================================================
// CAPTURE
// ============================================================

function renderCapture() {
  return `
    <div class="page-head">

      <div>

        <h1>
          Capture Invoice
        </h1>

        <p class="sub">
          Photograph or upload a physical invoice to begin.
        </p>

      </div>

    </div>


    <div class="capture-hero">

      <div class="icon-wrap">
        ${Icons.capture}
      </div>

      <h2>
        Ready when you are
      </h2>

      <p>
        Take a clear photo of the invoice, or upload an existing
        image or PDF. Gemini AI extraction starts immediately.
      </p>

      <div class="capture-actions">

        <button
          class="btn btn-accent btn-lg"
          id="btn-take-photo"
          type="button"
        >
          ${Icons.capture}
          Take Photo
        </button>

        <button
          class="btn btn-ghost btn-lg"
          id="btn-upload-invoice"
          type="button"
        >
          ${Icons.download}
          Upload Invoice
        </button>

      </div>

    </div>
  `;
}


// ============================================================
// PROCESSING
// ============================================================

function renderProcessing(
  stageIndex,
  stages,
  warningMode
) {
  const safeStages =
    Array.isArray(stages) &&
    stages.length
      ? stages
      : [
          'Uploading invoice',
          'Reading invoice',
          'Extracting data',
          'Validating invoice'
        ];

  const safeIndex =
    Math.max(
      0,
      Math.min(
        safeStages.length - 1,
        Number(stageIndex) || 0
      )
    );

  return `
    <div class="processing-screen">

      <div class="processing-spinner"></div>

      <div class="processing-stage">
        ${esc(safeStages[safeIndex])}
      </div>

      <div class="processing-sub">

        ${
          warningMode
            ? 'This is taking a little longer than usual…'
            : 'Gemini AI is processing the invoice.'
        }

      </div>


      <div class="processing-steps">

        ${
          safeStages
            .map(
              (stage, i) => `
                <div
                  class="processing-step
                    ${i < safeIndex ? 'done' : ''}
                    ${i === safeIndex ? 'active' : ''}"
                >

                  <span class="dot"></span>

                  ${esc(stage)}

                </div>
              `
            )
            .join('')
        }

      </div>

    </div>
  `;
}


// ============================================================
// REVIEW
// ============================================================

const FIELD_DEFS = [
  [
    'supplier_name',
    'Supplier',
    'text',
    2
  ],
  [
    'invoice_number',
    'Invoice Number',
    'mono',
    1
  ],
  [
    'purchase_order_number',
    'PO Number',
    'mono',
    1
  ],
  [
    'supplier_vat_number',
    'VAT Number',
    'mono',
    1
  ],
  [
    'invoice_date',
    'Invoice Date',
    'date',
    1
  ],
  [
    'due_date',
    'Due Date',
    'date',
    1
  ],
  [
    'subtotal',
    'Subtotal',
    'number',
    1
  ],
  [
    'vat_amount',
    'VAT',
    'number',
    1
  ],
  [
    'total_amount',
    'Total',
    'number',
    2
  ],
  [
    'payment_terms',
    'Payment Terms',
    'text',
    2
  ],
  [
    'supplier_address',
    'Supplier Address',
    'text',
    2
  ],
  [
    'supplier_contact',
    'Supplier Contact',
    'text',
    2
  ]
];


function reviewFieldHtml(
  invoice,
  key,
  label,
  type,
  span
) {
  const conf =
    (invoice.field_confidence || {})[key];

  const low =
    invoice.low_confidence_fields &&
    invoice.low_confidence_fields.includes(key);

  const val =
    invoice[key];

  const inputType =
    type === 'number'
      ? 'number'
      : type === 'date'
        ? 'date'
        : 'text';

  const step =
    type === 'number'
      ? 'step="0.01"'
      : '';

  const monoClass =
    (
      type === 'mono' ||
      type === 'number'
    )
      ? ''
      : 'text-field';

  return `
    <div
      class="review-field
        ${low ? 'low-confidence' : ''}
        ${monoClass}"
      data-field="${esc(key)}"
    >

      <div class="rf-head">

        <label>
          ${esc(label)}
        </label>

        ${
          conf !== undefined &&
          conf !== null
            ? confidenceTag(conf)
            : ''
        }

      </div>

      <input
        type="${inputType}"
        ${step}
        value="${esc(val ?? '')}"
        data-field-input="${esc(key)}"
      />

    </div>
  `;
}


function validationRowIcon(vr) {
  if (vr?.passed) {
    return Icons.check;
  }

  return Icons.alertTriangle;
}


function validationRowClass(vr) {
  if (vr?.passed) {
    return 'pass';
  }

  return vr?.severity === 'error'
    ? 'fail'
    : 'warn';
}


function renderReview(
  invoice,
  opts = {}
) {
  const isFinal =
    [
      'approved',
      'rejected'
    ].includes(invoice.status);

  const hasErrorValidation =
    (invoice.validation_results || [])
      .some(
        v =>
          v.severity === 'error' &&
          !v.passed
      );

  const lineItemsRows =
    (invoice.line_items || [])
      .map(li => `
        <tr>

          <td>
            ${esc(
              li.description || '—'
            )}
          </td>

          <td class="num-cell">
            ${li.quantity ?? '—'}
          </td>

          <td class="num-cell">
            ${
              li.unit_price != null
                ? fmtMoney(
                    li.unit_price,
                    invoice.currency
                  )
                : '—'
            }
          </td>

          <td class="num-cell">
            ${
              li.total != null
                ? fmtMoney(
                    li.total,
                    invoice.currency
                  )
                : '—'
            }
          </td>

        </tr>
      `)
      .join('');

  const auditRows =
    (invoice.processing_logs || [])
      .map(l => `
        <div class="audit-entry">

          <span class="t">
            ${fmtDateTime(l.created_at)}
          </span>

          <span class="d">
            ${logStageLabel(l)}

            ${
              l.actor_name
                ? `
                  <span class="actor">
                    — ${esc(l.actor_name)}
                  </span>
                `
                : ''
            }

          </span>

        </div>
      `)
      .join('');

  return `
    <div class="page-head">

      <div>

        <h1>
          ${
            isFinal
              ? 'Invoice Details'
              : 'Invoice Review'
          }
        </h1>

        <p class="sub">

          ${esc(
            invoice.supplier_name ||
            'Unidentified supplier'
          )}

          ${
            invoice.invoice_number
              ? ` · ${esc(invoice.invoice_number)}`
              : ''
          }

        </p>

      </div>

      <div class="page-actions">
        ${statusBadge(invoice.status)}
      </div>

    </div>


    ${
      opts.warning
        ? `
          <div class="review-warning-banner">

            ${Icons.alertTriangle}

            <div>
              ${esc(opts.warning)}
            </div>

          </div>
        `
        : ''
    }


    ${
      hasErrorValidation && !isFinal
        ? `
          <div class="review-warning-banner">

            ${Icons.alertTriangle}

            <div>
              This invoice has validation issues
              that need attention before approval.
            </div>

          </div>
        `
        : ''
    }


    <div class="review-layout">


      <div class="review-doc">

        <div
          id="review-doc-image"
          class="no-doc"
        >
          Loading document…
        </div>


        ${
          !isFinal
            ? `
              <div
                style="margin-top:12px;display:flex;gap:8px;"
              >

                <button
                  class="btn btn-ghost btn-sm"
                  id="btn-retake"
                  type="button"
                  style="flex:1"
                >
                  Retake Photo
                </button>

              </div>
            `
            : ''
        }

      </div>


      <div>


        <div class="card card-pad">

          <div class="review-field-grid">

            ${
              FIELD_DEFS
                .map(
                  ([
                    key,
                    label,
                    type,
                    span
                  ]) => `
                    <div
                      class="${span === 2 ? 'span-2' : ''}"
                    >
                      ${reviewFieldHtml(
                        invoice,
                        key,
                        label,
                        type,
                        span
                      )}
                    </div>
                  `
                )
                .join('')
            }

          </div>

        </div>


        ${
          (invoice.line_items || []).length
            ? `
              <div class="card card-pad line-items-card">

                <h3>
                  Line Items
                </h3>

                <div class="table-wrap">

                  <table class="data-table">

                    <thead>
                      <tr>
                        <th>
                          Description
                        </th>

                        <th style="text-align:right">
                          Qty
                        </th>

                        <th style="text-align:right">
                          Unit Price
                        </th>

                        <th style="text-align:right">
                          Total
                        </th>
                      </tr>
                    </thead>

                    <tbody>
                      ${lineItemsRows}
                    </tbody>

                  </table>

                </div>

              </div>
            `
            : ''
        }


        <div class="card card-pad validation-card">

          <h3>
            AI Validation
          </h3>

          <div class="validation-list">

            ${
              (invoice.validation_results || [])
                .map(
                  vr => `
                    <div
                      class="validation-row
                        ${validationRowClass(vr)}"
                    >

                      ${validationRowIcon(vr)}

                      <span>
                        ${esc(vr.message)}
                      </span>

                    </div>
                  `
                )
                .join('')
              ||
              `
                <div class="validation-row pass">
                  No validation results yet.
                </div>
              `
            }

          </div>

        </div>


        ${
          invoice.processing_logs &&
          invoice.processing_logs.length
            ? `
              <div class="card card-pad audit-card">

                <h3>
                  Processing History
                </h3>

                <div class="audit-log">
                  ${auditRows}
                </div>

              </div>
            `
            : ''
        }


        ${
          !isFinal
            ? `
              <div class="review-actions">

                <button
                  class="btn btn-danger-ghost btn-lg"
                  id="btn-reject"
                  type="button"
                >
                  Reject
                </button>

                <button
                  class="btn btn-accent btn-lg"
                  id="btn-approve"
                  type="button"
                >
                  Approve Invoice
                </button>

              </div>
            `
            : `
              <div class="review-actions">

                <button
                  class="btn btn-ghost btn-lg"
                  data-route="#/invoices"
                  type="button"
                >
                  Back to Invoices
                </button>

              </div>
            `
        }

      </div>

    </div>
  `;
}


// ============================================================
// PROCESSING LOG LABELS
// ============================================================

function logStageLabel(l) {
  const map = {

    uploaded:
      `Invoice uploaded (${l.detail?.filename || 'file'})`,

    ai_extracted:
      `Gemini AI extraction complete`,

    validated:
      `Validated — status set to ${statusLabel(
        l.detail?.status
      )}`,

    field_edited:
      `Manually corrected ${
        (l.detail?.changes || [])
          .map(c => c.field)
          .join(', ')
      }`,

    approved:
      'Invoice approved',

    rejected:
      `Invoice rejected${
        l.detail?.reason
          ? ': ' + l.detail.reason
          : ''
      }`,

    retried:
      'Invoice re-processed using Gemini AI',

    error:
      `Processing error: ${
        l.detail?.message || ''
      }`
  };

  return (
    map[l.stage] ||
    l.stage ||
    'Processing event'
  );
}


// ============================================================
// INVOICE LIST
// ============================================================

const STATUS_FILTERS = [
  [
    'all',
    'All'
  ],
  [
    'processing',
    'Processing'
  ],
  [
    'review_required',
    'Review Required'
  ],
  [
    'approved',
    'Approved'
  ],
  [
    'rejected',
    'Rejected'
  ],
  [
    'duplicate',
    'Duplicate'
  ],
  [
    'exception',
    'Exception'
  ]
];


function renderInvoicesList(
  invoices,
  filters,
  title = 'Invoices'
) {
  const safeInvoices =
    Array.isArray(invoices)
      ? invoices
      : [];

  const safeFilters =
    filters || {};

  const rows =
    safeInvoices
      .map(inv => `
        <tr data-id="${esc(inv.id)}">

          <td class="checkbox-cell">

            <input
              type="checkbox"
              class="row-check"
              data-id="${esc(inv.id)}"
              onclick="event.stopPropagation()"
            />

          </td>

          <td class="mono">
            ${esc(
              inv.invoice_number || '—'
            )}
          </td>

          <td>
            ${esc(
              inv.supplier_name || '—'
            )}
          </td>

          <td class="mono">
            ${esc(
              inv.supplier_vat_number || '—'
            )}
          </td>

          <td>
            ${fmtDate(inv.invoice_date)}
          </td>

          <td class="num-cell">
            ${fmtMoney(
              inv.total_amount,
              inv.currency
            )}
          </td>

          <td>
            ${statusBadge(inv.status)}
          </td>

          <td>
            ${confidenceTag(
              inv.overall_confidence
            )}
          </td>

        </tr>
      `)
      .join('');

  return `
    <div class="page-head">

      <div>

        <h1>
          ${esc(title)}
        </h1>

        <p class="sub">

          ${safeInvoices.length}
          invoice${safeInvoices.length === 1 ? '' : 's'}

        </p>

      </div>


      <div class="page-actions">

        <button
          class="btn btn-ghost"
          id="btn-export-selected"
          type="button"
        >
          ${Icons.download}
          Export Selected
        </button>

        <button
          class="btn btn-ghost"
          id="btn-export-all"
          type="button"
        >
          ${Icons.download}
          Export to Excel
        </button>

        <button
          class="btn btn-accent"
          data-route="#/capture"
          type="button"
        >
          ${Icons.plus}
          Capture Invoice
        </button>

      </div>

    </div>


    <div class="filter-bar">

      <div class="search-input-wrap">

        ${Icons.search}

        <input
          type="text"
          id="invoice-search"
          placeholder="Search invoice #, supplier, VAT, PO, amount…"
          value="${esc(safeFilters.q || '')}"
        />

      </div>

    </div>


    <div class="filter-bar">

      <div class="chip-filter">

        ${
          STATUS_FILTERS
            .map(
              ([value, label]) => `
                <button
                  class="chip ${
                    safeFilters.status === value ||
                    (!safeFilters.status &&
                      value === 'all')
                      ? 'active'
                      : ''
                  }"
                  data-status="${esc(value)}"
                  type="button"
                >
                  ${esc(label)}
                </button>
              `
            )
            .join('')
        }

      </div>

    </div>


    <div class="card">

      <div class="table-wrap">

        <table class="data-table">

          <thead>

            <tr>
              <th></th>
              <th>Invoice</th>
              <th>Supplier</th>
              <th>VAT No.</th>
              <th>Date</th>

              <th style="text-align:right">
                Amount
              </th>

              <th>Status</th>
              <th>Confidence</th>
            </tr>

          </thead>


          <tbody>

            ${
              rows ||
              `
                <tr>

                  <td colspan="8">

                    <div class="empty-state">

                      ${Icons.fileEmpty}

                      <p>
                        No invoices match your filters.
                      </p>

                    </div>

                  </td>

                </tr>
              `
            }

          </tbody>

        </table>

      </div>

    </div>
  `;
}


// ============================================================
// SUPPLIERS
// ============================================================

function renderSuppliers(
  suppliers
) {
  const safeSuppliers =
    Array.isArray(suppliers)
      ? suppliers
      : [];

  const rows =
    safeSuppliers
      .map(s => `
        <div class="supplier-card-row">

          <div>

            <div class="supplier-name">
              ${esc(s.name)}
            </div>

            <div class="supplier-meta">

              ${
                s.vat_number
                  ? `VAT ${esc(s.vat_number)}`
                  : 'No VAT number on file'
              }

              ·

              ${s.invoice_count || 0}
              invoice${
                s.invoice_count === 1
                  ? ''
                  : 's'
              }

            </div>

          </div>


          <div class="supplier-spend">

            <span class="lbl">
              Total spend
            </span>

            ${fmtMoney(
              s.total_spend
            )}

          </div>

        </div>
      `)
      .join('');

  return `
    <div class="page-head">

      <div>

        <h1>
          Suppliers
        </h1>

        <p class="sub">

          ${safeSuppliers.length}
          supplier${
            safeSuppliers.length === 1
              ? ''
              : 's'
          }
          on file.

        </p>

      </div>

    </div>


    <div class="card card-pad">

      ${
        rows ||
        `
          <div class="empty-state">

            ${Icons.suppliers}

            <p>
              No suppliers yet — they're created
              automatically from captured invoices.
            </p>

          </div>
        `
      }

    </div>
  `;
}


// ============================================================
// REPORTS
// ============================================================

function renderReports(
  suppliers,
  summary
) {
  const safeSuppliers =
    Array.isArray(suppliers)
      ? suppliers
      : [];

  const safeSummary =
    summary || {};

  const maxSpend =
    Math.max(
      1,
      ...safeSuppliers.map(
        s => Number(s.total_spend) || 0
      )
    );

  const bars =
    safeSuppliers
      .slice()
      .sort(
        (a, b) =>
          (Number(b.total_spend) || 0) -
          (Number(a.total_spend) || 0)
      )
      .slice(0, 8)
      .map(s => {

        const spend =
          Number(s.total_spend) || 0;

        const width =
          Math.max(
            3,
            (spend / maxSpend) * 100
          );

        return `
          <div style="margin-bottom:12px;">

            <div
              style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:4px;"
            >

              <span>
                ${esc(s.name)}
              </span>

              <span class="mono">
                ${fmtMoney(spend)}
              </span>

            </div>

            <div
              style="height:8px;background:var(--surface-100);border-radius:6px;overflow:hidden;"
            >

              <div
                style="height:100%;background:var(--accent-600);width:${width}%;"
              ></div>

            </div>

          </div>
        `;
      })
      .join('');

  return `
    <div class="page-head">

      <div>

        <h1>
          Reports
        </h1>

        <p class="sub">
          Spend by supplier, current invoice archive.
        </p>

      </div>

    </div>


    <div
      class="stat-grid"
      style="grid-template-columns:repeat(3,1fr);"
    >

      <div class="card stat-card">

        <div class="label">
          Total Invoice Value (Today)
        </div>

        <div class="value accent">
          ${fmtMoney(
            safeSummary.total_invoice_value
          )}
        </div>

      </div>


      <div class="card stat-card">

        <div class="label">
          Avg. Processing Time
        </div>

        <div class="value">

          ${
            safeSummary.avg_processing_seconds
              ? `${esc(
                  safeSummary.avg_processing_seconds
                )}s`
              : '—'
          }

        </div>

      </div>


      <div class="card stat-card">

        <div class="label">
          Suppliers On File
        </div>

        <div class="value">
          ${safeSuppliers.length}
        </div>

      </div>

    </div>


    <div class="card card-pad">

      <h3
        style="margin:0 0 16px;font-size:14px;"
      >
        Spend by Supplier
      </h3>

      ${
        bars ||
        `
          <div class="empty-state">

            ${Icons.reports}

            <p>
              No spend data yet.
            </p>

          </div>
        `
      }

    </div>
  `;
}


// ============================================================
// SETTINGS
// ============================================================

function renderSettings(
  user,
  health
) {
  const aiProvider =
    String(
      health?.ai_provider || 'gemini'
    ).toLowerCase();

  const providerReady =
    aiProvider === 'gemini';

  return `
    <div class="page-head">

      <div>

        <h1>
          Settings
        </h1>

        <p class="sub">
          Account and system configuration.
        </p>

      </div>

    </div>


    <div
      class="card card-pad"
      style="max-width:480px;margin-bottom:16px;"
    >

      <h3
        style="margin:0 0 14px;font-size:14px;"
      >
        Account
      </h3>


      <div class="field">

        <label>
          Name
        </label>

        <input
          value="${esc(user?.name || '')}"
          disabled
        />

      </div>


      <div class="field">

        <label>
          Email
        </label>

        <input
          value="${esc(user?.email || '')}"
          disabled
        />

      </div>


      <div class="field">

        <label>
          Role
        </label>

        <input
          value="${esc(user?.role || '')}"
          disabled
          style="text-transform:capitalize"
        />

      </div>


      <div
        class="field"
        style="margin-bottom:0;"
      >

        <label>
          Company
        </label>

        <input
          value="${esc(user?.company_name || '')}"
          disabled
        />

      </div>

    </div>


    <div
      class="card card-pad"
      style="max-width:480px;"
    >

      <h3
        style="margin:0 0 14px;font-size:14px;"
      >
        AI Extraction
      </h3>


      <div
        style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;"
      >

        <span
          style="font-size:13px;color:var(--ink-500);"
        >
          Provider
        </span>

        <span
          class="badge ${
            providerReady
              ? 'badge-approved'
              : 'badge-exception'
          }"
        >

          <span class="badge-dot"></span>

          ${
            providerReady
              ? 'Gemini AI'
              : esc(aiProvider)
          }

        </span>

      </div>


      <p
        style="font-size:13px;color:var(--ink-500);margin:0 0 6px;"
      >

        InvoiceFlow uses
        <strong style="color:var(--ink-900);">
          Gemini AI
        </strong>
        for invoice image and document extraction.

      </p>


      <p
        style="font-size:12.5px;color:var(--ink-400);margin:0;"
      >

        Invoice data is extracted from the uploaded
        document and then passed through validation
        before it becomes available for review.

      </p>

    </div>
  `;
}
