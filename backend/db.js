// server/db.js
//
// InvoiceFlow PostgreSQL database
//
// IMPORTANT:
// DATABASE_URL must be configured in Render environment variables.
//
// Example:
// DATABASE_URL=postgresql://USER:PASSWORD@HOST/DATABASE?sslmode=require
//
// This database is persistent and survives Render deployments/restarts.

const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not configured. Add your Neon PostgreSQL connection string to Render Environment Variables.'
  );
}

const pool = new Pool({
  connectionString: DATABASE_URL,

  ssl: {
    rejectUnauthorized: false
  },

  max: 10,

  idleTimeoutMillis: 30000,

  connectionTimeoutMillis: 10000
});

// ---------------------------------------------------------------------------
// DATABASE CONNECTION TEST
// ---------------------------------------------------------------------------

async function testConnection() {
  const result = await pool.query('SELECT NOW() AS now');

  console.log(
    `[db] PostgreSQL connected: ${result.rows[0].now}`
  );

  return true;
}

// ---------------------------------------------------------------------------
// QUERY
// ---------------------------------------------------------------------------

async function query(text, params = []) {
  return pool.query(text, params);
}

// ---------------------------------------------------------------------------
// GET ONE
// ---------------------------------------------------------------------------

async function get(text, params = []) {
  const result = await pool.query(text, params);

  return result.rows[0] || null;
}

// ---------------------------------------------------------------------------
// GET MANY
// ---------------------------------------------------------------------------

async function all(text, params = []) {
  const result = await pool.query(text, params);

  return result.rows;
}

// ---------------------------------------------------------------------------
// RUN INSERT / UPDATE / DELETE
// ---------------------------------------------------------------------------

async function run(text, params = []) {
  const result = await pool.query(text, params);

  return {
    rowCount: result.rowCount,
    rows: result.rows
  };
}

// ---------------------------------------------------------------------------
// TRANSACTION
// ---------------------------------------------------------------------------

async function transaction(callback) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const result = await callback(client);

    await client.query('COMMIT');

    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// CREATE DATABASE SCHEMA
// ---------------------------------------------------------------------------

async function initializeDatabase() {
  console.log('[db] Initializing PostgreSQL schema...');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (
        role IN ('admin', 'processor', 'reviewer')
      ),
      company_name TEXT DEFAULT 'Demo Company (Pty) Ltd',
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      vat_number TEXT,
      address TEXT,
      contact TEXT,
      normalized_key TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
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

      field_confidence TEXT,

      is_duplicate_of TEXT,

      processed_by TEXT,

      processed_at TIMESTAMPTZ,

      created_by TEXT,

      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

      ai_raw_response TEXT,

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

      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

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

      severity TEXT NOT NULL CHECK (
        severity IN ('info', 'warning', 'error')
      ),

      message TEXT,

      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

      FOREIGN KEY (invoice_id)
        REFERENCES invoices(id)
        ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS invoice_processing_logs (
      id TEXT PRIMARY KEY,

      invoice_id TEXT NOT NULL,

      stage TEXT NOT NULL,

      actor_id TEXT,

      detail TEXT,

      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

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

      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

      FOREIGN KEY (supplier_id)
        REFERENCES suppliers(id)
        ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS goods_received_notes (
      id TEXT PRIMARY KEY,

      po_id TEXT,

      invoice_id TEXT,

      received_date TEXT,

      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

      FOREIGN KEY (po_id)
        REFERENCES purchase_orders(id)
        ON DELETE SET NULL,

      FOREIGN KEY (invoice_id)
        REFERENCES invoices(id)
        ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_invoices_status
      ON invoices(status);

    CREATE INDEX IF NOT EXISTS idx_invoices_supplier
      ON invoices(supplier_name);

    CREATE INDEX IF NOT EXISTS idx_invoices_number
      ON invoices(invoice_number);

    CREATE INDEX IF NOT EXISTS idx_invoices_created
      ON invoices(created_at);

    CREATE INDEX IF NOT EXISTS idx_invoice_documents_invoice
      ON invoice_documents(invoice_id);

    CREATE INDEX IF NOT EXISTS idx_processing_logs_invoice
      ON invoice_processing_logs(invoice_id);

    CREATE INDEX IF NOT EXISTS idx_validation_invoice
      ON invoice_validation_results(invoice_id);
  `);

  console.log('[db] PostgreSQL schema ready.');

  return true;
}

// ---------------------------------------------------------------------------
// EXPORTS
// ---------------------------------------------------------------------------

module.exports = {
  pool,
  query,
  get,
  all,
  run,
  transaction,
  testConnection,
  initializeDatabase
};
