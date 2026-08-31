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

// Managed Postgres (Neon, Render, Supabase) requires SSL, so it stays the
// default. A local server usually has no TLS at all and would refuse the
// connection outright, so allow it to be turned off explicitly — either with
// ?sslmode=disable in the URL or PGSSL=disable in the environment.
const sslDisabled =
  /[?&]sslmode=disable/i.test(DATABASE_URL) ||
  String(process.env.PGSSL || '').toLowerCase() === 'disable';

const pool = new Pool({
  connectionString: DATABASE_URL,

  ssl: sslDisabled
    ? false
    : {
        rejectUnauthorized: false
      },

  max: 10,

  idleTimeoutMillis: 30000,

  connectionTimeoutMillis: 10000,

  // Adding a column needs an exclusive lock on the table. If anything else is
  // holding one — the instance being replaced, mid-request — the ALTER waits,
  // and with no timeout it waits forever: the boot never finishes, the deploy
  // never opens a port, and the thing holding the lock is never replaced.
  // Fifteen seconds turns that deadlock into a retry.
  lock_timeout: 15000,

  // Nothing this app does should run for two minutes. Something that does is
  // wrong, and killing it beats leaving it to hold what it holds.
  statement_timeout: 120000,

  // The one that matters most here: a transaction left open by a request
  // nobody is waiting for any more releases its locks after a minute instead
  // of blocking the next deploy.
  idle_in_transaction_session_timeout: 60000
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

      account_code TEXT,

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

  // -------------------------------------------------------------------------
  // STOCK
  //
  // The inventory model is an event ledger, not a quantity column. Documents
  // produce events, events are appended to stock_transactions, and current
  // stock is derived from those events. stock_balances is a materialized cache
  // of that derivation and must always reconcile against the ledger.
  // -------------------------------------------------------------------------

  await pool.query(`
    CREATE TABLE IF NOT EXISTS stock_locations (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      is_default BOOLEAN NOT NULL DEFAULT FALSE,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    -- Product master. The id is the canonical identifier for every movement;
    -- descriptions vary between suppliers and documents and are never the key.
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,

      sku TEXT,
      product_code TEXT,
      barcode TEXT,

      description TEXT NOT NULL,

      -- Lower-cased, punctuation-stripped, token-sorted form of the
      -- description. Matching compares this, never the raw text.
      normalized_description TEXT,

      category TEXT,
      unit_of_measure TEXT NOT NULL DEFAULT 'ea',

      reorder_level NUMERIC NOT NULL DEFAULT 0,
      unit_cost NUMERIC NOT NULL DEFAULT 0,

      supplier_id TEXT,
      supplier_product_code TEXT,

      -- Where the product physically sits. On a sign-out sheet this is often
      -- the only identifier anyone writes down, so it has to be able to
      -- resolve to a product on its own.
      bin_location TEXT,

      -- Which stock list the product belongs to — consumables, fittings,
      -- electrical. A store keeps these as separate lists and thinks of them
      -- separately, so the product master keeps them apart too.
      stock_group TEXT,

      -- Whether this product is inventory at all. A great deal of what a
      -- company buys is bought for a job and never held: services, one-off
      -- materials, direct-to-site deliveries. Those belong on the invoice and
      -- nowhere near the ledger.
      inventory_type TEXT NOT NULL DEFAULT 'STOCK'
        CHECK (inventory_type IN ('STOCK', 'NON_STOCK')),

      track_inventory BOOLEAN NOT NULL DEFAULT TRUE,

      is_active BOOLEAN NOT NULL DEFAULT TRUE,

      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

      FOREIGN KEY (supplier_id)
        REFERENCES suppliers(id)
        ON DELETE SET NULL,

      FOREIGN KEY (created_by)
        REFERENCES users(id)
        ON DELETE SET NULL
    );

    -- The immutable ledger. Rows are appended, never updated in place: a
    -- correction is another row (STOCK_ADJUSTMENT), not an edit.
    CREATE TABLE IF NOT EXISTS stock_transactions (
      id TEXT PRIMARY KEY,

      product_id TEXT NOT NULL,
      location_id TEXT,

      transaction_type TEXT NOT NULL CHECK (
        transaction_type IN (
          'OPENING_BALANCE',
          'PURCHASE_RECEIPT',
          'STOCK_ISSUE',
          'STOCK_RETURN',
          'STOCK_ADJUSTMENT',
          'STOCK_TRANSFER',
          'STOCK_COUNT'
        )
      ),

      -- quantity is always a positive magnitude; direction carries the sign,
      -- so a row can never accidentally mean the opposite of what it says.
      direction SMALLINT NOT NULL CHECK (direction IN (-1, 1)),
      quantity NUMERIC NOT NULL CHECK (quantity >= 0),

      signed_quantity NUMERIC GENERATED ALWAYS AS (quantity * direction) STORED,

      unit_cost NUMERIC,
      total_value NUMERIC GENERATED ALWAYS AS (quantity * COALESCE(unit_cost, 0)) STORED,

      -- What caused this movement, and which line of it.
      source_document_type TEXT,
      source_document_id TEXT,
      source_line_id TEXT,

      supplier_id TEXT,
      employee_name TEXT,
      job_reference TEXT,

      reason TEXT,
      notes TEXT,

      match_confidence NUMERIC,

      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

      FOREIGN KEY (product_id)
        REFERENCES products(id)
        ON DELETE RESTRICT,

      FOREIGN KEY (location_id)
        REFERENCES stock_locations(id)
        ON DELETE SET NULL,

      FOREIGN KEY (supplier_id)
        REFERENCES suppliers(id)
        ON DELETE SET NULL,

      FOREIGN KEY (created_by)
        REFERENCES users(id)
        ON DELETE SET NULL
    );

    -- Materialized current stock. Derived from the ledger, never authoritative.
    CREATE TABLE IF NOT EXISTS stock_balances (
      product_id TEXT NOT NULL,
      location_id TEXT NOT NULL,
      quantity NUMERIC NOT NULL DEFAULT 0,
      last_movement_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

      PRIMARY KEY (product_id, location_id),

      FOREIGN KEY (product_id)
        REFERENCES products(id)
        ON DELETE CASCADE,

      FOREIGN KEY (location_id)
        REFERENCES stock_locations(id)
        ON DELETE CASCADE
    );

    -- One row per document that has posted stock. The unique constraint is the
    -- idempotency gate: a second attempt to post the same document fails here
    -- rather than doubling the stock.
    CREATE TABLE IF NOT EXISTS stock_document_postings (
      id TEXT PRIMARY KEY,
      document_type TEXT NOT NULL,
      document_id TEXT NOT NULL,
      transaction_count INTEGER NOT NULL DEFAULT 0,
      posted_by TEXT,
      posted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

      UNIQUE (document_type, document_id),

      FOREIGN KEY (posted_by)
        REFERENCES users(id)
        ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS stock_imports (
      id TEXT PRIMARY KEY,
      filename TEXT,
      mime_type TEXT,
      file_path TEXT,

      status TEXT NOT NULL DEFAULT 'pending' CHECK (
        status IN ('pending', 'mapped', 'committed', 'failed', 'cancelled')
      ),

      sheet_name TEXT,
      detected_columns TEXT,
      column_mapping TEXT,
      location_id TEXT,

      total_rows INTEGER NOT NULL DEFAULT 0,
      imported_rows INTEGER NOT NULL DEFAULT 0,
      skipped_rows INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,

      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      committed_at TIMESTAMPTZ,

      FOREIGN KEY (location_id)
        REFERENCES stock_locations(id)
        ON DELETE SET NULL,

      FOREIGN KEY (created_by)
        REFERENCES users(id)
        ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS stock_import_rows (
      id TEXT PRIMARY KEY,
      import_id TEXT NOT NULL,
      row_number INTEGER NOT NULL,

      raw_data TEXT,

      sku TEXT,
      description TEXT,
      category TEXT,
      unit_of_measure TEXT,
      quantity NUMERIC,
      unit_cost NUMERIC,
      supplier_name TEXT,
      supplier_product_code TEXT,
      barcode TEXT,
      reorder_level NUMERIC,

      product_id TEXT,
      transaction_id TEXT,

      status TEXT NOT NULL DEFAULT 'pending' CHECK (
        status IN ('pending', 'imported', 'skipped', 'failed')
      ),
      message TEXT,

      FOREIGN KEY (import_id)
        REFERENCES stock_imports(id)
        ON DELETE CASCADE,

      FOREIGN KEY (product_id)
        REFERENCES products(id)
        ON DELETE SET NULL
    );

    -- Extra metadata for a manual correction. The movement itself is the
    -- linked ledger row; this holds the human reason and any evidence.
    CREATE TABLE IF NOT EXISTS stock_adjustments (
      id TEXT PRIMARY KEY,
      transaction_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      quantity NUMERIC NOT NULL,
      direction SMALLINT NOT NULL CHECK (direction IN (-1, 1)),
      reason TEXT NOT NULL,
      notes TEXT,
      document_path TEXT,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

      FOREIGN KEY (transaction_id)
        REFERENCES stock_transactions(id)
        ON DELETE CASCADE,

      FOREIGN KEY (product_id)
        REFERENCES products(id)
        ON DELETE CASCADE,

      FOREIGN KEY (created_by)
        REFERENCES users(id)
        ON DELETE SET NULL
    );

    -- Learned mappings. Once a person confirms that a supplier's wording means
    -- a given product, the same wording resolves automatically next time.
    CREATE TABLE IF NOT EXISTS document_product_matches (
      id TEXT PRIMARY KEY,
      supplier_id TEXT,
      source_text TEXT NOT NULL,
      normalized_text TEXT NOT NULL,
      source_code TEXT,
      product_id TEXT NOT NULL,
      match_method TEXT,
      confidence NUMERIC,
      times_used INTEGER NOT NULL DEFAULT 1,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

      FOREIGN KEY (supplier_id)
        REFERENCES suppliers(id)
        ON DELETE CASCADE,

      FOREIGN KEY (product_id)
        REFERENCES products(id)
        ON DELETE CASCADE,

      FOREIGN KEY (created_by)
        REFERENCES users(id)
        ON DELETE SET NULL
    );

    -- Lines that could not be matched confidently. They wait here instead of
    -- being guessed into the ledger.
    CREATE TABLE IF NOT EXISTS stock_review_queue (
      id TEXT PRIMARY KEY,

      source_document_type TEXT NOT NULL,
      source_document_id TEXT NOT NULL,
      source_line_id TEXT,

      raw_description TEXT,
      raw_code TEXT,
      quantity NUMERIC,
      unit_cost NUMERIC,

      supplier_id TEXT,
      location_id TEXT,

      candidates TEXT,
      best_confidence NUMERIC,

      status TEXT NOT NULL DEFAULT 'pending' CHECK (
        status IN ('pending', 'resolved', 'dismissed')
      ),

      resolved_product_id TEXT,
      resolved_transaction_id TEXT,
      resolved_by TEXT,
      resolved_at TIMESTAMPTZ,

      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

      FOREIGN KEY (supplier_id)
        REFERENCES suppliers(id)
        ON DELETE SET NULL,

      FOREIGN KEY (location_id)
        REFERENCES stock_locations(id)
        ON DELETE SET NULL,

      FOREIGN KEY (resolved_product_id)
        REFERENCES products(id)
        ON DELETE SET NULL,

      FOREIGN KEY (resolved_by)
        REFERENCES users(id)
        ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
    CREATE INDEX IF NOT EXISTS idx_products_code ON products(product_code);
    CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
    CREATE INDEX IF NOT EXISTS idx_products_supplier ON products(supplier_id);
    CREATE INDEX IF NOT EXISTS idx_products_supplier_code ON products(supplier_product_code);
    CREATE INDEX IF NOT EXISTS idx_products_norm_desc ON products(normalized_description);
    CREATE INDEX IF NOT EXISTS idx_products_active ON products(is_active);

    CREATE INDEX IF NOT EXISTS idx_stock_tx_product ON stock_transactions(product_id);
    CREATE INDEX IF NOT EXISTS idx_stock_tx_location ON stock_transactions(location_id);
    CREATE INDEX IF NOT EXISTS idx_stock_tx_type ON stock_transactions(transaction_type);
    CREATE INDEX IF NOT EXISTS idx_stock_tx_created ON stock_transactions(created_at);
    CREATE INDEX IF NOT EXISTS idx_stock_tx_source
      ON stock_transactions(source_document_type, source_document_id);

    -- A given document line may only move a given product once.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_tx_source_line
      ON stock_transactions(source_document_type, source_document_id, source_line_id)
      WHERE source_document_id IS NOT NULL
        AND source_line_id IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_stock_balances_product ON stock_balances(product_id);
    CREATE INDEX IF NOT EXISTS idx_import_rows_import ON stock_import_rows(import_id);
    CREATE INDEX IF NOT EXISTS idx_review_status ON stock_review_queue(status);
    CREATE INDEX IF NOT EXISTS idx_review_source
      ON stock_review_queue(source_document_type, source_document_id);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_dpm_supplier_text
      ON document_product_matches(COALESCE(supplier_id, ''), normalized_text);
  `);

  // -------------------------------------------------------------------------
  // STOCK SIGN-OUT SHEETS
  //
  // A physical sign-out sheet is a stock issue event. The sheet is captured
  // and extracted first; stock only moves when a person approves it. The two
  // stages are deliberately separate tables of state so a half-read document
  // can never deduct anything.
  // -------------------------------------------------------------------------

  await pool.query(`
    CREATE TABLE IF NOT EXISTS stock_sheets (
      id TEXT PRIMARY KEY,

      -- Human reference, SI-000184 style.
      sheet_number TEXT NOT NULL UNIQUE,

      filename TEXT,
      mime_type TEXT,
      file_path TEXT,
      file_hash TEXT,

      status TEXT NOT NULL DEFAULT 'UPLOADED' CHECK (
        status IN (
          'UPLOADED',
          'PROCESSING',
          'EXTRACTED',
          'REVIEW_REQUIRED',
          'READY',
          'POSTED',
          'FAILED',
          'CANCELLED'
        )
      ),

      -- Header fields read off the sheet.
      employee_name TEXT,
      job_reference TEXT,
      department TEXT,
      vehicle TEXT,
      issue_date TEXT,
      notes TEXT,

      header_confidence TEXT,

      location_id TEXT,

      extraction_provider TEXT,
      extraction_model TEXT,
      extraction_source TEXT,
      ai_raw_response TEXT,

      row_count INTEGER NOT NULL DEFAULT 0,
      matched_count INTEGER NOT NULL DEFAULT 0,
      review_count INTEGER NOT NULL DEFAULT 0,
      total_quantity NUMERIC NOT NULL DEFAULT 0,

      error_message TEXT,

      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

      posted_by TEXT,
      posted_at TIMESTAMPTZ,

      FOREIGN KEY (location_id)
        REFERENCES stock_locations(id)
        ON DELETE SET NULL,

      FOREIGN KEY (created_by)
        REFERENCES users(id)
        ON DELETE SET NULL,

      FOREIGN KEY (posted_by)
        REFERENCES users(id)
        ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS stock_sheet_rows (
      id TEXT PRIMARY KEY,
      sheet_id TEXT NOT NULL,
      row_number INTEGER NOT NULL,

      -- Exactly what the document said, kept verbatim so a correction can
      -- always be compared against the original reading.
      raw_product_code TEXT,
      raw_description TEXT,
      raw_bin TEXT,
      raw_quantity TEXT,
      raw_unit TEXT,
      raw_notes TEXT,

      quantity NUMERIC,
      unit_of_measure TEXT,

      product_id TEXT,
      match_confidence NUMERIC,
      match_method TEXT,
      quantity_confidence NUMERIC,
      candidates TEXT,

      -- Stock position captured at validation, so the review screen can show
      -- what the issue will do before anyone approves it.
      stock_before NUMERIC,
      stock_after NUMERIC,

      status TEXT NOT NULL DEFAULT 'PENDING' CHECK (
        status IN (
          'PENDING',
          'MATCHED',
          'REVIEW_REQUIRED',
          'INSUFFICIENT_STOCK',
          'RESOLVED',
          'EXCLUDED',
          'POSTED'
        )
      ),

      issue TEXT,

      transaction_id TEXT,

      corrected_by TEXT,
      corrected_at TIMESTAMPTZ,

      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

      FOREIGN KEY (sheet_id)
        REFERENCES stock_sheets(id)
        ON DELETE CASCADE,

      FOREIGN KEY (product_id)
        REFERENCES products(id)
        ON DELETE SET NULL,

      FOREIGN KEY (corrected_by)
        REFERENCES users(id)
        ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sheets_status ON stock_sheets(status);
    CREATE INDEX IF NOT EXISTS idx_sheets_created ON stock_sheets(created_at);
    CREATE INDEX IF NOT EXISTS idx_sheets_employee ON stock_sheets(employee_name);
    CREATE INDEX IF NOT EXISTS idx_sheets_job ON stock_sheets(job_reference);
    CREATE INDEX IF NOT EXISTS idx_sheet_rows_sheet ON stock_sheet_rows(sheet_id);
    CREATE INDEX IF NOT EXISTS idx_sheet_rows_product ON stock_sheet_rows(product_id);
    CREATE INDEX IF NOT EXISTS idx_sheet_rows_status ON stock_sheet_rows(status);

    -- The same physical document uploaded twice should be recognised before it
    -- can be posted a second time.
    CREATE INDEX IF NOT EXISTS idx_sheets_hash ON stock_sheets(file_hash);
  `);

  // SYSPRO handshake fields. InvoiceFlow owns the ledger today; these carry the
  // mapping and sync state so a later SYSPRO integration does not require a
  // schema migration on a table that by then holds live history.
  await pool.query(`
    ALTER TABLE stock_transactions
      ADD COLUMN IF NOT EXISTS syspro_stock_code TEXT,
      ADD COLUMN IF NOT EXISTS syspro_warehouse TEXT,
      ADD COLUMN IF NOT EXISTS syspro_transaction_reference TEXT,
      ADD COLUMN IF NOT EXISTS syspro_sync_status TEXT DEFAULT 'NOT_SYNCED',
      ADD COLUMN IF NOT EXISTS syspro_sync_error TEXT;

    ALTER TABLE products
      ADD COLUMN IF NOT EXISTS syspro_stock_code TEXT;

    CREATE INDEX IF NOT EXISTS idx_stock_tx_syspro_status
      ON stock_transactions(syspro_sync_status);
  `);

  // Bin numbers. Stores that write only the bin on a sign-out sheet need it to
  // identify the product, so it is indexed in the same punctuation-free form
  // the matcher compares.
  await pool.query(`
    ALTER TABLE products
      ADD COLUMN IF NOT EXISTS bin_location TEXT;

    CREATE INDEX IF NOT EXISTS idx_products_bin
      ON products (
        UPPER(REGEXP_REPLACE(COALESCE(bin_location, ''), '[^A-Za-z0-9]', '', 'g'))
      );

    ALTER TABLE stock_sheet_rows
      ADD COLUMN IF NOT EXISTS raw_bin TEXT;

    ALTER TABLE products
      ADD COLUMN IF NOT EXISTS stock_group TEXT;

    CREATE INDEX IF NOT EXISTS idx_products_stock_group
      ON products(stock_group);
  `);

  // What an invoice line is allowed to do to stock.
  //
  // An invoice is a record of what was bought, which is not the same as a
  // record of what is held. Every line keeps the decision made about it —
  // matched to a stock product, matched to something deliberately not
  // tracked, not matched at all, or matched and then excluded by a person —
  // so that posting reads a decision rather than making one.
  await pool.query(`
    ALTER TABLE products
      ADD COLUMN IF NOT EXISTS inventory_type TEXT NOT NULL DEFAULT 'STOCK',
      ADD COLUMN IF NOT EXISTS track_inventory BOOLEAN NOT NULL DEFAULT TRUE;

    ALTER TABLE invoice_line_items
      ADD COLUMN IF NOT EXISTS supplier_product_code TEXT,
      ADD COLUMN IF NOT EXISTS unit_of_measure TEXT,
      ADD COLUMN IF NOT EXISTS stock_decision TEXT,
      ADD COLUMN IF NOT EXISTS stock_decision_reason TEXT,
      ADD COLUMN IF NOT EXISTS stock_decision_by TEXT,
      ADD COLUMN IF NOT EXISTS stock_decision_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS match_candidates TEXT;

    CREATE INDEX IF NOT EXISTS idx_line_items_decision
      ON invoice_line_items(stock_decision);

    CREATE INDEX IF NOT EXISTS idx_products_inventory_type
      ON products(inventory_type);
  `);

  // A product can occupy more than one bin. Real stock sheets show the same
  // part in several places — a fast-moving bolt in two racks, a lube oil
  // across four shelves — and every one of those bins is written on a sign-out
  // sheet at some point, so every one has to resolve. products.bin_location
  // stays the primary bin a person sees; this table is the full set.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS product_bins (
      id TEXT PRIMARY KEY,

      product_id TEXT NOT NULL,

      -- As written, and in the punctuation-free form the matcher compares.
      bin TEXT NOT NULL,
      normalized_bin TEXT NOT NULL,

      source TEXT,

      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

      FOREIGN KEY (product_id)
        REFERENCES products(id)
        ON DELETE CASCADE,

      FOREIGN KEY (created_by)
        REFERENCES users(id)
        ON DELETE SET NULL,

      UNIQUE (product_id, normalized_bin)
    );

    CREATE INDEX IF NOT EXISTS idx_product_bins_normalized
      ON product_bins(normalized_bin);

    CREATE INDEX IF NOT EXISTS idx_product_bins_product
      ON product_bins(product_id);
  `);

  // Line items carry their resolved product so an invoice can be re-examined
  // later without re-running the matcher.
  await pool.query(`
    ALTER TABLE invoice_line_items
      ADD COLUMN IF NOT EXISTS product_id TEXT,
      ADD COLUMN IF NOT EXISTS match_confidence NUMERIC,
      ADD COLUMN IF NOT EXISTS match_method TEXT;

    CREATE INDEX IF NOT EXISTS idx_line_items_product
      ON invoice_line_items(product_id);
  `);

  // Every deployment needs somewhere for stock to live. More locations can be
  // added later; this one is the default target for movements that do not
  // name one.
  await pool.query(`
    INSERT INTO stock_locations (id, code, name, is_default)
    VALUES ('loc-main', 'MAIN', 'Main Warehouse', TRUE)
    ON CONFLICT (code) DO NOTHING;
  `);

  // -------------------------------------------------------------------------
  // MIGRATIONS
  //
  // CREATE TABLE IF NOT EXISTS never alters an existing table, so columns
  // added after a database was first created must be applied separately.
  // Each statement is idempotent and safe to run on every boot.
  // -------------------------------------------------------------------------

  await pool.query(`
    ALTER TABLE invoices
      ADD COLUMN IF NOT EXISTS account_code TEXT;

    CREATE INDEX IF NOT EXISTS idx_invoices_account_code
      ON invoices(account_code);
  `);

  // -------------------------------------------------------------------------
  // JOBS
  //
  // A job number is the thread that ties an invoice and a stock issue to the
  // same piece of work. The record is deliberately only the number: what a job
  // costs, who it is for and how it is going are all questions for later.
  //
  // A job is never created by detection alone. A number read off a document
  // that matches nothing here raises an approval instead, and only a person
  // saying yes writes a row into this table.
  // -------------------------------------------------------------------------

  await pool.query(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,

      -- As a person writes it: JOB-1001.
      job_number TEXT NOT NULL,

      -- The same number with the formatting taken out, so JOB-1001, JOB 1001
      -- and JOB1001 cannot become three jobs. This is the column uniqueness
      -- is really enforced on.
      normalized_key TEXT NOT NULL,

      -- Where the number was first seen. Kept for traceability only.
      first_source_type TEXT,
      first_source_id TEXT,

      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    -- One job per number, whichever way it was written. The database is the
    -- last line of defence: two people approving the same new number at the
    -- same moment both re-check first, and the loser of the race lands here.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_key
      ON jobs(normalized_key);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_number
      ON jobs(job_number);
  `);

  // A job number found on a document that does not exist yet. Nothing is
  // created from one of these until a person answers it.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS job_approvals (
      id TEXT PRIMARY KEY,

      job_number TEXT NOT NULL,
      normalized_key TEXT NOT NULL,

      -- What the number was read off: INVOICE or STOCK_SHEET, and which one.
      source_type TEXT NOT NULL CHECK (source_type IN ('INVOICE', 'STOCK_SHEET')),
      source_id TEXT NOT NULL,

      -- The sheet line it came from, when a sheet names a job per line.
      source_line_id TEXT,

      status TEXT NOT NULL DEFAULT 'PENDING' CHECK (
        status IN ('PENDING', 'APPROVED', 'REJECTED')
      ),

      -- What the person decided to do instead, when they said no.
      resolution TEXT CHECK (
        resolution IN ('CREATED', 'ASSIGNED_EXISTING', 'UNASSIGNED')
      ),

      resolved_job_id TEXT,
      resolved_by TEXT,
      resolved_at TIMESTAMPTZ,

      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

      FOREIGN KEY (resolved_job_id) REFERENCES jobs(id),
      FOREIGN KEY (resolved_by) REFERENCES users(id)
    );

    -- One question per number per source line. Re-reading a document must not
    -- stack up the same ask.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_job_approvals_source
      ON job_approvals(source_type, source_id, COALESCE(source_line_id, ''), normalized_key);

    CREATE INDEX IF NOT EXISTS idx_job_approvals_pending
      ON job_approvals(status, created_at DESC);
  `);

  // The links themselves. An invoice and a stock movement each point at a job;
  // neither is copied into it.
  await pool.query(`
    ALTER TABLE invoices
      ADD COLUMN IF NOT EXISTS job_id TEXT REFERENCES jobs(id),
      ADD COLUMN IF NOT EXISTS job_reference TEXT;

    CREATE INDEX IF NOT EXISTS idx_invoices_job ON invoices(job_id);

    ALTER TABLE stock_transactions
      ADD COLUMN IF NOT EXISTS job_id TEXT REFERENCES jobs(id);

    CREATE INDEX IF NOT EXISTS idx_stock_transactions_job
      ON stock_transactions(job_id);

    -- A sheet can name a different job on each line, so the line carries its
    -- own reading and its own resolution.
    ALTER TABLE stock_sheet_rows
      ADD COLUMN IF NOT EXISTS raw_job TEXT,
      ADD COLUMN IF NOT EXISTS job_id TEXT REFERENCES jobs(id);

    ALTER TABLE stock_sheets
      ADD COLUMN IF NOT EXISTS job_id TEXT REFERENCES jobs(id);
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
