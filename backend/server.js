require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');

const db = require('./db');

// ---------------------------------------------------------------------------
// FIRST BOOT
// ---------------------------------------------------------------------------

const userCount =
  db.prepare(
    'SELECT COUNT(*) c FROM users'
  ).get().c;

if (userCount === 0) {
  console.log(
    'No users found — running first-boot seed (demo users + sample invoices)...'
  );

  require('./seed').runSeed();
}

// ---------------------------------------------------------------------------
// ROUTES
// ---------------------------------------------------------------------------

const authRoutes =
  require('./routes/auth');

const {
  router: invoiceRoutes
} = require('./routes/invoices');

const dashboardRoutes =
  require('./routes/dashboard');

const supplierRoutes =
  require('./routes/suppliers');

const exportRoutes =
  require('./routes/export');

// ---------------------------------------------------------------------------
// APP
// ---------------------------------------------------------------------------

const app = express();

const PORT =
  process.env.PORT || 4000;

app.use(cors());

app.use(
  express.json({
    limit: '2mb'
  })
);

// ---------------------------------------------------------------------------
// API ROUTES
// ---------------------------------------------------------------------------

app.use(
  '/api/auth',
  authRoutes
);

app.use(
  '/api/invoices',
  invoiceRoutes
);

app.use(
  '/api/dashboard',
  dashboardRoutes
);

app.use(
  '/api/suppliers',
  supplierRoutes
);

app.use(
  '/api/export',
  exportRoutes
);

// ---------------------------------------------------------------------------
// HEALTH CHECK
// ---------------------------------------------------------------------------

app.get(
  '/api/health',
  (req, res) => {

    const geminiConfigured =
      Boolean(
        process.env.GEMINI_API_KEY
      );

    const claudeConfigured =
      Boolean(
        process.env.ANTHROPIC_API_KEY
      );

    let provider =
      process.env.AI_PROVIDER ||
      null;

    if (!provider) {
      if (geminiConfigured) {
        provider = 'gemini';
      } else if (claudeConfigured) {
        provider = 'claude';
      } else {
        provider = 'mock';
      }
    }

    res.json({
      status: 'ok',

      ai_provider:
        provider,

      ai_configured:
        geminiConfigured ||
        claudeConfigured,

      gemini_configured:
        geminiConfigured,

      claude_configured:
        claudeConfigured,

      gemini_model:
        process.env.GEMINI_MODEL ||
        'gemini-2.5-flash'
    });
  }
);

// ---------------------------------------------------------------------------
// FRONTEND
// ---------------------------------------------------------------------------

const FRONTEND_DIR =
  path.join(
    __dirname,
    '..',
    'frontend'
  );

app.use(
  express.static(
    FRONTEND_DIR
  )
);

app.get(
  '*',
  (req, res, next) => {

    if (
      req.path.startsWith('/api/')
    ) {
      return next();
    }

    res.sendFile(
      path.join(
        FRONTEND_DIR,
        'index.html'
      )
    );
  }
);

// ---------------------------------------------------------------------------
// ERROR HANDLER
// ---------------------------------------------------------------------------

app.use(
  (err, req, res, next) => {

    console.error(
      '[unhandled]',
      err
    );

    res.status(
      err.status || 500
    ).json({
      error:
        err.message ||
        'Something went wrong. Please try again.'
    });
  }
);

// ---------------------------------------------------------------------------
// START SERVER
// ---------------------------------------------------------------------------

app.listen(
  PORT,
  () => {

    const geminiConfigured =
      Boolean(
        process.env.GEMINI_API_KEY
      );

    const claudeConfigured =
      Boolean(
        process.env.ANTHROPIC_API_KEY
      );

    let provider =
      process.env.AI_PROVIDER ||
      null;

    if (!provider) {
      if (geminiConfigured) {
        provider = 'gemini';
      } else if (claudeConfigured) {
        provider = 'claude';
      } else {
        provider = 'mock';
      }
    }

    console.log(
      `InvoiceFlow backend listening on port ${PORT}`
    );

    console.log(
      `AI provider: ${provider}`
    );

    console.log(
      `Gemini configured: ${geminiConfigured}`
    );

    console.log(
      `Claude configured: ${claudeConfigured}`
    );

    if (provider === 'gemini') {
      console.log(
        `Gemini model: ${
          process.env.GEMINI_MODEL ||
          'gemini-2.5-flash'
        }`
      );
    }
  }
);
