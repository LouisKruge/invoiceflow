require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');

const db = require('./db');

const app = express();

const PORT = process.env.PORT || 4000;

// ---------------------------------------------------------------------------
// MIDDLEWARE
// ---------------------------------------------------------------------------

app.use(cors());

app.use(
  express.json({
    limit: '2mb'
  })
);

// ---------------------------------------------------------------------------
// START SERVER
// ---------------------------------------------------------------------------

async function startServer() {
  try {
    // -----------------------------------------------------------------------
    // DATABASE
    // -----------------------------------------------------------------------

    console.log('[server] Initializing database...');

    await db.testConnection();

    await db.initializeDatabase();

    console.log(
      '[server] Database initialization complete.'
    );

    // -----------------------------------------------------------------------
    // FIRST BOOT
    // -----------------------------------------------------------------------

    const userCount = await db.get(
      `
        SELECT COUNT(*)::int AS count
        FROM users
      `
    );

    if (Number(userCount.count) === 0) {
      console.log(
        'No users found — running first-boot administrator setup...'
      );

      try {
        const seed = require('./seed');

        if (
          seed &&
          typeof seed.runSeed === 'function'
        ) {
          await seed.runSeed();
        } else {
          console.log(
            '[server] seed.runSeed() is not available.'
          );
        }
      } catch (seedError) {
        console.error(
          '[server] First-boot seed failed:',
          seedError
        );

        console.log(
          '[server] Continuing without seed data.'
        );
      }
    } else {
      console.log(
        `[server] Existing users found: ${userCount.count}`
      );
    }

    // -----------------------------------------------------------------------
    // ROUTES
    // -----------------------------------------------------------------------

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

    const stockRoutes =
      require('./routes/stock');

    // -----------------------------------------------------------------------
    // API ROUTES
    // -----------------------------------------------------------------------

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

    app.use(
      '/api/stock',
      stockRoutes
    );

    // -----------------------------------------------------------------------
    // HEALTH CHECK
    // -----------------------------------------------------------------------

    app.get(
      '/api/health',
      async (req, res) => {
        try {
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

            database:
              'postgresql',

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

        } catch (error) {
          console.error(
            '[health]',
            error
          );

          res.status(500).json({
            status: 'error'
          });
        }
      }
    );

    // -----------------------------------------------------------------------
    // FRONTEND
    // -----------------------------------------------------------------------

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

    // -----------------------------------------------------------------------
    // FRONTEND FALLBACK
    //
    // Express 5 DOES NOT support app.get('*', ...).
    // Use a regular middleware instead.
    // -----------------------------------------------------------------------

    app.use(
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
          ),
          (error) => {
            if (error) {
              next(error);
            }
          }
        );
      }
    );

    // -----------------------------------------------------------------------
    // 404 API HANDLER
    // -----------------------------------------------------------------------

    app.use(
      (req, res, next) => {
        if (
          req.path.startsWith('/api/')
        ) {
          return res.status(404).json({
            error:
              'API endpoint not found'
          });
        }

        next();
      }
    );

    // -----------------------------------------------------------------------
    // ERROR HANDLER
    // -----------------------------------------------------------------------

    app.use(
      (err, req, res, next) => {
        console.error(
          '[unhandled]',
          err
        );

        if (res.headersSent) {
          return next(err);
        }

        res.status(
          err.status || 500
        ).json({
          error:
            err.message ||
            'Something went wrong. Please try again.'
        });
      }
    );

    // -----------------------------------------------------------------------
    // START LISTENING
    // -----------------------------------------------------------------------

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
          '================================================='
        );

        console.log(
          'InvoiceFlow backend'
        );

        console.log(
          '================================================='
        );

        console.log(
          `Listening on port ${PORT}`
        );

        console.log(
          'Database: PostgreSQL / Neon'
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

        console.log(
          '================================================='
        );
      }
    );

  } catch (error) {
    console.error(
      '================================================='
    );

    console.error(
      '[server] FATAL STARTUP ERROR'
    );

    console.error(
      '================================================='
    );

    console.error(error);

    process.exit(1);
  }
}

startServer();
