require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const db = require('./db'); // ensures schema is created on boot

// First-boot convenience: if there are no users yet (fresh install), seed
// demo accounts and sample invoices automatically so a pilot can log in
// immediately without a separate manual step. Safe to leave in place —
// it's a no-op once any user exists.
const userCount = db.prepare('SELECT COUNT(*) c FROM users').get().c;
if (userCount === 0) {
  console.log('No users found — running first-boot seed (demo users + sample invoices)...');
  require('./seed').runSeed();
}

const authRoutes = require('./routes/auth');
const { router: invoiceRoutes } = require('./routes/invoices');
const dashboardRoutes = require('./routes/dashboard');
const supplierRoutes = require('./routes/suppliers');
const exportRoutes = require('./routes/export');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.use('/api/auth', authRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/suppliers', supplierRoutes);
app.use('/api/export', exportRoutes);

app.get('/api/health', (req, res) => res.json({
  status: 'ok',
  ai_provider: process.env.AI_PROVIDER || (process.env.ANTHROPIC_API_KEY ? 'claude' : 'mock'),
}));

// Serve the frontend (static build) if present, so the whole app can run from one process.
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
app.use(express.static(FRONTEND_DIR));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
});

// Central error handler — the system must never silently fail.
app.use((err, req, res, next) => {
  console.error('[unhandled]', err);
  res.status(err.status || 500).json({ error: err.message || 'Something went wrong. Please try again.' });
});

app.listen(PORT, () => {
  console.log(`InvoiceFlow backend listening on http://localhost:${PORT}`);
  console.log(`AI provider: ${process.env.AI_PROVIDER || (process.env.ANTHROPIC_API_KEY ? 'claude' : 'mock (no ANTHROPIC_API_KEY set)')}`);
});
