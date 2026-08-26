// app.js — router + state + event wiring for the InvoiceFlow SPA.
const AppState = {
  user: null,
  health: null,
  invoiceFilters: { q: '', status: 'all' },
  selectedIds: new Set(),
};

const root = document.getElementById('app');

function toast(message, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  document.getElementById('toast-root').appendChild(el);
  setTimeout(() => el.remove(), 3800);
}

function setLoggedIn(token, user) {
  API.setToken(token);
  AppState.user = user;
}
function logout() {
  API.clearToken();
  AppState.user = null;
  location.hash = '#/login';
}

// ------------------------------- Router --------------------------------
const routes = {
  '#/login': renderLoginPage,
  '#/dashboard': renderDashboardPage,
  '#/capture': renderCapturePage,
  '#/invoices': () => renderInvoicesPage({}),
  '#/exceptions': () => renderInvoicesPage({ status: 'exception', title: 'Exceptions', forceExceptionView: true }),
  '#/suppliers': renderSuppliersPage,
  '#/reports': renderReportsPage,
  '#/settings': renderSettingsPage,
};

async function router() {
  let hash = location.hash || '#/dashboard';
  const invoiceMatch = hash.match(/^#\/invoices\/(.+)$/);
  const reviewMatch = hash.match(/^#\/review\/(.+)$/);

  if (!API.token() && hash !== '#/login') { location.hash = '#/login'; return; }
  if (API.token() && hash === '#/login') { location.hash = '#/dashboard'; return; }

  if (API.token() && !AppState.user) {
    try { const { user } = await API.me(); AppState.user = user; }
    catch (e) { logout(); return; }
  }
  if (API.token() && !AppState.health) {
    try { AppState.health = await fetch('/api/health').then(r => r.json()); } catch (e) {}
  }

  if (invoiceMatch) return renderInvoiceDetailPage(invoiceMatch[1]);
  if (reviewMatch) return renderReviewPage(reviewMatch[1]);

  const handler = routes[hash] || renderDashboardPage;
  return handler();
}
window.addEventListener('hashchange', router);
window.addEventListener('DOMContentLoaded', router);

// ------------------------------ Shell mount ------------------------------
async function mountShell(contentHtml, activeRoute) {
  let exceptionsCount = 0;
  try {
    const { invoices } = await API.listInvoices({ status: 'exception' });
    exceptionsCount = invoices.length;
  } catch (e) {}
  root.innerHTML = renderShell(activeRoute, AppState.user, exceptionsCount, contentHtml);
  bindShellEvents();
}

function bindShellEvents() {
  root.querySelectorAll('[data-route]').forEach(el => {
    el.addEventListener('click', () => { location.hash = el.getAttribute('data-route'); });
  });
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) logoutBtn.onclick = logout;
  const fab = document.getElementById('fab-capture');
  if (fab) fab.onclick = () => { location.hash = '#/capture'; };
  const mobileNavBtn = document.getElementById('mobile-nav-btn');
  if (mobileNavBtn) mobileNavBtn.onclick = () => openMobileNav();
}

function openMobileNav() {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.style.justifyContent = 'flex-start';
  backdrop.style.alignItems = 'stretch';
  backdrop.style.padding = '0';
  const items = [
    ['#/dashboard', 'Dashboard'], ['#/invoices', 'Invoices'], ['#/capture', 'Capture Invoice'],
    ['#/suppliers', 'Suppliers'], ['#/exceptions', 'Exceptions'], ['#/reports', 'Reports'], ['#/settings', 'Settings'],
  ];
  backdrop.innerHTML = `<div style="background:var(--ink-900);width:78%;max-width:280px;padding:20px 16px;color:#fff;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
      <div style="font-weight:800;">InvoiceFlow</div>
      <button class="icon-btn" style="color:#fff" id="close-mobile-nav">${Icons.x}</button>
    </div>
    ${items.map(([r, l]) => `<button class="nav-item" data-route="${r}" style="color:#fff">${l}</button>`).join('')}
    <div class="nav-divider"></div>
    <button class="logout-btn" id="mobile-logout-btn">Sign out</button>
  </div>`;
  document.body.appendChild(backdrop);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
  backdrop.querySelector('#close-mobile-nav').onclick = () => backdrop.remove();
  backdrop.querySelector('#mobile-logout-btn').onclick = logout;
  backdrop.querySelectorAll('[data-route]').forEach(el => el.addEventListener('click', () => {
    location.hash = el.getAttribute('data-route'); backdrop.remove();
  }));
}

// -------------------------------- Login page --------------------------------
function renderLoginPage(error) {
  root.innerHTML = renderLogin(error);
  document.querySelectorAll('.demo-chip').forEach(chip => {
    chip.onclick = () => {
      document.querySelector('input[name="email"]').value = chip.dataset.email;
      document.querySelector('input[name="password"]').value = chip.dataset.pass;
    };
  });
  document.getElementById('login-form').onsubmit = async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    try {
      const { token, user } = await API.login(form.get('email'), form.get('password'));
      setLoggedIn(token, user);
      location.hash = '#/dashboard';
      router();
    } catch (err) {
      renderLoginPage(err.message);
    }
  };
}

// ------------------------------ Dashboard page -------------------------------
async function renderDashboardPage() {
  await mountShell(`<div class="loading-inline">Loading dashboard…</div>`, '#/dashboard');
  try {
    const data = await API.dashboardSummary();
    document.querySelector('.content').innerHTML = renderDashboard(data);
    bindShellEvents();
    document.querySelectorAll('#recent-table tbody tr[data-id]').forEach(tr => {
      tr.onclick = () => { location.hash = `#/invoices/${tr.dataset.id}`; };
    });
  } catch (e) { toast(e.message, 'error'); }
}

// -------------------------------- Capture page --------------------------------
async function renderCapturePage() {
  await mountShell(renderCapture(), '#/capture');
  document.getElementById('btn-take-photo').onclick = () => {
    Camera.open({ onCapture: (file) => runCapture(file), onCancel: () => {} });
  };
  document.getElementById('btn-upload-invoice').onclick = () => {
    Camera.openNativePicker({ capture: false, onCapture: (file) => runCapture(file), onCancel: () => {} });
  };
}

const PROCESSING_STAGES = ['Uploading invoice...', 'Reading document...', 'Extracting invoice information...', 'Validating information...'];

async function runCapture(file) {
  let stageIndex = 0;
  root.innerHTML = renderProcessing(stageIndex, PROCESSING_STAGES, false);
  const stageTimer = setInterval(() => {
    if (stageIndex < PROCESSING_STAGES.length - 1) {
      stageIndex++;
      root.innerHTML = renderProcessing(stageIndex, PROCESSING_STAGES, false);
    }
  }, 900);

  try {
    const result = await API.captureInvoice(file);
    clearInterval(stageTimer);
    root.innerHTML = renderProcessing(PROCESSING_STAGES.length - 1, [...PROCESSING_STAGES, 'Complete'].slice(1), false);
    setTimeout(() => {
      location.hash = `#/review/${result.invoice.id}`;
      router();
      if (result.warning) toast(result.warning, 'error');
    }, 500);
  } catch (err) {
    clearInterval(stageTimer);
    toast(`Upload failed: ${err.message}`, 'error');
    location.hash = '#/capture';
    router();
  }
}

// -------------------------------- Review page ---------------------------------
async function renderReviewPage(id, warning) {
  await mountShell(`<div class="loading-inline">Loading invoice…</div>`, '#/invoices');
  try {
    const { invoice } = await API.getInvoice(id);
    await paintReview(invoice, warning);
  } catch (e) { toast(e.message, 'error'); location.hash = '#/invoices'; }
}
async function renderInvoiceDetailPage(id) { return renderReviewPage(id); }

async function paintReview(invoice, warning) {
  document.querySelector('.content').innerHTML = renderReview(invoice, { warning });
  bindShellEvents();

  const docImgWrap = document.getElementById('review-doc-image');
  API.fetchDocumentBlob(invoice.id).then(url => {
    if (url) docImgWrap.outerHTML = `<img id="review-doc-image" src="${url}" alt="Original invoice document" />`;
    else docImgWrap.textContent = 'No document on file';
  }).catch(() => { docImgWrap.textContent = 'Could not load document'; });

  // Editable fields — save on blur if changed.
  document.querySelectorAll('[data-field-input]').forEach(input => {
    const original = input.value;
    input.addEventListener('blur', async () => {
      if (input.value === original) return;
      const field = input.dataset.fieldInput;
      try {
        const { invoice: updated } = await API.updateInvoice(invoice.id, { [field]: input.value });
        toast('Field updated');
        await paintReview(updated, warning);
      } catch (err) { toast(err.message, 'error'); }
    });
  });

  const approveBtn = document.getElementById('btn-approve');
  if (approveBtn) approveBtn.onclick = async () => {
    try {
      approveBtn.disabled = true;
      const { invoice: updated } = await API.approveInvoice(invoice.id);
      toast('Invoice approved', 'success');
      await paintReview(updated);
    } catch (err) { toast(err.message, 'error'); approveBtn.disabled = false; }
  };
  const rejectBtn = document.getElementById('btn-reject');
  if (rejectBtn) rejectBtn.onclick = () => confirmReject(invoice.id);

  const retakeBtn = document.getElementById('btn-retake');
  if (retakeBtn) retakeBtn.onclick = () => {
    Camera.open({
      onCapture: async (file) => {
        root.innerHTML = renderProcessing(1, PROCESSING_STAGES, false);
        try {
          const { invoice: updated } = await API.retryInvoice(invoice.id, file);
          location.hash = `#/review/${updated.id}`;
          router();
        } catch (err) { toast(err.message, 'error'); location.hash = `#/review/${invoice.id}`; router(); }
      },
      onCancel: () => {},
    });
  };
}

function confirmReject(id) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal-card">
      <h3>Reject this invoice?</h3>
      <p>This marks the invoice as rejected and removes it from approval queues. This can be reviewed later in the archive.</p>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="cancel-reject">Cancel</button>
        <button class="btn btn-danger-ghost" id="confirm-reject" style="background:var(--bad-600);color:#fff;">Reject Invoice</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);
  backdrop.querySelector('#cancel-reject').onclick = () => backdrop.remove();
  backdrop.querySelector('#confirm-reject').onclick = async () => {
    try {
      const { invoice } = await API.rejectInvoice(id);
      backdrop.remove();
      toast('Invoice rejected');
      await paintReview(invoice);
    } catch (err) { toast(err.message, 'error'); }
  };
}

// ------------------------------ Invoices list page -----------------------------
async function renderInvoicesPage(opts) {
  await mountShell(`<div class="loading-inline">Loading invoices…</div>`, opts.forceExceptionView ? '#/exceptions' : '#/invoices');
  const filters = opts.status ? { ...AppState.invoiceFilters, status: opts.status } : AppState.invoiceFilters;
  await loadAndPaintInvoices(filters, opts.title, opts.forceExceptionView);
}

async function loadAndPaintInvoices(filters, title, isExceptionView) {
  try {
    const params = { q: filters.q, status: isExceptionView ? undefined : (filters.status === 'all' ? undefined : filters.status) };
    const { invoices } = await API.listInvoices(params);
    const finalList = isExceptionView ? invoices.filter(i => ['exception', 'duplicate'].includes(i.status)) : invoices;
    document.querySelector('.content').innerHTML = renderInvoicesList(finalList, filters, title || 'Invoices');
    bindShellEvents();
    bindInvoicesListEvents(filters, title, isExceptionView);
  } catch (e) { toast(e.message, 'error'); }
}

function bindInvoicesListEvents(filters, title, isExceptionView) {
  document.querySelectorAll('table.data-table tbody tr[data-id]').forEach(tr => {
    tr.onclick = () => { location.hash = `#/invoices/${tr.dataset.id}`; };
  });
  const searchInput = document.getElementById('invoice-search');
  if (searchInput) {
    let t;
    searchInput.oninput = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        AppState.invoiceFilters.q = searchInput.value;
        loadAndPaintInvoices(AppState.invoiceFilters, title, isExceptionView);
      }, 300);
    };
  }
  document.querySelectorAll('.chip[data-status]').forEach(chip => {
    chip.onclick = () => {
      AppState.invoiceFilters.status = chip.dataset.status;
      loadAndPaintInvoices(AppState.invoiceFilters, title, isExceptionView);
    };
  });
  const exportAllBtn = document.getElementById('btn-export-all');
  if (exportAllBtn) exportAllBtn.onclick = () => downloadAuthenticated(API.exportAllUrl(), 'invoiceflow-export.xlsx').catch(e => toast(e.message, 'error'));

  const exportSelectedBtn = document.getElementById('btn-export-selected');
  if (exportSelectedBtn) exportSelectedBtn.onclick = async () => {
    const ids = Array.from(document.querySelectorAll('.row-check:checked')).map(cb => cb.dataset.id);
    if (!ids.length) { toast('Select at least one invoice first', 'error'); return; }
    try {
      const resp = await fetch(`/api/export/selected`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API.token()}` },
        body: JSON.stringify({ ids }),
      });
      if (!resp.ok) throw new Error('Export failed');
      const blob = await resp.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `invoiceflow-selected-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
    } catch (e) { toast(e.message, 'error'); }
  };
}

// -------------------------------- Suppliers page --------------------------------
async function renderSuppliersPage() {
  await mountShell(`<div class="loading-inline">Loading suppliers…</div>`, '#/suppliers');
  try {
    const { suppliers } = await API.listSuppliers();
    document.querySelector('.content').innerHTML = renderSuppliers(suppliers);
    bindShellEvents();
  } catch (e) { toast(e.message, 'error'); }
}

// --------------------------------- Reports page ---------------------------------
async function renderReportsPage() {
  await mountShell(`<div class="loading-inline">Loading reports…</div>`, '#/reports');
  try {
    const [{ suppliers }, summary] = await Promise.all([API.listSuppliers(), API.dashboardSummary()]);
    document.querySelector('.content').innerHTML = renderReports(suppliers, summary);
    bindShellEvents();
  } catch (e) { toast(e.message, 'error'); }
}

// -------------------------------- Settings page ---------------------------------
async function renderSettingsPage() {
  await mountShell(renderSettings(AppState.user, AppState.health), '#/settings');
}
