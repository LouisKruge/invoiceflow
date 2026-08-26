// server/app.js
//
// InvoiceFlow production server
//
// IMPORTANT:
// - No automatic demo-data seeding.
// - SQLite persistence is handled by db.js.
// - Render Persistent Disk should be mounted to /data.
// - Authentication is handled by the auth routes.
// - AI extraction is handled by the invoice routes/services.
//

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');

// ---------------------------------------------------------------------------
// DATABASE
// ---------------------------------------------------------------------------

const db = require('./db');

// ---------------------------------------------------------------------------
// ROUTES
// ---------------------------------------------------------------------------

const authRoutes = require('./routes/auth');

const {
  router: invoiceRoutes,
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
  Number(process.env.PORT) || 4000;

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);

// ---------------------------------------------------------------------------
// BODY PARSER
// ---------------------------------------------------------------------------

app.use(
  express.json({
    limit: '10mb',
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: '10mb',
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
      String(
        process.env.AI_PROVIDER || ''
      )
        .trim()
        .toLowerCase();

    if (!provider) {
      if (geminiConfigured) {
        provider = 'gemini';
      } else if (claudeConfigured) {
        provider = 'claude';
      } else {
        provider = 'none';
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
        'gemini-3.6-flash',

      database:
        'sqlite',

      persistence:
        Boolean(
          process.env.RENDER_DISK_PATH ||
          process.env.DATA_DIR
        ),
    });
  }
);

// ---------------------------------------------------------------------------
// API 404
// ---------------------------------------------------------------------------

app.use(
  '/api',
  (req, res) => {
    res.status(404).json({
      error: 'API endpoint not found.',
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
    FRONTEND_DIR,
    {
      maxAge: '1h',
    }
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
  (
    err,
    req,
    res,
    next
  ) => {
    console.error(
      '[unhandled]',
      err
    );

    const status =
      Number(err.status) || 500;

    res.status(status).json({
      error:
        err.message ||
        'Something went wrong. Please try again.',
    });
  }
);

// ---------------------------------------------------------------------------
// START SERVER
// ---------------------------------------------------------------------------

app.listen(
  PORT,
  '0.0.0.0',
  () => {
    const provider =
      String(
        process.env.AI_PROVIDER ||
        ''
      )
        .trim()
        .toLowerCase() ||
      (
        process.env.GEMINI_API_KEY
          ? 'gemini'
          : process.env.ANTHROPIC_API_KEY
            ? 'claude'
            : 'none'
      );

    console.log(
      '================================================='
    );

    console.log(
      'InvoiceFlow backend started'
    );

    console.log(
      `Port: ${PORT}`
    );

    console.log(
      `AI provider: ${provider}`
    );

    console.log(
      `Gemini configured: ${Boolean(
        process.env.GEMINI_API_KEY
      )}`
    );

    console.log(
      `Claude configured: ${Boolean(
        process.env.ANTHROPIC_API_KEY
      )}`
    );

    console.log(
      'Automatic demo seeding: DISABLED'
    );

    console.log(
      '================================================='
    );
  }
);

// ---------------------------------------------------------------------------
// GRACEFUL SHUTDOWN
// ---------------------------------------------------------------------------

function shutdown(signal) {
  console.log(
    `[server] Received ${signal}. Shutting down...`
  );

  try {
    db.close();
  } catch (error) {
    console.error(
      '[server] Database close failed:',
      error.message
    );
  }

  process.exit(0);
}

process.on(
  'SIGTERM',
  () => shutdown('SIGTERM')
);

process.on(
  'SIGINT',
  () => shutdown('SIGINT')
);
