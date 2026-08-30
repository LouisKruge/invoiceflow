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

// The running build, so "did my deploy take?" has an answer on screen rather
// than being inferred from whether a feature appears to work.
const BUILD = (() => {
  let version = 'unknown';

  try {
    version = require('./package.json').version || 'unknown';
  } catch (error) {
    // Keep the fallback.
  }

  const commit =
    process.env.RENDER_GIT_COMMIT ||
    process.env.GIT_COMMIT ||
    process.env.SOURCE_VERSION ||
    null;

  return {
    version,
    commit: commit ? String(commit).slice(0, 7) : null,
    // Named so a person can check a capability is present without having to
    // find the screen it lives on.
    features: [
      'invoices',
      'stock-ledger',
      'stock-sign-out',
      'bin-numbers',
      'stock-groups',
      'bundled-bin-sheet',
    ],
  };
})();

// Whether the schema is ready to be served.
//
// The port is opened before the database is touched. A migration that has to
// wait — for a lock held by the instance being replaced, most of all — used to
// mean no port, which a host reads as a service that failed to start: the
// deploy is rolled back, the old instance keeps its lock, and the next attempt
// waits on the same thing. Listening first breaks that circle, and the API
// says plainly that it is not ready yet rather than answering with half a
// schema.
const SCHEMA = {
  state: 'starting',
  error: null,
  attempts: 0,
};

/**
 * Brings the schema up, retrying for as long as it takes.
 *
 * Each attempt fails fast rather than hanging, so a lock held elsewhere costs
 * a few seconds and a retry instead of the whole deploy.
 */
async function prepareDatabase() {
  for (let attempt = 1; ; attempt++) {
    SCHEMA.attempts = attempt;

    try {

      console.log(
        `[server] Initializing database (attempt ${attempt})...`
      );

      await db.testConnection();

      await db.initializeDatabase();

      console.log('[server] Database initialization complete.');

      const userCount =
        await db.get('SELECT COUNT(*)::int AS count FROM users');

      if (Number(userCount.count) === 0) {
        console.log(
          'No users found — running first-boot administrator setup...'
        );

        try {
          const seed = require('./seed');

          if (seed && typeof seed.runSeed === 'function') {
            await seed.runSeed();
          } else {
            console.log('[server] seed.runSeed() is not available.');
          }
        } catch (seedError) {
          console.error('[server] First-boot seed failed:', seedError);
          console.log('[server] Continuing without seed data.');
        }
      } else {
        console.log(`[server] Existing users found: ${userCount.count}`);
      }

      SCHEMA.state = 'ready';
      SCHEMA.error = null;

      return;

    } catch (error) {
      SCHEMA.state = 'migrating';
      SCHEMA.error = error.message;

      console.error(
        `[server] Database initialization failed (attempt ${attempt}): ${error.message}`
      );

      // Backing off to a minute, so a database that is down for a while does
      // not turn into a log full of the same line.
      const wait = Math.min(attempt * 5000, 60000);

      console.log(`[server] Retrying in ${Math.round(wait / 1000)}s.`);

      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
}

async function startServer() {
  try {
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

    // Answering with half a schema is worse than saying "not yet". Health is
    // exempt, so a person can see what the server is waiting on.
    app.use('/api', (req, res, next) => {
      if (SCHEMA.state === 'ready' || req.path === '/health') {
        return next();
      }

      return res.status(503).json({
        error:
          'InvoiceFlow is finishing a database update. Try again in a moment.',
        schema: SCHEMA.state,
        detail: SCHEMA.error,
      });
    });

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

            // What is actually running. A deploy that did not take is
            // otherwise indistinguishable from a feature that does not work.
            version: BUILD.version,
            commit: BUILD.commit,
            features: BUILD.features,

            schema: SCHEMA.state,
            schema_error: SCHEMA.error,

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
        // The schema is brought up behind the open port, so a migration that
        // has to wait for a lock cannot stop the service from starting.
        prepareDatabase();

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
          `Build: ${BUILD.version}${BUILD.commit ? ` (${BUILD.commit})` : ''}`
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
