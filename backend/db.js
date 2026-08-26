// server/db.js
//
// InvoiceFlow PostgreSQL database
//
// IMPORTANT:
// - No SQLite
// - No local filesystem database
// - No demo data
// - No automatic seed data
// - PostgreSQL connection comes from DATABASE_URL
//
// Render:
// DATABASE_URL must be configured as an Environment Variable.
//
// Example:
// DATABASE_URL=postgresql://user:password@host/database?sslmode=require

const { Pool } = require('pg');

// -----------------------------------------------------------------------------
// DATABASE CONFIGURATION
// -----------------------------------------------------------------------------

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not configured. Add your PostgreSQL connection string to the Render Environment Variables.'
  );
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,

  // Neon/PostgreSQL requires SSL.
  ssl: {
    rejectUnauthorized: false,
  },

  max: 10,

  idleTimeoutMillis: 30000,

  connectionTimeoutMillis: 10000,
});

// -----------------------------------------------------------------------------
// DATABASE CONNECTION TEST
// -----------------------------------------------------------------------------

pool.on('error', (error) => {
  console.error(
    '[db] Unexpected PostgreSQL pool error:',
    error
  );
});

// -----------------------------------------------------------------------------
// SCHEMA
// -----------------------------------------------------------------------------

const schema = `

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL
    CHECK (role IN ('admin', 'processor', 'reviewer')),
  company_name TEXT DEFAULT 'InvoiceFlow Company',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  vat_number TEXT,
  address TEXT,
  contact TEXT,
  normalized_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,

  invoice_number TEXT,

  supplier_id TEXT,

  supplier_name TEXT,

  supplier_vat_number TEXT,

  supplier_address TEXT,

  supplier_contact TEXT,

  invoice_date TEXT,

  due_date TEXT,

  purchase_order_number TEXT,

  subtotal NUMERIC,

  vat_amount NUMERIC,

  total_amount NUMERIC,

  currency TEXT DEFAULT 'ZAR',

  payment_terms TEXT,

  status TEXT NOT NULL DEFAULT 'processing'
    CHECK (
      status IN (
        'processing',
        'review_required',
        'approved',
        'rejected',
        'duplicate',
        'exception'
      )
    ),

  overall_confidence NUMERIC,

  field_confidence JSONB,

  is_duplicate_of TEXT,

  processed_by TEXT,

  processed_at TIMESTAMPTZ,

  created_by TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  ai_raw_response JSONB,

  FOREIGN KEY (supplier_id)
    REFERENCES suppliers(id)
    ON DELETE SET NULL,

  FOREIGN KEY (processed_by)
    REFERENCES users(id)
    ON DELETE SET NULL,

  FOREIGN KEY (created_by)
    REFERENCES users(id)
    ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS invoice_documents (
  id TEXT PRIMARY KEY,

  invoice_id TEXT NOT NULL,

  file_path TEXT NOT NULL,

  original_filename TEXT,

  mime_type TEXT,

  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  FOREIGN KEY (invoice_id)
    REFERENCES invoices(id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS invoice_line_items (
  id TEXT PRIMARY KEY,

  invoice_id TEXT NOT NULL,

  description TEXT,

  quantity NUMERIC,

  unit_price NUMERIC,

  vat NUMERIC,

  total NUMERIC,

  FOREIGN KEY (invoice_id)
    REFERENCES invoices(id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS invoice_validation_results (
  id TEXT PRIMARY KEY,

  invoice_id TEXT NOT NULL,

  rule_code TEXT NOT NULL,

  passed INTEGER NOT NULL,

  severity TEXT NOT NULL
    CHECK (
      severity IN (
        'info',
        'warning',
        'error'
      )
    ),

  message TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  FOREIGN KEY (invoice_id)
    REFERENCES invoices(id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS invoice_processing_logs (
  id TEXT PRIMARY KEY,

  invoice_id TEXT NOT NULL,

  stage TEXT NOT NULL,

  actor_id TEXT,

  detail JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  FOREIGN KEY (invoice_id)
    REFERENCES invoices(id)
    ON DELETE CASCADE,

  FOREIGN KEY (actor_id)
    REFERENCES users(id)
    ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id TEXT PRIMARY KEY,

  po_number TEXT NOT NULL UNIQUE,

  supplier_id TEXT,

  total_amount NUMERIC,

  status TEXT DEFAULT 'open',

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  FOREIGN KEY (supplier_id)
    REFERENCES suppliers(id)
    ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS goods_received_notes (
  id TEXT PRIMARY KEY,

  po_id TEXT,

  invoice_id TEXT,

  received_date TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  FOREIGN KEY (po_id)
    REFERENCES purchase_orders(id)
    ON DELETE SET NULL,

  FOREIGN KEY (invoice_id)
    REFERENCES invoices(id)
    ON DELETE SET NULL
);

-- ---------------------------------------------------------------------------
-- INDEXES
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_invoices_status
  ON invoices(status);

CREATE INDEX IF NOT EXISTS idx_invoices_supplier
  ON invoices(supplier_name);

CREATE INDEX IF NOT EXISTS idx_invoices_number
  ON invoices(invoice_number);

CREATE INDEX IF NOT EXISTS idx_invoices_created
  ON invoices(created_at);

CREATE INDEX IF NOT EXISTS idx_invoices_created_by
  ON invoices(created_by);

CREATE INDEX IF NOT EXISTS idx_invoice_documents_invoice
  ON invoice_documents(invoice_id);

CREATE INDEX IF NOT EXISTS idx_invoice_line_items_invoice
  ON invoice_line_items(invoice_id);

CREATE INDEX IF NOT EXISTS idx_invoice_validation_invoice
  ON invoice_validation_results(invoice_id);

CREATE INDEX IF NOT EXISTS idx_invoice_logs_invoice
  ON invoice_processing_logs(invoice_id);

`;

// -----------------------------------------------------------------------------
// INITIALIZE DATABASE
// -----------------------------------------------------------------------------

let initializationPromise = null;

async function initializeDatabase() {
  if (initializationPromise) {
    return initializationPromise;
  }

  initializationPromise = (async () => {
    const client = await pool.connect();

    try {
      console.log('[db] Connecting to PostgreSQL...');

      await client.query('SELECT 1');

      console.log('[db] PostgreSQL connection successful.');

      console.log('[db] Checking InvoiceFlow schema...');

      await client.query(schema);

      console.log('[db] InvoiceFlow schema ready.');

    } catch (error) {

      console.error(
        '[db] PostgreSQL initialization failed:',
        error
      );

      initializationPromise = null;

      throw error;

    } finally {
      client.release();
    }
  })();

  return initializationPromise;
}

// -----------------------------------------------------------------------------
// DATABASE HELPERS
// -----------------------------------------------------------------------------

async function query(text, params = []) {

  await initializeDatabase();

  return pool.query(
    text,
    params
  );
}

async function get(text, params = []) {

  const result =
    await query(
      text,
      params
    );

  return result.rows[0] || null;
}

async function all(text, params = []) {

  const result =
    await query(
      text,
      params
    );

  return result.rows;
}

async function run(text, params = []) {

  const result =
    await query(
      text,
      params
    );

  return result;
}

// -----------------------------------------------------------------------------
// TRANSACTION HELPER
// -----------------------------------------------------------------------------

async function transaction(callback) {

  await initializeDatabase();

  const client =
    await pool.connect();

  try {

    await client.query(
      'BEGIN'
    );

    const transactionDb = {

      query: (
        text,
        params = []
      ) =>
        client.query(
          text,
          params
        ),

      get: async (
        text,
        params = []
      ) => {

        const result =
          await client.query(
            text,
            params
          );

        return (
          result.rows[0] ||
          null
        );
      },

      all: async (
        text,
        params = []
      ) => {

        const result =
          await client.query(
            text,
            params
          );

        return result.rows;
      },

      run: (
        text,
        params = []
      ) =>
        client.query(
          text,
          params
        ),
    };

    const result =
      await callback(
        transactionDb
      );

    await client.query(
      'COMMIT'
    );

    return result;

  } catch (error) {

    try {
      await client.query(
        'ROLLBACK'
      );
    } catch (rollbackError) {
      console.error(
        '[db] Rollback failed:',
        rollbackError
      );
    }

    throw error;

  } finally {

    client.release();

  }
}

// -----------------------------------------------------------------------------
// HEALTH CHECK
// -----------------------------------------------------------------------------

async function healthCheck() {

  try {

    await initializeDatabase();

    const result =
      await pool.query(
        'SELECT NOW() AS now'
      );

    return {
      connected: true,
      now: result.rows[0].now,
    };

  } catch (error) {

    return {
      connected: false,
      error: error.message,
    };

  }
}

// -----------------------------------------------------------------------------
// EXPORTS
// -----------------------------------------------------------------------------

module.exports = {

  pool,

  query,

  get,

  all,

  run,

  transaction,

  healthCheck,

  initializeDatabase,

};
