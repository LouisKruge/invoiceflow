// server/app.js
//
// InvoiceFlow production backend
//
// - PostgreSQL database
// - No SQLite
// - No automatic demo users
// - No automatic sample invoices
// - No mock invoice seeding
// - Database connection comes from DATABASE_URL
//

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');

const db = require('./db');

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

// ---------------------------------------------------------------------------
// MIDDLEWARE
// ---------------------------------------------------------------------------

app.use(
  cors()
);

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
  async (req, res) => {

    const geminiConfigured =
      Boolean(
        process.env.GEMINI_API_KEY
      );

    const claudeConfigured =
      Boolean(
        process.env.ANTHROPIC_API_KEY
      );

    let provider =
      (
        process.env.AI_PROVIDER ||
        ''
      )
        .toLowerCase()
        .trim();

    if (!provider) {

      if (geminiConfigured) {
        provider = 'gemini';

      } else if (claudeConfigured) {
        provider = 'claude';

      } else {
        provider = 'none';
      }
    }

    let database;

    try {

      database =
        await db.healthCheck();

    } catch (error) {

      database = {
        connected: false,
        error: error.message
      };
    }

    res.json({

      status:
        database.connected
          ? 'ok'
          : 'degraded',

      database,

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
        'gemini-3.6-flash',

      claude_model:
        process.env.CLAUDE_MODEL ||
        'claude-sonnet-4-6'

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

// ---------------------------------------------------------------------------
// SPA FALLBACK
// ---------------------------------------------------------------------------

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

async function startServer() {

  try {

    // -----------------------------------------------------------------------
    // DATABASE
    //
    // IMPORTANT:
    // This only creates/updates the database schema.
    //
    // It DOES NOT create demo users.
    // It DOES NOT create sample invoices.
    // It DOES NOT reset existing data.
    // -----------------------------------------------------------------------

    console.log(
      '[startup] Initializing PostgreSQL database...'
    );

    await db.initializeDatabase();

    console.log(
      '[startup] PostgreSQL database ready.'
    );

    // -----------------------------------------------------------------------
    // AI CONFIGURATION
    // -----------------------------------------------------------------------

    const geminiConfigured =
      Boolean(
        process.env.GEMINI_API_KEY
      );

    const claudeConfigured =
      Boolean(
        process.env.ANTHROPIC_API_KEY
      );

    let provider =
      (
        process.env.AI_PROVIDER ||
        ''
      )
        .toLowerCase()
        .trim();

    if (!provider) {

      if (geminiConfigured) {

        provider =
          'gemini';

      } else if (claudeConfigured) {

        provider =
          'claude';

      } else {

        provider =
          'none';
      }
    }

    // -----------------------------------------------------------------------
    // SERVER
    // -----------------------------------------------------------------------

    app.listen(
      PORT,
      () => {

        console.log(
          '--------------------------------------------------'
        );

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

        if (
          provider === 'gemini'
        ) {

          console.log(
            `Gemini model: ${
              process.env.GEMINI_MODEL ||
              'gemini-3.6-flash'
            }`
          );
        }

        if (
          provider === 'claude'
        ) {

          console.log(
            `Claude model: ${
              process.env.CLAUDE_MODEL ||
              'claude-sonnet-4-6'
            }`
          );
        }

        console.log(
          'Demo/sample database seeding: DISABLED'
        );

        console.log(
          '--------------------------------------------------'
        );
      }
    );

  } catch (error) {

    console.error(
      '--------------------------------------------------'
    );

    console.error(
      '[startup] InvoiceFlow failed to start.'
    );

    console.error(
      '[startup] Database initialization error:'
    );

    console.error(
      error
    );

    console.error(
      '--------------------------------------------------'
    );

    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// START
// ---------------------------------------------------------------------------

startServer();

// ---------------------------------------------------------------------------
// EXPORT
// ---------------------------------------------------------------------------

module.exports = app;
